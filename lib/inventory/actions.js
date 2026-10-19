/**
 * lib/inventory/actions.js — PURE asset-action definitions shared by the
 * asset API (app/api/inventory/assets/[id]/actions) and the asset pages.
 *
 * Safe for 'use client' components: imports only the pure inventory constants
 * and the pure depreciation math. The server re-validates everything here —
 * the UI uses the same table only to decide which buttons to show.
 *
 *   ASSET_ACTIONS[key]            { label, verb, to, from, perms, icon, tone, money, … }
 *   availableAssetActions(asset, can)   actions valid for the asset's status and the user's permissions
 *   primaryActionKeys(status)     the 1–3 actions shown as buttons for a status
 *   disposalPreview(asset, …)     depreciation to the disposal date, NBV and gain/loss
 *   buildDamageCases(events)      damage cases (Labour Act s.125/127 register rows) from AssetEvents
 *   recoveryProgress(rec, updates) recovered so far / balance of a damage case (instalments, waiver)
 */

import {
  ASSET_STATUSES, TERMINAL_STATUSES, canTransition, round2, statusLabel,
} from './constants.js'
import { depreciationToDate, effectiveAccumulated, overPostedDepreciation } from './depreciationMath.js'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const NON_TERMINAL = ASSET_STATUSES.filter(s => !TERMINAL_STATUSES.includes(s))

/** Who may perform an action (any of). */
const ASSIGN  = ['inventory.assign']
const MANAGE  = ['inventory.manage']
const DISPOSE = ['inventory.dispose']
const NOTE    = ['inventory.assign', 'inventory.manage', 'inventory.dispose']

/**
 * Every action the asset detail page can perform.
 *  - to:    target status (null = status unchanged / decided by the payload)
 *  - from:  statuses the action may start from (always a subset of TRANSITIONS)
 *  - perms: any-of permission keys
 *  - money: posts to the ledger / changes book value (books lock applies)
 *  - log:   logActivity action
 *  - hidden: not offered in the action bar (opened from a panel instead)
 */
