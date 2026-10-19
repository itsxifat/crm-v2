/**
 * app/api/tax/entries/_lib/deposits.js — SERVER-ONLY challan deposits.
 *
 * recordChallanDeposit() turns a treasury challan into:
 *   - a TaxEntry   TDS_DEPOSIT (kind TDS) | VAT_PAYMENT (kind VDS / VAT) with the
 *                  challan details and the payables it settles (settledEntryIds),
 *   - a Transaction EXPENSE kind TAX_PAYMENT from the money account (no P&L effect),
 *   - optionally a Transaction EXPENSE kind OPERATING 'Tax Interest & Penalties'
 *     for interest paid with the challan (P&L, not tax-deductible),
 *   - and records the challan's share on each payable it pays (deposit.allocations /
 *     paidAmount): paid in full → deposit.status DEPOSITED; paid in part → it stays
 *     PENDING for its balance, which a later challan pays.
 *
 * The payables are claimed atomically first (so two people cannot deposit the
 * same deduction twice); every later failure undoes what was written.
 */

import mongoose from 'mongoose'
import { TaxEntry, TaxFiling, Transaction } from '@/models'
import { recordTaxEntry, depositReleaseFilter, depositReleasePipeline } from '@/lib/tax/engine'
import { challanKeyOf } from '@/lib/tax/challanKey'
import { postMoneyEntry } from '@/lib/finance/ledger'
import { getFinanceSettings, assertBooksOpen } from '@/lib/finance/settings'
import { vatReturnPeriodKey, vatReturnRangeProblem } from '@/lib/tax/vatReturn'
import {
  round2, CHALLAN_CODES, vatChallanCode, tdsChallanCode,
} from '@/lib/tax/catalog'
import {
  isPeriod, taxPeriodOf, addPeriods, periodRange, periodsBetween, periodLabel, fiscalYearOf,
} from '@/lib/finance/fiscal'
import { formatMoney } from '@/lib/currencies'
import {
  httpError, num, str, parseDay, todayKey, dayKeyOfDate, escapeRegex, returnPeriodOf, EPS, depositBalanceOf,
} from './common'

export const DEPOSIT_KIND_META = {
  TDS: { payableType: 'TDS_PAYABLE', depositType: 'TDS_DEPOSIT', category: 'Tax Deposit — TDS', label: 'TDS' },
  VDS: { payableType: 'VDS_PAYABLE', depositType: 'VAT_PAYMENT', category: 'Tax Deposit — VDS', label: 'VDS' },
  VAT: { payableType: null,          depositType: 'VAT_PAYMENT', category: 'VAT Payment',       label: 'VAT' },
}

const tk = (n) => formatMoney(round2(n), 'BDT')

/**
 * The ACTIVE deposit row of `entryType` (TDS_DEPOSIT / VAT_PAYMENT / ADVANCE_TAX)
 * already holding this challan number — case, spaces, '-', '/' and '.' ignored,
 * as in the VAT return — or null. Rows saved before challanKey existed are
 * matched on deposit.challanNo with the same separators ignored.
 */
export async function findActiveChallan(entryType, challanNo, { excludeId = null } = {}) {
  const key = challanKeyOf(challanNo)
  if (!key) return null
  const loose = `^[\\s\\-/.]*${[...key].map(ch => `${escapeRegex(ch)}[\\s\\-/.]*`).join('')}$`
  return TaxEntry.findOne({
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    status: 'ACTIVE',
    entryType,
    $or: [
      { challanKey: key },
      { challanKey: null, 'deposit.challanNo': { $regex: loose, $options: 'i' } },
    ],
  }).select('entryNo').lean()
}

/**
 * The VAT return a payment belongs to. Explicit start/end ('YYYY-MM') are used
 * exactly as given — the same periodKey the VAT return page drafts and files —
 * so the payment counts in that return's note 58 (recordChallanDeposit refuses a
 * range that splits the single Jul–Sep 2026 return or overlaps a filed return);
 * otherwise the return of the last ended period (honouring statutory overrides).
 * @returns {{ start, end, key, label }}
 */
