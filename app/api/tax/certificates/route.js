export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { logActivity } from '@/lib/logActivity'
import { maskList, TAX_ENTRY_PII } from '@/lib/pii'
import { getFinanceSettings } from '@/lib/finance/settings'
import { isPeriod, addPeriods, taxPeriodOf } from '@/lib/finance/fiscal'
import { round2, TAX_ENTRY_TYPE_META } from '@/lib/tax/catalog'
import {
  errorResponse, escapeRegex, serializeEntry, partyKeyOf, toCsv, csvResponse, money2, todayKey, num,
  parseIdList, dayKeyOfDate,
} from '../entries/_lib/common'
import {
  CERT_DIRECTION, CERT_ENTRY_TYPES, CERT_TYPE_OF, certificateDue, certificateReadiness,
  planCertificateUpdate, assertOneCertificateGroup,
} from '../entries/_lib/certificates'
import { codeContains, codeEquals } from '@/lib/codes'
import { z } from 'zod'

const TYPES_FOR = {
  COLLECT: { VDS: ['VDS_RECEIVABLE'], TDS: ['TDS_RECEIVABLE'], ALL: ['VDS_RECEIVABLE', 'TDS_RECEIVABLE'] },
  ISSUE:   { VDS: ['VDS_PAYABLE'],    TDS: ['TDS_PAYABLE'],    ALL: ['VDS_PAYABLE', 'TDS_PAYABLE'] },
  ALL:     { VDS: ['VDS_RECEIVABLE', 'VDS_PAYABLE'], TDS: ['TDS_RECEIVABLE', 'TDS_PAYABLE'], ALL: CERT_ENTRY_TYPES },
}

const STATUS_FILTER = {
  PENDING:      ['PENDING'],
  RECEIVED:     ['RECEIVED'],
  ISSUED:       ['ISSUED'],
  DONE:         ['RECEIVED', 'ISSUED'],
  NOT_REQUIRED: ['NOT_REQUIRED'],
}

function decorate(row, settings, today) {
  const out = serializeEntry(row)
  out.direction = CERT_DIRECTION[row.entryType]
  out.certType = CERT_TYPE_OF[row.entryType]
  out.typeLabel = TAX_ENTRY_TYPE_META[row.entryType]?.label ?? row.entryType
  out.partyKey = partyKeyOf(row)
  out.due = certificateDue(row, settings, today)
  if (out.direction === 'ISSUE') out.readiness = certificateReadiness(row, settings)
  return out
}

const CSV_COLUMNS = [
  { label: 'Entry no',         value: r => r.entryNo },
  { label: 'Direction',        value: r => (r.direction === 'COLLECT' ? 'To collect' : 'To issue') },
  { label: 'Certificate',      value: r => (r.certType === 'VDS' ? 'Mushak-6.6 (VDS)' : 'TDS certificate') },
  { label: 'Deduction date',   value: r => r.date },
  { label: 'Party',            value: r => r.partyName },
  { label: 'BIN',              value: r => r.partyBin },
  { label: 'TIN',              value: r => r.partyTin },
  { label: 'Document',         value: r => r.documentNo },
  { label: 'Section / code',   value: r => r.section ?? r.serviceCode },
  { label: 'Base',             value: r => money2(r.baseAmount) },
  { label: 'Amount withheld',  value: r => money2(r.amount) },
  { label: 'Status',           value: r => r.certificate?.status },
  { label: 'Certificate no',   value: r => r.certificate?.number },
  { label: 'Certificate date', value: r => r.certificate?.date },
  { label: 'Due / claim by',   value: r => r.due?.date ?? r.due?.period ?? '' },
  { label: 'Deposit',          value: r => r.deposit?.status },
  { label: 'Challan',          value: r => r.deposit?.challanNo },
]

