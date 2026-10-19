/**
 * Inventory & fixed-asset constants and pure helpers.
 *
 * PURE MODULE: imported by 'use client' components as well as by server code,
 * so it must never import mongoose, models, next-auth or any server-only lib.
 * Server code may import the same names from '@/lib/inventory/assets' (which
 * re-exports everything here).
 *
 * Colours are semantic names ('gray', 'blue', …). Tailwind classes for them
 * live in components/inventory/AssetStatusBadge.jsx (Tailwind does not scan lib/).
 */

// ── Money helper (house rule: 2 decimals, half-up) ───────────────────────────
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ── Asset lifecycle ──────────────────────────────────────────────────────────
export const ASSET_STATUSES = ['IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'DAMAGED', 'LOST', 'STOLEN', 'RETIRED', 'SOLD', 'SCRAPPED', 'WRITTEN_OFF', 'DONATED']

/** Disposed for good: no further transitions, excluded from audits and depreciation. */
export const TERMINAL_STATUSES = ['SOLD', 'SCRAPPED', 'WRITTEN_OFF', 'DONATED']

/** Statuses in which an asset is still held by (and shown to) its assignee. */
export const HELD_STATUSES = ['ASSIGNED', 'IN_REPAIR', 'DAMAGED']

/** Every status that is not terminal (still on the register). */
export const NON_TERMINAL_STATUSES = ASSET_STATUSES.filter(s => !TERMINAL_STATUSES.includes(s))

export const STATUS_META = {
  IN_STOCK:    { label: 'In stock',    color: 'gray' },
  ASSIGNED:    { label: 'Assigned',    color: 'blue' },
  IN_REPAIR:   { label: 'In repair',   color: 'yellow' },
  DAMAGED:     { label: 'Damaged',     color: 'orange' },
  LOST:        { label: 'Lost',        color: 'red' },
  STOLEN:      { label: 'Stolen',      color: 'red' },
  RETIRED:     { label: 'Retired',     color: 'purple' },
  SOLD:        { label: 'Sold',        color: 'teal' },
  SCRAPPED:    { label: 'Scrapped',    color: 'gray' },
  WRITTEN_OFF: { label: 'Written off', color: 'red' },
  DONATED:     { label: 'Donated',     color: 'indigo' },
}

export const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'BROKEN']

export const CONDITION_META = {
  NEW:    { label: 'New',    color: 'green' },
  GOOD:   { label: 'Good',   color: 'blue' },
  FAIR:   { label: 'Fair',   color: 'yellow' },
  POOR:   { label: 'Poor',   color: 'orange' },
  BROKEN: { label: 'Broken', color: 'red' },
}

