/**
 * Server-side executors for POST /api/inventory/assets/[id]/actions.
 * Private folder (`_lib`) — not a route.
 *
 * Every action:
 *  - checks the action table (lib/inventory/actions.js) for status + permission,
 *  - validates its payload,
 *  - writes an AssetEvent and changes the Asset with an optimistic guard
 *    (updatedAt + status), compensating on failure (no multi-document
 *    transactions in this app),
 *  - posts money / tax entries for disposals, recoveries and impairments.
 */

import { z } from 'zod'
import { canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { parseDhakaDay } from '@/lib/dhakaTime'
import {
  Asset, AssetCategory, AssetEvent, Department, Employee, InventoryLocation, ProjectExpense, TaxEntry, Transaction,
  User, Vendor,
} from '@/models'
import { getFinanceSettings, assertBooksOpen, assertTaxOpen } from '@/lib/finance/settings'
import { postMoneyEntry } from '@/lib/finance/ledger'
import { recordTaxEntry } from '@/lib/tax/engine'
import { isValidBin, normalizeBin, treatmentForRate, BUYER_BIN_THRESHOLD } from '@/lib/tax/catalog'
import { createNotification } from '@/lib/createNotification'
import {
  logAssetEvent, assetState, round2, statusLabel, CONDITIONS, DAMAGE_CAUSES, DAMAGE_CAUSE_LABELS, RECOVERY_METHODS,
  RECOVERY_METHOD_LABELS, UPLOAD_URL_RE, openingRegisterDay,
} from '@/lib/inventory/assets'
import { periodLabelOf, periodEndDate, residualValueOf, effectiveAccumulated } from '@/lib/inventory/depreciation'
import {
  ASSET_ACTIONS, ASSET_ACTION_KEYS, DISPOSAL_ACTIONS, NON_RECOVERABLE_CAUSES, EMPLOYEE_RECOVERY_METHODS,
  ASSET_LEDGER_CATEGORIES as CAT, actionAllowedFrom, actionBlockedMessage, actionCondition, disposalPreview,
  maxRecoverable, initialRecoveryStatus, hasHolder,
} from '@/lib/inventory/actions'
import { httpError, todayKey, eventInstant, dayKeyOf, blankToNull, fmtTk } from './service'

const CHANGED = 'This asset was changed by someone else — reload and try again'
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// ── payload schemas ──────────────────────────────────────────────────────────

const idField   = z.string().trim().refine(isValidObjectId, 'Invalid id')
const dayField  = z.string().trim().regex(DAY_RE, 'Use YYYY-MM-DD').refine(v => Boolean(parseDhakaDay(v)), 'Invalid date')
const money     = z.coerce.number({ invalid_type_error: 'Must be a number' }).min(0, 'Cannot be negative').max(1e12)
const text      = (max) => z.string().trim().max(max)
const optId     = idField.optional().nullable()
const condition = z.enum(CONDITIONS).optional().nullable()
const uploadUrl = z.string().trim().regex(UPLOAD_URL_RE, 'Attach the file with the upload button')
const urlList   = z.array(uploadUrl).max(20).optional().nullable()

const baseSchema = z.object({
  action:      z.enum(ASSET_ACTION_KEYS, { errorMap: () => ({ message: 'Unknown action' }) }),
  date:        dayField.optional().nullable(),
  notes:       text(4000).optional().nullable(),
  attachments: urlList,
}).passthrough()

const assignSchema = z.object({
  employeeId: optId, departmentId: optId, locationId: optId,
  expectedReturnDate: dayField.optional().nullable(), condition,
})

const SCHEMAS = {
  assign: assignSchema,
  reassign: assignSchema,
  return: z.object({ condition, locationId: optId }),
  transfer: z.object({ locationId: idField }),
  repair_send: z.object({
    vendorId: optId, vendorName: text(200).optional().nullable(), repairRef: text(120).optional().nullable(),
    expectedDate: dayField.optional().nullable(),
  }),
  repair_complete: z.object({
    cost: money.optional().nullable(),
    capitalize: z.boolean().optional().nullable(),
    payment: z.object({
      mode: z.enum(['REQUEST', 'NONE']).optional().nullable(),
      vatAmount: money.optional().nullable(),
    }).optional().nullable(),
    condition,
    returnTo: z.enum(['IN_STOCK', 'ASSIGNED']).optional().nullable(),
    locationId: optId,
    vendorId: optId,
    vendorName: text(200).optional().nullable(),
    repairRef: text(120).optional().nullable(),
  }),
  report_damage: z.object({
    cause: z.enum(DAMAGE_CAUSES, { errorMap: () => ({ message: 'Choose what caused the damage' }) }),
    description: text(4000).min(3, 'Describe the damage'),
    responsibleEmployeeId: optId,
    liabilityPct: z.coerce.number().min(0).max(100).optional().nullable(),
    assessedLoss: money.optional().nullable(),
    recovery: z.object({
      method: z.enum(RECOVERY_METHODS).optional().nullable(),
      amount: money.optional().nullable(),
    }).optional().nullable(),
    enquiryNote: text(4000).optional().nullable(),
    photos: urlList,
    condition,
    gdNumber: text(120).optional().nullable(),
    reportEventId: optId,
  }),
  update_recovery: z.object({
    eventId: idField,
    status: z.enum(['RECOVERED', 'WAIVED']),
    amount: money.optional().nullable(),
    accountId: optId,
    note: text(2000).optional().nullable(),
  }),
  mark_lost: z.object({ description: text(4000).min(3, 'Describe what happened'), gdNumber: text(120).optional().nullable() }),
  mark_stolen: z.object({ description: text(4000).min(3, 'Describe what happened'), gdNumber: text(120).optional().nullable() }),
  found: z.object({ locationId: optId, condition }),
  retire: z.object({ reason: text(2000).optional().nullable() }),
  reactivate: z.object({}),
  sell: z.object({
    buyerName: text(200).min(1, 'Buyer name is required'),
    buyerBin: text(20).optional().nullable(),
    proceeds: money,
    vatRate: z.coerce.number().min(0).max(100).optional().nullable(),
    accountId: optId,
    reason: text(2000).optional().nullable(),
  }),
  scrap: z.object({
    reason: text(2000).min(3, 'Give the reason for scrapping'),
    scrapValue: money.optional().nullable(),
    buyerName: text(200).optional().nullable(),
    buyerBin: text(20).optional().nullable(),
    vatRate: z.coerce.number().min(0).max(100).optional().nullable(),
    accountId: optId,
  }),
  write_off: z.object({ reason: text(2000).min(3, 'Give the reason for the write-off') }),
  donate: z.object({
    recipient: text(200).min(1, 'Who received the donation?'),
    reason: text(2000).min(3, 'Give the reason for the donation'),
  }),
  adjust_value: z.object({
    impairment: money.optional().nullable(),
    newCost: money.optional().nullable(),
    reason: text(2000).min(5, 'Explain the adjustment (at least 5 characters)'),
  }),
  note: z.object({}),
}

// ── small helpers ────────────────────────────────────────────────────────────

const str = (v) => (v === null || v === undefined ? null : String(v?._id ?? v))
const dayStart = (key) => parseDhakaDay(key).start

function userIdOf(emp) {
  if (!emp?.userId) return null
  return String(emp.userId._id ?? emp.userId)
}

function nameOf(emp) {
  return emp?.userId?.name ?? emp?.employeeId ?? 'employee'
}

async function loadEmployee(id, { allowInactive = false } = {}) {
  const emp = await Employee.findById(id)
    .select('employeeId userId designation department isActive resigned')
    .populate('userId', 'name isActive')
    .lean()
  if (!emp) throw httpError(422, 'Employee not found')
  if (!allowInactive && (emp.resigned || emp.isActive === false || emp.userId?.isActive === false)) {
    throw httpError(422, `${nameOf(emp)} is no longer an active employee`)
  }
  return emp
}

async function loadLocation(id) {
  const loc = await InventoryLocation.findById(id).select('name isActive').lean()
  if (!loc) throw httpError(422, 'Location not found')
  if (loc.isActive === false) throw httpError(422, `Location "${loc.name}" is inactive`)
  return loc
}

async function loadDepartment(id) {
  const dept = await Department.findById(id).select('name isActive').lean()
  if (!dept || dept.isActive === false) throw httpError(422, 'Department not found')
  return dept
}

async function loadVendor(id) {
  const v = await Vendor.findById(id).select('company').lean()
  if (!v) throw httpError(422, 'Vendor not found')
  return v
}

async function booksOpen(dateKey) {
  const msg = await assertBooksOpen(dateKey)
  if (msg) throw httpError(409, msg, { code: 'BOOKS_LOCKED' })
}

async function notifyManagers({ title, message, link, exceptUserId }) {
  try {
    const users = await User.find({ role: { $in: ['SUPER_ADMIN', 'MANAGER'] }, isActive: true }).select('_id').limit(50).lean()
    const ids = users.map(u => String(u._id)).filter(id => id !== exceptUserId)
    if (ids.length) await createNotification({ userId: ids, title, message, type: 'ASSET', link })
  } catch (err) {
    console.error('[asset actions] manager notification failed', err)
  }
}

function notify(userId, title, message, link = '/admin/my-assets') {
  if (!userId) return
  createNotification({ userId, title, message, type: 'ASSET', link }).catch(() => {})
}

const holderCleared = () => ({
  assignedEmployeeId: null,
  assignedUserId: null,
  assignedDepartmentId: null,
  assignedAt: null,
  expectedReturnDate: null,
  acknowledgement: { status: 'NOT_REQUIRED', at: null, note: null, eventId: null },
})

const getIn = (obj, path) => path.split('.').reduce((c, k) => (c == null ? undefined : c[k]), obj)

/** Put back the claimed fields of an asset after a failed money posting (best effort). */
async function restoreAsset(prev, keys, filter) {
  const restore = {}
  for (const k of keys) {
    if (k === 'updatedBy') continue
    const v = getIn(prev, k)
    restore[k] = v === undefined ? null : v
  }
  try {
    await Asset.updateOne({ _id: prev._id, ...filter }, { $set: restore })
  } catch (err) {
    console.error(`[asset actions] restore of ${prev.assetTag} failed`, err)
  }
}

async function deleteRows({ txIds = [], taxIds = [], eventIds = [] }) {
  const jobs = []
  if (txIds.length) jobs.push(Transaction.deleteMany({ _id: { $in: txIds } }))
  if (taxIds.length) jobs.push(TaxEntry.deleteMany({ _id: { $in: taxIds } }))
  if (eventIds.length) jobs.push(AssetEvent.deleteMany({ _id: { $in: eventIds } }))
  const results = await Promise.allSettled(jobs)
  for (const r of results) if (r.status === 'rejected') console.error('[asset actions] compensation failed', r.reason)
}

/**
 * Write the event, then apply `set` to the asset with an optimistic guard.
 * `set` may be a function of the new event id (acknowledgement.eventId).
 */
async function commit(ctx, { event, set }) {
  const ev = await logAssetEvent({
    asset: ctx.asset,
    date: ctx.dateKey,
    notes: event.notes === undefined ? ctx.notes : event.notes,
    attachments: event.attachments ?? ctx.attachments,
    session: ctx.session,
    ...event,
  })
  const changes = typeof set === 'function' ? set(ev._id) : { ...set }
  changes.updatedBy = ctx.session.user.id
  let updated = null
  try {
    updated = await Asset.findOneAndUpdate(
      { _id: ctx.asset._id, updatedAt: ctx.asset.updatedAt, status: ctx.asset.status },
      { $set: changes },
      { new: true, runValidators: true },
    ).lean()
  } catch (err) {
    await deleteRows({ eventIds: [ev._id] })
    throw err
  }
  if (!updated) {
    await deleteRows({ eventIds: [ev._id] })
    throw httpError(409, CHANGED)
  }
  return { updated, event: ev }
}

/** Claim the asset (status change + money fields) before posting money. */
async function claim(ctx, set) {
  const changes = { ...set, updatedBy: ctx.session.user.id }
  const updated = await Asset.findOneAndUpdate(
    { _id: ctx.asset._id, updatedAt: ctx.asset.updatedAt, status: ctx.asset.status },
    { $set: changes },
    { new: true, runValidators: true },
  ).lean()
  if (!updated) throw httpError(409, CHANGED)
  return { updated, keys: Object.keys(changes) }
}

const tagName = (a) => `${a.assetTag} ${a.name}`

// ── custody ──────────────────────────────────────────────────────────────────

async function doAssign(ctx) {
  const { asset, payload: p, action, category } = ctx
  if (!p.employeeId && !p.departmentId) throw httpError(422, 'Choose the employee (or department) to assign the asset to')
  const [emp, dept, loc] = await Promise.all([
    p.employeeId ? loadEmployee(p.employeeId) : null,
    p.departmentId ? loadDepartment(p.departmentId) : null,
    p.locationId ? loadLocation(p.locationId) : null,
  ])
  if (action === 'reassign') {
    const same = str(asset.assignedEmployeeId) === str(emp?._id) && str(asset.assignedDepartmentId) === str(dept?._id)
    if (same) throw httpError(409, `The asset is already assigned to ${emp ? nameOf(emp) : dept.name}`)
  }
  if (p.expectedReturnDate && p.expectedReturnDate < ctx.dateKey) {
    throw httpError(422, 'The expected return date is before the hand-over date')
  }
  const ackStatus = emp && category?.requiresAcknowledgement !== false ? 'PENDING' : 'NOT_REQUIRED'
  const to = {
    status: 'ASSIGNED',
    locationId: loc?._id ?? asset.locationId ?? null,
    employeeId: emp?._id ?? null,
    departmentId: dept?._id ?? null,
    condition: p.condition ?? asset.condition,
  }
  const result = await commit(ctx, {
    event: {
      type: 'ASSIGNED',
      from: assetState(asset),
      to,
      details: {
        reassign: action === 'reassign',
        expectedReturnDate: p.expectedReturnDate ?? null,
        acknowledgement: ackStatus,
        previousEmployeeId: asset.assignedEmployeeId ?? null,
        previousDepartmentId: asset.assignedDepartmentId ?? null,
      },
    },
    set: (eventId) => ({
      status: 'ASSIGNED',
      assignedEmployeeId: emp?._id ?? null,
      assignedUserId: emp ? userIdOf(emp) : null,
      assignedDepartmentId: dept?._id ?? null,
      assignedAt: eventInstant(ctx.dateKey),
      expectedReturnDate: p.expectedReturnDate ? dayStart(p.expectedReturnDate) : null,
      locationId: to.locationId,
      condition: to.condition,
      acknowledgement: { status: ackStatus, at: null, note: null, eventId },
    }),
  })

  if (emp) {
    notify(userIdOf(emp), 'Equipment assigned to you',
      `${tagName(asset)}.${ackStatus === 'PENDING' ? ' Please confirm you received it in My Assets.' : ''}`)
  }
  if (action === 'reassign' && asset.assignedUserId && str(asset.assignedUserId) !== userIdOf(emp)) {
    notify(str(asset.assignedUserId), 'Equipment handed over', `${tagName(asset)} has been reassigned to ${emp ? nameOf(emp) : dept.name}.`)
  }
  return {
    ...result,
    log: { to: emp ? nameOf(emp) : dept?.name, employeeId: str(emp?._id), departmentId: str(dept?._id), acknowledgement: ackStatus },
  }
}

async function doReturn(ctx) {
  const { asset, payload: p } = ctx
  const condition = p.condition ?? asset.condition
  const target = condition === 'BROKEN' ? 'DAMAGED' : 'IN_STOCK'
  if (asset.status === 'DAMAGED' && target === 'DAMAGED' && !hasHolder(asset)) {
    throw httpError(409, 'The asset is already damaged and in store — send it for repair or dispose of it')
  }
  const loc = p.locationId ? await loadLocation(p.locationId) : null
  const locationId = loc?._id ?? asset.locationId ?? null
  const result = await commit(ctx, {
    event: {
      type: 'RETURNED',
      from: assetState(asset),
      to: { status: target, locationId, condition },
      condition,
      details: {
        previousEmployeeId: asset.assignedEmployeeId ?? null,
        previousDepartmentId: asset.assignedDepartmentId ?? null,
        assignedAt: asset.assignedAt ?? null,
        acknowledgementAtReturn: asset.acknowledgement?.status ?? null,
        returnedBroken: target === 'DAMAGED',
      },
    },
    set: { ...holderCleared(), status: target, condition, locationId },
  })
  if (asset.assignedUserId) {
    notify(str(asset.assignedUserId), 'Equipment return recorded', `${tagName(asset)} has been checked back in.`)
  }
  const warnings = target === 'DAMAGED'
    ? ['Returned broken — the asset is now Damaged. Record a damage report if a recovery case is needed.']
    : []
  return { ...result, warnings, log: { condition, status: target } }
}

async function doTransfer(ctx) {
  const { asset, payload: p } = ctx
  const loc = await loadLocation(p.locationId)
  if (str(asset.locationId) === str(loc._id)) throw httpError(409, `The asset is already at ${loc.name}`)
  const result = await commit(ctx, {
    event: {
      type: 'TRANSFERRED',
      from: { status: asset.status, locationId: asset.locationId },
      to: { status: asset.status, locationId: loc._id },
      details: { toLocationName: loc.name },
    },
    set: { locationId: loc._id },
  })
  return { ...result, log: { to: loc.name } }
}

// ── repairs ──────────────────────────────────────────────────────────────────

async function doRepairSend(ctx) {
  const { asset, payload: p } = ctx
  const vendor = p.vendorId ? await loadVendor(p.vendorId) : null
  const vendorName = p.vendorName ?? vendor?.company ?? null
  if (p.expectedDate && p.expectedDate < ctx.dateKey) throw httpError(422, 'The expected return date is before the date sent')
  const result = await commit(ctx, {
    event: {
      type: 'REPAIR_SENT',
      from: assetState(asset),
      to: { ...assetState(asset), status: 'IN_REPAIR' },
      vendorId: vendor?._id ?? null,
      details: {
        repairRef: p.repairRef ?? null,
        vendorName,
        expectedDate: p.expectedDate ?? null,
        previousStatus: asset.status,
        issue: ctx.notes ?? null,
      },
    },
    set: { status: 'IN_REPAIR' },
  })
  return { ...result, log: { vendor: vendorName, repairRef: p.repairRef ?? null } }
}

async function doRepairComplete(ctx) {
  const { asset, payload: p, session } = ctx
  const sent = await AssetEvent.findOne({ assetId: asset._id, type: 'REPAIR_SENT' }).sort({ date: -1, createdAt: -1 }).lean()
  const cost = round2(p.cost ?? 0)
  const capitalize = Boolean(p.capitalize) && cost > 0
  if (capitalize) {
    if (!canDoAny(session, ['inventory.manage', 'inventory.dispose'])) {
      throw httpError(403, 'Only inventory managers can add a repair to the asset cost')
    }
    if (asset.isCapitalized === false) throw httpError(422, 'This asset is not capitalized — the repair cost is an expense')
    await booksOpen(ctx.dateKey)
  }
  const mode = cost > 0 ? (p.payment?.mode ?? 'REQUEST') : 'NONE'
  const vat = round2(p.payment?.vatAmount ?? 0)
  if (vat > cost + 0.005) throw httpError(422, 'VAT cannot be more than the repair bill')

  const returnTo = p.returnTo ?? (hasHolder(asset) ? 'ASSIGNED' : 'IN_STOCK')
  if (returnTo === 'ASSIGNED' && !hasHolder(asset)) {
    throw httpError(422, 'No one holds this asset — return it to stock, then assign it')
  }
  const vendor = p.vendorId ? await loadVendor(p.vendorId) : null
  const vendorId = vendor?._id ?? sent?.vendorId ?? null
  const vendorName = p.vendorName ?? vendor?.company ?? sent?.details?.vendorName ?? null
  const repairRef = p.repairRef ?? sent?.details?.repairRef ?? null
  const condition = p.condition ?? 'GOOD'
  const loc = p.locationId ? await loadLocation(p.locationId) : null
  const locationId = loc?._id ?? asset.locationId ?? null

  let expense = null
  if (mode === 'REQUEST') {
    expense = await new ProjectExpense({
      origin: vendorId ? 'VENDOR' : 'OTHER',
      title: `[${asset.assetTag}] repair${repairRef ? ` — ${repairRef}` : ''}`,
      amount: cost,
      currency: 'BDT',
      amountBDT: cost,
      category: CAT.REPAIRS,
      date: dayStart(ctx.dateKey),
      notes: [`Repair of ${tagName(asset)}`, vendorName ? `Vendor: ${vendorName}` : null, ctx.notes].filter(Boolean).join('\n'),
      invoiceUrl: ctx.attachments[0] ?? null,
      vendorId: vendorId ?? null,
      paidToName: vendorId ? null : vendorName,
      submittedBy: session.user.id,
      status: 'PENDING',
      capitalizedAmountBDT: capitalize ? cost : 0,
      ...(vat > 0 ? { tax: { vatAmount: vat, vatCreditable: false, netPayable: cost } } : {}),
    }).save()
  }

  const newCost = capitalize ? round2((Number(asset.cost) || 0) + cost) : null
  const set = { status: returnTo, condition, locationId }
  if (returnTo === 'IN_STOCK') Object.assign(set, holderCleared())
  if (capitalize) {
    const acc = effectiveAccumulated(asset)
    set.cost = newCost
    set['depreciation.fullyDepreciated'] = acc >= round2(newCost - residualValueOf(asset)) - 0.005
  }

  const days = sent?.date ? Math.max(0, Math.round((dayStart(ctx.dateKey) - new Date(sent.date)) / 86400000)) : null
  let result
  try {
    result = await commit(ctx, {
      event: {
        type: 'REPAIR_COMPLETED',
        from: assetState(asset),
        to: { ...assetState(asset), status: returnTo, condition, locationId, ...(returnTo === 'IN_STOCK' ? { employeeId: null, departmentId: null } : {}) },
        condition,
        amount: cost > 0 ? cost : null,
        vendorId,
        expenseId: expense?._id ?? null,
        details: {
          repairRef, vendorName, cost, vatAmount: vat, capitalize, paymentMode: mode,
          expenseId: expense?._id ?? null, returnTo, sentEventId: sent?._id ?? null, daysInRepair: days,
        },
      },
      set,
    })
  } catch (err) {
    if (expense) await ProjectExpense.deleteOne({ _id: expense._id }).catch(e => console.error('[repair_complete] expense rollback failed', e))
    throw err
  }

  if (capitalize) {
    try {
      await logAssetEvent({
        asset: result.updated,
        type: 'VALUE_ADJUSTED',
        date: ctx.dateKey,
        amount: cost,
        expenseId: expense?._id ?? null,
        details: {
          kind: 'CAPITALIZED_REPAIR', amount: cost,
          costBefore: round2(asset.cost), costAfter: newCost,
          fromCost: round2(asset.cost), toCost: newCost, repairEventId: result.event._id,
        },
        notes: 'Repair cost added to the asset cost',
        session,
      })
    } catch (err) {
      console.error('[repair_complete] value event failed', err)
    }
  }

  const warnings = []
  if (cost > 0 && mode === 'NONE') warnings.push('No payment request was created — record the repair bill in Accounts if it still has to be paid.')
  if (expense) warnings.push(`Payment request ${expense.expenseId ?? ''} sent to Accounts for ${fmtTk(cost)}.`.replace('  ', ' '))
  if (returnTo === 'ASSIGNED' && asset.assignedUserId) {
    notify(str(asset.assignedUserId), 'Equipment back from repair', `${tagName(asset)} has been repaired and is back with you.`)
  }
  return { ...result, warnings, log: { cost, capitalize, expenseId: str(expense?._id), returnTo } }
}

// ── damage & recovery (Labour Act 2006 s.125 / s.127 register) ──────────────

async function doReportDamage(ctx) {
  const { asset, payload: p } = ctx
  const method = p.recovery?.method ?? 'NONE'
  const loss = round2(p.assessedLoss ?? 0)
  const resp = p.responsibleEmployeeId ? await loadEmployee(p.responsibleEmployeeId, { allowInactive: true }) : null
  let pct = p.liabilityPct ?? null
  let amount = round2(p.recovery?.amount ?? 0)

  if (EMPLOYEE_RECOVERY_METHODS.includes(method)) {
    if (!resp) throw httpError(422, 'Choose the employee responsible for the damage')
    if (NON_RECOVERABLE_CAUSES.includes(p.cause)) {
      throw httpError(422, `${DAMAGE_CAUSE_LABELS[p.cause]} is not the employee's fault — nothing can be recovered from them (Labour Act s.125)`)
    }
    if (!(loss > 0)) throw httpError(422, 'Enter the assessed loss before recovering it from an employee')
    if (pct === null) pct = 100
    if (!(pct > 0)) throw httpError(422, "Enter the employee's share of the liability")
    const cap = maxRecoverable({ assessedLoss: loss, liabilityPct: pct })
    if (!(amount > 0)) amount = cap
    if (amount > cap + 0.005) {
      throw httpError(422, `The recovery cannot exceed the employee's share of the actual loss (${fmtTk(cap)})`)
    }
    if (!p.enquiryNote || p.enquiryNote.length < 10) {
      throw httpError(422, 'Record the enquiry findings — a deduction needs a proper enquiry (Labour Act s.125/127)')
    }
  } else if (method === 'INSURANCE') {
    if (!(amount > 0)) amount = loss
    if (loss > 0 && amount > loss + 0.005) throw httpError(422, 'The insurance claim cannot exceed the assessed loss')
  } else {
    amount = 0
  }
  const recoveryStatus = initialRecoveryStatus(method, amount)

  let report = null
  if (p.reportEventId) {
    report = await AssetEvent.findOne({ _id: p.reportEventId, assetId: asset._id, type: 'DAMAGE_REPORTED' }).select('_id date').lean()
    if (!report) throw httpError(422, 'The employee report being assessed was not found')
  }

  const cond = p.condition ?? 'POOR'
  const photos = p.photos ?? []
  const result = await commit(ctx, {
    event: {
      type: 'DAMAGE_REPORTED',
      from: assetState(asset),
      to: { ...assetState(asset), status: 'DAMAGED', condition: cond },
      condition: cond,
      amount: loss > 0 ? loss : null,
      notes: p.description,
      attachments: [...photos, ...ctx.attachments],
      details: {
        cause: p.cause,
        description: p.description,
        responsibleEmployeeId: resp?._id ?? null,
        responsibleEmployeeName: resp ? nameOf(resp) : null,
        liabilityPct: pct,
        assessedLoss: loss,
        recovery: {
          method, amount, status: recoveryStatus,
          recoveredAt: null, recoveredAmount: null, transactionId: null, note: null,
        },
        gdNumber: p.gdNumber ?? null,
        enquiryNote: p.enquiryNote ?? null,
        reportedByEmployee: false,
        reportEventId: report?._id ?? null,
        holderEmployeeId: asset.assignedEmployeeId ?? null,
        photos,
        extraNotes: ctx.notes ?? null,
      },
    },
    set: { status: 'DAMAGED', condition: cond },
  })

  // The employee's own report is now assessed (it stays in the history, linked to this case).
  if (report) {
    await AssetEvent.updateOne(
      { _id: report._id },
      { $set: { 'details.assessed': true, 'details.assessedEventId': result.event._id } },
    ).catch(e => console.error('[report_damage] marking the employee report assessed failed', e))
  }

  const warnings = []
  const nbv = round2((Number(asset.cost) || 0) - effectiveAccumulated(asset))
  if (asset.isCapitalized !== false && loss > nbv + 0.005 && nbv > 0) {
    warnings.push(`The assessed loss is more than the book value (${fmtTk(nbv)}).`)
  }
  if (resp && recoveryStatus === 'PENDING' && EMPLOYEE_RECOVERY_METHODS.includes(method)) {
    notify(userIdOf(resp), 'Damage recovery recorded',
      `${fmtTk(amount)} (${RECOVERY_METHOD_LABELS[method].toLowerCase()}) for damage to ${tagName(asset)}. Talk to your manager or HR if you disagree.`)
  }
  return { ...result, warnings, log: { cause: p.cause, assessedLoss: loss, recovery: { method, amount, status: recoveryStatus }, responsible: resp ? nameOf(resp) : null } }
}

/**
 * Record a recovery instalment or waive the balance of a damage case.
 *
 * A case may be recovered in instalments (wage deductions are limited per wage
 * period): details.recovery.recoveredAmount is the running total and the case
 * stays PENDING until the whole case amount is recovered, or the balance is
 * waived with a reason (WAIVED keeps what was already recovered on record).
 *
 * The money row and the RECOVERY_UPDATED event are written first; the guarded
 * update of the case (still PENDING, and no other instalment recorded since it
 * was read) is the commit point. A refused or failed commit deletes only our
 * own rows, so a case someone else has moved on is never rolled back.
 */
async function doUpdateRecovery(ctx) {
  const { asset, payload: p, session } = ctx
  const ev = await AssetEvent.findOne({ _id: p.eventId, assetId: asset._id, type: 'DAMAGE_REPORTED' }).lean()
  if (!ev) throw httpError(404, 'Damage case not found')
  const rec = ev.details?.recovery
  if (!rec || rec.status !== 'PENDING') throw httpError(409, 'This damage case has no pending recovery')
  const method = rec.method ?? 'NONE'
  const note = p.note ?? ctx.notes ?? null
  const caseDay = dayKeyOf(ev.date)
  if (caseDay && ctx.dateKey < caseDay) throw httpError(422, `The date is before the damage was recorded (${caseDay})`)

  // Case amount, what earlier instalments recovered and the balance still due.
  const cap = round2(Number(rec.amount) > 0 ? Number(rec.amount) : Number(ev.details?.assessedLoss) || 0)
  const already = round2(Number(rec.recoveredAmount) || 0)
  const balance = round2(Math.max(0, cap - already))

  let amount = 0
  let total = already
  let waived = null
  let newStatus = 'WAIVED'
  let needsAccount = false
  if (p.status === 'RECOVERED') {
    amount = round2(p.amount ?? balance)
    if (!(amount > 0)) throw httpError(422, 'Enter the amount recovered')
    if (cap > 0 && amount > balance + 0.005) {
      throw httpError(422, already > 0
        ? `The recovery cannot exceed the balance still to recover (${fmtTk(balance)})`
        : `The recovery cannot exceed ${fmtTk(cap)} for this case`)
    }
    total = round2(already + amount)
    newStatus = cap > 0 && total < cap - 0.005 ? 'PENDING' : 'RECOVERED'
    needsAccount = method === 'CASH' || method === 'INSURANCE'
    if (needsAccount && !p.accountId) throw httpError(422, 'Choose the account the money was received into')
    if (needsAccount) await booksOpen(ctx.dateKey)
  } else {
    if (!note || note.length < 5) throw httpError(422, 'Give the reason for waiving the recovery')
    waived = balance
  }
  const outstanding = newStatus === 'PENDING' ? round2(cap - total) : 0

  let tx = null
  let event = null
  try {
    if (needsAccount) {
      const who = ev.details?.responsibleEmployeeName
      tx = await postMoneyEntry({
        type: 'INCOME',
        kind: 'OPERATING',
        category: CAT.RECOVERY,
        amount,
        currency: 'BDT',
        amountBDT: amount,
        date: ctx.dateKey,
        accountId: p.accountId,
        description: `${method === 'INSURANCE' ? 'Insurance claim' : 'Damage recovery'} — ${tagName(asset)}${method === 'CASH' && who ? ` (from ${who})` : ''}${newStatus === 'PENDING' || already > 0 ? ' (instalment)' : ''}`,
        reference: asset.assetTag,
        assetId: asset._id,
        createdBy: session.user.id,
      }, { userId: session.user.id })
    }
    event = await logAssetEvent({
      asset,
      type: 'RECOVERY_UPDATED',
      date: ctx.dateKey,
      amount: p.status === 'RECOVERED' ? amount : null,
      transactionId: tx?._id ?? null,
      notes: note,
      attachments: ctx.attachments,
      details: {
        eventId: ev._id,          // the damage case (read by reports and the employee Assets tab)
        damageEventId: ev._id,
        previousStatus: 'PENDING',
        status: newStatus,        // PENDING = part recovered, the case stays open
        method,
        amount: p.status === 'RECOVERED' ? amount : null,   // this instalment
        caseAmount: cap,
        recoveredBefore: already,
        recoveredTotal: total,
        outstanding,
        waivedAmount: waived,
        accountId: needsAccount ? p.accountId : null,
        transactionId: tx?._id ?? null,
        note,
      },
      session,
    })
  } catch (err) {
    await deleteRows({ txIds: tx ? [tx._id] : [] })
    throw err
  }

  const own = { txIds: tx ? [tx._id] : [], eventIds: [event._id] }
  let claimed
  try {
    claimed = await AssetEvent.updateOne(
      { _id: ev._id, 'details.recovery.status': 'PENDING', 'details.recovery.recoveredAmount': rec.recoveredAmount ?? null },
      {
        $set: {
          'details.recovery.status': newStatus,
          'details.recovery.recoveredAt': eventInstant(ctx.dateKey),
          'details.recovery.recoveredAmount': total > 0 ? total : null,
          'details.recovery.note': note,
          ...(tx ? { 'details.recovery.transactionId': tx._id } : {}),
          ...(newStatus === 'WAIVED' ? { 'details.recovery.waivedAmount': waived } : {}),
        },
        ...(tx ? { $push: { 'details.recovery.transactionIds': tx._id } } : {}),
      },
    )
  } catch (err) {
    await deleteRows(own)
    throw err
  }
  if (claimed.matchedCount !== 1) {
    await deleteRows(own)
    throw httpError(409, 'This recovery was just updated by someone else — reload and try again')
  }

  const warnings = []
  if (newStatus === 'PENDING') warnings.push(`${fmtTk(outstanding)} still to recover — the case stays open.`)
  if (p.status === 'RECOVERED' && method === 'SALARY') {
    warnings.push(`${fmtTk(amount)} recorded as recovered through salary — make sure the deduction appears on the payslip (Labour Act s.127 register).`)
  }
  return {
    updated: asset,
    event,
    warnings,
    logAction: needsAccount ? 'PAYMENT' : 'UPDATE',
    log: {
      damageEventId: str(ev._id), status: newStatus, method, amount,
      recoveredTotal: total, outstanding, waivedAmount: waived, transactionId: str(tx?._id),
    },
  }
}

// ── lost / stolen / found / retire ───────────────────────────────────────────

async function doLostStolen(ctx) {
  const { asset, payload: p, action, session } = ctx
  const to = action === 'mark_stolen' ? 'STOLEN' : 'LOST'
  const result = await commit(ctx, {
    event: {
      type: to,
      from: assetState(asset),
      to: { status: to, locationId: asset.locationId },
      notes: p.description,
      details: {
        description: p.description,
        gdNumber: p.gdNumber ?? null,
        lastHolderEmployeeId: asset.assignedEmployeeId ?? null,
        lastHolderDepartmentId: asset.assignedDepartmentId ?? null,
        lastLocationId: asset.locationId ?? null,
        extraNotes: ctx.notes ?? null,
      },
    },
    set: { ...holderCleared(), status: to },
  })
  const warnings = []
  if (to === 'STOLEN' && !p.gdNumber) warnings.push('Add the police GD number when you have it — insurers and the tax write-off need it.')
  notifyManagers({
    title: `Asset reported ${to === 'STOLEN' ? 'stolen' : 'lost'}`,
    message: `${tagName(asset)} — ${p.description.slice(0, 140)}`,
    link: `/admin/inventory/assets/${asset._id}`,
    exceptUserId: session.user.id,
  })
  return { ...result, warnings, log: { gdNumber: p.gdNumber ?? null } }
}

async function doFound(ctx) {
  const { asset, payload: p } = ctx
  const loc = p.locationId ? await loadLocation(p.locationId) : null
  const locationId = loc?._id ?? asset.locationId ?? null
  const cond = p.condition ?? asset.condition
  const result = await commit(ctx, {
    event: {
      type: 'FOUND',
      from: assetState(asset),
      to: { status: 'IN_STOCK', locationId, condition: cond },
      condition: cond,
      details: { wasStatus: asset.status },
    },
    set: { status: 'IN_STOCK', locationId, condition: cond },
  })
  return { ...result, log: { condition: cond } }
}

async function doRetire(ctx) {
  const { asset, payload: p } = ctx
  const result = await commit(ctx, {
    event: {
      type: 'RETIRED',
      from: assetState(asset),
      to: { ...assetState(asset), status: 'RETIRED' },
      details: { reason: p.reason ?? ctx.notes ?? null },
    },
    set: { status: 'RETIRED' },
  })
  return { ...result, warnings: ['Book depreciation continues while a retired asset is kept (IAS 16).'] }
}

async function doReactivate(ctx) {
  const { asset } = ctx
  return commit(ctx, {
    event: { type: 'REACTIVATED', from: assetState(asset), to: { ...assetState(asset), status: 'IN_STOCK' } },
    set: { status: 'IN_STOCK' },
  })
}

async function doNote(ctx) {
  if (!ctx.notes || ctx.notes.length < 2) throw httpError(422, 'Write the note')
  return commit(ctx, {
    event: { type: 'NOTE', from: ctx.asset.status, to: ctx.asset.status },
    set: {},
  })
}

// ── disposals ────────────────────────────────────────────────────────────────

async function doDispose(ctx) {
  const { asset, payload: p, action, session, settings } = ctx
  const toStatus = DISPOSAL_ACTIONS[action]
  const def = ASSET_ACTIONS[action]
  const userId = session.user.id
  const convention = settings.inventory?.depreciationConvention || 'PRORATA_DAYS'
  const postDepreciation = settings.inventory?.postDepreciationToLedger !== false
  const registered = (settings.vat?.registrationType ?? 'REGISTERED') === 'REGISTERED'

  const proceeds = action === 'sell' ? round2(p.proceeds) : action === 'scrap' ? round2(p.scrapValue ?? 0) : 0
  let vatRate = 0
  if (proceeds > 0) {
    // Sale of a used asset or of scrap is a taxable supply for a registered person.
    vatRate = p.vatRate ?? (registered ? Number(settings.vat?.defaultSalesRate ?? 15) : 0)
    if (!registered && vatRate > 0) throw httpError(422, 'The company is not VAT registered — no VAT can be charged on the sale')
  }
  const buyerName = action === 'sell' ? p.buyerName
    : action === 'scrap' ? (p.buyerName ?? (proceeds > 0 ? 'Scrap buyer' : null))
      : action === 'donate' ? p.recipient : null
  let buyerBin = null
  if (p.buyerBin) {
    if (!isValidBin(p.buyerBin)) throw httpError(422, 'Buyer BIN must be 9 or 13 digits (e.g. 000123456-0101)')
    buyerBin = normalizeBin(p.buyerBin)
  }
  const reason = p.reason ?? ctx.notes ?? null

  const preview = disposalPreview(asset, { date: ctx.dateKey, proceeds, vatRate, convention })
  if (preview.gross > 0 && !p.accountId) throw httpError(422, 'Choose the account the money was received into')
  await booksOpen(ctx.dateKey)
  if (preview.vatAmount > 0) {
    const taxLocked = await assertTaxOpen(ctx.dateKey)
    if (taxLocked) throw httpError(409, taxLocked)
  }

  const warnings = []
  const over = preview.overPosted ?? { amount: 0, lines: [] }
  if (over.amount > 0.005) {
    const first = over.lines[0]?.period
    const lastLine = over.lines[over.lines.length - 1]?.period
    const span = first && lastLine && first !== lastLine ? `${periodLabelOf(first)} – ${periodLabelOf(lastLine)}` : periodLabelOf(first ?? lastLine)
    warnings.push(`Depreciation of ${fmtTk(over.amount)} already posted after the disposal date (${span}) was written back.`)
  }
  if (preview.vatAmount > 0 && !buyerBin && proceeds > BUYER_BIN_THRESHOLD) {
    warnings.push('No buyer BIN recorded — a registered buyer needs it on the Mushak-6.3.')
  }

  const gainLoss = proceeds > 0 ? preview.gainLoss : round2(-preview.bookValue)
  const capitalized = asset.isCapitalized !== false
  const claimSet = {
    ...holderCleared(),
    status: toStatus,
    disposal: {
      type: toStatus,
      date: dayStart(ctx.dateKey),
      buyerName: buyerName ?? null,
      buyerBin,
      proceeds: action === 'sell' || proceeds > 0 ? proceeds : null,
      vatAmount: preview.vatAmount > 0 ? preview.vatAmount : null,
      accountId: preview.gross > 0 ? p.accountId : null,
      bookValue: preview.bookValue,
      gainLoss,
      transactionIds: [],
      reason,
      approvedBy: userId,
    },
  }
  if (capitalized) {
    claimSet['depreciation.accumulated'] = preview.accumulatedAfter
    claimSet['depreciation.fullyDepreciated'] = preview.accumulatedAfter >= round2(preview.cost - residualValueOf(asset)) - 0.005
    if (preview.depreciation.amount > 0) claimSet['depreciation.lastPostedPeriod'] = preview.depreciation.toPeriod
  }

  const { updated, keys } = await claim(ctx, claimSet)

  const txIds = []
  const taxIds = []
  const eventIds = []
  let depTx = null
  let saleTx = null
  let mainTx = null
  let taxEntry = null
  let event = null
  const common = { currency: 'BDT', date: ctx.dateKey, reference: asset.assetTag, assetId: asset._id, createdBy: userId }
  try {
    const dep = preview.depreciation
    if (capitalized && dep.amount > 0.005 && postDepreciation) {
      depTx = await postMoneyEntry({
        ...common,
        type: 'EXPENSE', kind: 'NON_CASH', category: CAT.DEPRECIATION, expenseCategory: CAT.DEPRECIATION,
        amount: dep.amount, amountBDT: dep.amount, plAmountBDT: dep.amount, accountId: null,
        description: `Depreciation to disposal — ${asset.assetTag} (${periodLabelOf(dep.fromPeriod)}${dep.fromPeriod !== dep.toPeriod ? ` – ${periodLabelOf(dep.toPeriod)}` : ''})`,
      }, { userId })
      txIds.push(depTx._id)
    }

    // Write back depreciation the monthly runs posted for days after the disposal
    // date — one row per month, dated like the run row it offsets.
    if (capitalized && over.amount > 0.005) {
      let accRunning = preview.accumulatedBefore
      for (const l of over.lines) {
        let wbTx = null
        if (postDepreciation) {
          wbTx = await postMoneyEntry({
            ...common,
            date: dayKeyOf(periodEndDate(l.period)),
            type: 'INCOME', kind: 'NON_CASH', category: CAT.DEPRECIATION, expenseCategory: CAT.DEPRECIATION,
            amount: l.amount, amountBDT: l.amount, plAmountBDT: l.amount, accountId: null,
            description: `Depreciation written back — ${asset.assetTag} disposed ${ctx.dateKey} (${periodLabelOf(l.period)})`,
          }, { userId })
          txIds.push(wbTx._id)
        }
        accRunning = round2(accRunning - l.amount)
        const wbEvent = await logAssetEvent({
          asset,
          type: 'DEPRECIATION',
          date: periodEndDate(l.period),
          amount: -l.amount,
          transactionId: wbTx?._id ?? null,
          details: {
            period: l.period,
            months: 1,
            disposal: true,
            writeBack: true,
            disposalDate: ctx.dateKey,
            accumulatedAfter: accRunning,
            bookValueAfter: round2(preview.cost - accRunning),
            postedToLedger: Boolean(wbTx),
          },
          notes: `Depreciation for ${periodLabelOf(l.period)} after the disposal date written back`,
          session,
        })
        eventIds.push(wbEvent._id)
      }
    }

    if (preview.gross > 0) {
      saleTx = await postMoneyEntry({
        ...common,
        type: 'INCOME', kind: 'ASSET_SALE', category: CAT.SALE,
        amount: preview.gross, amountBDT: preview.gross, plAmountBDT: 0, accountId: p.accountId,
        description: `${action === 'scrap' ? 'Scrap sale' : 'Sale'} of ${tagName(asset)} to ${buyerName}`,
        tax: { grossBDT: preview.gross, vatBDT: preview.vatAmount, sdBDT: 0, vdsBDT: 0, tdsBDT: 0 },
      }, { userId })
      txIds.push(saleTx._id)
    }

    if (proceeds > 0) {
      if (preview.gainLoss > 0.005) {
        mainTx = await postMoneyEntry({
          ...common,
          type: 'INCOME', kind: 'NON_CASH', category: CAT.GAIN,
          amount: preview.gainLoss, amountBDT: preview.gainLoss, plAmountBDT: preview.gainLoss, accountId: null,
          description: `Gain on disposal — ${tagName(asset)} (proceeds ${fmtTk(proceeds)} − book value ${fmtTk(preview.bookValue)})`,
        }, { userId })
        txIds.push(mainTx._id)
      } else if (preview.gainLoss < -0.005) {
        const loss = round2(-preview.gainLoss)
        mainTx = await postMoneyEntry({
          ...common,
          type: 'EXPENSE', kind: 'NON_CASH', category: CAT.LOSS, expenseCategory: CAT.LOSS,
          amount: loss, amountBDT: loss, plAmountBDT: loss, accountId: null,
          description: `Loss on disposal — ${tagName(asset)} (book value ${fmtTk(preview.bookValue)} − proceeds ${fmtTk(proceeds)})`,
        }, { userId })
        txIds.push(mainTx._id)
      }
    } else if (preview.bookValue > 0.005) {
      const what = action === 'donate' ? 'donated' : action === 'scrap' ? 'scrapped' : 'written off'
      mainTx = await postMoneyEntry({
        ...common,
        type: 'EXPENSE', kind: 'NON_CASH', category: CAT.WRITE_OFF, expenseCategory: CAT.WRITE_OFF,
        amount: preview.bookValue, amountBDT: preview.bookValue, plAmountBDT: preview.bookValue, accountId: null,
        description: `${tagName(asset)} ${what} — book value ${fmtTk(preview.bookValue)}`,
      }, { userId })
      txIds.push(mainTx._id)
    }

    if (preview.vatAmount > 0) {
      taxEntry = await recordTaxEntry({
        entryType: 'OUTPUT_VAT',
        date: ctx.dateKey,
        baseAmount: proceeds,
        rate: vatRate,
        amount: preview.vatAmount,
        sdAmount: 0,
        treatment: treatmentForRate(vatRate),
        partyType: 'OTHER',
        partyName: buyerName,
        partyBin: buyerBin,
        documentNo: asset.assetTag,
        documentDate: ctx.dateKey,
        assetId: asset._id,
        transactionId: saleTx?._id ?? null,
        bankingChannel: null,
        notes: `Sale of fixed asset ${tagName(asset)}`,
      }, { userId })
      taxIds.push(taxEntry._id)
      if (saleTx) await Transaction.updateOne({ _id: saleTx._id }, { $set: { taxEntryIds: [taxEntry._id] } })
    }

    await Asset.updateOne({ _id: asset._id }, { $set: { 'disposal.transactionIds': txIds } })

    if (capitalized && dep.amount > 0.005) {
      const depEvent = await logAssetEvent({
        asset,
        type: 'DEPRECIATION',
        date: ctx.dateKey,
        amount: dep.amount,
        transactionId: depTx?._id ?? null,
        details: {
          period: dep.toPeriod,
          fromPeriod: dep.fromPeriod,
          months: dep.months,
          catchUp: dep.fromPeriod !== dep.toPeriod,
          disposal: true,
          accumulatedBefore: preview.accumulatedBefore,
          accumulatedAfter: preview.accumulatedAfter,
          bookValueAfter: preview.bookValue,
          lines: dep.lines,
          postedToLedger: Boolean(depTx),
        },
        notes: 'Depreciation up to the disposal date',
        session,
      })
      eventIds.push(depEvent._id)
    }

    event = await logAssetEvent({
      asset,
      type: def.event,
      date: ctx.dateKey,
      from: assetState(asset),
      to: { status: toStatus, locationId: asset.locationId },
      amount: proceeds > 0 ? proceeds : preview.bookValue,
      transactionId: saleTx?._id ?? mainTx?._id ?? null,
      notes: ctx.notes ?? reason,
      attachments: ctx.attachments,
      details: {
        buyerName: buyerName ?? null,
        buyerBin,
        proceeds,
        vatRate,
        vatAmount: preview.vatAmount,
        gross: preview.gross,
        cost: preview.cost,
        accumulatedAfter: preview.accumulatedAfter,
        bookValue: preview.bookValue,
        gainLoss,
        accountId: preview.gross > 0 ? p.accountId : null,
        depreciationToDate: { amount: preview.depreciation.amount, months: preview.depreciation.months, fromPeriod: preview.depreciation.fromPeriod, toPeriod: preview.depreciation.toPeriod },
        overPosted: over.amount > 0.005 ? over : null,
        transactionIds: txIds,
        taxEntryId: taxEntry?._id ?? null,
        reason,
      },
      session,
    })
  } catch (err) {
    await deleteRows({ txIds, taxIds, eventIds })
    await restoreAsset(ctx.asset, keys, { status: toStatus })
    throw err
  }

  return {
    updated,
    event,
    warnings,
    log: {
      proceeds, vatAmount: preview.vatAmount, bookValue: preview.bookValue, gainLoss,
      depreciationToDate: preview.depreciation.amount, depreciationWrittenBack: over.amount, transactionIds: txIds.map(String), taxEntryId: str(taxEntry?._id),
      buyer: buyerName ?? null, reason,
    },
  }
}

// ── value adjustments ────────────────────────────────────────────────────────

async function doAdjustValue(ctx) {
  const { asset, payload: p, session } = ctx
  if (asset.isCapitalized === false) throw httpError(422, 'Only capitalized assets carry a book value to adjust')
  const hasImpairment = p.impairment !== null && p.impairment !== undefined && Number(p.impairment) > 0
  const hasCost = p.newCost !== null && p.newCost !== undefined
  if (hasImpairment === hasCost) throw httpError(422, 'Enter either an impairment amount or a corrected cost')
  await booksOpen(ctx.dateKey)

  const cost = round2(asset.cost)
  const accBefore = effectiveAccumulated(asset)
  const residual = residualValueOf(asset)
  const nbv = round2(cost - accBefore)

  if (hasImpairment) {
    const amount = round2(p.impairment)
    if (amount > nbv + 0.005) throw httpError(422, `The impairment cannot exceed the book value (${fmtTk(nbv)})`)
    const accAfter = round2(accBefore + amount)
    const { updated, keys } = await claim(ctx, {
      'depreciation.accumulated': accAfter,
      'depreciation.fullyDepreciated': accAfter >= round2(cost - residual) - 0.005,
    })
    let tx = null
    let event = null
    try {
      tx = await postMoneyEntry({
        type: 'EXPENSE', kind: 'NON_CASH', category: CAT.IMPAIRMENT, expenseCategory: CAT.IMPAIRMENT,
        amount, currency: 'BDT', amountBDT: amount, plAmountBDT: amount, accountId: null,
        date: ctx.dateKey, reference: asset.assetTag, assetId: asset._id, createdBy: session.user.id,
        description: `Impairment — ${tagName(asset)}: ${p.reason}`,
      }, { userId: session.user.id })
      event = await logAssetEvent({
        asset,
        type: 'VALUE_ADJUSTED',
        date: ctx.dateKey,
        amount,
        transactionId: tx._id,
        notes: p.reason,
        attachments: ctx.attachments,
        details: {
          kind: 'IMPAIRMENT', amount, reason: p.reason,
          costBefore: cost, costAfter: cost,
          accumulatedBefore: accBefore, accumulatedAfter: accAfter,
          bookValueBefore: nbv, bookValueAfter: round2(nbv - amount),
        },
        session,
      })
    } catch (err) {
      await deleteRows({ txIds: tx ? [tx._id] : [] })
      await restoreAsset(ctx.asset, keys, { updatedAt: updated.updatedAt })
      throw err
    }
    return { updated, event, log: { kind: 'IMPAIRMENT', amount, bookValueAfter: round2(nbv - amount), transactionId: str(tx._id) } }
  }

  // Cost correction (register error) — no ledger posting, only before any depreciation is posted.
  if (asset.purchase?.billId) throw httpError(409, 'The cost comes from the purchase bill — correct the bill instead')
  // An opening asset's cost is part of the go-live position: once that is locked it cannot be restated.
  if (asset.opening?.isExisting && ctx.settings?.openingLocked) {
    throw httpError(409, 'Opening balances are locked — the cost of an opening-register asset can no longer be corrected (ask an admin to unlock them, or record an impairment)')
  }
  if (asset.depreciation?.lastPostedPeriod) {
    throw httpError(409, 'Depreciation has been posted — record an impairment instead of changing the cost')
  }
  if (await Transaction.exists({ assetId: asset._id })) {
    throw httpError(409, 'Ledger entries already reference this asset — record an impairment instead of changing the cost')
  }
  const newCost = round2(p.newCost)
  if (Math.abs(newCost - cost) < 0.005) throw httpError(409, 'That is already the cost')
  if (newCost < accBefore - 0.005) throw httpError(422, `The cost cannot be lower than the accumulated depreciation (${fmtTk(accBefore)})`)
  const newResidual = Math.min(residual, newCost)
  return commit(ctx, {
    event: {
      type: 'VALUE_ADJUSTED',
      from: asset.status,
      to: asset.status,
      amount: round2(newCost - cost),
      notes: p.reason,
      details: { kind: 'COST_CORRECTION', costBefore: cost, costAfter: newCost, fromCost: cost, toCost: newCost, reason: p.reason },
    },
    set: {
      cost: newCost,
      'depreciation.residualValue': newResidual,
      'depreciation.fullyDepreciated': accBefore >= round2(newCost - newResidual) - 0.005 && newCost > 0,
    },
  }).then(r => ({ ...r, log: { kind: 'COST_CORRECTION', fromCost: cost, toCost: newCost } }))
}

const HANDLERS = {
  assign: doAssign,
  reassign: doAssign,
  return: doReturn,
  transfer: doTransfer,
  repair_send: doRepairSend,
  repair_complete: doRepairComplete,
  report_damage: doReportDamage,
  update_recovery: doUpdateRecovery,
  mark_lost: doLostStolen,
  mark_stolen: doLostStolen,
  found: doFound,
  retire: doRetire,
  reactivate: doReactivate,
  sell: doDispose,
  scrap: doDispose,
  write_off: doDispose,
  donate: doDispose,
  adjust_value: doAdjustValue,
  note: doNote,
}

/** Custody-only actions an opening-register asset may take before go-live arrives (no value, money or status exit). */
const PRE_REGISTER_CUSTODY_ACTIONS = new Set(['assign', 'reassign', 'return', 'transfer', 'note'])

/**
 * Run one asset action.
 * @returns {Promise<{ assetId, action, event, warnings: string[], logAction, log }>}
 */
export async function performAssetAction({ assetId, body, session }) {
  const raw = blankToNull(body)
  const base = baseSchema.safeParse(raw ?? {})
  if (!base.success) throw httpError(422, 'Validation failed', { details: base.error.flatten() })
  const action = base.data.action
  const def = ASSET_ACTIONS[action]

  if (!canDoAny(session, def.perms)) throw httpError(403, 'Forbidden')

  const payloadParsed = SCHEMAS[action].safeParse(raw)
  if (!payloadParsed.success) throw httpError(422, 'Validation failed', { details: payloadParsed.error.flatten() })

  if (!isValidObjectId(assetId)) throw httpError(404, 'Not found')
  const asset = await Asset.findById(assetId).lean()
  if (!asset) throw httpError(404, 'Not found')
  if (!actionAllowedFrom(action, asset.status)) throw httpError(409, actionBlockedMessage(action, asset.status))
  const blocked = actionCondition(action, asset)
  if (blocked) throw httpError(409, blocked)

  const today = todayKey()
  const dateKey = base.data.date ?? today
  if (dateKey > today) throw httpError(422, 'The date cannot be in the future')
  const purchaseDay = dayKeyOf(asset.purchase?.date)
  if (purchaseDay && dateKey < purchaseDay) throw httpError(422, `The date is before the asset was purchased (${purchaseDay})`)

  const [category, settings] = await Promise.all([
    AssetCategory.findById(asset.categoryId).select('name requiresAcknowledgement').lean(),
    getFinanceSettings(),
  ])

  // An opening-register asset is held, as recorded, at the end of its register day
  // (the later of opening.asOfDate and the day before go-live): nothing can have happened to it
  // on or before that day — correct the register instead. Only while that day is
  // still ahead (go-live not reached) can custody moves be recorded; the register
  // then simply shows the asset where it is.
  const registerDay = openingRegisterDay(asset, settings)
  if (registerDay && dateKey <= registerDay && !(registerDay >= today && PRE_REGISTER_CUSTODY_ACTIONS.has(action))) {
    throw httpError(422, `The date is on or before the opening register date (${registerDay}) — this asset is in the opening register as held on that day; correct the opening register instead`)
  }

  const ctx = {
    session,
    action,
    def,
    asset,
    category,
    settings,
    payload: payloadParsed.data,
    dateKey,
    notes: base.data.notes ?? null,
    attachments: base.data.attachments ?? [],
  }
  const result = await HANDLERS[action](ctx)
  return {
    assetId: String(asset._id),
    assetTag: asset.assetTag,
    action,
    fromStatus: asset.status,
    toStatus: result.updated?.status ?? asset.status,
    event: result.event ?? null,
    warnings: result.warnings ?? [],
    logAction: result.logAction ?? def.log,
    log: result.log ?? {},
    statusLabel: statusLabel(result.updated?.status ?? asset.status),
  }
}