export const ASSET_ACTIONS = {
  assign: {
    label: 'Assign', verb: 'Assign', title: 'Assign to an employee', icon: 'UserCheck', tone: 'primary',
    to: 'ASSIGNED', from: ['IN_STOCK'], perms: ASSIGN, log: 'ASSIGN', event: 'ASSIGNED',
  },
  reassign: {
    label: 'Reassign', verb: 'Reassign', title: 'Hand over to someone else', icon: 'Repeat', tone: 'default',
    to: 'ASSIGNED', from: ['ASSIGNED'], perms: ASSIGN, log: 'ASSIGN', event: 'ASSIGNED',
  },
  return: {
    label: 'Return to stock', verb: 'Return', title: 'Return to stock', icon: 'Undo2', tone: 'primary',
    to: 'IN_STOCK', from: ['ASSIGNED', 'DAMAGED'], perms: ASSIGN, log: 'RETURN', event: 'RETURNED',
  },
  transfer: {
    label: 'Move location', verb: 'Move', title: 'Move to another location', icon: 'ArrowLeftRight', tone: 'default',
    to: null, from: NON_TERMINAL.filter(s => !['LOST', 'STOLEN'].includes(s)), perms: ASSIGN, log: 'TRANSFER', event: 'TRANSFERRED',
  },
  repair_send: {
    label: 'Send to repair', verb: 'Send to repair', title: 'Send for repair', icon: 'Wrench', tone: 'default',
    to: 'IN_REPAIR', from: ['IN_STOCK', 'ASSIGNED', 'DAMAGED'], perms: ASSIGN, log: 'STATUS_CHANGE', event: 'REPAIR_SENT',
  },
  repair_complete: {
    label: 'Complete repair', verb: 'Complete repair', title: 'Repair completed', icon: 'CircleCheckBig', tone: 'primary',
    to: null, from: ['IN_REPAIR'], perms: ASSIGN, log: 'STATUS_CHANGE', event: 'REPAIR_COMPLETED',
  },
  report_damage: {
    label: 'Report damage', verb: 'Report damage', title: 'Report damage', icon: 'TriangleAlert', tone: 'warning',
    to: 'DAMAGED', from: ['IN_STOCK', 'ASSIGNED', 'IN_REPAIR'], perms: ASSIGN, log: 'STATUS_CHANGE', event: 'DAMAGE_REPORTED',
  },
  update_recovery: {
    label: 'Update recovery', verb: 'Save', title: 'Damage recovery', icon: 'HandCoins', tone: 'default',
    to: null, from: ASSET_STATUSES, perms: DISPOSE, log: 'UPDATE', event: 'RECOVERY_UPDATED', hidden: true, money: true,
  },
  mark_lost: {
    label: 'Mark lost', verb: 'Mark lost', title: 'Report as lost', icon: 'SearchX', tone: 'danger',
    to: 'LOST', from: ['IN_STOCK', 'ASSIGNED'], perms: ASSIGN, log: 'STATUS_CHANGE', event: 'LOST',
  },
  mark_stolen: {
    label: 'Mark stolen', verb: 'Mark stolen', title: 'Report as stolen', icon: 'ShieldAlert', tone: 'danger',
    to: 'STOLEN', from: ['IN_STOCK', 'ASSIGNED'], perms: ASSIGN, log: 'STATUS_CHANGE', event: 'STOLEN',
  },
  found: {
    label: 'Mark found', verb: 'Mark found', title: 'Asset found', icon: 'ScanSearch', tone: 'primary',
    to: 'IN_STOCK', from: ['LOST', 'STOLEN'], perms: ASSIGN, log: 'STATUS_CHANGE', event: 'FOUND',
  },
  retire: {
    label: 'Retire', verb: 'Retire', title: 'Retire (keep, not in use)', icon: 'Archive', tone: 'default',
    to: 'RETIRED', from: ['IN_STOCK'], perms: MANAGE, log: 'STATUS_CHANGE', event: 'RETIRED',
  },
  reactivate: {
    label: 'Reactivate', verb: 'Reactivate', title: 'Bring back into use', icon: 'ArchiveRestore', tone: 'primary',
    to: 'IN_STOCK', from: ['RETIRED'], perms: MANAGE, log: 'STATUS_CHANGE', event: 'REACTIVATED',
  },
  sell: {
    label: 'Sell', verb: 'Record sale', title: 'Sell asset', icon: 'BadgeDollarSign', tone: 'default',
    to: 'SOLD', from: ['IN_STOCK', 'DAMAGED', 'RETIRED'], perms: DISPOSE, log: 'SELL', event: 'SOLD', money: true, disposal: true,
  },
  scrap: {
    label: 'Scrap', verb: 'Scrap', title: 'Scrap asset', icon: 'Trash2', tone: 'danger',
    to: 'SCRAPPED', from: ['IN_STOCK', 'IN_REPAIR', 'DAMAGED', 'RETIRED'], perms: DISPOSE, log: 'DISPOSE', event: 'SCRAPPED', money: true, disposal: true,
  },
  write_off: {
    label: 'Write off', verb: 'Write off', title: 'Write off asset', icon: 'FileX2', tone: 'danger',
    to: 'WRITTEN_OFF', from: ['IN_STOCK', 'IN_REPAIR', 'DAMAGED', 'LOST', 'STOLEN', 'RETIRED'], perms: DISPOSE, log: 'WRITE_OFF', event: 'WRITTEN_OFF', money: true, disposal: true,
  },
  donate: {
    label: 'Donate', verb: 'Record donation', title: 'Donate asset', icon: 'HeartHandshake', tone: 'default',
    to: 'DONATED', from: ['IN_STOCK', 'DAMAGED', 'RETIRED'], perms: DISPOSE, log: 'DISPOSE', event: 'DONATED', money: true, disposal: true,
  },
  adjust_value: {
    label: 'Adjust value', verb: 'Save adjustment', title: 'Adjust value', icon: 'Scale', tone: 'default',
    to: null, from: NON_TERMINAL, perms: DISPOSE, log: 'UPDATE', event: 'VALUE_ADJUSTED', money: true,
  },
  note: {
    label: 'Add note', verb: 'Add note', title: 'Add a note', icon: 'StickyNote', tone: 'default',
    to: null, from: ASSET_STATUSES, perms: NOTE, log: 'UPDATE', event: 'NOTE',
  },
}

export const ASSET_ACTION_KEYS = Object.keys(ASSET_ACTIONS)

/** Disposal action key → resulting status / disposal type. */
export const DISPOSAL_ACTIONS = { sell: 'SOLD', scrap: 'SCRAPPED', write_off: 'WRITTEN_OFF', donate: 'DONATED' }

/** Causes that are never the employee's fault — no salary/cash recovery (Labour Act s.125(2)(c)). */
export const NON_RECOVERABLE_CAUSES = ['WEAR_AND_TEAR', 'MANUFACTURING_DEFECT', 'POWER_SURGE']

/** Recovery methods that take money from the responsible employee. */
export const EMPLOYEE_RECOVERY_METHODS = ['SALARY', 'CASH']

