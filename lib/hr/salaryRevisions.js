/**
 * lib/hr/salaryRevisions.js — SERVER-ONLY. Salary increments, promotions and
 * adjustments ("revisions") with an effective month, approval and history.
 *
 * Employee.salary is the salary in effect now. A revision is proposed (PENDING)
 * by someone with hr.salary.revise, approved by someone with hr.salary.approve
 * (never for themselves, except a Super Admin), and takes effect from its month:
 * Employee.salary — and the designation, for a promotion — follow once that
 * month has started (applyDueRevisions, run whenever salaries are read). Payroll
 * asks salaryForPeriod(), so a slip for an earlier month still uses that month's
 * salary after a raise.
 *
 * Revisions are kept in date order: a change cannot be slipped in before an
 * approved revision that is still to come (cancel that one first), so every
 * revision's "from" salary stays true.
 */
import connectDB from '@/lib/mongodb'
import { Employee, SalaryRevision, SalarySlip, User } from '@/models'
import { canDo } from '@/lib/rbac'
import { dhakaParts } from '@/lib/dhakaTime'
import { nextSequence } from '@/lib/sequence'
import { createNotification } from '@/lib/createNotification'
import { inventoryManagerUserIds } from '@/app/api/my-assets/_lib/shared'
import { formatMoney } from '@/lib/currencies'

export const REVISION_TYPES = ['INCREMENT', 'PROMOTION', 'ADJUSTMENT', 'DECREASE']
export const TYPE_LABELS = { INCREMENT: 'Increment', PROMOTION: 'Promotion', ADJUSTMENT: 'Adjustment', DECREASE: 'Decrease' }

export class RevisionError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.status = status
  }
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const bdt = (n) => formatMoney(n, 'BDT')

/** Current payroll month in the business timezone (Asia/Dhaka). */
export function currentPeriod() {
  const { year, month } = dhakaParts()
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

export function isValidPeriod(p) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(p ?? ''))
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

