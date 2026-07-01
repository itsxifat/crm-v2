// Freelancer money rollups, derived live from assignments + salary payouts.
// There is no wallet/balance stored on the freelancer any more — these buckets
// are computed on demand so they can never drift out of sync.
//
//   accepted        — committed work not yet delivered (status ACCEPTED/IN_PROGRESS)
//   awaitingPayment — delivered or payment-requested, not yet PAID  (this is "owed")
//   paid            — settled (lifetime)
//
// Amounts are grouped by currency so two currencies are never summed together.
import { FreelancerAssignment, SalaryPayout } from '@/models'

function groupByCurrency(rows) {
  const map = new Map()
  for (const r of rows) {
    const cur = r.currency || 'BDT'
    map.set(cur, (map.get(cur) || 0) + (Number(r.amount) || 0))
  }
  return [...map.entries()].map(([currency, total]) => ({ currency, total }))
}

export async function computeFreelancerFinance(freelancerId) {
  const [assignments, payouts] = await Promise.all([
    FreelancerAssignment.find({ freelancerId }).lean(),
    SalaryPayout.find({ freelancerId }).lean(),
  ])

  const payable = assignments.filter(a => a.paymentStatus !== 'NOT_REQUIRED' && a.paymentAmount)

  const acceptedRows = payable
    .filter(a => ['ACCEPTED', 'IN_PROGRESS'].includes(a.status))
    .map(a => ({ currency: a.currency, amount: a.paymentAmount }))

  // Owed = delivered-but-unpaid (COMPLETED, not PAID) OR payment-requested, plus
  // any PENDING salary payout.
  const owedAssignmentRows = payable
    .filter(a =>
      (a.status === 'COMPLETED' && a.paymentStatus !== 'PAID') ||
      a.paymentStatus === 'PAYMENT_REQUESTED'
    )
    .map(a => ({ currency: a.currency, amount: a.paymentAmount }))
  const owedSalaryRows = payouts
    .filter(p => p.status === 'PENDING')
    .map(p => ({ currency: p.currency, amount: p.amount }))
  const owedRows = [...owedAssignmentRows, ...owedSalaryRows]

  const paidRows = [
    ...payable.filter(a => a.paymentStatus === 'PAID').map(a => ({ currency: a.currency, amount: a.paymentAmount })),
    ...payouts.filter(p => p.status === 'PAID').map(p => ({ currency: p.currency, amount: p.amount })),
  ]

  // Last activity: most recent assignment touch.
  const lastWorkedAt = assignments.reduce((latest, a) => {
    const d = a.completedAt || a.acceptedAt || a.updatedAt || a.createdAt
    return d && (!latest || new Date(d) > new Date(latest)) ? d : latest
  }, null)

  return {
    accepted:        groupByCurrency(acceptedRows),
    owed:            groupByCurrency(owedRows),
    paid:            groupByCurrency(paidRows),
    owedCount:       owedRows.length,
    hasUnpaid:       owedRows.length > 0,
    lastWorkedAt,
  }
}
