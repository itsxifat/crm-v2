export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxFiling } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { fileVatReturn, vatReturnPeriodKey, laterVatReturnsToAmend } from '@/lib/tax/vatReturn'
import { fileSchema, cleanChallans } from '../_lib/schemas'
import { filingView, FILED_STATUSES } from '../_lib/server'

// POST /api/tax/vat-return/file
// Body: { start, end, returnType?, acknowledgementNo?, filedAt?: 'YYYY-MM-DD', challans?: [{ challanNo, date, bank, branch, accountCode, amount }],
//         refundRequested?, notes? }
// Freezes the computed Mushak-9.1 into a FILED TaxFiling (or AMENDED when returnType 'AMENDED' and the
// period is already filed — 'AMENDED' for a period never filed is refused with 422), marks the claimed
// credits, links the entries and locks VAT entries up to the period end.
// → { data, amended, laterReturns: [periodKey], warning: string|null } — laterReturns are filed later
//   returns whose brought-forward balance (note 52) no longer matches this return; amend them in order.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.returns.file')
    if (denied) return denied

    const body = await request.json().catch(() => null)
    const parsed = fileSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const d = parsed.data

    await connectDB()

    const periodKey = vatReturnPeriodKey(d.start, d.end)
    const before = await TaxFiling.findOne({ kind: 'VAT_RETURN', periodKey }).select('status returnType netPayable closingBalance').lean()
    const wasFiled = !!before && FILED_STATUSES.includes(before.status)
    if (wasFiled && d.returnType !== 'AMENDED') {
      return NextResponse.json({
        error: 'This return is already filed. Choose return type "Amended (s.66)" to file a correction.',
      }, { status: 409 })
    }
    if (!wasFiled && d.returnType === 'AMENDED') {
      return NextResponse.json({
        error: 'This return has not been filed yet — there is nothing to amend. Choose "Original (s.64)" or "Late (s.65)".',
      }, { status: 422 })
    }

    const filing = await fileVatReturn({
      start:             d.start,
      end:               d.end,
      returnType:        d.returnType ?? undefined,
      acknowledgementNo: d.acknowledgementNo ?? null,
      filedAt:           d.filedAt ?? undefined,
      challans:          cleanChallans(d.challans),
      notes:             d.notes ?? null,
      refundRequested:   d.refundRequested ?? undefined,
      userId:            session.user.id,
    })

    // Later filed returns that brought forward the earlier closing balance (note 52).
    const laterReturns = await laterVatReturnsToAmend(filing).catch((err) => {
      console.error('[POST /api/tax/vat-return/file] later returns check failed', err)
      return []
    })
    const warning = laterReturns.length
      ? `Later filed return(s) ${laterReturns.join(', ')} brought forward the earlier closing balance (note 52). File amended returns for them, starting with ${laterReturns[0]}.`
      : null

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'FILE_RETURN',
      entity:   'TAX_FILING',
      entityId: filing._id.toString(),
      changes:  JSON.stringify({
        kind:              'VAT_RETURN',
        periodKey,
        returnType:        filing.returnType,
        status:            { from: before?.status ?? null, to: filing.status },
        netPayable:        { from: wasFiled ? before.netPayable : null, to: filing.netPayable },
        closingBalance:    { from: wasFiled ? before.closingBalance : null, to: filing.closingBalance },
        refundRequested:   filing.refundRequested,
        acknowledgementNo: filing.acknowledgementNo ?? null,
        challans:          (filing.challans ?? []).length,
        laterReturns,
      }),
      request,
    })

    return NextResponse.json(
      { data: filingView(filing.toObject()), amended: wasFiled, laterReturns, warning },
      { status: wasFiled ? 200 : 201 },
    )
  } catch (err) {
    if (err?.status && err.status < 500) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[POST /api/tax/vat-return/file]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
