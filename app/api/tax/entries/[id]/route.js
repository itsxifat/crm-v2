export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry, Transaction, MoneyAccount } from '@/models'
import { canDo, canDoAny } from '@/lib/rbac'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { maskDoc, stripMaskedValues, TAX_ENTRY_PII } from '@/lib/pii'
import { voidTaxEntry, getTdsSection } from '@/lib/tax/engine'
import { reverseMoneyEntry } from '@/lib/finance/ledger'
import { getFinanceSettings, assertBooksOpen } from '@/lib/finance/settings'
import {
  isValidBin, isValidTin, normalizeBin, normalizeTin, vatReturnNoteOf, TAX_ENTRY_TYPE_META, CLAIM_WINDOW_PERIODS,
} from '@/lib/tax/catalog'
import { challanKeyOf } from '@/lib/tax/challanKey'
import { taxPeriodOf, addPeriods } from '@/lib/finance/fiscal'
import { UPLOAD_URL_RE } from '@/lib/inventory/constants'
import {
  errorResponse, parseDay, serializeEntry, tdsDueInfo, dayKeyOfDate, depositPaidOf, depositBalanceOf, depositAllocationsOf,
} from '../_lib/common'
import {
  planCertificateUpdate, filedFilingOf, certificateDue, certificateReadiness, CERT_DIRECTION,
} from '../_lib/certificates'
import { findActiveChallan } from '../_lib/deposits'
import { z } from 'zod'

const DEPOSIT_TYPES = ['TDS_DEPOSIT', 'VAT_PAYMENT', 'ADVANCE_TAX']

const DETAIL_POPULATE = [
  { path: 'createdBy', select: 'name' },
  { path: 'voidedBy', select: 'name' },
  { path: 'filingId', select: 'kind periodKey status filedAt' },
  { path: 'invoiceId', select: 'invoiceNumber status clientId' },
  { path: 'creditNoteId', select: 'noteNo kind' },
  { path: 'expenseId', select: 'expenseId title amount currency status' },
  { path: 'purchaseBillId', select: 'billNo' },
  { path: 'assetId', select: 'assetTag name' },
  { path: 'transactionId', select: 'txnId amount kind category date accountId', populate: { path: 'accountId', select: 'name type last4' } },
  { path: 'settledEntryIds', select: 'entryNo entryType date amount partyName section documentNo certificate' },
  { path: 'deposit.depositEntryId', select: 'entryNo documentNo date amount' },
]

/** Where an entry came from (system-generated entries must be corrected at their source). */
function sourceOf(e) {
  const id = (v) => (v && typeof v === 'object' ? String(v._id ?? v.id ?? '') : v ? String(v) : null)
  if (e.isOpening) return { type: 'OPENING', label: 'Opening balance', href: '/admin/finance/opening-balances' }
  if (e.creditNoteId) {
    return {
      type: 'CREDIT_NOTE',
      label: `Credit/debit note ${e.creditNoteId?.noteNo ?? ''}`.trim(),
      href: e.invoiceId ? `/admin/tax/notes?invoiceId=${id(e.invoiceId)}` : '/admin/tax/notes',
      printHref: `/api/credit-notes/${id(e.creditNoteId)}/print`,
    }
  }
  if (e.invoiceId) return { type: 'INVOICE', label: `Invoice ${e.invoiceId?.invoiceNumber ?? ''}`.trim(), href: `/admin/invoices/${id(e.invoiceId)}` }
  if (e.purchaseBillId) return { type: 'PURCHASE_BILL', label: `Purchase bill ${e.purchaseBillId?.billNo ?? ''}`.trim(), href: `/admin/inventory/purchases/${id(e.purchaseBillId)}` }
  if (e.assetId) return { type: 'ASSET', label: `Asset ${e.assetId?.assetTag ?? ''}`.trim(), href: `/admin/inventory/assets/${id(e.assetId)}` }
  if (e.expenseId) return { type: 'EXPENSE', label: `Expense ${e.expenseId?.expenseId ?? ''}`.trim(), href: '/admin/accounts?tab=requests' }
  if (e.projectPaymentId) return { type: 'PAYMENT', label: 'Client payment', href: null }
  // AIT the bank deducted from interest, recorded with an "Interest received" money movement.
  if (e.entryType === 'TDS_RECEIVABLE' && e.transactionId) {
    const acc = id(e.transactionId?.accountId)
    return { type: 'MOVEMENT', label: 'Interest received (money movement)', href: acc ? `/admin/finance/accounts/${acc}?tab=activity` : '/admin/finance/accounts' }
  }
  return { type: 'MANUAL', label: 'Manual entry', href: null }
}

