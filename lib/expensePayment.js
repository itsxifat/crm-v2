import { Project, Transaction, FreelancerAssignment, SalaryPayout, Freelancer } from '@/models'
import { createNotification } from '@/lib/createNotification'

function ymd(date) {
  const d = new Date(date)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
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

// Settles an already-loaded APPROVED expense as PAID: stamps the paid fields,
// creates the EXPENSE Transaction (ledger cash-out), bumps the project budget,
// and flips any linked FreelancerAssignment / SalaryPayout. The caller owns the
// APPROVED-status + signed-scan guards. Returns the created Transaction.
export async function settleExpenseAsPaid(expense, {
  userId, signedInvoiceUrl, paymentMethod = null, paymentNote = null,
  txnId, accountManager, batchInvoiceNo = null,
}) {
  expense.signedInvoiceUrl = signedInvoiceUrl
  expense.paidBy        = userId
  expense.paidAt        = new Date()
  expense.paymentMethod = paymentMethod ?? expense.paymentMethod ?? null
  expense.paymentNote   = paymentNote ?? null
  if (batchInvoiceNo) expense.batchInvoiceNo = batchInvoiceNo
  expense.status        = 'PAID'

  const bdt     = expense.amountBDT ?? expense.amount ?? 0
  const project = expense.projectId ? await Project.findById(expense.projectId) : null

  const txn = await new Transaction({
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
    receiptUrl:      expense.signedInvoiceUrl ?? expense.invoiceUrl ?? null,
    paymentMethod:   expense.paymentMethod ?? null,
    txnId:           txnId || undefined,
    accountManager:  accountManager || userId,
    createdBy:       userId,
    paidBy:          userId,
    freelancerId:     expense.freelancerId?.toString() ?? null,
    agencyId:         expense.agencyId ?? null,
    vendorId:         expense.vendorId?.toString() ?? null,
    paidToEmployeeId: expense.paidToEmployeeId ?? null,
    paidToName:       expense.paidToName ?? null,
  }).save()

  expense.syncedToAccounts      = true
  expense.accountsTransactionId = txn._id
  await expense.save()

  if (project) {
    project.approvedExpenses = (project.approvedExpenses ?? 0) + bdt
    await project.save()
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

  return txn
}