// GET /api/tax/certificates — certificate tracker
//   ?direction=collect|issue|all&type=VDS|TDS|all&status=PENDING|RECEIVED|ISSUED|DONE|NOT_REQUIRED|all
//   &fiscalYear=&period=&search=&partyKey=&page&limit&format=csv
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    const sp = new URL(request.url).searchParams
    const direction = (sp.get('direction') || 'all').toUpperCase()
    const type = (sp.get('type') || 'all').toUpperCase()
    const status = (sp.get('status') || 'PENDING').toUpperCase()
    if (!TYPES_FOR[direction]) return NextResponse.json({ error: 'direction must be collect, issue or all' }, { status: 400 })
    if (!TYPES_FOR[direction][type]) return NextResponse.json({ error: 'type must be VDS, TDS or all' }, { status: 400 })
    if (status !== 'ALL' && !STATUS_FILTER[status]) return NextResponse.json({ error: 'Unknown certificate status' }, { status: 400 })

    const filter = { status: 'ACTIVE', entryType: { $in: TYPES_FOR[direction][type] } }
    if (status !== 'ALL') filter['certificate.status'] = { $in: STATUS_FILTER[status] }
    const fy = sp.get('fiscalYear')
    if (fy) {
      if (!/^\d{4}(-\d{2})?$/.test(fy)) return NextResponse.json({ error: 'fiscalYear must look like 2026-27' }, { status: 400 })
      filter.fiscalYear = fy
    }
    const period = sp.get('period')
    if (period) {
      if (!isPeriod(period)) return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 })
      filter.period = period
    }
    const search = sp.get('search')?.trim()
    if (search) {
      const rx   = { $regex: escapeRegex(search), $options: 'i' }
      // Document, entry and certificate numbers match with separators ignored
      // (VDS-2610-001 = VDS2610001; a typed number still matches as typed).
      const code = codeContains(search)
      filter.$or = [
        { partyName: rx }, { partyBin: rx },
        ...(code ? [{ documentNo: code }, { entryNo: code }, { 'certificate.number': code }] : []),
      ]
    }
    // Exact certificate number, separators and case ignored (old printed numbers keep working).
    const certNo = sp.get('certificateNo')?.trim()
    if (certNo) filter['certificate.number'] = codeEquals(certNo) ?? certNo

    const pending = status === 'PENDING'
    const sort = pending ? { date: 1, entryNo: 1 } : { date: -1, entryNo: -1 }

    await connectDB()
    const settings = await getFinanceSettings()
    const today = todayKey()

    if (sp.get('format') === 'csv') {
      const rows = await TaxEntry.find(filter).sort(sort).limit(10000).lean()
      const data = maskList(session, rows.map(r => decorate(r, settings, today)), TAX_ENTRY_PII)
      return csvResponse(toCsv(CSV_COLUMNS, data), `tax-certificates-${today}.csv`)
    }

    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50))

    const [rows, total, groups, pendingIssue, pendingCollect] = await Promise.all([
      TaxEntry.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      TaxEntry.countDocuments(filter),
      TaxEntry.aggregate([
        { $match: { status: 'ACTIVE', entryType: { $in: CERT_ENTRY_TYPES }, ...(fy ? { fiscalYear: fy } : {}) } },
        { $group: {
          _id: { t: '$entryType', s: { $ifNull: ['$certificate.status', 'NOT_REQUIRED'] } },
          count: { $sum: 1 },
          amount: { $sum: '$amount' },
        } },
      ]),
      TaxEntry.find({ status: 'ACTIVE', entryType: { $in: ['VDS_PAYABLE', 'TDS_PAYABLE'] }, 'certificate.status': 'PENDING' })
        .select('entryType date period amount partyBin deposit certificate filingId status').lean(),
      TaxEntry.find({ status: 'ACTIVE', entryType: 'VDS_RECEIVABLE', 'certificate.status': 'PENDING', claimPeriod: null })
        .select('entryType period amount claimDeadline claimPeriod certificate status').lean(),
    ])

    const bucket = () => ({ count: 0, amount: 0 })
    const summary = {
      collect: {
        VDS: { pending: bucket(), received: bucket(), expiring: bucket(), expired: bucket() },
        TDS: { pending: bucket(), received: bucket() },
      },
      issue: {
        VDS: { pending: bucket(), issued: bucket(), ready: bucket(), overdue: bucket() },
        TDS: { pending: bucket(), issued: bucket(), ready: bucket(), overdue: bucket() },
      },
    }
    const add = (b, n, amt) => { b.count += n; b.amount = round2(b.amount + num(amt)) }
    for (const g of groups) {
      const t = g._id.t
      const s = g._id.s
      const dir = CERT_DIRECTION[t] === 'COLLECT' ? summary.collect : summary.issue
      const k = CERT_TYPE_OF[t]
      if (s === 'PENDING') add(dir[k].pending, g.count, g.amount)
      else if (s === 'RECEIVED' && dir[k].received) add(dir[k].received, g.count, g.amount)
      else if (s === 'ISSUED' && dir[k].issued) add(dir[k].issued, g.count, g.amount)
    }
    for (const e of pendingIssue) {
      const k = CERT_TYPE_OF[e.entryType]
      if (certificateReadiness(e, settings).ready) add(summary.issue[k].ready, 1, e.amount)
      if (certificateDue(e, settings, today)?.overdue) add(summary.issue[k].overdue, 1, e.amount)
    }
    const expiringBy = addPeriods(taxPeriodOf(new Date()), 1)
    for (const e of pendingCollect) {
      const due = certificateDue(e, settings, today)
      if (!due?.period) continue
      if (due.overdue) add(summary.collect.VDS.expired, 1, e.amount)
      else if (due.period <= expiringBy) add(summary.collect.VDS.expiring, 1, e.amount)
    }

    return NextResponse.json({
      data: maskList(session, rows.map(r => decorate(r, settings, today)), TAX_ENTRY_PII),
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      summary,
      registrationType: settings?.vat?.registrationType ?? 'REGISTERED',
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/tax/certificates]')
  }
}

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const bulkSchema = z.object({
  entryIds: z.array(z.string()).min(1, 'Select at least one entry').max(200),
  status:   z.enum(['PENDING', 'RECEIVED', 'ISSUED', 'NOT_REQUIRED']).optional(),
  number:   z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(60).nullable()).optional(),
  date:     z.preprocess(v => (empty(v) ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable()).optional(),
  url:      z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(500).nullable()).optional(),
})

