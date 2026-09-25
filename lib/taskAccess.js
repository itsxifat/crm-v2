/**
 * lib/taskAccess.js — ownership scoping for task sub-resources.
 *
 * The /api/tasks/[id]/comments and /timesheets endpoints are used by both staff
 * (admin task board) and the freelancer assigned to a task. Without scoping,
 * ANY authenticated user — including clients/vendors — could read internal task
 * comments/timesheets or post fake ones for any task id. This guards that.
 */

import { Task, Employee, Freelancer } from '@/models'
import { canDo } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'

const STAFF = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']

/**
 * Minimal fields to populate on a task's assignee (Employee / Freelancer).
 * The full profile carries salary, NID/passport, bank, phone, address, etc.
 */
export const TASK_ASSIGNEE_SELECT = 'userId designation'

/**
 * @returns {Promise<boolean>} whether the session may view/contribute to this task.
 *   • SUPER_ADMIN / MANAGER → always (they manage the board; MANAGER needs tasks.view)
 *   • EMPLOYEE → only if the task is assigned to them (same rule as GET /api/tasks/[id])
 *   • freelancer → only if the task is assigned to them
 *   • client / vendor → never
 */
export async function canAccessTask(session, taskId) {
  const role = session?.user?.role
  if (!role) return false
  if (!isValidObjectId(taskId)) return false
  if (role === 'SUPER_ADMIN') return true
  if (STAFF.includes(role) && !canDo(session, 'tasks.view')) return false
  if (role === 'MANAGER') return true

  if (role === 'EMPLOYEE') {
    const emp = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
    if (!emp) return false
    const task = await Task.findById(taskId).select('assignedEmployeeId').lean()
    return !!task && String(task.assignedEmployeeId) === String(emp._id)
  }

  if (role === 'FREELANCER') {
    const fr = await Freelancer.findOne({ userId: session.user.id }).select('_id').lean()
    if (!fr) return false
    const task = await Task.findById(taskId).select('assignedFreelancerId').lean()
    return !!task && String(task.assignedFreelancerId) === String(fr._id)
  }

  return false
}

/** True for internal staff roles (used to decide whether internal comments are visible). */
export function isStaff(session) {
  return STAFF.includes(session?.user?.role)
}
