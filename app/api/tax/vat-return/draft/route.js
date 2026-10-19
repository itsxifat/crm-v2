export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxFiling } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { computeVatReturn, vatReturnPeriodKey, vatReturnRangeProblem } from '@/lib/tax/vatReturn'
import { getFinanceSettings } from '@/lib/finance/settings'
import { fiscalYearOf, periodRange } from '@/lib/finance/fiscal'
import { draftSchema, cleanChallans } from '../_lib/schemas'
import { filingView, FILED_STATUSES } from '../_lib/server'

// POST /api/tax/vat-return/draft
// Body: { start, end, challans?: [{ challanNo, date, bank, branch, accountCode, amount, head?: 'VAT'|'SD' }], refundRequested?, notes? }
// Refused (422 / 409) for a range that splits the single Jul–Sep 2026 return or overlaps a filed return.
// Saves the treasury challans / refund request / notes of a return that is being prepared as a DRAFT
// TaxFiling, so they count in note 58 / 67 before filing and deposits can be linked to the filing id.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.returns.file')
    if (denied) return denied

    const body = await request.json().catch(() => null)
    const parsed = draftSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const d = parsed.data

    await connectDB()
    const periodKey = vatReturnPeriodKey(d.start, d.end)
    const existing = await TaxFiling.findOne({ kind: 'VAT_RETURN', periodKey }).lean()
    if (existing && FILED_STATUSES.includes(existing.status)) {
      return NextResponse.json({ error: 'This return is already filed — file an amended return to change it' }, { status: 409 })
    }
    // A draft is only useful for a range that can be filed: not one that splits the
    // single Jul–Sep 2026 return, nor one overlapping a filed return.
    const problem = await vatReturnRangeProblem(d.start, d.end)
    if (problem) {
      return NextResponse.json({ error: problem.message, code: problem.code, suggest: problem.suggest ?? null }, { status: problem.status })
    }

    const challans = cleanChallans(d.challans)
    const computed = await computeVatReturn({
      start: d.start,
      end: d.end,
      challans: challans ?? undefined,
      refundRequested: d.refundRequested ?? undefined,
    })
    if (computed.refundRequested > computed.closingBalance + 0.005) {
      return NextResponse.json({
        error: `Refund requested cannot exceed the closing balance of this return (Tk ${computed.closingBalance.toFixed(2)})`,
      }, { status: 422 })
    }

    const settings = await getFinanceSettings()
    const set = {
      periodStart:     d.start,
      periodEnd:       d.end,
      fiscalYear:      fiscalYearOf(periodRange(d.end).start, settings?.fiscalYearStartMonth ?? 7),
      netPayable:      computed.notes[50],
      closingBalance:  computed.closingBalance,
      refundRequested: computed.refundRequested,
      challans:        computed.challans,
    }
    if (d.notes !== undefined) set.notes = d.notes

    let filing
    try {
      filing = await TaxFiling.findOneAndUpdate(
        { kind: 'VAT_RETURN', periodKey, status: 'DRAFT' },
        {
          $set: set,
          // kind / periodKey / status are seeded from the filter on insert.
          $setOnInsert: { returnType: 'ORIGINAL', createdBy: session.user.id },
        },
        { new: true, upsert: true, runValidators: true },
      ).lean()
    } catch (err) {
      // The return was filed between the check above and the upsert.
      if (err?.code === 11000) return NextResponse.json({ error: 'This return was just filed by someone else — reload the page' }, { status: 409 })
      throw err
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   existing ? 'UPDATE' : 'CREATE',
      entity:   'TAX_FILING',
      entityId: filing._id.toString(),
      changes:  JSON.stringify({
        kind: 'VAT_RETURN',
        periodKey,
        status: 'DRAFT',
        challans: { from: existing?.challans?.length ?? 0, to: filing.challans?.length ?? 0 },
        refundRequested: { from: existing?.refundRequested ?? 0, to: filing.refundRequested ?? 0 },
        netPayable: filing.netPayable,
      }),
      request,
    })

    return NextResponse.json({ data: filingView(filing) }, { status: existing ? 200 : 201 })
  } catch (err) {
    if (err?.status && err.status < 500) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[POST /api/tax/vat-return/draft]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
