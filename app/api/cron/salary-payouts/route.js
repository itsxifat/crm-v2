export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer, SalaryPayout, ProjectExpense } from '@/models'
import { BASE_CURRENCY } from '@/lib/currencies'

// Generates this period's PENDING salary payouts for active salary-based
// freelancers whose salary day has arrived. Idempotent: the unique
// (freelancerId, period) index means re-running never double-creates.
//
// Auth: either an external scheduler passing the CRON_SECRET header, OR an
// authenticated manager hitting "Run now" from the admin UI. The repo has no
// built-in scheduler, so point a daily cron (hosting cron / system crontab) at:
//   POST /api/cron/salary-payouts   with header  x-cron-secret: $CRON_SECRET
async function run() {
  await connectDB()

  const now    = new Date()
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const day    = now.getDate()

  const due = await Freelancer.find({
    employmentMode: 'SALARY',
    salaryActive:   true,
    salaryAmount:   { $gt: 0 },
    salaryDay:      { $lte: day },
  }).populate('userId', 'name').lean()

  let created = 0
  const results = []
  for (const f of due) {
    // Respect the temporary employment window.
    if (f.salaryStartDate && now < new Date(f.salaryStartDate)) continue
    if (f.salaryEndDate && now > new Date(new Date(f.salaryEndDate).setHours(23, 59, 59, 999))) continue

    const currency = f.salaryCurrency || f.paymentCurrency || BASE_CURRENCY
    try {
      const payout = await SalaryPayout.create({
        freelancerId: f._id,
        period,
        amount:    f.salaryAmount,
        currency,
        amountBDT: currency === BASE_CURRENCY ? f.salaryAmount : null, // approver sets BDT for foreign
        status:    'PENDING',
      })
      // Route the salary through the unified expense pipeline: approve → voucher → paid (with scan).
      await ProjectExpense.create({
        origin:         'SALARY',
        projectId:      null,
        title:          `Salary ${period} — ${f.userId?.name ?? 'Freelancer'}`,
        amount:         f.salaryAmount,
        currency,
        amountBDT:      currency === BASE_CURRENCY ? f.salaryAmount : null,
        category:       'Salary',
        subcategory:    'Freelancer Salary',
        date:           new Date(),
        freelancerId:   f._id,
        salaryPayoutId: payout._id,
        submittedBy:    null, // system-generated
        status:         'PENDING',
      })
      created++
      results.push({ freelancerId: String(f._id), period, status: 'created' })
    } catch (err) {
      if (err?.code === 11000) {
        results.push({ freelancerId: String(f._id), period, status: 'exists' })
      } else {
        results.push({ freelancerId: String(f._id), period, status: 'error', error: err.message })
      }
    }
  }

  return { period, due: due.length, created, results }
}

export async function POST(request) {
  try {
    const secret = request.headers.get('x-cron-secret')
    const validSecret = process.env.CRON_SECRET && secret === process.env.CRON_SECRET

    if (!validSecret) {
      // Allow a manager to trigger manually ("Run now").
      const session = await getServerSession(authOptions)
      if (!session || !['SUPER_ADMIN', 'MANAGER'].includes(session.user?.role)) {
        return Response.json({ error: 'Unauthorised' }, { status: 401 })
      }
    }

    const out = await run()
    return Response.json({ ok: true, ...out })
  } catch (err) {
    console.error('[cron/salary-payouts]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Convenience GET for schedulers that only issue GET requests.
export async function GET(request) {
  return POST(request)
}
