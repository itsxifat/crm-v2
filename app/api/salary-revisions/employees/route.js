export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Employee, SalaryRevision, User } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { ciContains, ciEquals } from '@/lib/searchMatch'
import { codeContains } from '@/lib/codes'
import { normalizeDeptCode } from '@/models/Employee'
import { applyDueRevisions, currentPeriod, periodLabel, round2, TYPE_LABELS } from '@/lib/hr/salaryRevisions'

const monthsBetween = (fromPeriod, toPeriod) => {
  const [y1, m1] = fromPeriod.split('-').map(Number)
  const [y2, m2] = toPeriod.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1)
}
const periodOf = (date) => {
  const d = new Date(new Date(date).getTime() + 6 * 3600_000)   // Asia/Dhaka
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// GET /api/salary-revisions/employees?department=&search= — every active employee
// with the salary in effect, their last change (and how long ago), and any change
// waiting for approval or still to come. Longest without a change first.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, ['hr.salary.revise', 'hr.salary.approve'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()
    await applyDueRevisions()

    const sp = new URL(request.url).searchParams
    const filter = { resigned: { $ne: true } }
    const department = sp.get('department')
    if (department) {
      const code = normalizeDeptCode(department)
      filter.department = code ? ciEquals(code) : ciContains(department)
    }
    const search = sp.get('search')
    if (search) {
      const users = await User.find({ name: ciContains(search) }).select('_id').lean()
      // Employee IDs match with separators ignored (EN-DEV2610001 = ENDEV2610001).
      const code = codeContains(search)
      filter.$or = [{ userId: { $in: users.map(u => u._id) } }, ...(code ? [{ employeeId: code }] : [])]
    }
    const employees = await Employee.find(filter)
      .select('employeeId department designation position salary hireDate userId')
      .populate('userId', 'name avatar isActive').lean()
    const ids = employees.map(e => e._id)
    const revisions = await SalaryRevision.find({ employeeId: { $in: ids }, status: { $in: ['APPROVED', 'PENDING'] } })
      .sort({ effectiveMonth: 1, approvedAt: 1, createdAt: 1 }).lean()
    const byEmp = new Map()
    for (const r of revisions) {
      const k = String(r.employeeId)
      if (!byEmp.has(k)) byEmp.set(k, [])
      byEmp.get(k).push(r)
    }
    const now = currentPeriod()
    const brief = (r) => r && ({
      id: String(r._id), type: r.type, typeLabel: TYPE_LABELS[r.type], effectiveMonth: r.effectiveMonth,
      effectiveLabel: periodLabel(r.effectiveMonth), previousSalary: r.previousSalary, newSalary: r.newSalary,
      change: round2(r.newSalary - r.previousSalary),
      percent: r.previousSalary > 0 ? round2(((r.newSalary - r.previousSalary) / r.previousSalary) * 100) : null,
    })

    const rows = employees
      .filter(e => e.userId && e.userId.isActive !== false)
      .map(e => {
        const list = byEmp.get(String(e._id)) ?? []
        const approved = list.filter(r => r.status === 'APPROVED')
        const last = [...approved].reverse().find(r => r.effectiveMonth <= now) ?? null
        const upcoming = approved.find(r => r.effectiveMonth > now) ?? null
        const pending = list.find(r => r.status === 'PENDING') ?? null
        const since = last ? last.effectiveMonth : e.hireDate ? periodOf(e.hireDate) : null
        return {
          id:          String(e._id),
          userId:      e.userId?._id ? String(e.userId._id) : null,
          name:        e.userId?.name ?? '—',
          avatar:      e.userId?.avatar ?? null,
          employeeId:  e.employeeId ?? null,
          department:  e.department ?? null,
          designation: e.designation ?? e.position ?? null,
          hireDate:    e.hireDate ?? null,
          salary:      round2(Number(e.salary) || 0),
          lastChange:  brief(last),
          monthsSinceChange: since ? Math.max(0, monthsBetween(since, now)) : null,
          pending:     brief(pending),
          upcoming:    brief(upcoming),
        }
      })
      .sort((a, b) => (b.monthsSinceChange ?? -1) - (a.monthsSinceChange ?? -1) || a.name.localeCompare(b.name))

    return NextResponse.json({ data: rows, period: now })
  } catch (err) {
    console.error('[GET /api/salary-revisions/employees]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