/** Ledger categories posted by asset actions (kept in one place for reports). */
export const ASSET_LEDGER_CATEGORIES = {
  DEPRECIATION: 'Depreciation',
  SALE:         'Asset Sale',
  GAIN:         'Gain on Disposal of Assets',
  LOSS:         'Loss on Disposal of Assets',
  WRITE_OFF:    'Asset Write-off',
  IMPAIRMENT:   'Asset Impairment',
  RECOVERY:     'Asset Damage Recovery',
  REPAIRS:      'Repairs & Maintenance',
}

/** Buttons shown up front for each status (the rest go into "More"). */
const PRIMARY_BY_STATUS = {
  IN_STOCK:    ['assign', 'transfer', 'repair_send'],
  ASSIGNED:    ['return', 'reassign', 'repair_send'],
  IN_REPAIR:   ['repair_complete', 'report_damage'],
  DAMAGED:     ['repair_send', 'return', 'sell'],
  LOST:        ['found', 'write_off'],
  STOLEN:      ['found', 'write_off'],
  RETIRED:     ['reactivate', 'sell', 'scrap'],
  SOLD:        ['note'],
  SCRAPPED:    ['note'],
  WRITTEN_OFF: ['note'],
  DONATED:     ['note'],
}

export function primaryActionKeys(status) {
  return PRIMARY_BY_STATUS[status] ?? []
}

/** Whether `action` may start from `status` (status rules only — no permissions). */
export function actionAllowedFrom(action, status) {
  const def = ASSET_ACTIONS[action]
  if (!def || !status) return false
  if (!def.from.includes(status)) return false
  if (def.to && def.to !== status && !canTransition(status, def.to)) return false
  return true
}

/** Human message for an action that is not allowed from the asset's status. */
export function actionBlockedMessage(action, status) {
  const def = ASSET_ACTIONS[action]
  if (!def) return 'Unknown action'
  return `Can't ${def.label.toLowerCase()} — the asset is ${statusLabel(status).toLowerCase()}`
}

/**
 * Extra, asset-specific conditions beyond the status table.
 * Returns null when the action is possible, else a short reason.
 */
export function actionCondition(action, asset) {
  if (!asset) return 'No asset'
  if (asset.isArchived) return 'The asset is archived'
  switch (action) {
    case 'adjust_value':
      if (asset.isCapitalized === false) return 'Only capitalized assets carry a book value to adjust'
      return null
    default:
      return null
  }
}

export function hasHolder(asset) {
  return Boolean(asset?.assignedEmployeeId || asset?.assignedDepartmentId)
}

/**
 * Actions the current user can perform on the asset.
 * @param {object} asset  serialized asset (status, isCapitalized, assignedEmployeeId…)
 * @param {(perm: string) => boolean} can  permission check (usePermission().can / canDo)
 * @returns {Array<{ key, ...def }>}
 */
export function availableAssetActions(asset, can = () => false) {
  if (!asset) return []
  const out = []
  for (const key of ASSET_ACTION_KEYS) {
    const def = ASSET_ACTIONS[key]
    if (!actionAllowedFrom(key, asset.status)) continue
    if (!def.perms.some(p => can(p))) continue
    if (actionCondition(key, asset)) continue
    out.push({ key, ...def })
  }
  return out
}

/** Label of the return action in context (a damaged asset without holder goes "back to stock"). */
export function returnActionLabel(asset) {
  if (asset?.status === 'DAMAGED' && !hasHolder(asset)) return 'Back to stock'
  return ASSET_ACTIONS.return.label
}

// ── Money previews (shared by the sale/scrap/write-off modals and the API) ───

/**
 * What a disposal on `date` does to the books.
 *
 * Depreciation from the month after the last posted month up to the disposal
 * day is charged first (never re-charging posted months); depreciation already
 * posted for days after the disposal day (disposal month / later months) is
 * written back (overPosted); the net book value after that is compared with
 * the proceeds (excl. VAT). Non-capitalized assets
 * were expensed when bought, so their book value is 0 and any proceeds are gain.
 *
 * @param {object} asset
 * @param {object} opts
 * @param {string|Date} opts.date        disposal date ('YYYY-MM-DD' = Dhaka day)
 * @param {number} [opts.proceeds=0]     sale / scrap proceeds excluding VAT
 * @param {number} [opts.vatRate=0]      % VAT charged on the proceeds
 * @param {'PRORATA_DAYS'|'FULL_MONTH'} [opts.convention]
 * @returns {{ depreciation: { amount, months, fromPeriod, toPeriod, lines }, overPosted: { amount, lines },
 *            accumulatedBefore, accumulatedAfter,
 *            cost, bookValue, proceeds, vatRate, vatAmount, gross, gainLoss, capitalized }}
 */
