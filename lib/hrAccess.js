/**
 * HR self-service helpers shared by the attendance / leave routes.
 *
 * Holders of hr.attendance.view / hr.leaves.view without the matching manage /
 * approve permission only see their OWN records; nobody (except a Super Admin)
 * may approve or edit HR records that belong to themselves.
 */
import { Employee, Attendance, Leave } from '@/models'
import { dhakaParts, dhakaDayStart } from '@/lib/dhakaTime'

/** The caller's own Employee _id, or null when they have no Employee record. */
export async function getOwnEmployeeId(session) {
  if (!session?.user?.id) return null
  const emp = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
  return emp?._id ?? null
}

/** True when the Employee `employeeId` belongs to the calling user. */
export async function isOwnEmployeeRecord(session, employeeId) {
  if (!session?.user?.id || !employeeId) return false
  const emp = await Employee.findById(employeeId).select('userId').lean()
  return !!emp && String(emp.userId) === String(session.user.id)
}

/** Business-day key ('YYYY-MM-DD', Asia/Dhaka) for an attendance date. */
export function attendanceDayKey(date) {
  const { year, month, day } = dhakaParts(date)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Create or update the single attendance record for (employee, Dhaka day).
 * Keyed on a unique { employeeId, day } index so concurrent submits for the
 * same day cannot create duplicates. A legacy record for that day (created
 * before the `day` key existed) is adopted instead of adding a second one.
 */
export async function upsertAttendance(employeeId, date, updateData) {
  const day = attendanceDayKey(date)
  try {
    const legacy = await Attendance.findOneAndUpdate(
      { employeeId, day: { $exists: false }, date: { $gte: dhakaDayStart(date), $lt: dhakaDayStart(date, 1) } },
      { $set: { ...updateData, day } },
      { new: true }
    )
    if (legacy) return legacy
  } catch (e) {
    if (e?.code !== 11000) throw e // a keyed record already exists — update that one below
  }
  const query  = { employeeId, day }
  const update = { $set: updateData, $setOnInsert: { date: new Date(date) } }
  const opts   = { new: true, upsert: true, setDefaultsOnInsert: true }
  try {
    return await Attendance.findOneAndUpdate(query, update, opts)
  } catch (e) {
    // Two concurrent upserts both tried to insert — the loser retries as an update.
    if (e?.code === 11000) return Attendance.findOneAndUpdate(query, update, opts)
    throw e
  }
}

/**
 * Validate a leave date range for an employee: end must not be before start,
 * and it must not overlap an existing PENDING / APPROVED leave.
 * Returns an error string, or null when the range is acceptable.
 */
export async function checkLeaveRange(employeeId, startDate, endDate) {
  const start = new Date(startDate)
  const end   = new Date(endDate)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'Start and end dates are required'
  if (end < start) return 'End date cannot be before the start date'

  const overlap = await Leave.exists({
    employeeId,
    status:    { $in: ['PENDING', 'APPROVED'] },
    startDate: { $lte: end },
    endDate:   { $gte: start },
  })
  return overlap ? 'This employee already has a pending or approved leave overlapping these dates' : null
}
