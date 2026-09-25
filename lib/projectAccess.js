/**
 * lib/projectAccess.js — access scoping for the internal /api/projects/:id/*
 * endpoints (detail, brief, discussion, milestones, ...).
 *
 * Middleware does not enforce roles on /api routes, so without this any
 * authenticated user (including clients of other companies and vendors) could
 * read any project's internal data by id. Clients have their own scoped routes
 * under /api/client/projects, so they (and vendors) are never allowed here.
 */

import { Project, Task, Employee } from '@/models'
import { canDo } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'

/**
 * Who may see project money (value, paid, expenses, profit, renewal amounts).
 * Driven by the flat RBAC permissions — SUPER_ADMIN always, MANAGER by default,
 * EMPLOYEE only when their custom role / overrides grant it.
 */
export function canViewProjectFinancials(session) {
  return canDo(session, 'finance.overview.view')
}

/** True when the user is the project's PM or on its team. */
function isOnTeam(project, uid) {
  return (
    String(project.projectManagerId?._id ?? project.projectManagerId ?? '') === uid ||
    (project.teamMembers ?? []).some(m => String(m?._id ?? m) === uid)
  )
}

/**
 * May this session view the given project's internal data?
 *   • SUPER_ADMIN → always
 *   • MANAGER     → needs projects.view
 *   • EMPLOYEE    → needs projects.view AND must be PM, team member or have a task on it
 *   • FREELANCER  → must be PM or team member
 *   • CLIENT / VENDOR → never (they use their own portal routes)
 *
 * @param {object} session
 * @param {string|object} projectOrId — project id, or a (lean/populated) project
 *        carrying _id/id, projectManagerId and teamMembers
 * @returns {Promise<boolean>}
 */
export async function canAccessProject(session, projectOrId) {
  const role = session?.user?.role
  const uid  = String(session?.user?.id ?? '')
  if (!role || !uid) return false
  if (role === 'SUPER_ADMIN') return true
  if (!['MANAGER', 'EMPLOYEE', 'FREELANCER'].includes(role)) return false
  if (role !== 'FREELANCER' && !canDo(session, 'projects.view')) return false
  if (role === 'MANAGER') return true

  let project = projectOrId
  if (!project || typeof project !== 'object' || !('teamMembers' in project)) {
    const id = typeof projectOrId === 'object' ? (projectOrId?._id ?? projectOrId?.id) : projectOrId
    if (!isValidObjectId(id)) return false
    project = await Project.findById(id).select('projectManagerId teamMembers').lean()
  }
  if (!project) return false
  if (isOnTeam(project, uid)) return true

  if (role === 'EMPLOYEE') {
    const emp = await Employee.findOne({ userId: uid }).select('_id').lean()
    if (!emp) return false
    const pid = project._id ?? project.id
    return !!(await Task.exists({ projectId: pid, assignedEmployeeId: emp._id }))
  }
  return false
}