/** Why this entry cannot be voided here (null when it can). */
function voidBlocker(e) {
  if (e.status === 'VOID') return 'This entry is already void'
  const src = sourceOf(e)
  if (src.type === 'OPENING') return 'Opening balances are changed under Finance → Opening balances'
  if (src.type === 'EXPENSE') {
    return `Created when ${src.label} was paid — to correct it, reverse that payment in Accounts → Payment requests → "Reverse payment" (this voids its VAT / VDS / TDS entries and puts the request back to Pending), then pay it again with the right details`
  }
  if (['VDS_RECEIVABLE', 'TDS_RECEIVABLE'].includes(e.entryType) && e.projectPaymentId) {
    const inv = e.invoiceId && typeof e.invoiceId === 'object' ? e.invoiceId.invoiceNumber : null
    return `Created when a client payment${inv ? ` on invoice ${inv}` : ''} was recorded — to correct it, reverse that payment in Accounts → Payment confirmations → "Reverse payment" (this voids its VDS / TDS entries and takes the payment off the invoice), then record it again with the right details`
  }
  if (src.type === 'MOVEMENT') {
    // Voiding it alone would leave the interest in the P&L at the gross amount.
    return 'Recorded with the interest received — reverse that money movement under Finance → Money accounts (it voids this entry too), then record it again'
  }
  if (src.type !== 'MANUAL') return `Created from ${src.label} — correct it there`
  if (['TDS_PAYABLE', 'VDS_PAYABLE'].includes(e.entryType) && depositPaidOf(e) > 0) {
    const challans = [...new Set(depositAllocationsOf(e).map(a => a.challanNo).filter(Boolean))].join(', ')
    return e.deposit?.status === 'DEPOSITED'
      ? `Deposited by challan ${challans} — void that deposit first`.replace('  ', ' ')
      : `Part-deposited by challan ${challans} — void that deposit first`.replace('  ', ' ')
  }
  if (CERT_DIRECTION[e.entryType] === 'ISSUE' && e.certificate?.status === 'ISSUED') {
    return `On certificate ${e.certificate?.number ?? ''} issued to the party`.trim()
  }
  const certified = (e.settledEntryIds ?? []).find(s => s && typeof s === 'object' && s.certificate?.status === 'ISSUED')
  if (certified) {
    return `Certificate ${certified.certificate?.number ?? ''} was issued for ${certified.entryNo} with this challan — correct the challan details instead, or reset that certificate to pending first`.replace('  ', ' ')
  }
  return null
}

