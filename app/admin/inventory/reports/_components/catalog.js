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
      { type: 'register', title: 'Fixed asset register', description: 'Cost, depreciation and book value by category.', icon: Package, filters: ['category', 'location', 'status', 'disposed'], categoryType: 'ASSET' },
      { type: 'custodian', title: 'Assets by custodian', description: 'What each employee or department holds.', icon: Users, filters: ['employee', 'category'], categoryType: 'ASSET' },
      { type: 'location', title: 'Assets by location', description: 'Where every asset is kept.', icon: MapPin, filters: ['location', 'category'], categoryType: 'ASSET' },
      { type: 'warranty', title: 'Warranty expiry', description: 'Warranties ending soon, with supplier contacts.', icon: ShieldCheck, filters: ['days'] },
    ],
  },
  {
    title: 'Depreciation & tax',
    items: [
      { type: 'ppe-movement', title: 'PPE movement schedule', description: 'Cost and depreciation roll-forward (IAS 16).', icon: Scale, filters: ['fy'] },
      { type: 'tax-depreciation', title: 'Tax depreciation schedule', description: 'Third Schedule allowance by asset class.', icon: Landmark, filters: ['fy'] },
      { type: 'book-depreciation', title: 'Book depreciation by month', description: 'Monthly depreciation charged per asset.', icon: TrendingDown, filters: ['range', 'category'], categoryType: 'ASSET' },
      { type: 'disposals', title: 'Disposals', description: 'Sold, scrapped and written-off assets with gain/loss.', icon: HandCoins, filters: ['range'] },
    ],
  },
  {
    title: 'Damage & maintenance',
    items: [
      { type: 'damage', title: 'Damage, loss & recovery register', description: 'Damage, loss and recovery (Labour Act s.125/127).', icon: TriangleAlert, filters: ['range', 'employee', 'recovery'] },
      { type: 'maintenance', title: 'Repairs & maintenance', description: 'Completed repairs and their cost.', icon: Wrench, filters: ['range', 'groupBy'], groupBy: [['vendor', 'Repairer'], ['asset', 'Asset'], ['category', 'Category']] },
    ],
  },
  {
    title: 'Consumables',
    items: [
      { type: 'stock-valuation', title: 'Stock valuation', description: 'Stock on hand at moving-average cost.', icon: Boxes, filters: ['asOf', 'category'], categoryType: 'CONSUMABLE' },
      { type: 'low-stock', title: 'Low stock', description: 'Items at or below reorder level.', icon: PackageX, filters: [] },
      { type: 'consumption', title: 'Consumable usage', description: 'Stock issued net of returns.', icon: ClipboardList, filters: ['range', 'groupBy', 'employee'], groupBy: [['employee', 'Employee'], ['department', 'Department'], ['month', 'Month'], ['item', 'Item']] },
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