// POST /api/tax/certificates — record one certificate covering several entries of one party (tax.manage)
//   { entryIds:[...], number, date, url?, status? }   receivables ⇒ RECEIVED, payables ⇒ ISSUED
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.manage')
    if (denied) return denied

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = bulkSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const ids = parseIdList(parsed.data.entryIds, { max: 200, field: 'entryIds' })
    await connectDB()
    const entries = await TaxEntry.find({ _id: { $in: ids } }).lean()
    if (entries.length !== ids.length) return NextResponse.json({ error: 'Some selected entries were not found — reload and try again' }, { status: 404 })
    assertOneCertificateGroup(entries)

    const input = { status: parsed.data.status, number: parsed.data.number, date: parsed.data.date, url: parsed.data.url }
    // Every entry is checked before anything is written; entries that cannot be
    // certified yet (e.g. TDS not deposited) are all listed.
    const plans = []
    const blockers = []
    for (const e of entries) {
      try { plans.push({ e, set: planCertificateUpdate(e, input) }) } catch (err) {
        if (err?.status !== 409) throw err
        blockers.push(err.message)
      }
    }
    if (blockers.length) {
      return NextResponse.json({
        error: blockers.length === 1 ? blockers[0] : `${blockers.length} of the selected entries cannot be certified yet — ${blockers[0]}`,
        details: blockers,
      }, { status: 409 })
    }
    // Each write is conditional on the entry being unchanged since it was checked
    // (e.g. a deposit voided meanwhile re-opens it), like the single-entry save.
    // On a lost race the entries already written are put back: all or nothing.
    const written = []
    let lost = false
    for (const { e, set } of plans) {
      const r = await TaxEntry.updateOne({ _id: e._id, status: 'ACTIVE', updatedAt: e.updatedAt }, { $set: set })
      if (!(r.matchedCount ?? r.n ?? 0)) { lost = true; break }
      written.push({ e, set })
    }
    if (lost) {
      for (const { e, set } of written) {
        const prev = e.certificate ?? {}
        await TaxEntry.updateOne(
          { _id: e._id, 'certificate.status': set['certificate.status'], 'certificate.number': set['certificate.number'] ?? null },
          { $set: {
            'certificate.status': prev.status ?? 'NOT_REQUIRED', 'certificate.number': prev.number ?? null,
            'certificate.date': prev.date ?? null, 'certificate.url': prev.url ?? null,
          } },
        ).catch(err => console.error('[POST /api/tax/certificates] undo failed', e._id, err))
      }
      return NextResponse.json({ error: 'Some entries were changed or voided meanwhile — reload and try again' }, { status: 409 })
    }

    const first = plans[0].set
    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'UPDATE',
      entity: 'TAX_ENTRY',
      entityId: String(entries[0]._id),
      changes: JSON.stringify({
        certificate: { status: first['certificate.status'], number: first['certificate.number'] ?? null, date: first['certificate.date'] ? dayKeyOfDate(first['certificate.date']) : null },
        entries: entries.map(e => e.entryNo),
        party: entries[0].partyName ?? null,
      }),
      request,
    })

    const fresh = await TaxEntry.find({ _id: { $in: ids } }).lean()
    const settings = await getFinanceSettings()
    return NextResponse.json({ data: maskList(session, fresh.map(r => decorate(r, settings, todayKey())), TAX_ENTRY_PII) })
  } catch (err) {
    return errorResponse(err, '[POST /api/tax/certificates]')
  }
}
