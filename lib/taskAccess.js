/**
 * lib/taskAccess.js — ownership scoping for task sub-resources.
 *
 * The /api/tasks/[id]/comments and /timesheets endpoints are used by both staff
 * (admin task board) and the freelancer assigned to a task. Without scoping,
 * ANY authenticated user — including clients/vendors — could read internal task
 * comments/timesheets or post fake ones for any task id. This guards that.
 */

import { Task, Freelancer } from '@/models'

const STAFF = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']

/**
 * @returns {Promise<boolean>} whether the session may view/contribute to this task.
 *   • staff → always (they manage the board)
 *   • freelancer → only if the task is assigned to them
 *   • client / vendor → never
 */
export async function canAccessTask(session, taskId) {
  const role = session?.user?.role
  if (!role) return false
  if (STAFF.includes(role)) return true

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
