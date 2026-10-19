export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxFiling } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { logActivity } from '@/lib/logActivity'
import { getFinanceSettings } from '@/lib/finance/settings'
import { periodLastDay, whtQuarterOf } from '@/lib/finance/fiscal'
import {
  errorResponse, toCsv, csvResponse, money2, parseDay, todayKey,
} from '../entries/_lib/common'
import { resolveWhtQuarter, computeWithholdingReturn } from '../entries/_lib/withholdingReturn'
import { maskTin } from '../entries/_lib/print'
import { UPLOAD_URL_RE } from '@/lib/inventory/constants'
import { z } from 'zod'

const PAYEE_LABEL = { COMPANY: 'Company / firm', INDIVIDUAL: 'Individual', NON_RESIDENT: 'Non-resident' }

function recentQuarters(startMonth, count = 8) {
  const out = []
  let q = whtQuarterOf(new Date(), startMonth)
  for (let i = 0; i < count && q; i++) {
    out.push({ key: q.key, label: `${q.label} (FY ${q.fy} Q${q.q})`, dueDate: q.dueDate })
    // step back one quarter: the day before this quarter's first month
    const [y, m] = q.start.split('-').map(Number)
    const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
    q = whtQuarterOf(`${prevMonth}-15`, startMonth)
  }
  return out
}

// GET /api/tax/withholding-return?quarter=2026-27-Q1[&format=csv]
// Section-wise summary (Tofsil-4 style) + payee-wise lines of TDS we deducted in the quarter.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    const sp = new URL(request.url).searchParams
    await connectDB()
    const settings = await getFinanceSettings()
    const startMonth = settings?.fiscalYearStartMonth ?? 7
    const quarter = resolveWhtQuarter(sp.get('quarter'), startMonth)
    const result = await computeWithholdingReturn(quarter)

    const canSeeTin = canDo(session, 'pii.identity.view')
    for (const p of result.payees) if (p.partyTin && !canSeeTin) p.partyTin = maskTin(p.partyTin)

    if (sp.get('format') === 'csv') {
      const rows = [
        ...result.sections.map(s => ({ kind: 'SECTION', ...s })),
        ...result.payees.map(p => ({ kind: 'PAYEE', ...p })),
        { kind: 'TOTAL', section: '', code: '', label: 'Total', count: result.totals.count, payeeCount: result.totals.payeeCount, base: result.totals.base, deducted: result.totals.deducted, deposited: result.totals.deposited, pending: result.totals.pending, challans: [] },
      ]
      const csv = toCsv([
        { label: 'Row',              value: r => r.kind },
        { label: 'Section',          value: r => (r.section ? `s.${r.section}` : '') },
        { label: 'Code',             value: r => r.code ?? '' },
        { label: 'Description',      value: r => (r.kind === 'PAYEE' ? '' : r.label) },
        { label: 'Payee',            value: r => (r.kind === 'PAYEE' ? r.partyName : '') },
        { label: 'Payee TIN',        value: r => (r.kind === 'PAYEE' ? r.partyTin ?? '' : '') },
        { label: 'Payee type',       value: r => (r.kind === 'PAYEE' ? PAYEE_LABEL[r.payeeType] ?? '' : '') },
        { label: 'No. of payees',    value: r => (r.kind === 'PAYEE' ? '' : r.payeeCount) },
        { label: 'No. of payments',  value: r => r.count },
        { label: 'Amount paid',      value: r => money2(r.base) },
        { label: 'Tax deducted',     value: r => money2(r.deducted) },
        { label: 'Deposited',        value: r => money2(r.deposited) },
        { label: 'Not deposited',    value: r => money2(r.pending) },
        { label: 'Challans',         value: r => (r.challans ?? []).join(' ') },
      ], rows)
      return csvResponse(csv, `withholding-return-${quarter.key}.csv`)
    }

    return NextResponse.json({
      data: { ...result, quarters: recentQuarters(startMonth) },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/tax/withholding-return]')
  }
}

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const schema = z.object({
  quarter:           z.string().trim().regex(/^\d{4}-\d{2}-Q[1-4]$/i, 'Quarter must look like 2026-27-Q1'),
  filedAt:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  acknowledgementNo: z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(80).nullable()).optional(),
  attachmentUrl:     z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(500).regex(UPLOAD_URL_RE, 'Attach an uploaded file').nullable()).optional(),
  notes:             z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(1000).nullable()).optional(),
  amend:             z.boolean().optional(),
})

