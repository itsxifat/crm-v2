export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { SalaryRevision } from '@/models'
import { getOwnEmployeeId } from '@/lib/hrAccess'
import { applyDueRevisions, periodLabel, round2, TYPE_LABELS } from '@/lib/hr/salaryRevisions'

// GET /api/employee/salary-revisions — the signed-in employee's own approved
// salary changes (with their letters). Never anyone else's.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()
    const employeeId = await getOwnEmployeeId(session)
    if (!employeeId) return NextResponse.json({ data: [] })
    await applyDueRevisions({ employeeId })
    const rows = await SalaryRevision.find({ employeeId, status: 'APPROVED', source: 'REVISION' })
      .sort({ effectiveMonth: -1, approvedAt: -1 }).lean()
    return NextResponse.json({
      data: rows.map(r => ({
        id:             String(r._id),
        type:           r.type,
        typeLabel:      TYPE_LABELS[r.type],
        effectiveMonth: r.effectiveMonth,
        effectiveLabel: periodLabel(r.effectiveMonth),
        previousSalary: r.previousSalary,
        newSalary:      r.newSalary,
        change:         round2(r.newSalary - r.previousSalary),
        newDesignation: r.newDesignation,
        letterNo:       r.letterNo ?? null,
        inEffect:       !!r.appliedAt,
        approvedAt:     r.approvedAt,
      })),
    })
  } catch (err) {
    console.error('[GET /api/employee/salary-revisions]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
