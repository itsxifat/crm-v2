import { Project, ProjectExpense, Transaction, FreelancerAssignment, SalaryPayout, Freelancer, SalarySlip } from '@/models'
import { createNotification } from '@/lib/createNotification'

// Calendar day in the business timezone (Asia/Dhaka, UTC+6, no DST).
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000
function ymd(date) {
  const d = new Date(new Date(date).getTime() + DHAKA_OFFSET_MS)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

function catSlug(s) {
  return String(s || 'OTHER').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'OTHER'
}

// Deterministic reference for a combined/authorized invoice covering a group of
// expenses. Stable across print → pay because it derives only from the group's
// shared date + category. Mixed groups collapse to MULTI / MIXED.
export function computeBatchRef(expenses) {
  const days = new Set(expenses.map(e => ymd(e.date)))
  const cats = new Set(expenses.map(e => e.category || 'OTHER'))
  const dayPart = days.size === 1 ? [...days][0] : 'MULTI'
  const catPart = cats.size === 1 ? catSlug([...cats][0]) : 'MIXED'
  return `EXB-${dayPart}-${catPart}`
}

// The batch reference the given expenses already share (persisted when the
// combined invoice was first printed / authorized), or null if they don't all
// carry the same one.
export function sharedBatchRef(expenses) {
  const refs = new Set(expenses.map(e => e.batchInvoiceNo ?? null))
  return refs.size === 1 ? [...refs][0] : null
}

// A batch reference that no other batch uses yet: the deterministic base
// (EXB-YYYYMMDD-CATEGORY) for the first batch, then -2, -3, … for later batches
// with the same date + category.
export async function allocateBatchRef(expenses) {
  const base = computeBatchRef(expenses)
  const esc  = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const used = await ProjectExpense.distinct('batchInvoiceNo', { batchInvoiceNo: { $regex: `^${esc}(-\\d+)?$` } })
  if (used.length === 0) return base
  const highest = Math.max(1, ...used.map(r => Number(String(r).slice(base.length + 1)) || 1))
  return `${base}-${highest + 1}`
}

// Undo the pending links of an expense that will never be paid (rejected or
// deleted before payment), so the source records don't get stuck:
//   • FreelancerAssignment  → back to paymentStatus PENDING (can request again)
//   • SalaryPayout          → CANCELLED
//   • SalarySlip            → deleted (frees the period for regeneration)
export async function unwindExpenseLinks(expense) {
  await FreelancerAssignment.updateMany(
    { expenseId: expense._id, paymentStatus: 'PAYMENT_REQUESTED' },
    { $set: { paymentStatus: 'PENDING', expenseId: null } },
  )
  if (expense.salaryPayoutId) {
    await SalaryPayout.updateOne(
      { _id: expense.salaryPayoutId, status: 'PENDING' },
      { $set: { status: 'CANCELLED' } },
    )
  }
  if (expense.employeeSalarySlipId) {
    await SalarySlip.deleteOne({ _id: expense.employeeSalarySlipId, expenseId: expense._id })
  }
}

// Saves the ledger entry, using the accountant-entered external reference as
// txnId when it is free. Transaction.txnId is globally unique, but one bank
// transfer can legitimately settle several expenses, so when the reference is
// already taken the system generates the txnId and the reference is kept in
// the description instead of failing the payment.
async function saveLedgerEntry(data, externalRef) {
  if (externalRef) {
    try {
      return await new Transaction({ ...data, txnId: externalRef }).save()
    } catch (err) {
      if (err?.code !== 11000 || !err?.keyPattern?.txnId) throw err
    }
  }
  return new Transaction({
    ...data,
    description: externalRef ? `${data.description} (Ref: ${externalRef})` : data.description,
  }).save()
}

// PENDING → PAID. Records the payment (method / txn id / proof), creates the
// EXPENSE Transaction (ledger cash-out), bumps the project budget, and flips any
// linked FreelancerAssignment / SalaryPayout. The caller owns the payment-field
// guards and must first claim the expense atomically (conditional
// findOneAndUpdate on status PENDING) so a repeated request can never pay twice.
// Returns the created Transaction.
export async function payExpense(expense, {
  userId, paymentMethod, paymentProofUrl = null, paymentTxnId = null, accountManager,
}) {
  expense.paymentMethod   = paymentMethod
  expense.paymentProofUrl = paymentProofUrl
  expense.paymentTxnId    = paymentTxnId
  expense.paidBy          = userId
  expense.paidAt          = new Date()
  expense.status          = 'PAID'

  const bdt     = expense.amountBDT ?? expense.amount ?? 0
  const project = expense.projectId ? await Project.findById(expense.projectId) : null

  const txn = await saveLedgerEntry({
    type:            'EXPENSE',
    category:        expense.category,
    expenseCategory: expense.subcategory ?? null,
    description:     project ? `[${project.projectCode ?? project.venture ?? ''}] ${expense.title}` : expense.title,
    amount:          expense.amount,
    currency:        expense.currency ?? 'BDT',
    amountBDT:       bdt,
    date:            expense.date,
    reference:       expense._id.toString(),
    projectId:       expense.projectId ?? null,
    receiptUrl:      expense.paymentProofUrl ?? expense.invoiceUrl ?? null,
    paymentMethod:   expense.paymentMethod ?? null,
    accountManager:  accountManager || userId,
    createdBy:       userId,
    paidBy:          userId,
    freelancerId:     expense.freelancerId?.toString() ?? null,
    agencyId:         expense.agencyId ?? null,
    vendorId:         expense.vendorId?.toString() ?? null,
    paidToEmployeeId: expense.paidToEmployeeId ?? null,
    paidToName:       expense.paidToName ?? null,
  }, expense.paymentTxnId || null)

  expense.syncedToAccounts      = true
  expense.accountsTransactionId = txn._id
  await expense.save()

  if (project) {
    // Atomic increment — never a read-modify-write of the running total.
    await Project.updateOne({ _id: project._id }, { $inc: { approvedExpenses: bdt } })
  }

  const linkedAssignment = await FreelancerAssignment.findOne({ expenseId: expense._id })
  if (linkedAssignment) {
    linkedAssignment.paymentStatus = 'PAID'
    linkedAssignment.approvedAt    = new Date()
    linkedAssignment.approvedBy    = userId
    await linkedAssignment.save()
  }

  if (expense.salaryPayoutId) {
    const payout = await SalaryPayout.findById(expense.salaryPayoutId)
    if (payout && payout.status !== 'PAID') {
      payout.status        = 'PAID'
      payout.amountBDT     = bdt
      payout.transactionId = txn._id
      payout.approvedBy    = userId
      payout.approvedAt    = new Date()
      await payout.save()

      const freelancer = await Freelancer.findById(payout.freelancerId).populate('userId', 'name').lean()
      if (freelancer?.userId?._id) {
        createNotification({
          userId:  freelancer.userId._id.toString(),
          title:   'Salary paid',
          message: `Your salary for ${payout.period} has been paid.`,
          type:    'PAYMENT',
          link:    '/freelancer',
        }).catch(() => {})
      }
    }
  }

  if (expense.employeeSalarySlipId) {
    const slip = await SalarySlip.findById(expense.employeeSalarySlipId)
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name' } })
    const staffUserId = slip?.employeeId?.userId?._id
    if (staffUserId) {
      createNotification({
        userId:  staffUserId.toString(),
        title:   'Salary paid',
        message: `Your salary for ${slip.period} has been paid.`,
        type:    'PAYMENT',
        link:    '/admin/profile',
      }).catch(() => {})
    }
  }

  return txn
}

// PAID → AUTHORIZED. Attaches the scan of the printed & authorized invoice.
// No ledger change (that already happened at payment). Caller owns the
// PAID-status + scan guards.
export async function authorizeExpense(expense, { userId, signedInvoiceUrl, batchInvoiceNo = null }) {
  expense.signedInvoiceUrl = signedInvoiceUrl
  expense.authorizedBy     = userId
  expense.authorizedAt     = new Date()
  if (batchInvoiceNo) expense.batchInvoiceNo = batchInvoiceNo
  expense.status           = 'AUTHORIZED'
  await expense.save()
  return expense
}