export function disposalPreview(asset, { date, proceeds = 0, vatRate = 0, convention = 'PRORATA_DAYS' } = {}) {
  const cost = round2(num(asset?.cost))
  const capitalized = asset?.isCapitalized !== false
  const p = round2(Math.max(0, num(proceeds)))
  const rate = Math.max(0, num(vatRate))
  const vatAmount = p > 0 ? round2(p * rate / 100) : 0

  let dep = { amount: 0, months: 0, fromPeriod: null, toPeriod: null, lines: [] }
  let overPosted = { amount: 0, lines: [] }
  let accBefore = capitalized ? effectiveAccumulated(asset) : 0
  let accAfter = accBefore
  if (capitalized && date) {
    try {
      const d = depreciationToDate(asset, date, { convention })
      dep = { amount: d.amount, months: d.months, fromPeriod: d.fromPeriod, toPeriod: d.toPeriod, lines: d.lines }
      accBefore = d.accumulatedBefore
      accAfter = d.accumulatedAfter
      // Disposed in (or before) a month already posted by a run: give back what
      // was charged after the disposal day.
      overPosted = overPostedDepreciation(asset, date, { convention })
      accAfter = round2(accAfter - overPosted.amount)
    } catch {
      // invalid date — no depreciation preview
    }
  }
  const bookValue = capitalized ? round2(Math.max(0, cost - accAfter)) : 0
  return {
    depreciation: dep,
    overPosted,
    accumulatedBefore: accBefore,
    accumulatedAfter: accAfter,
    cost,
    bookValue,
    proceeds: p,
    vatRate: rate,
    vatAmount,
    gross: round2(p + vatAmount),
    gainLoss: round2(p - bookValue),
    capitalized,
  }
}

/** Largest salary/cash recovery the Labour Act allows: the employee's share of the actual loss. */
export function maxRecoverable({ assessedLoss = 0, liabilityPct = 0 } = {}) {
  const loss = Math.max(0, num(assessedLoss))
  const pct = Math.min(100, Math.max(0, num(liabilityPct)))
  return round2(loss * pct / 100)
}

/** Initial recovery status for a new damage case. */
export function initialRecoveryStatus(method, amount) {
  if (!method || method === 'NONE') return 'NOT_APPLICABLE'
  if (method === 'WAIVED') return 'WAIVED'
  return num(amount) > 0 ? 'PENDING' : 'NOT_APPLICABLE'
}

// ── Damage cases from the event history ──────────────────────────────────────

const idStr = (v) => {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') {
    if (v.id !== undefined || v._id !== undefined) return String(v.id ?? v._id ?? '') || null
    return String(v) || null // ObjectId instance
  }
  return String(v)
}

/** Staff events that mean an employee's own problem report has been dealt with. */
const FOLLOW_UP_TYPES = ['DAMAGE_REPORTED', 'REPAIR_SENT', 'REPAIR_COMPLETED', 'RETURNED', 'LOST', 'STOLEN', 'FOUND',
  'WRITTEN_OFF', 'SCRAPPED', 'SOLD', 'DONATED', 'RECOVERY_UPDATED']

const moneyOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? round2(n) : null
}
const recordedAt = (e) => new Date(e?.createdAt ?? e?.date ?? 0).getTime()

/**
 * Where a damage case's recovery stands: the case's own recovery record
 * (details.recovery of the DAMAGE_REPORTED event) folded with its
 * RECOVERY_UPDATED events (any order).
 *
 * A case can be recovered in instalments — each update that is not a waiver adds
 * what it recovered (a part payment is written with status PENDING, so the case
 * stays open); the update recorded last decides the status. `amount` is always
 * the case amount (what is to be recovered), never an instalment.
 * @returns {{ method, amount, status, recoveredAmount, outstanding, waivedAmount, recoveredAt, transactionId, note }}
 *   outstanding: balance still to recover (0 unless PENDING); waivedAmount: balance written off by a waiver.
 */