/** Allowed status moves. ASSIGNED → ASSIGNED is a re-assignment. */
export const TRANSITIONS = {
  IN_STOCK:    ['ASSIGNED', 'IN_REPAIR', 'DAMAGED', 'LOST', 'STOLEN', 'RETIRED', 'SOLD', 'SCRAPPED', 'WRITTEN_OFF', 'DONATED'],
  ASSIGNED:    ['IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'DAMAGED', 'LOST', 'STOLEN'],
  IN_REPAIR:   ['IN_STOCK', 'ASSIGNED', 'DAMAGED', 'SCRAPPED', 'WRITTEN_OFF'],
  DAMAGED:     ['IN_REPAIR', 'IN_STOCK', 'SOLD', 'SCRAPPED', 'WRITTEN_OFF', 'DONATED'],
  LOST:        ['IN_STOCK', 'WRITTEN_OFF'],
  STOLEN:      ['IN_STOCK', 'WRITTEN_OFF'],
  RETIRED:     ['IN_STOCK', 'SOLD', 'SCRAPPED', 'WRITTEN_OFF', 'DONATED'],
  SOLD:        [],
  SCRAPPED:    [],
  WRITTEN_OFF: [],
  DONATED:     [],
}

// ── Asset events (append-only history) ───────────────────────────────────────
export const EVENT_TYPES = [
  'CREATED', 'RECEIVED', 'ASSIGNED', 'RETURNED', 'TRANSFERRED', 'ACKNOWLEDGED', 'ACK_DECLINED',
  'REPAIR_SENT', 'REPAIR_COMPLETED', 'DAMAGE_REPORTED', 'LOST', 'STOLEN', 'FOUND', 'RETIRED',
  'REACTIVATED', 'SOLD', 'SCRAPPED', 'WRITTEN_OFF', 'DONATED', 'DEPRECIATION', 'VALUE_ADJUSTED',
  'AUDIT_VERIFIED', 'UPDATED', 'NOTE', 'RECOVERY_UPDATED', 'OPENING',
]

/**
 * Timeline presentation per event type. `icon` is a lucide-react@0.454 export
 * name (render with AssetEventIcon from components/inventory/AssetStatusBadge.jsx).
 */
export const EVENT_META = {
  CREATED:          { label: 'Added to register',        icon: 'PackagePlus',     color: 'gray' },
  RECEIVED:         { label: 'Received from purchase',   icon: 'PackageCheck',    color: 'green' },
  ASSIGNED:         { label: 'Assigned',                 icon: 'UserCheck',       color: 'blue' },
  RETURNED:         { label: 'Returned to stock',        icon: 'Undo2',           color: 'gray' },
  TRANSFERRED:      { label: 'Moved location',           icon: 'ArrowLeftRight',  color: 'indigo' },
  ACKNOWLEDGED:     { label: 'Receipt acknowledged',     icon: 'BadgeCheck',      color: 'green' },
  ACK_DECLINED:     { label: 'Acknowledgement declined', icon: 'ThumbsDown',      color: 'red' },
  REPAIR_SENT:      { label: 'Sent for repair',          icon: 'Wrench',          color: 'yellow' },
  REPAIR_COMPLETED: { label: 'Repair completed',         icon: 'CircleCheckBig',  color: 'green' },
  DAMAGE_REPORTED:  { label: 'Damage reported',          icon: 'TriangleAlert',   color: 'orange' },
  LOST:             { label: 'Reported lost',            icon: 'SearchX',         color: 'red' },
  STOLEN:           { label: 'Reported stolen',          icon: 'ShieldAlert',     color: 'red' },
  FOUND:            { label: 'Found',                    icon: 'ScanSearch',      color: 'green' },
  RETIRED:          { label: 'Retired',                  icon: 'Archive',         color: 'purple' },
  REACTIVATED:      { label: 'Reactivated',              icon: 'ArchiveRestore',  color: 'blue' },
  SOLD:             { label: 'Sold',                     icon: 'BadgeDollarSign', color: 'teal' },
  SCRAPPED:         { label: 'Scrapped',                 icon: 'Trash2',          color: 'gray' },
  WRITTEN_OFF:      { label: 'Written off',              icon: 'FileX2',          color: 'red' },
  DONATED:          { label: 'Donated',                  icon: 'HeartHandshake',  color: 'indigo' },
  DEPRECIATION:     { label: 'Depreciation posted',      icon: 'TrendingDown',    color: 'gray' },
  VALUE_ADJUSTED:   { label: 'Value adjusted',           icon: 'Scale',           color: 'purple' },
  AUDIT_VERIFIED:   { label: 'Physical audit',           icon: 'ClipboardCheck',  color: 'teal' },
  UPDATED:          { label: 'Details updated',          icon: 'Pencil',          color: 'gray' },
  NOTE:             { label: 'Note',                     icon: 'StickyNote',      color: 'yellow' },
  RECOVERY_UPDATED: { label: 'Damage recovery updated',  icon: 'HandCoins',       color: 'teal' },
  OPENING:          { label: 'Opening register entry',   icon: 'FolderInput',     color: 'indigo' },
}

// ── Damage & recovery (Labour Act 2006 s.125/127 register) ───────────────────
export const DAMAGE_CAUSES = ['ACCIDENT', 'NEGLIGENCE', 'WEAR_AND_TEAR', 'POWER_SURGE', 'LIQUID', 'DROP', 'MANUFACTURING_DEFECT', 'UNKNOWN']

export const DAMAGE_CAUSE_LABELS = {
  ACCIDENT:             'Accident',
  NEGLIGENCE:           'Negligence',
  WEAR_AND_TEAR:        'Normal wear and tear',
  POWER_SURGE:          'Power surge',
  LIQUID:               'Liquid spill',
  DROP:                 'Dropped',
  MANUFACTURING_DEFECT: 'Manufacturing defect',
  UNKNOWN:              'Unknown',
}

export const RECOVERY_METHODS = ['NONE', 'SALARY', 'CASH', 'INSURANCE', 'WAIVED']

export const RECOVERY_METHOD_LABELS = {
  NONE:      'No recovery',
  SALARY:    'Salary deduction',
  CASH:      'Cash from employee',
  INSURANCE: 'Insurance claim',
  WAIVED:    'Waived',
}

export const RECOVERY_STATUSES = ['PENDING', 'RECOVERED', 'WAIVED', 'NOT_APPLICABLE']

export const RECOVERY_STATUS_META = {
  PENDING:        { label: 'Pending',        color: 'yellow' },
  RECOVERED:      { label: 'Recovered',      color: 'green' },
  WAIVED:         { label: 'Waived',         color: 'gray' },
  NOT_APPLICABLE: { label: 'Not applicable', color: 'gray' },
}

// ── Acknowledgement of receipt by the assignee ───────────────────────────────
export const ACK_STATUSES = ['NOT_REQUIRED', 'PENDING', 'ACCEPTED', 'DECLINED']

export const ACK_META = {
  NOT_REQUIRED: { label: 'Not required', color: 'gray' },
  PENDING:      { label: 'Awaiting acknowledgement', color: 'yellow' },
  ACCEPTED:     { label: 'Acknowledged', color: 'green' },
  DECLINED:     { label: 'Declined',     color: 'red' },
}

// ── Disposal ─────────────────────────────────────────────────────────────────
export const DISPOSAL_TYPES = ['SOLD', 'SCRAPPED', 'WRITTEN_OFF', 'DONATED']

// ── Locations ────────────────────────────────────────────────────────────────
export const LOCATION_TYPES = ['OFFICE', 'FLOOR', 'ROOM', 'STORE', 'REMOTE', 'OTHER']

export const LOCATION_TYPE_LABELS = {
  OFFICE: 'Office',
  FLOOR:  'Floor',
  ROOM:   'Room',
  STORE:  'Store room',
  REMOTE: 'Remote / WFH',
  OTHER:  'Other',
}

// ── Categories & depreciation policy ─────────────────────────────────────────
export const CATEGORY_TYPES = ['ASSET', 'CONSUMABLE']

export const CATEGORY_TYPE_LABELS = {
  ASSET:      'Asset (tracked one by one)',
  CONSUMABLE: 'Consumable (tracked by quantity)',
}

/** Category codes: 2–6 characters, A–Z and 0–9 (used inside asset tags). */
export const CATEGORY_CODE_REGEX = /^[A-Z0-9]{2,6}$/

export const DEPRECIATION_METHODS = ['STRAIGHT_LINE', 'DECLINING_BALANCE', 'NONE']

export const DEPRECIATION_METHOD_LABELS = {
  STRAIGHT_LINE:     'Straight-line',
  DECLINING_BALANCE: 'Declining balance',
  NONE:              'Not depreciated',
}

export const DEPRECIATION_CONVENTIONS = ['PRORATA_DAYS', 'FULL_MONTH']

export const DEPRECIATION_CONVENTION_LABELS = {
  PRORATA_DAYS: 'Pro-rata by days in the first and last month',
  FULL_MONTH:   'Full month from the month the asset is put to use',
}

export const DEFAULT_CATEGORIES = [ // seed
  { name: 'Laptop',                                 code: 'LAP', type: 'ASSET',      taxClass: 'COMPUTER' },
  { name: 'Desktop / Workstation',                  code: 'DSK', type: 'ASSET',      taxClass: 'COMPUTER' },
  { name: 'Monitor',                                code: 'MON', type: 'ASSET',      taxClass: 'COMPUTER' },
  { name: 'Printer / Scanner',                      code: 'PRN', type: 'ASSET',      taxClass: 'COMPUTER' },
  { name: 'Networking (router, switch, AP)',        code: 'NET', type: 'ASSET',      taxClass: 'COMPUTER' },
  { name: 'Server / Storage',                       code: 'SRV', type: 'ASSET',      taxClass: 'COMPUTER' },
  { name: 'Mobile phone / Tablet',                  code: 'PHN', type: 'ASSET',      taxClass: 'BATTERY' },
  { name: 'Camera & AV equipment',                  code: 'CAM', type: 'ASSET',      taxClass: 'AUDIO_VISUAL' },
  { name: 'Air conditioner',                        code: 'ACU', type: 'ASSET',      taxClass: 'OFFICE_EQUIPMENT' },
  { name: 'Office equipment',                       code: 'OEQ', type: 'ASSET',      taxClass: 'OFFICE_EQUIPMENT' },
  { name: 'UPS / IPS / Battery',                    code: 'UPS', type: 'ASSET',      taxClass: 'BATTERY' },
  { name: 'Furniture',                              code: 'FUR', type: 'ASSET',      taxClass: 'FURNITURE' },
  { name: 'Vehicle',                                code: 'VEH', type: 'ASSET',      taxClass: 'MOTOR_VEHICLE' },
  { name: 'Software licence',                       code: 'SFT', type: 'ASSET',      taxClass: 'SOFTWARE_FOREIGN' },
  { name: 'Accessories (mouse, keyboard, headset)', code: 'ACC', type: 'ASSET',      taxClass: 'COMPUTER', capitalize: false },
  { name: 'Office supplies & stationery',           code: 'STA', type: 'CONSUMABLE', taxClass: 'OTHER' },
  { name: 'Pantry & cleaning',                      code: 'PAN', type: 'CONSUMABLE', taxClass: 'OTHER' },
  { name: 'Printer consumables (toner, ink)',       code: 'TON', type: 'CONSUMABLE', taxClass: 'OTHER' },
]

// ── Consumable stock ─────────────────────────────────────────────────────────
export const STOCK_MOVEMENT_TYPES = ['OPENING', 'PURCHASE', 'ISSUE', 'RETURN', 'ADJUST_IN', 'ADJUST_OUT', 'DAMAGED', 'TRANSFER']

/** direction null ⇒ the caller chooses (TRANSFER legs). */
export const STOCK_MOVEMENT_META = {
  OPENING:    { label: 'Opening stock',     direction: 'IN',  color: 'indigo' },
  PURCHASE:   { label: 'Purchase',          direction: 'IN',  color: 'green' },
  ISSUE:      { label: 'Issued',            direction: 'OUT', color: 'blue' },
  RETURN:     { label: 'Returned',          direction: 'IN',  color: 'teal' },
  ADJUST_IN:  { label: 'Adjustment (+)',    direction: 'IN',  color: 'gray' },
  ADJUST_OUT: { label: 'Adjustment (−)',    direction: 'OUT', color: 'gray' },
  DAMAGED:    { label: 'Damaged / expired', direction: 'OUT', color: 'orange' },
  TRANSFER:   { label: 'Transfer',          direction: null,  color: 'purple' },
}

export const STOCK_UNITS = ['pcs', 'box', 'pack', 'ream', 'set', 'kg', 'g', 'ltr', 'ml', 'roll', 'bottle', 'carton', 'dozen']

// ── Purchase bills ───────────────────────────────────────────────────────────
export const PURCHASE_LINE_TYPES = ['ASSET', 'CONSUMABLE', 'EXPENSE']

export const PURCHASE_LINE_TYPE_LABELS = {
  ASSET:      'Asset',
  CONSUMABLE: 'Consumable stock',
  EXPENSE:    'Expense / service',
}

export const PURCHASE_BILL_STATUSES = ['DRAFT', 'RECEIVED', 'CANCELLED']

export const PURCHASE_BILL_STATUS_META = {
  DRAFT:     { label: 'Draft',     color: 'gray' },
  RECEIVED:  { label: 'Received',  color: 'green' },
  CANCELLED: { label: 'Cancelled', color: 'red' },
}

export const PURCHASE_PAYMENT_MODES = ['PAY_NOW', 'REQUEST', 'PAID_OUTSIDE']

export const PURCHASE_PAYMENT_MODE_LABELS = {
  PAY_NOW:      'Pay now from a money account',
  REQUEST:      'Send to finance as a payment request',
  PAID_OUTSIDE: 'Already paid (historical, no money movement)',
}

export const PURCHASE_PAYMENT_STATUSES = ['UNPAID', 'REQUESTED', 'PAID']

export const PURCHASE_PAYMENT_STATUS_META = {
  UNPAID:    { label: 'Unpaid',    color: 'gray' },
  REQUESTED: { label: 'Requested', color: 'yellow' },
  PAID:      { label: 'Paid',      color: 'green' },
}

export const SUPPLIER_VAT_TYPES = ['REGISTERED', 'TURNOVER', 'UNREGISTERED', 'FOREIGN']

export const SUPPLIER_VAT_TYPE_LABELS = {
  REGISTERED:   'VAT registered (15% / reduced rate)',
  TURNOVER:     'Turnover tax enlisted',
  UNREGISTERED: 'Not VAT registered',
  FOREIGN:      'Foreign supplier',
}

// ── Uploaded-file URLs ───────────────────────────────────────────────────────
/**
 * /uploads/<bucket>/<uuid>.<ext> — the only URLs our upload route (FileUpload)
 * returns. Attachment / photo / document fields accept nothing else, so no
 * javascript:, data:, external or same-origin /api/… link can be stored and
 * later rendered as an href / img src.
 */
export const UPLOAD_URL_RE = /^\/uploads\/(receipts|onboarding|assets|tax)\/[a-f0-9-]{36}\.(jpg|jpeg|png|webp|pdf)$/i

/**
 * Render-side guard for stored links (older rows were not validated): a
 * same-origin path that is not an /api/… endpoint, or an http(s) URL. Anything
 * else (javascript:, data:, //host) ⇒ null, so it is never used as href / src.
 */
export function safeLinkUrl(url) {
  if (typeof url !== 'string') return null
  const u = url.trim()
  return /^(\/(?![\/\\]|api\/)|https?:\/\/)/i.test(u) ? u : null
}

// ── Depreciation runs ────────────────────────────────────────────────────────
// POSTING = claimed and being applied; a POSTING run older than
// DEPRECIATION_POSTING_STALE_MS was interrupted and is recovered by running the month again.
export const DEPRECIATION_RUN_STATUSES = ['POSTED', 'REVERSED', 'POSTING']
export const DEPRECIATION_POSTING_STALE_MS = 15 * 60 * 1000

/** true when a POSTING run has not been touched for DEPRECIATION_POSTING_STALE_MS (interrupted). */
export function isStalePostingRun(run, now = Date.now()) {
  if (run?.status !== 'POSTING') return false
  const t = new Date(run.updatedAt ?? run.createdAt ?? 0).getTime()
  return !Number.isFinite(t) || now - t > DEPRECIATION_POSTING_STALE_MS
}

// ── Physical audits ──────────────────────────────────────────────────────────
export const AUDIT_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED']

export const AUDIT_STATUS_META = {
  IN_PROGRESS: { label: 'In progress', color: 'yellow' },
  COMPLETED:   { label: 'Completed',   color: 'green' },
  CANCELLED:   { label: 'Cancelled',   color: 'gray' },
}

export const AUDIT_RESULTS = ['PENDING', 'FOUND', 'MISSING', 'WRONG_LOCATION', 'DAMAGED']

export const AUDIT_RESULT_META = {
  PENDING:        { label: 'Not checked',    color: 'gray' },
  FOUND:          { label: 'Found',          color: 'green' },
  MISSING:        { label: 'Missing',        color: 'red' },
  WRONG_LOCATION: { label: 'Wrong location', color: 'orange' },
  DAMAGED:        { label: 'Damaged',        color: 'yellow' },
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Statuses an asset in `from` may move to (empty for terminal / unknown). */
export function allowedTransitions(from) {
  return TRANSITIONS[from] ? [...TRANSITIONS[from]] : []
}

/**
 * Whether a status change is allowed. A brand-new asset (no `from`) may start
 * in any non-terminal status.
 */
export function canTransition(from, to) {
  if (!ASSET_STATUSES.includes(to)) return false
  if (!from) return !TERMINAL_STATUSES.includes(to)
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to)
}

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * Capitalized cost in BDT: unit cost + VAT (when the VAT is not reclaimable and
 * therefore capitalized; default true) + other directly attributable costs.
 */
export function computeAssetCost({ unitCost = 0, vatAmount = 0, vatCapitalized = true, otherCosts = 0 } = {}) {
  return round2(num(unitCost) + (vatCapitalized === false ? 0 : num(vatAmount)) + num(otherCosts))
}

/** Net book value = cost − accumulated depreciation (works on docs and lean objects). */
export function bookValue(asset) {
  if (!asset) return 0
  return round2(num(asset.cost) - num(asset.depreciation?.accumulated))
}

/** IN/OUT for a stock movement type (null for TRANSFER, which needs an explicit direction). */
export function stockDirectionFor(type) {
  return STOCK_MOVEMENT_META[type]?.direction ?? null
}

/** Normalise a category code for tags: upper-case A–Z/0–9 only. */
export function normalizeCategoryCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Normalise the asset-tag prefix from settings: upper-case A–Z/0–9, max 8 chars. */
export function normalizeTagPrefix(prefix) {
  return String(prefix ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

export function statusLabel(status) {
  return STATUS_META[status]?.label ?? (status ? String(status).replace(/_/g, ' ').toLowerCase() : '')
}

export function eventLabel(type) {
  return EVENT_META[type]?.label ?? (type ? String(type).replace(/_/g, ' ').toLowerCase() : '')
}

/** [{ value, label }] for a list of keys and a label map (or meta map with .label). */
export function toOptions(keys, labels = {}) {
  return keys.map(k => {
    const l = labels[k]
    return { value: k, label: (l && typeof l === 'object' ? l.label : l) ?? String(k).replace(/_/g, ' ') }
  })
}

export const STATUS_OPTIONS          = toOptions(ASSET_STATUSES, STATUS_META)
export const CONDITION_OPTIONS       = toOptions(CONDITIONS, CONDITION_META)
export const LOCATION_TYPE_OPTIONS   = toOptions(LOCATION_TYPES, LOCATION_TYPE_LABELS)
export const DAMAGE_CAUSE_OPTIONS    = toOptions(DAMAGE_CAUSES, DAMAGE_CAUSE_LABELS)
export const RECOVERY_METHOD_OPTIONS = toOptions(RECOVERY_METHODS, RECOVERY_METHOD_LABELS)
export const DEPRECIATION_METHOD_OPTIONS = toOptions(DEPRECIATION_METHODS, DEPRECIATION_METHOD_LABELS)
export const STOCK_UNIT_OPTIONS      = STOCK_UNITS.map(u => ({ value: u, label: u }))
