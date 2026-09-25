import { z } from 'zod'
import Employee from '@/models/Employee'
import Lead from '@/models/Lead'
import { isValidObjectId } from '@/lib/objectId'

/**
 * Populate spec for a lead's assignee. Only exposes non-sensitive Employee
 * fields — never salary / NID / passport / DOB / address / HR notes.
 */
export const LEAD_ASSIGNEE_POPULATE = {
  path:     'assignedToId',
  select:   'userId designation department',
  populate: { path: 'userId', select: 'name avatar' },
}

/**
 * The caller's own Employee _id (or null if they have no Employee profile).
 */
export async function getOwnEmployeeId(session) {
  if (!session?.user?.id) return null
  const employee = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
  return employee?._id ?? null
}

/**
 * EMPLOYEEs may only touch leads assigned to them. Returns true for other
 * staff roles (their access is governed by sales.leads.* permissions).
 * `lead.assignedToId` may be an ObjectId or a populated Employee document.
 */
export async function canAccessLead(session, lead) {
  if (!lead) return false
  if (session?.user?.role !== 'EMPLOYEE') return true
  const employeeId = await getOwnEmployeeId(session)
  if (!employeeId) return false
  const assigned = lead.assignedToId?._id ?? lead.assignedToId
  return !!assigned && assigned.toString() === employeeId.toString()
}

/**
 * Load a lead (lean) and verify the caller may access it.
 * Returns the lead, or null when it doesn't exist / isn't accessible
 * (callers should respond 404 in both cases to avoid leaking existence).
 */
export async function findAccessibleLead(session, id, select = null) {
  if (!isValidObjectId(id)) return null
  let q = Lead.findById(id)
  if (select) q = q.select(select)
  const lead = await q.lean()
  if (!lead) return null
  return (await canAccessLead(session, lead)) ? lead : null
}

/**
 * Lead links: accept scheme-less input ("facebook.com/acme") by prefixing
 * https://, and only ever store http(s) URLs (links are rendered as hrefs).
 */
export const leadLinkSchema = z.string().trim().min(1)
  .transform(s => (/^https?:\/\//i.test(s) ? s : `https://${s}`))
  .pipe(z.string().url())