// POST /api/tax/withholding-return — record that the quarter's return (s.177) was filed (tax.returns.file)
//   { quarter, filedAt, acknowledgementNo?, attachmentUrl?, notes?, amend? }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.returns.file')
    if (denied) return denied

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    const d = parsed.data

    await connectDB()
    const settings = await getFinanceSettings()
    const quarter = resolveWhtQuarter(d.quarter, settings?.fiscalYearStartMonth ?? 7)
    const filed = parseDay(d.filedAt)
    if (!filed) return NextResponse.json({ error: 'Enter a valid filing date' }, { status: 422 })
    if (filed.key > todayKey()) return NextResponse.json({ error: 'The filing date cannot be in the future' }, { status: 422 })
    if (filed.key <= periodLastDay(quarter.end)) return NextResponse.json({ error: `The return can be filed only after ${quarter.label} ends` }, { status: 422 })

    const result = await computeWithholdingReturn(quarter)
    const existing = await TaxFiling.findOne({ kind: 'WHT_RETURN', periodKey: quarter.key }).lean()
    const alreadyFiled = existing && ['FILED', 'AMENDED'].includes(existing.status)
    if (alreadyFiled && !d.amend) {
      return NextResponse.json({ error: `The withholding return for ${quarter.label} is already recorded as filed. Tick "Amended return" to replace it.` }, { status: 409 })
    }

    const returnType = alreadyFiled ? 'AMENDED' : (filed.key > quarter.dueDate ? 'LATE' : 'ORIGINAL')
    const history = alreadyFiled
      ? [...(existing.snapshot?.history ?? []), {
          status: existing.status, returnType: existing.returnType, filedAt: existing.filedAt, acknowledgementNo: existing.acknowledgementNo ?? null,
          totals: existing.snapshot?.totals ?? null, supersededAt: new Date(),
        }]
      : (existing?.snapshot?.history ?? [])
    const snapshot = {
      quarter: result.quarter, sections: result.sections, payees: result.payees, totals: result.totals,
      computedAt: new Date(), history,
    }
    const fields = {
      kind: 'WHT_RETURN',
      periodKey: quarter.key,
      periodStart: quarter.start,
      periodEnd: quarter.end,
      fiscalYear: quarter.fy,
      status: returnType === 'AMENDED' ? 'AMENDED' : 'FILED',
      returnType,
      snapshot,
      netPayable: result.totals.deducted,
      filedAt: filed.start,
      filedBy: session.user.id,
      acknowledgementNo: d.acknowledgementNo ?? null,
      attachmentUrl: d.attachmentUrl ?? null,
      notes: d.notes ?? null,
    }

    let filing
    if (existing) {
      filing = await TaxFiling.findOneAndUpdate({ _id: existing._id, updatedAt: existing.updatedAt }, { $set: fields }, { new: true }).lean()
      if (!filing) return NextResponse.json({ error: 'This return was changed by someone else just now — reload and try again' }, { status: 409 })
    } else {
      try {
        filing = (await TaxFiling.create({ ...fields, createdBy: session.user.id })).toObject()
      } catch (err) {
        if (err?.code === 11000) return NextResponse.json({ error: 'This return is being recorded by someone else — reload and try again' }, { status: 409 })
        throw err
      }
    }

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'FILE_RETURN',
      entity: 'TAX_FILING',
      entityId: String(filing._id),
      changes: JSON.stringify({ kind: 'WHT_RETURN', quarter: quarter.key, returnType, filedAt: filed.key, acknowledgementNo: d.acknowledgementNo ?? null, deducted: result.totals.deducted, pending: result.totals.pending }),
      request,
    })

    const warnings = []
    if (result.totals.pending > 0.005) warnings.push(`Tk ${result.totals.pending.toFixed(2)} deducted in this quarter is not yet deposited.`)
    return NextResponse.json({
      data: { id: String(filing._id), status: filing.status, returnType: filing.returnType, filedAt: filing.filedAt, acknowledgementNo: filing.acknowledgementNo ?? null },
      warnings,
    }, { status: existing ? 200 : 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/tax/withholding-return]')
  }
}
