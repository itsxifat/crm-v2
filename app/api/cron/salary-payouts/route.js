export const dynamic = 'force-dynamic'
import { timingSafeEqual } from 'crypto'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer, SalaryPayout, ProjectExpense } from '@/models'
import { BASE_CURRENCY } from '@/lib/currencies'
import { requirePerm } from '@/lib/rbac'
import { dhakaParts, dhakaDayStart } from '@/lib/dhakaTime'

// Constant-time comparison of the scheduler secret.
function secretMatches(given, expected) {
  if (!given || !expected) return false
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  return a.length === b.length && timingSafeEqual(a, b)
}

// Route the salary through the unified expense pipeline: approve → voucher → paid (with scan).
function createExpenseForPayout(f, payout, period) {
  return ProjectExpense.create({
    origin:         'SALARY',
    projectId:      null,
    title:          `Salary ${period} — ${f.userId?.name ?? 'Freelancer'}`,
    amount:         payout.amount,
    currency:       payout.currency,
    amountBDT:      payout.currency === BASE_CURRENCY ? payout.amount : null,
    category:       'Salary',
    subcategory:    'Freelancer Salary',
    date:           new Date(),
    freelancerId:   f._id,
    salaryPayoutId: payout._id,
    submittedBy:    null, // system-generated
    status:         'PENDING',
  })
}

// Generates this period's PENDING salary payouts for active salary-based
// freelancers whose salary day has arrived. Idempotent: the unique
// (freelancerId, period) index means re-running never double-creates.
//
// Auth: either an external scheduler passing the CRON_SECRET header, OR an
// authenticated user with finance.salary.pay hitting "Run now" from the admin
// UI. The repo has no built-in scheduler, so point a daily cron (hosting cron /
// system crontab) at:
//   POST /api/cron/salary-payouts   with header  x-cron-secret: $CRON_SECRET
async function run() {
  await connectDB()

  // Period / day in the business timezone (Asia/Dhaka), not server UTC.
  const now    = new Date()
  const { year, month, day } = dhakaParts(now)
  const period = `${year}-${String(month + 1).padStart(2, '0')}`

  const due = await Freelancer.find({
    employmentMode: 'SALARY',
    salaryActive:   true,
    salaryAmount:   { $gt: 0 },
    salaryDay:      { $lte: day },
    disabledAt:     null,
  }).populate('userId', 'name isActive').lean()

  let created = 0
  const results = []
  for (const f of due) {
    // Respect the temporary employment window (end date inclusive, Dhaka day).
    if (f.salaryStartDate && now < new Date(f.salaryStartDate)) continue
    if (f.salaryEndDate && now >= dhakaDayStart(f.salaryEndDate, 1)) continue
    // Deleted or deactivated accounts must not keep accruing salary.
    if (!f.userId || f.userId.isActive === false) continue

    const currency = f.salaryCurrency || f.paymentCurrency || BASE_CURRENCY
    let payout
    try {
      payout = await SalaryPayout.create({
        freelancerId: f._id,
        period,
        amount:    f.salaryAmount,
        currency,
        amountBDT: currency === BASE_CURRENCY ? f.salaryAmount : null, // approver sets BDT for foreign
        status:    'PENDING',
      })
    } catch (err) {
      if (err?.code !== 11000) {
        results.push({ freelancerId: String(f._id), period, status: 'error', error: err.message })
        continue
      }
      // Already exists. Self-heal a PENDING payout left without its expense
      // (e.g. an earlier run failed between the two inserts).
      try {
        const existing   = await SalaryPayout.findOne({ freelancerId: f._id, period }).lean()
        const hasExpense = existing ? await ProjectExpense.exists({ salaryPayoutId: existing._id }) : true
        if (existing?.status === 'PENDING' && !hasExpense) {
          await createExpenseForPayout(f, existing, period)
          results.push({ freelancerId: String(f._id), period, status: 'repaired' })
        } else {
          results.push({ freelancerId: String(f._id), period, status: 'exists' })
        }
      } catch (e) {
        results.push({ freelancerId: String(f._id), period, status: 'error', error: e.message })
      }
      continue
    }

    try {
      await createExpenseForPayout(f, payout, period)
      created++
      results.push({ freelancerId: String(f._id), period, status: 'created' })
    } catch (err) {
      // Roll back so the payout never sits PENDING with nothing to pay in Accounts.
      await SalaryPayout.deleteOne({ _id: payout._id }).catch(() => {})
      results.push({ freelancerId: String(f._id), period, status: 'error', error: err.message })
    }
  }

  return { period, due: due.length, created, results }
}

export async function POST(request) {
  try {
    const validSecret = secretMatches(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)

    if (!validSecret) {
      // Manual "Run now" from the admin UI: POST only (a GET can be triggered by
      // a cross-site link), gated on the salary permission rather than the role.
      if (request.method !== 'POST') return Response.json({ error: 'Unauthorised' }, { status: 401 })
      const session = await getServerSession(authOptions)
      const denied  = requirePerm(session, 'finance.salary.pay')
      if (denied) return denied
    }

    const out = await run()
    return Response.json({ ok: true, ...out })
  } catch (err) {
    console.error('[cron/salary-payouts]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Convenience GET for schedulers that only issue GET requests (secret only).
export async function GET(request) {
  return POST(request)
}