export function recoveryProgress(rec, updates = []) {
  const r = rec && typeof rec === 'object' ? rec : {}
  const ups = (Array.isArray(updates) ? updates : []).slice()
    .sort((a, b) => recordedAt(a) - recordedAt(b) || new Date(a?.date ?? 0) - new Date(b?.date ?? 0))
  let status = r.status ?? null
  let method = r.method ?? null
  let recoveredAt = r.recoveredAt ?? null
  let transactionId = r.transactionId ?? null
  let note = r.note ?? null
  let waivedAmount = moneyOrNull(r.waivedAmount)
  let recovered = null
  for (const u of ups) {
    const d = u?.details || {}
    const st = d.status ?? d.recovery?.status ?? null
    if (st) status = st
    method = d.method ?? d.recovery?.method ?? method
    recoveredAt = u?.date ?? recoveredAt
    transactionId = d.transactionId ?? transactionId
    note = d.note ?? u?.notes ?? note
    if (st === 'WAIVED') {
      if (moneyOrNull(d.waivedAmount) !== null) waivedAmount = moneyOrNull(d.waivedAmount)
      continue
    }
    const amt = moneyOrNull(d.amount ?? d.recovery?.amount ?? u?.amount)
    if (amt !== null) recovered = round2((recovered ?? 0) + amt)
  }
  // No updates (or none with an amount): the running total kept on the case.
  if (recovered === null) recovered = moneyOrNull(r.recoveredAmount)
  const amount = moneyOrNull(r.amount)
  const outstanding = status === 'PENDING' && amount !== null ? round2(Math.max(0, amount - (recovered ?? 0))) : 0
  if (status === 'WAIVED' && waivedAmount === null && amount !== null) waivedAmount = round2(Math.max(0, amount - (recovered ?? 0)))
  return { method, amount, status, recoveredAmount: recovered, outstanding, waivedAmount, recoveredAt, transactionId, note }
}

/**
 * Damage & recovery cases from an asset's events (any order).
 * Each DAMAGE_REPORTED event is a case; RECOVERY_UPDATED events (details.damageEventId)
 * are its updates (instalments / waiver) — see recoveryProgress.
 * @returns {Array<{ eventId, date, cause, description, condition, responsibleEmployeeId, responsibleEmployeeName,
 *   liabilityPct, assessedLoss, recovery: { method, amount, status, recoveredAmount, outstanding, waivedAmount,
 *   recoveredAt, transactionId, note },
 *   reportedByEmployee, assessed, enquiryNote, gdNumber, attachments, createdByName, updates: [] }>} newest first
 */
export function buildDamageCases(events = []) {
  const list = Array.isArray(events) ? events : []
  const updates = new Map()
  for (const e of list) {
    if (e?.type !== 'RECOVERY_UPDATED') continue
    const key = idStr(e.details?.eventId ?? e.details?.damageEventId)
    if (!key) continue
    if (!updates.has(key)) updates.set(key, [])
    updates.get(key).push(e)
  }
  // An employee's own report is assessed once a manager acted on it: an explicit
  // assessment (details.assessed / a damage case pointing at it) or any later
  // follow-up event recorded by staff (repair, return, loss, disposal…).
  const when = (e) => new Date(e?.createdAt ?? e?.date ?? 0).getTime()
  const assessedReports = new Set(list.map(e => (e?.type === 'DAMAGE_REPORTED' ? idStr(e.details?.reportEventId) : null)).filter(Boolean))
  const followUps = list.filter(e => FOLLOW_UP_TYPES.includes(e?.type) && !e.details?.reportedByEmployee)
  const isAssessed = (e, id) => {
    const d = e.details || {}
    if (!d.reportedByEmployee) return true
    if (d.assessed === true || assessedReports.has(id)) return true
    return followUps.some(f => f !== e && when(f) > when(e))
  }
  const cases = []
  for (const e of list) {
    if (e?.type !== 'DAMAGE_REPORTED') continue
    const id = idStr(e.id ?? e._id)
    const d = e.details || {}
    const ups = (updates.get(id) || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date) || recordedAt(a) - recordedAt(b))
    const progress = recoveryProgress(d.recovery, ups)
    cases.push({
      eventId: id,
      date: e.date,
      cause: d.cause ?? null,
      description: d.description ?? e.notes ?? null,
      condition: e.condition ?? null,
      responsibleEmployeeId: idStr(d.responsibleEmployeeId),
      responsibleEmployeeName: d.responsibleEmployeeName ?? e.responsibleEmployee?.name ?? null,
      liabilityPct: d.liabilityPct ?? null,
      assessedLoss: d.assessedLoss ?? null,
      recovery: { ...progress, transactionId: idStr(progress.transactionId) },
      reportedByEmployee: Boolean(d.reportedByEmployee),
      assessed: isAssessed(e, id),
      enquiryNote: d.enquiryNote ?? null,
      gdNumber: d.gdNumber ?? null,
      attachments: Array.isArray(e.attachments) ? e.attachments : [],
      createdByName: e.createdByName ?? null,
      updates: ups,
    })
  }
  return cases.sort((a, b) => new Date(b.date) - new Date(a.date))
}