// GET /api/tax/entries/[id] — one tax entry with its links, money rows and flags
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const entry = await TaxEntry.findById(params.id).populate(DETAIL_POPULATE).lean()
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [transactions, settings] = await Promise.all([
      Transaction.find({ taxEntryIds: entry._id })
        .select('txnId type kind category amount date accountId reversalOf description')
        .populate('accountId', 'name type last4')
        .sort({ date: 1 }).lean(),
      getFinanceSettings(),
    ])
    const reversed = transactions.length
      ? await Transaction.find({ reversalOf: { $in: transactions.map(t => t._id) } }).select('reversalOf txnId date').lean()
      : []
    const reversedBy = new Map(reversed.map(r => [String(r.reversalOf), r]))

    const data = serializeEntry(entry)
    data.typeLabel = TAX_ENTRY_TYPE_META[entry.entryType]?.label ?? entry.entryType
    data.note = vatReturnNoteOf(entry)
    data.source = sourceOf(entry)
    if (entry.entryType === 'TDS_PAYABLE' && entry.deposit?.status === 'PENDING') data.depositDue = tdsDueInfo(entry)
    if (['TDS_PAYABLE', 'VDS_PAYABLE'].includes(entry.entryType)) {
      data.depositPaid = depositPaidOf(entry)
      data.depositBalance = depositBalanceOf(entry)
    }
    // TDS section as configured (custom sections / Tax-settings edits), not only the catalog.
    if (entry.section) {
      const row = await getTdsSection(entry.section, entry.date).catch(() => null)
      data.sectionInfo = row
        ? {
            code: row.code, section: row.section ?? null, label: row.label ?? null, basis: row.basis ?? 'GROSS',
            rateCompany: row.rateCompany ?? null, rateIndividual: row.rateIndividual ?? null,
            commissionRate: row.commissionRate ?? null, grossRate: row.grossRate ?? null,
          }
        : null
    }
    if (CERT_DIRECTION[entry.entryType]) {
      data.certificateDue = certificateDue(entry, settings)
      if (CERT_DIRECTION[entry.entryType] === 'ISSUE') data.certificateReadiness = certificateReadiness(entry, settings)
    }
    data.transactions = transactions.map(t => ({
      id: String(t._id), txnId: t.txnId, type: t.type, kind: t.kind, category: t.category, amount: Number(t.amount) || 0,
      date: t.date, description: t.description,
      account: t.accountId ? { id: String(t.accountId._id), name: t.accountId.name, type: t.accountId.type, last4: t.accountId.last4 ?? null } : null,
      reversal: t.reversalOf ? true : false,
      reversedBy: reversedBy.get(String(t._id))?.txnId ?? null,
    }))
    const blocker = voidBlocker(entry)
    const filed = await filedFilingOf({ filingId: entry.filingId?._id ?? entry.filingId })
    data.permissions = {
      canVoid: !blocker && !filed && (DEPOSIT_TYPES.includes(entry.entryType)
        ? canDoAny(session, ['tax.deposits.manage', 'tax.manage'])
        : canDo(session, 'tax.manage')),
      voidBlockedReason: blocker ?? (filed ? `Included in the filed return ${filed.periodKey}` : null),
      canEdit: canDo(session, 'tax.manage'),
      inFiledReturn: !!filed,
    }
    return NextResponse.json({ data: maskDoc(session, data, TAX_ENTRY_PII) })
  } catch (err) {
    return errorResponse(err, '[GET /api/tax/entries/[id]]')
  }
}

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const optText = (max) => z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(max).nullable()).optional()