export function resolveVatReturnPeriod({ start, end } = {}, settings) {
  let s = str(start)
  let e = str(end) ?? s
  if (s) {
    if (!isPeriod(s) || !isPeriod(e)) throw httpError(422, 'Return period must be YYYY-MM')
    if (s > e) throw httpError(422, 'Return start must not be after its end')
    if (periodsBetween(s, e).length > 12) throw httpError(422, 'A return covers at most 12 tax periods')
  } else {
    const prev = addPeriods(taxPeriodOf(new Date()), -1)
    const rp = returnPeriodOf(prev, settings?.vat?.returnFrequency)
    s = rp.start
    e = rp.end
  }
  if (s > taxPeriodOf(new Date())) throw httpError(422, 'The return period has not started yet')
  const key = vatReturnPeriodKey(s, e)
  const label = s === e ? periodLabel(s) : `${periodLabel(s)} – ${periodLabel(e)}`
  return { start: s, end: e, key, label }
}

/** Find (or create as DRAFT) the TaxFiling of a VAT return so the payment can be linked to it. */
async function ensureVatFiling(rp, settings, userId) {
  const existing = await TaxFiling.findOne({ kind: 'VAT_RETURN', periodKey: rp.key }).lean()
  if (existing) return { filing: existing, created: false }
  try {
    const filing = await TaxFiling.create({
      kind:        'VAT_RETURN',
      periodKey:   rp.key,
      periodStart: rp.start,
      periodEnd:   rp.end,
      fiscalYear:  fiscalYearOf(periodRange(rp.end).start, settings?.fiscalYearStartMonth ?? 7),
      status:      'DRAFT',
      createdBy:   userId || null,
    })
    return { filing: filing.toObject(), created: true }
  } catch (err) {
    if (err?.code !== 11000) throw err
    const again = await TaxFiling.findOne({ kind: 'VAT_RETURN', periodKey: rp.key }).lean()
    if (!again) throw err
    return { filing: again, created: false }
  }
}

/**
 * @param {object} input
 * @param {'TDS'|'VDS'|'VAT'} input.kind
 * @param {string[]} [input.entryIds]        payables to settle (TDS / VDS)
 * @param {string} [input.returnStart]       VAT: return period start 'YYYY-MM'
 * @param {string} [input.returnEnd]         VAT: return period end 'YYYY-MM'
 * @param {string} input.challanNo
 * @param {string} input.date                'YYYY-MM-DD'
 * @param {string|null} [input.accountId]    money account the challan was paid from
 * @param {number} input.amount              tax deposited (BDT)
 * @param {number} [input.interestAmount]    interest / late fee paid with it (P&L)
 * @param {boolean} [input.allowPartial]     TDS / VDS: amount may be less than the selection
 * @returns {Promise<{ deposit, transaction, interestTransaction, settledIds, partPaid, unallocatedAmount, filing }>}
 *
 * TDS / VDS part payments: the challan pays the selected deductions' balances
 * oldest first; the last one reached may be paid in part (deposit.paidAmount /
 * deposit.allocations) and stays PENDING for its balance, which a later challan
 * pays. settledIds lists every deduction the challan paid (in full or in part).
 */