export function shiftPeriod(p, by) {
  const [y, m] = p.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function periodLabel(p) {
  const [y, m] = String(p ?? '').split('-').map(Number)
  if (!y || !m) return p ?? ''
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** Who may see salary figures in revisions. */
export function canSeeSalaries(session) {
  return ['hr.salary.revise', 'hr.salary.approve', 'pii.financial.view', 'finance.salary.pay'].some(p => canDo(session, p))
}

const ORDER = { effectiveMonth: 1, approvedAt: 1, createdAt: 1 }

/** Approved revisions of the employees, oldest first, grouped by employee id. */
async function approvedByEmployee(employeeIds) {
  const rows = await SalaryRevision.find({ employeeId: { $in: employeeIds }, status: 'APPROVED' })
    .select('employeeId effectiveMonth previousSalary newSalary approvedAt createdAt')
    .sort(ORDER).lean()
  const map = new Map()
  for (const r of rows) {
    const k = String(r.employeeId)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  return map
}

/** Salary in effect in `period` from the approved revisions (oldest first), else the stored salary (null when none is set). */
function salaryFrom(revisions, period, storedSalary) {
  if (!revisions?.length) return storedSalary == null || storedSalary === '' ? null : round2(Number(storedSalary) || 0)
  let s = null
  for (const r of revisions) if (r.effectiveMonth <= period) s = r.newSalary
  return round2(s ?? revisions[0].previousSalary)
}

/** The monthly salary in effect for `employee` in payroll month `period` ('YYYY-MM'). */
export async function salaryForPeriod(employee, period) {
  const map = await approvedByEmployee([employee._id])
  return salaryFrom(map.get(String(employee._id)), period, employee.salary)
}

/** salaryForPeriod for many employees at once: Map(employeeId → salary). */
export async function salariesForPeriod(employees, period) {
  const map = await approvedByEmployee(employees.map(e => e._id))
  return new Map(employees.map(e => [String(e._id), salaryFrom(map.get(String(e._id)), period, e.salary)]))
}

/**
 * Brings Employee.salary (and the designation of a promotion) up to date with
 * the approved revisions whose month has started. Cheap when nothing is due;
 * called before salaries are read.
 */
export async function applyDueRevisions({ employeeId = null } = {}) {
  await connectDB()
  const now = currentPeriod()
  const due = await SalaryRevision.find({
    status: 'APPROVED', appliedAt: null, effectiveMonth: { $lte: now },
    ...(employeeId ? { employeeId } : {}),
  }).sort(ORDER).lean()
  if (!due.length) return 0
  const touched = new Set()
  for (const r of due) {
    const claimed = await SalaryRevision.findOneAndUpdate({ _id: r._id, appliedAt: null }, { $set: { appliedAt: new Date() } }).lean()
    if (!claimed) continue
    touched.add(String(r.employeeId))
    // A promotion's new title arrives with it (later manual edits of the title are left alone).
    if (r.newDesignation) await Employee.updateOne({ _id: r.employeeId }, { $set: { designation: r.newDesignation } })
  }
  for (const id of touched) {
    const map = await approvedByEmployee([id])
    const emp = await Employee.findById(id).select('salary').lean()
    if (emp) await Employee.updateOne({ _id: id }, { $set: { salary: salaryFrom(map.get(id), now, emp.salary) } })
  }
  return touched.size
}

/** An approved revision that is still to come after `period` (they must stay in date order). */
async function laterApproved(employeeId, period) {
  return SalaryRevision.findOne({ employeeId, status: 'APPROVED', effectiveMonth: { $gt: period } })
    .sort({ effectiveMonth: 1 }).lean()
}

function checkDirection(type, previous, next) {
  if (!(next > 0)) throw new RevisionError('Enter the new monthly salary')
  if (next > 1e9) throw new RevisionError('That salary is too large')
  const diff = round2(next - previous)
  if (type === 'INCREMENT' && !(diff > 0)) throw new RevisionError(`An increment must raise the salary above ${bdt(previous)}`)
  if (type === 'DECREASE' && !(diff < 0)) throw new RevisionError(`A decrease must bring the salary below ${bdt(previous)}`)
  if (type === 'ADJUSTMENT' && diff === 0) throw new RevisionError('The new salary is the same as the current one')
}

const isSuper = (session) => session?.user?.role === 'SUPER_ADMIN'

/**
 * Proposes a revision for one employee. With `approveNow` (and the right to
 * approve it) it is approved at once.
 * @returns {Promise<{ revision: object, warnings: string[] }>}
 */
export async function proposeRevision({ employeeId, type, newSalary, effectiveMonth, newDesignation = null, reason = null, batchId = null, approveNow = false, session }) {
  await connectDB()
  if (!REVISION_TYPES.includes(type)) throw new RevisionError('Choose the kind of change')
  if (!isValidPeriod(effectiveMonth)) throw new RevisionError('Choose the month the new salary starts')
  if (effectiveMonth < currentPeriod()) {
    throw new RevisionError(`${periodLabel(effectiveMonth)} has passed. Start the new salary from this month or later, and pay any arrears as an earning on the next salary slip.`)
  }
  const employee = await Employee.findById(employeeId).populate('userId', 'name').lean()
  if (!employee) throw new RevisionError('Employee not found', 404)
  if (employee.resigned) throw new RevisionError(`${employee.userId?.name ?? 'This employee'} has resigned`)
  if (String(employee.userId?._id ?? employee.userId) === String(session.user.id) && !isSuper(session)) {
    throw new RevisionError('You cannot propose a change to your own salary', 403)
  }
  const later = await laterApproved(employee._id, effectiveMonth)
  if (later) {
    throw new RevisionError(`An approved change from ${periodLabel(later.effectiveMonth)} (${bdt(later.newSalary)}) is still to come. Cancel it first, or make this change part of it.`, 409)
  }

  // The salary as it stands in that month so far (an approved change in the same month counts).
  const previousSalary = Number(await salaryForPeriod(employee, effectiveMonth)) || 0
  const next = round2(Number(newSalary))
  checkDirection(type, previousSalary, next)
  const title = String(newDesignation ?? '').trim().slice(0, 120) || null
  if (type === 'PROMOTION' && !title) throw new RevisionError('Enter the new designation for the promotion')

  let revision
  try {
    revision = await SalaryRevision.create({
      employeeId: employee._id,
      type,
      effectiveMonth,
      previousSalary,
      newSalary: next,
      previousDesignation: employee.designation ?? employee.position ?? null,
      newDesignation: type === 'PROMOTION' || title ? title : null,
      reason: String(reason ?? '').trim().slice(0, 1000) || null,
      batchId,
      requestedBy: session.user.id,
    })
  } catch (err) {
    if (err?.code === 11000) throw new RevisionError(`${employee.userId?.name ?? 'This employee'} already has a change waiting for approval. Approve or cancel it first.`, 409)
    throw err
  }

  if (approveNow && canDo(session, 'hr.salary.approve')) {
    return decideRevision({ id: revision._id, action: 'approve', session, quiet: true })
  }
  await notifyApprovers(revision, employee, session)
  return { revision: revision.toObject(), warnings: [] }
}

async function nextLetterNo() {
  const { year, month } = dhakaParts()
  const prefix = `INC-${String(year).slice(-2)}${String(month + 1).padStart(2, '0')}-`
  const existing = await SalaryRevision.find({ letterNo: { $regex: `^${prefix}[0-9]+$` } }).select('letterNo').lean()
  const maxUsed = existing.reduce((m, d) => Math.max(m, parseInt(d.letterNo.slice(prefix.length), 10) || 0), 0)
  const seq = await nextSequence(`salaryRevision:${prefix}`, maxUsed)
  return `${prefix}${String(seq).padStart(4, '0')}`
}

/**
 * approve / reject / cancel.
 *   approve, reject — hr.salary.approve; never your own salary (Super Admin excepted)
 *   cancel          — a pending one by its requester or an approver; an approved one
 *                     not in effect yet by an approver
 * @returns {Promise<{ revision: object, warnings: string[] }>}
 */
export async function decideRevision({ id, action, note = null, session, quiet = false }) {
  await connectDB()
  const rev = await SalaryRevision.findById(id).lean()
  if (!rev) throw new RevisionError('Not found', 404)
  const employee = await Employee.findById(rev.employeeId).populate('userId', 'name').lean()
  const ownSalary = employee && String(employee.userId?._id ?? employee.userId) === String(session.user.id)
  const canApprove = canDo(session, 'hr.salary.approve')
  const cleanNote = String(note ?? '').trim().slice(0, 1000) || null
  const warnings = []

  if (action === 'cancel') {
    const mine = String(rev.requestedBy) === String(session.user.id)
    if (rev.status === 'PENDING' ? !(mine || canApprove) : !canApprove) throw new RevisionError('Forbidden', 403)
    if (rev.status === 'APPROVED' && rev.appliedAt) throw new RevisionError('This change is already in effect. Make a new change instead.', 409)
    if (!['PENDING', 'APPROVED'].includes(rev.status)) throw new RevisionError(`This change is already ${rev.status.toLowerCase()}`, 409)
    if (rev.status === 'APPROVED') {
      const later = await laterApproved(rev.employeeId, rev.effectiveMonth)
      if (later) throw new RevisionError(`Cancel the later change from ${periodLabel(later.effectiveMonth)} first`, 409)
    }
    const done = await SalaryRevision.findOneAndUpdate(
      { _id: rev._id, status: rev.status, appliedAt: null },
      { $set: { status: 'CANCELLED', cancelledBy: session.user.id, cancelledAt: new Date(), decisionNote: cleanNote ?? rev.decisionNote } },
      { new: true },
    ).lean()
    if (!done) throw new RevisionError('This change was updated meanwhile. Reload and try again.', 409)
    return { revision: done, warnings }
  }

  if (!canApprove) throw new RevisionError('You cannot approve salary changes', 403)
  if (ownSalary && !isSuper(session)) throw new RevisionError('You cannot approve a change to your own salary', 403)
  if (rev.status !== 'PENDING') throw new RevisionError(`This change is already ${rev.status.toLowerCase()}`, 409)

  if (action === 'reject') {
    const done = await SalaryRevision.findOneAndUpdate(
      { _id: rev._id, status: 'PENDING' },
      { $set: { status: 'REJECTED', approvedBy: session.user.id, approvedAt: new Date(), decisionNote: cleanNote } },
      { new: true },
    ).lean()
    if (!done) throw new RevisionError('This change was updated meanwhile. Reload and try again.', 409)
    if (String(rev.requestedBy) !== String(session.user.id)) {
      await createNotification({
        userId: String(rev.requestedBy), type: 'SALARY',
        title: 'Salary change not approved',
        message: `The ${TYPE_LABELS[rev.type].toLowerCase()} for ${employee?.userId?.name ?? 'the employee'} (${bdt(rev.newSalary)} from ${periodLabel(rev.effectiveMonth)}) was not approved.${cleanNote ? ` Note: ${cleanNote}` : ''}`,
        link: `/admin/employees/${rev.employeeId}`,
      })
    }
    return { revision: done, warnings }
  }

  // approve — re-check against the salary as it stands now.
  if (!employee) throw new RevisionError('The employee no longer exists', 409)
  if (employee.resigned) throw new RevisionError(`${employee.userId?.name ?? 'This employee'} has resigned`, 409)
  const later = await laterApproved(rev.employeeId, rev.effectiveMonth)
  if (later) throw new RevisionError(`An approved change from ${periodLabel(later.effectiveMonth)} is still to come. Cancel it first.`, 409)
  const previousSalary = Number(await salaryForPeriod(employee, rev.effectiveMonth)) || 0
  if (Math.abs(previousSalary - rev.previousSalary) >= 0.01) {
    warnings.push(`The salary changed since this was proposed (${bdt(rev.previousSalary)} → ${bdt(previousSalary)}); the change is counted from ${bdt(previousSalary)}.`)
  }
  try {
    checkDirection(rev.type, previousSalary, rev.newSalary)
  } catch (err) {
    throw new RevisionError(`${err.message}. The salary changed since this was proposed: cancel it and propose again.`, 409)
  }
  const done = await SalaryRevision.findOneAndUpdate(
    { _id: rev._id, status: 'PENDING' },
    { $set: { status: 'APPROVED', approvedBy: session.user.id, approvedAt: new Date(), decisionNote: cleanNote, previousSalary, letterNo: await nextLetterNo() } },
    { new: true },
  ).lean()
  if (!done) throw new RevisionError('This change was updated meanwhile. Reload and try again.', 409)

  let result = done
  if (rev.effectiveMonth <= currentPeriod()) {
    await applyDueRevisions({ employeeId: rev.employeeId })
    result = (await SalaryRevision.findById(rev._id).lean()) ?? done
    if (await SalarySlip.exists({ employeeId: rev.employeeId, period: rev.effectiveMonth })) {
      warnings.push(`A salary slip for ${periodLabel(rev.effectiveMonth)} already exists and keeps the old salary: pay the difference as an earning on the next slip.`)
    }
  }

  const name = employee.userId?.name ?? 'the employee'
  const change = round2(rev.newSalary - previousSalary)
  if (!quiet && String(rev.requestedBy) !== String(session.user.id)) {
    await createNotification({
      userId: String(rev.requestedBy), type: 'SALARY',
      title: 'Salary change approved',
      message: `${name}: ${bdt(previousSalary)} → ${bdt(rev.newSalary)} from ${periodLabel(rev.effectiveMonth)}.`,
      link: `/admin/employees/${rev.employeeId}`,
    })
  }
  const empUserId = employee.userId?._id ?? employee.userId
  if (empUserId) {
    await createNotification({
      userId: String(empUserId), type: 'SALARY',
      title: rev.type === 'PROMOTION' ? 'You have been promoted' : 'Your salary has been revised',
      message: `${rev.type === 'PROMOTION' && rev.newDesignation ? `New designation: ${rev.newDesignation}. ` : ''}Your monthly salary will be ${bdt(rev.newSalary)} from ${periodLabel(rev.effectiveMonth)}${change > 0 ? ` (+${bdt(change)})` : ''}. Your letter is on your profile.`,
      link: '/admin/profile',
    })
  }
  return { revision: result, warnings }
}

async function notifyApprovers(revision, employee, session) {
  const ids = (await inventoryManagerUserIds({ perms: ['hr.salary.approve'], excludeUserId: session.user.id }))
    .filter(id => String(id) !== String(employee.userId?._id ?? employee.userId))
  if (!ids.length) return
  await createNotification({
    userId: ids, type: 'SALARY',
    title: 'Salary change to approve',
    message: `${session.user.name ?? 'Someone'} proposed ${['INCREMENT', 'ADJUSTMENT'].includes(revision.type) ? 'an' : 'a'} ${TYPE_LABELS[revision.type].toLowerCase()} for ${employee.userId?.name ?? 'an employee'}: ${bdt(revision.previousSalary)} → ${bdt(revision.newSalary)} from ${periodLabel(revision.effectiveMonth)}.`,
    link: '/admin/salary-increments',
  })
}

/**
 * Before the salary is changed on the employee form: refused while an approved
 * change is still to come (it was counted from the salary as it is now).
 */
export async function assertSalaryEditable(employee) {
  const later = await laterApproved(employee._id, currentPeriod())
  if (later) {
    throw new RevisionError(`An approved salary change from ${periodLabel(later.effectiveMonth)} is still to come: change the salary in Salary increments instead.`, 409)
  }
}

/**
 * Records a salary changed on the employee form as an applied change for this
 * month, so the history stays complete. `previousSalary` is the salary for this
 * month read before the form was saved.
 */
export async function recordSalaryEdit({ employee, previousSalary, newSalary, session }) {
  const prev = round2(Number(previousSalary) || 0)
  const next = round2(Number(newSalary) || 0)
  // Setting a salary for the first time is the starting salary, not a change.
  if (!(prev > 0) || Math.abs(next - prev) < 0.01) return null
  const now = new Date()
  return SalaryRevision.create({
    employeeId: employee._id,
    type: next > prev ? 'INCREMENT' : 'DECREASE',
    source: 'EDIT',
    effectiveMonth: currentPeriod(),
    previousSalary: prev,
    newSalary: next,
    previousDesignation: employee.designation ?? null,
    reason: 'Changed on the employee profile',
    status: 'APPROVED',
    requestedBy: session.user.id, approvedBy: session.user.id, approvedAt: now, appliedAt: now,
  })
}

/** A revision for API responses. */
export function revisionJson(r, { employee = null, users = new Map() } = {}) {
  const change = round2(r.newSalary - r.previousSalary)
  const user = (id) => (id ? users.get(String(id)) ?? null : null)
  return {
    id:             String(r._id),
    employeeId:     String(r.employeeId),
    employee,
    type:           r.type,
    typeLabel:      TYPE_LABELS[r.type],
    source:         r.source,
    effectiveMonth: r.effectiveMonth,
    effectiveLabel: periodLabel(r.effectiveMonth),
    previousSalary: r.previousSalary,
    newSalary:      r.newSalary,
    change,
    percent:        r.previousSalary > 0 ? round2((change / r.previousSalary) * 100) : null,
    previousDesignation: r.previousDesignation,
    newDesignation: r.newDesignation,
    reason:         r.reason,
    status:         r.status,
    inEffect:       r.status === 'APPROVED' && !!r.appliedAt,
    batchId:        r.batchId,
    letterNo:       r.letterNo ?? null,
    requestedBy:    user(r.requestedBy),
    approvedBy:     user(r.approvedBy),
    approvedAt:     r.approvedAt,
    decisionNote:   r.decisionNote,
    createdAt:      r.createdAt,
  }
}

/** Names of the users referenced by revisions: Map(id → { id, name }). */
export async function usersOf(revisions) {
  const ids = [...new Set(revisions.flatMap(r => [r.requestedBy, r.approvedBy]).filter(Boolean).map(String))]
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name').lean() : []
  return new Map(users.map(u => [String(u._id), { id: String(u._id), name: u.name }]))
}
