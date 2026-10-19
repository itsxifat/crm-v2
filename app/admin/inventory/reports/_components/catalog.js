import {
  Package, Users, MapPin, ShieldCheck, Scale, Landmark, TrendingDown, HandCoins, TriangleAlert,
  Wrench, Boxes, PackageX, ClipboardList,
} from 'lucide-react'

/**
 * Inventory report catalogue. `filters` lists the controls the report view
 * shows; each maps to query parameters of GET /api/inventory/reports.
 *   range     fiscal year or custom start/end dates      (fy | start,end)
 *   fy        fiscal (income) year only                  (fy)
 *   category  asset or consumable category               (categoryId)
 *   location                                             (locationId)
 *   status    asset status                               (status)
 *   disposed  include disposed assets                    (includeDisposed)
 *   employee                                             (employeeId)
 *   days      warranty window                            (days, includeExpired)
 *   recovery  recovery status                            (recoveryStatus)
 *   groupBy   grouping options (per report)              (groupBy)
 *   asOf      valuation date                             (asOf)
 */
export const REPORT_GROUPS = [
  {
    title: 'Asset register',
    items: [
      { type: 'register', title: 'Fixed asset register', description: 'Every asset with cost, accumulated depreciation and net book value, by category.', icon: Package, filters: ['category', 'location', 'status', 'disposed'], categoryType: 'ASSET' },
      { type: 'custodian', title: 'Assets by custodian', description: 'What each employee or department holds — for exit clearance and confirmations.', icon: Users, filters: ['employee', 'category'], categoryType: 'ASSET' },
      { type: 'location', title: 'Assets by location', description: 'Where everything is kept — use it as the count sheet for a physical audit.', icon: MapPin, filters: ['location', 'category'], categoryType: 'ASSET' },
      { type: 'warranty', title: 'Warranty expiry', description: 'Warranties ending in the coming weeks, with the supplier to contact.', icon: ShieldCheck, filters: ['days'] },
    ],
  },
  {
    title: 'Depreciation & tax',
    items: [
      { type: 'ppe-movement', title: 'PPE movement schedule', description: 'Opening + additions − disposals = closing, for cost and accumulated depreciation (IAS 16 note).', icon: Scale, filters: ['fy'] },
      { type: 'tax-depreciation', title: 'Tax depreciation schedule', description: 'Third Schedule allowance per income year, grouped by asset class — for the income-tax return.', icon: Landmark, filters: ['fy'] },
      { type: 'book-depreciation', title: 'Book depreciation by month', description: 'Depreciation charged per asset in each month, as posted by the runs.', icon: TrendingDown, filters: ['range', 'category'], categoryType: 'ASSET' },
      { type: 'disposals', title: 'Disposals', description: 'Assets sold, scrapped, written off or donated, with gain or loss.', icon: HandCoins, filters: ['range'] },
    ],
  },
  {
    title: 'Damage & maintenance',
    items: [
      { type: 'damage', title: 'Damage, loss & recovery register', description: 'Damage and loss cases with the responsible employee and recovery (Labour Act s.125/127).', icon: TriangleAlert, filters: ['range', 'employee', 'recovery'] },
      { type: 'maintenance', title: 'Repairs & maintenance', description: 'Completed repairs and what they cost, by repairer, asset or category.', icon: Wrench, filters: ['range', 'groupBy'], groupBy: [['vendor', 'Repairer'], ['asset', 'Asset'], ['category', 'Category']] },
    ],
  },
  {
    title: 'Consumables',
    items: [
      { type: 'stock-valuation', title: 'Stock valuation', description: 'Consumable stock on hand at moving-average cost, now or at a past date.', icon: Boxes, filters: ['asOf', 'category'], categoryType: 'CONSUMABLE' },
      { type: 'low-stock', title: 'Low stock', description: 'Items at or below their reorder level, with a suggested order.', icon: PackageX, filters: [] },
      { type: 'consumption', title: 'Consumable usage', description: 'Stock issued net of returns, by employee, department, month or item.', icon: ClipboardList, filters: ['range', 'groupBy', 'employee'], groupBy: [['employee', 'Employee'], ['department', 'Department'], ['month', 'Month'], ['item', 'Item']] },
    ],
  },
]

export const REPORTS = Object.fromEntries(REPORT_GROUPS.flatMap(g => g.items.map(i => [i.type, { ...i, group: g.title }])))

/** Query keys each filter owns (used to keep the URL tidy when switching reports). */
export const FILTER_KEYS = {
  range: ['fy', 'start', 'end'],
  fy: ['fy'],
  category: ['categoryId'],
  location: ['locationId'],
  status: ['status'],
  disposed: ['includeDisposed'],
  employee: ['employeeId'],
  days: ['days', 'includeExpired'],
  recovery: ['recoveryStatus'],
  groupBy: ['groupBy'],
  asOf: ['asOf'],
}