const updateSchema = z.object({
  notes:        optText(2000),
  documentNo:   optText(80),
  documentDate: z.preprocess(v => (empty(v) ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()).optional(),
  attachments:  z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  partyName:    optText(200),
  partyBin:     optText(20),
  partyTin:     optText(20),
  partyAddress: optText(500),
  certificate:  z.object({
    status: z.enum(['NOT_REQUIRED', 'PENDING', 'RECEIVED', 'ISSUED']).optional(),
    number: optText(60),
    date:   z.preprocess(v => (empty(v) ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()).optional(),
    url:    optText(500),
  }).optional(),
  // ADVANCE_TAX: which s.155 instalment the challan paid (null = not stated).
  instalment:   z.preprocess(v => (empty(v) ? null : v), z.coerce.number().int().min(1).max(4).nullable()).optional(),
}).strict()

const voidSchema = z.object({
  action: z.literal('void'),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
})

// PUT /api/tax/entries/[id]
//   { action:'void', reason }                     void (deposits also reverse their money rows)
//   { notes, documentNo, documentDate, attachments, partyName, partyBin, partyTin, partyAddress, certificate, instalment }
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, ['tax.manage', 'tax.deposits.manage'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let raw
    try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

    await connectDB()
    const entry = await TaxEntry.findById(params.id).lean()
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // ── void ────────────────────────────────────────────────────────────────
    if (raw?.action === 'void') {
      const allowed = DEPOSIT_TYPES.includes(entry.entryType)
        ? canDoAny(session, ['tax.deposits.manage', 'tax.manage'])
        : canDo(session, 'tax.manage')
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const parsed = voidSchema.safeParse(raw)
      if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

      const populated = await TaxEntry.findById(entry._id).populate(DETAIL_POPULATE.slice(2)).lean()
      const blocker = voidBlocker(populated)
      if (blocker) return NextResponse.json({ error: blocker }, { status: 409 })

      // Money rows to reverse (deposits / advance tax paid from an account).
      let toReverse = []
      if (DEPOSIT_TYPES.includes(entry.entryType)) {
        const txs = await Transaction.find({ taxEntryIds: entry._id, reversalOf: null }).select('_id txnId accountId').lean()
        const already = new Set((await Transaction.find({ reversalOf: { $in: txs.map(t => t._id) } }).select('reversalOf').lean()).map(r => String(r.reversalOf)))
        toReverse = txs.filter(t => !already.has(String(t._id)))
        if (toReverse.length) {
          const locked = await assertBooksOpen(new Date())
          if (locked) return NextResponse.json({ error: `${locked} — the deposit's payment cannot be reversed today` }, { status: 409 })
          const accountIds = toReverse.map(t => t.accountId).filter(Boolean)
          if (accountIds.length) {
            const archived = await MoneyAccount.findOne({ _id: { $in: accountIds }, status: { $ne: 'ACTIVE' } }).select('name').lean()
            if (archived) return NextResponse.json({ error: `${archived.name} is archived — reactivate it to reverse this payment` }, { status: 409 })
          }
        }
      }

      // requireActive: a double submit gets 409 here instead of reversing the money rows twice.
      const voided = await voidTaxEntry(entry._id, { reason: parsed.data.reason, userId: session.user.id, requireActive: true })

      const reversals = []
      const warnings = []
      for (const t of toReverse) {
        try {
          const rev = await reverseMoneyEntry(t._id, { userId: session.user.id, reason: `Tax entry ${entry.entryNo} voided: ${parsed.data.reason}` })
          reversals.push({ original: t.txnId, reversal: rev.txnId })
        } catch (err) {
          console.error('[PUT /api/tax/entries/[id]] reversal failed', t._id, err)
          warnings.push(`The payment ${t.txnId ?? t._id} could not be reversed (${err.message}) — reverse it in Accounts.`)
        }
      }

      logActivity({
        userId: session.user.id,
        userRole: session.user.role,
        action: 'VOID',
        entity: 'TAX_ENTRY',
        entityId: entry._id.toString(),
        changes: JSON.stringify({ entryNo: entry.entryNo, entryType: entry.entryType, amount: entry.amount, reason: parsed.data.reason, reversals, released: (entry.settledEntryIds ?? []).length }),
        request,
      })

      return NextResponse.json({ data: serializeEntry(voided.toObject ? voided.toObject() : voided), reversals, warnings })
    }

    // ── update ──────────────────────────────────────────────────────────────
    if (!canDo(session, 'tax.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = stripMaskedValues(raw) ?? {}
    delete body.action
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    const d = parsed.data

    const set = {}
    const changes = {}
    const track = (field, from, to) => {
      const a = from instanceof Date ? dayKeyOfDate(from) : (from ?? null)
      const b = to instanceof Date ? dayKeyOfDate(to) : (to ?? null)
      if (JSON.stringify(a) !== JSON.stringify(b)) changes[field] = { from: a, to: b }
    }

    if (entry.status === 'VOID') {
      const keys = Object.keys(d).filter(k => k !== 'notes')
      if (keys.length) return NextResponse.json({ error: 'A void entry can only have its notes changed' }, { status: 409 })
    }

    if (d.notes !== undefined) { set.notes = d.notes; track('notes', entry.notes, d.notes) }
    if (d.attachments !== undefined) {
      // New links must be uploaded files; links already on the entry may be sent back unchanged.
      const kept = new Set((entry.attachments ?? []).map(String))
      if (d.attachments.some(u => !kept.has(u) && !UPLOAD_URL_RE.test(u))) {
        return NextResponse.json({ error: 'Attach files with the upload button' }, { status: 422 })
      }
      set.attachments = d.attachments
      track('attachments', entry.attachments?.length ?? 0, d.attachments.length)
    }

    const filed = await filedFilingOf(entry)
    const partyKeys = ['partyName', 'partyBin', 'partyTin', 'partyAddress', 'documentDate']
    if (partyKeys.some(k => d[k] !== undefined) && filed) {
      return NextResponse.json({ error: `This entry is part of the filed return ${filed.periodKey} — party and date details are frozen` }, { status: 409 })
    }
    if (d.partyName !== undefined) {
      if (!d.partyName) return NextResponse.json({ error: 'Party name cannot be empty' }, { status: 422 })
      set.partyName = d.partyName; track('partyName', entry.partyName, d.partyName)
    }
    if (d.partyBin !== undefined) {
      if (d.partyBin && !isValidBin(d.partyBin)) return NextResponse.json({ error: 'BIN is 9 or 13 digits, e.g. 000123456-0101' }, { status: 422 })
      const v = d.partyBin ? normalizeBin(d.partyBin) : null
      set.partyBin = v; track('partyBin', entry.partyBin, v)
    }
    if (d.partyTin !== undefined) {
      if (!canDo(session, 'pii.identity.view')) return NextResponse.json({ error: 'You do not have permission to change TINs' }, { status: 403 })
      if (d.partyTin && !isValidTin(d.partyTin)) return NextResponse.json({ error: 'TIN is 12 digits' }, { status: 422 })
      const v = d.partyTin ? normalizeTin(d.partyTin) : null
      set.partyTin = v
      if ((entry.partyTin ?? null) !== v) changes.partyTin = v ? 'updated' : 'cleared'
    }
    if (d.partyAddress !== undefined) { set.partyAddress = d.partyAddress; track('partyAddress', entry.partyAddress, d.partyAddress) }
    if (d.documentDate !== undefined) {
      const dd = d.documentDate ? parseDay(d.documentDate) : null
      if (d.documentDate && !dd) return NextResponse.json({ error: 'Invalid document date' }, { status: 422 })
      set.documentDate = dd?.start ?? null; track('documentDate', entry.documentDate, set.documentDate)
      // s.46: input VAT is claimable in the Mushak-6.3's own period + 6 — keep the
      // window in step with the document date while the credit is unclaimed.
      if (entry.entryType === 'INPUT_VAT' && !entry.claimPeriod && !entry.isOpening) {
        const deadline = addPeriods(taxPeriodOf(set.documentDate ?? entry.date), CLAIM_WINDOW_PERIODS)
        if (deadline && deadline !== (entry.claimDeadline ?? null)) {
          set.claimDeadline = deadline; track('claimDeadline', entry.claimDeadline, deadline)
        }
      }
    }

    // Document / challan number
    let challanChange = null
    if (d.documentNo !== undefined && (d.documentNo ?? null) !== (entry.documentNo ?? null)) {
      if (DEPOSIT_TYPES.includes(entry.entryType)) {
        if (!d.documentNo) return NextResponse.json({ error: 'The challan number cannot be empty' }, { status: 422 })
        // Same comparison as recording a challan (case, spaces and separators ignored);
        // the unique index on challanKey is the guard against a race.
        const dup = await findActiveChallan(entry.entryType, d.documentNo, { excludeId: entry._id })
        if (dup) return NextResponse.json({ error: `Challan ${d.documentNo} is already recorded (${dup.entryNo})` }, { status: 409 })
        set['deposit.challanNo'] = d.documentNo
        // findOneAndUpdate skips the model's pre('validate') hook — keep the key in step here.
        set.challanKey = entry.isOpening ? null : challanKeyOf(d.documentNo)
        challanChange = d.documentNo
      } else if (filed && entry.entryType === 'OUTPUT_VAT') {
        return NextResponse.json({ error: `This sale is part of the filed return ${filed.periodKey} — its document number is frozen` }, { status: 409 })
      }
      set.documentNo = d.documentNo
      track('documentNo', entry.documentNo, d.documentNo)
    }

    if (d.instalment !== undefined) {
      if (entry.entryType !== 'ADVANCE_TAX') return NextResponse.json({ error: 'Only advance income tax payments have an instalment' }, { status: 422 })
      set.instalment = d.instalment
      track('instalment', entry.instalment ?? null, d.instalment)
    }

    // A Mushak-6.6 already issued must keep the supplier's BIN it was issued to.
    if (set.partyBin !== undefined && !set.partyBin && entry.entryType === 'VDS_PAYABLE' &&
        (d.certificate?.status ?? entry.certificate?.status) === 'ISSUED') {
      return NextResponse.json({ error: `Mushak-6.6 ${entry.certificate?.number ?? ''} was issued to this supplier — its BIN cannot be removed (reset the certificate to pending first)`.replace('  ', ' ') }, { status: 409 })
    }

    if (d.certificate) {
      // Readiness is checked against the entry as it will be saved (a BIN may be added in the same request).
      const certEntry = set.partyBin !== undefined ? { ...entry, partyBin: set.partyBin } : entry
      const certSet = planCertificateUpdate(certEntry, d.certificate)
      Object.assign(set, certSet)
      track('certificate', entry.certificate ?? null, {
        status: certSet['certificate.status'],
        number: certSet['certificate.number'] ?? null,
        date: certSet['certificate.date'] ? dayKeyOfDate(certSet['certificate.date']) : null,
      })
    }

    if (!Object.keys(set).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

    let updated
    try {
      updated = await TaxEntry.findOneAndUpdate(
        { _id: entry._id, updatedAt: entry.updatedAt },
        { $set: set },
        { new: true, runValidators: true },
      ).populate(DETAIL_POPULATE).lean()
    } catch (err) {
      if (err?.code === 11000 && (err.keyPattern?.challanKey || /uniq_active_deposit_challan/.test(String(err.message ?? '')))) {
        return NextResponse.json({ error: `Challan ${d.documentNo} is already recorded` }, { status: 409 })
      }
      throw err
    }
    if (!updated) return NextResponse.json({ error: 'This entry was changed by someone else just now — reload and try again' }, { status: 409 })

    if (challanChange && entry.settledEntryIds?.length) {
      // The payables this challan completed, and its share recorded on each payable it paid.
      await TaxEntry.updateMany(
        { _id: { $in: entry.settledEntryIds }, 'deposit.depositEntryId': entry._id },
        { $set: { 'deposit.challanNo': challanChange } },
      )
      await TaxEntry.updateMany(
        { _id: { $in: entry.settledEntryIds }, 'deposit.allocations.depositEntryId': entry._id },
        { $set: { 'deposit.allocations.$[a].challanNo': challanChange } },
        { arrayFilters: [{ 'a.depositEntryId': entry._id }] },
      )
    }

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'UPDATE',
      entity: 'TAX_ENTRY',
      entityId: entry._id.toString(),
      changes: JSON.stringify({ entryNo: entry.entryNo, ...changes }),
      request,
    })

    const data = serializeEntry(updated)
    data.typeLabel = TAX_ENTRY_TYPE_META[updated.entryType]?.label ?? updated.entryType
    data.note = vatReturnNoteOf(updated)
    data.source = sourceOf(updated)
    return NextResponse.json({ data: maskDoc(session, data, TAX_ENTRY_PII) })
  } catch (err) {
    return errorResponse(err, '[PUT /api/tax/entries/[id]]')
  }
}