export async function recordChallanDeposit(input, { userId = null } = {}) {
  const meta = DEPOSIT_KIND_META[input.kind]
  if (!meta) throw httpError(422, 'Deposit kind must be TDS, VDS or VAT')

  const day = parseDay(input.date)
  if (!day) throw httpError(422, 'Challan date must be a valid date (YYYY-MM-DD)')
  if (day.key > todayKey()) throw httpError(422, 'The challan date cannot be in the future')

  const amount = round2(num(input.amount))
  if (!(amount > 0)) throw httpError(422, 'Enter the amount deposited')
  const interest = round2(num(input.interestAmount))
  if (interest < 0) throw httpError(422, 'Interest cannot be negative')

  const challanNo = str(input.challanNo)
  if (!challanNo) throw httpError(422, 'Enter the challan number')

  const settings = await getFinanceSettings()

  // Same challan recorded twice for the same kind of deposit? (friendly check —
  // the unique index uniq_active_deposit_challan is the guard against a race)
  const dup = await findActiveChallan(meta.depositType, challanNo)
  if (dup) throw httpError(409, `Challan ${challanNo} is already recorded (${dup.entryNo})`)

  // ── what is being settled ──────────────────────────────────────────────────
  let allocated = []
  let unallocatedAmount = 0
  let returnPeriod = null
  let accountCode = str(input.accountCode)

  if (meta.payableType) {
    const ids = [...new Set((input.entryIds ?? []).map(String))]
    if (!ids.length) throw httpError(422, `Select the ${meta.label} deductions this challan pays`)
    const payables = await TaxEntry.find({ _id: { $in: ids } }).lean()
    if (payables.length !== ids.length) throw httpError(404, 'Some selected deductions were not found — reload and try again')
    for (const p of payables) {
      if (p.entryType !== meta.payableType) throw httpError(422, `${p.entryNo} is not a ${meta.label} deduction`)
      if (p.status !== 'ACTIVE') throw httpError(409, `${p.entryNo} is void`)
      const ds = p.deposit?.status ?? 'NOT_REQUIRED'
      if (ds === 'DEPOSITED') throw httpError(409, `${p.entryNo} is already deposited (challan ${p.deposit?.challanNo ?? '—'})`)
      if (ds === 'VIA_RETURN') throw httpError(409, `${p.entryNo} is settled through the VAT return — pay it with the return, not a separate challan`)
      if (ds !== 'PENDING') throw httpError(409, `${p.entryNo} does not need a deposit`)
      if (!(depositBalanceOf(p) > EPS)) throw httpError(409, `${p.entryNo} has nothing left to deposit — reload and try again`)
      if ((dayKeyOfDate(p.date) ?? '') > day.key) throw httpError(422, `The challan date is before the deduction ${p.entryNo} (${dayKeyOfDate(p.date)})`)
    }
    payables.sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.entryNo).localeCompare(String(b.entryNo)))
    // What is still owed on each deduction (amount less earlier part payments).
    const selectedTotal = round2(payables.reduce((s, p) => s + depositBalanceOf(p), 0))
    const exact = Math.abs(amount - selectedTotal) <= 0.01

    if (!exact) {
      if (amount > selectedTotal) {
        throw httpError(422, `The challan amount (${tk(amount)}) is more than the selected deductions still to deposit (${tk(selectedTotal)}). Enter any interest separately.`)
      }
      if (!input.allowPartial) {
        throw httpError(422, `The challan amount (${tk(amount)}) must equal the selected deductions still to deposit (${tk(selectedTotal)}). Tick "Part payment" to deposit less.`)
      }
    }
    // Oldest deductions first: each is paid its balance while the challan lasts;
    // the last one reached may be paid in part and keeps the rest as its balance.
    let left = exact ? selectedTotal : amount
    for (const p of payables) {
      if (left <= EPS) break
      const due = depositBalanceOf(p)
      const share = round2(Math.min(due, left))
      allocated.push({ ...p, share, paidBefore: Number(p.deposit?.paidAmount) || 0, full: share >= due - EPS })
      left = round2(left - share)
    }
    unallocatedAmount = round2(Math.max(0, amount - allocated.reduce((s, p) => s + p.share, 0)))

    if (!accountCode) {
      if (meta.payableType === 'TDS_PAYABLE') {
        const types = [...new Set(allocated.map(p => p.payeeType || 'COMPANY'))]
        accountCode = types.length === 1 ? tdsChallanCode(types[0]) : null
      } else {
        accountCode = CHALLAN_CODES.VAT_NEW
      }
    }
  } else {
    returnPeriod = resolveVatReturnPeriod({ start: input.returnStart, end: input.returnEnd }, settings)
    if (day.key < `${returnPeriod.start}-01`) throw httpError(422, `The challan date is before the return period (${returnPeriod.label})`)
    // Only link to a return that can be filed (else the payment is stranded on a draft).
    const rangeProblem = await vatReturnRangeProblem(returnPeriod.start, returnPeriod.end)
    if (rangeProblem) {
      throw httpError(rangeProblem.status, rangeProblem.code === 'PERIOD_OVERRIDE'
        ? `${rangeProblem.suggest?.label ?? 'This period'} is a single return — pay against ${rangeProblem.suggest?.start} to ${rangeProblem.suggest?.end}`
        : `${rangeProblem.message} — pay against that return`, { code: rangeProblem.code })
    }
    if (!accountCode) accountCode = vatChallanCode(settings?.vat?.commissionerateCode)
  }

  // VAT payments are linked to their return, which may lie inside the VAT lock
  // (paid after an earlier return was filed) — only the books lock applies.
  if (meta.depositType === 'VAT_PAYMENT' && !meta.payableType) {
    const locked = await assertBooksOpen(day.start)
    if (locked) throw httpError(409, locked)
  }

  // ── claim the payables ─────────────────────────────────────────────────────
  // Each payable is claimed only if nobody changed what was paid on it since it
  // was read (same paidAmount, still PENDING), so two challans can never both
  // pay the same balance. Its share is recorded as an allocation under a claim
  // token that becomes the deposit entry's id once that is written.
  const claimToken = new mongoose.Types.ObjectId()
  const claimIds = allocated.map(p => p._id)
  let depositEntry = null
  const release = async () => {
    if (!claimIds.length) return
    const ids = [claimToken, ...(depositEntry?._id ? [depositEntry._id] : [])]
    await TaxEntry.updateMany(depositReleaseFilter(claimIds, ids), depositReleasePipeline(ids))
      .catch(e => console.error('[recordChallanDeposit] release failed', e))
  }
  if (claimIds.length) {
    const res = await TaxEntry.bulkWrite(allocated.map(p => {
      const set = { 'deposit.paidAmount': round2(p.paidBefore + p.share) }
      if (p.full) {
        Object.assign(set, {
          'deposit.status': 'DEPOSITED', 'deposit.challanNo': challanNo, 'deposit.date': day.start,
          'deposit.depositEntryId': claimToken, 'deposit.accountCode': accountCode,
        })
      }
      return {
        updateOne: {
          filter: {
            _id: p._id, status: 'ACTIVE', 'deposit.status': 'PENDING',
            $expr: { $eq: [{ $ifNull: ['$deposit.paidAmount', 0] }, p.paidBefore] },
          },
          update: {
            $set: set,
            $push: { 'deposit.allocations': { depositEntryId: claimToken, challanNo, date: day.start, accountCode, amount: p.share } },
          },
        },
      }
    }), { ordered: false }).catch(async (err) => { await release(); throw err })
    if ((res.modifiedCount ?? res.nModified ?? 0) !== claimIds.length) {
      await release()
      throw httpError(409, 'Some of these deductions were just deposited or changed by someone else — reload and try again')
    }
  }
  const partPaid = allocated.filter(p => !p.full)

  // ── write the deposit, the money and the links ────────────────────────────
  let filingInfo = null
  let filingCreated = false
  const createdTx = []
  try {
    if (returnPeriod) {
      const { filing, created } = await ensureVatFiling(returnPeriod, settings, userId)
      filingInfo = filing
      filingCreated = created
    }

    const single = allocated.length && new Set(allocated.map(p => `${p.partyType}|${p.partyId ?? p.partyName}`)).size === 1 ? allocated[0] : null
    const sections = [...new Set(allocated.map(p => p.section).filter(Boolean))]
    const payeeTypes = [...new Set(allocated.map(p => p.payeeType).filter(Boolean))]
    const bank = str(input.bank)
    const branch = str(input.branch)
    const userNotes = str(input.notes)
    const noteParts = []
    if (returnPeriod) noteParts.push(`VAT for the return ${returnPeriod.label}`)
    if (meta.payableType) {
      const fullCount = allocated.length - partPaid.length
      if (fullCount) noteParts.push(`Settles ${fullCount} ${meta.label} deduction(s)`)
      for (const p of partPaid) {
        noteParts.push(`Part-pays ${p.entryNo} ${tk(p.share)} (${tk(round2(num(p.amount) - p.paidBefore - p.share))} left)`)
      }
    }
    if (unallocatedAmount > EPS) noteParts.push(`Unallocated ${tk(unallocatedAmount)}`)
    if (interest > 0) noteParts.push(`Interest/penalty ${tk(interest)} paid with this challan`)
    if (userNotes) noteParts.push(userNotes)

    depositEntry = await recordTaxEntry({
      entryType:    meta.depositType,
      date:         day.start,
      // VAT payment: amount = whole challan (note 58); baseAmount = the VAT
      // principal, so computeVatReturn can show the interest in note 41.
      baseAmount:   returnPeriod ? amount : 0,
      amount:       returnPeriod ? round2(amount + interest) : amount,
      section:      sections.length === 1 ? sections[0] : null,
      payeeType:    payeeTypes.length === 1 ? payeeTypes[0] : null,
      partyType:    single?.partyType ?? null,
      partyId:      single?.partyId ?? null,
      partyName:    single?.partyName ?? null,
      partyBin:     single?.partyBin ?? null,
      partyTin:     single?.partyTin ?? null,
      documentNo:   challanNo,
      documentDate: day.start,
      deposit:      { status: 'DEPOSITED', challanNo, date: day.start, accountCode },
      challan:      { bank, branch, accountCode },
      settledEntryIds: claimIds,
      settledAllocations: meta.payableType ? allocated.map(p => ({ entryId: p._id, amount: p.share })) : undefined,
      filingId:     filingInfo?._id ?? null,
      bankingChannel: true,
      notes:        noteParts.join(' · ') || null,
      attachments:  Array.isArray(input.attachments) ? input.attachments.filter(Boolean).slice(0, 10) : [],
    }, { userId, allowLocked: !!returnPeriod })

    const accountId = str(input.accountId)
    const desc = returnPeriod
      ? `VAT payment — return ${returnPeriod.label} — challan ${challanNo}`
      : `${meta.label} deposit — challan ${challanNo} (${allocated.length} deduction${allocated.length === 1 ? '' : 's'})`

    const tx = await postMoneyEntry({
      type:        'EXPENSE',
      kind:        'TAX_PAYMENT',
      category:    meta.category,
      amount,
      currency:    'BDT',
      amountBDT:   amount,
      date:        day.start,
      accountId,
      channel:     'CHALLAN',
      reference:   challanNo,
      description: desc,
      taxEntryIds: [depositEntry._id],
    }, { userId })
    createdTx.push(tx)

    let interestTx = null
    if (interest > 0) {
      interestTx = await postMoneyEntry({
        type:        'EXPENSE',
        kind:        'OPERATING',
        category:    'Tax Interest & Penalties',
        amount:      interest,
        currency:    'BDT',
        amountBDT:   interest,
        plAmountBDT: interest,
        date:        day.start,
        accountId,
        channel:     'CHALLAN',
        reference:   challanNo,
        description: `Interest / penalty on late ${meta.label} — challan ${challanNo}`,
        taxEntryIds: [depositEntry._id],
        tax:         { taxDeductible: false },
      }, { userId })
      createdTx.push(interestTx)
    }

    await TaxEntry.updateOne({ _id: depositEntry._id }, { $set: { transactionId: tx._id } })
    if (claimIds.length) {
      // Claim token → the deposit entry, on the allocation and (paid in full) on the payable.
      await TaxEntry.updateMany(
        { _id: { $in: claimIds }, 'deposit.allocations.depositEntryId': claimToken },
        { $set: { 'deposit.allocations.$[a].depositEntryId': depositEntry._id } },
        { arrayFilters: [{ 'a.depositEntryId': claimToken }] },
      )
      await TaxEntry.updateMany(
        { _id: { $in: claimIds }, 'deposit.depositEntryId': claimToken },
        { $set: { 'deposit.depositEntryId': depositEntry._id } },
      )
    }

    const fresh = await TaxEntry.findById(depositEntry._id).lean()
    return {
      deposit: fresh,
      transaction: tx,
      interestTransaction: interestTx,
      settledIds: claimIds.map(String),
      partPaid: partPaid.map(p => ({
        id: String(p._id), entryNo: p.entryNo, paid: p.share, balance: round2(num(p.amount) - p.paidBefore - p.share),
      })),
      unallocatedAmount,
      filing: filingInfo ? { id: String(filingInfo._id), periodKey: filingInfo.periodKey, status: filingInfo.status } : null,
      returnPeriod,
    }
  } catch (err) {
    if (createdTx.length) {
      await Transaction.deleteMany({ _id: { $in: createdTx.map(t => t._id) } })
        .catch(e => console.error('[recordChallanDeposit] compensating transaction delete failed', e))
    }
    if (depositEntry?._id) {
      await TaxEntry.deleteOne({ _id: depositEntry._id })
        .catch(e => console.error('[recordChallanDeposit] compensating tax entry delete failed', e))
    }
    await release()
    if (filingCreated && filingInfo?._id) {
      const used = await TaxEntry.exists({ filingId: filingInfo._id }).catch(() => true)
      if (!used) await TaxFiling.deleteOne({ _id: filingInfo._id, status: 'DRAFT' }).catch(() => {})
    }
    throw err
  }
}
