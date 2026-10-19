import {
  LayoutDashboard, Users, UserCheck, Briefcase, ClipboardList, FileText, TrendingUp, Settings2,
  CalendarDays, Clock, FileSignature, UserCog, Building2, ArrowRightLeft, CheckCircle2, Inbox,
  ShieldCheck, Activity, Bell, UserCircle, PieChart, Wallet, Landmark, Receipt, Percent, Banknote,
  KeyRound, LineChart, Scale, Calculator, FileSpreadsheet, BookOpen, FileCheck, FileMinus, ListChecks,
  Package, PackageCheck, Laptop, ShoppingCart, Boxes, ClipboardCheck, BarChart3, SlidersHorizontal,
  Mail, MessageCircle, CreditCard, ShieldAlert, Plus,
} from 'lucide-react'
import { canDo } from '@/lib/rbac'

const STAFF = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']

// ─── Admin navigation ─────────────────────────────────────────────────────────
// A top-level entry is either a link ({ href }) or a collapsible group ({ items }).
// `permission` — RBAC permission string, or an array meaning ANY of them (keep it
// equal to the page's ROUTE_PERMISSIONS entry). SUPER_ADMIN always sees everything.
// `tab` + `basePath` — the link is a ?tab= view of basePath (active detection).
export const NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true, permission: 'dashboard.view' },
  {
    label: 'Sales',
    icon: TrendingUp,
    items: [
      { href: '/admin/leads',             label: 'Leads',           icon: TrendingUp,    permission: 'sales.leads.view' },
      { href: '/admin/clients',           label: 'Customers',       icon: UserCheck,     permission: 'sales.customers.view' },
      { href: '/admin/quotations',        label: 'Quotations',      icon: FileSignature, permission: 'sales.quotations.view' },
      { href: '/admin/invoices',          label: 'Invoices',        icon: FileText,      permission: 'sales.invoices.view' },
      { href: '/admin/password-requests', label: 'Password resets', icon: KeyRound,      permission: 'sales.customers.passwordReset' },
    ],
  },
  {
    label: 'Projects',
    icon: Briefcase,
    items: [
      { href: '/admin/projects', label: 'Projects', icon: Briefcase,     permission: 'projects.view' },
      { href: '/admin/tasks',    label: 'Tasks',    icon: ClipboardList, permission: 'tasks.view' },
    ],
  },
  {
    label: 'Finance',
    icon: Wallet,
    items: [
      { href: '/admin/accounts',                   label: 'Overview',         icon: PieChart,       permission: 'finance.overview.view', exact: true },
      { href: '/admin/finance/accounts',           label: 'Money accounts',   icon: Landmark,       permission: ['finance.accounts.view', 'finance.accounts.manage', 'finance.accounts.reconcile'] },
      { href: '/admin/accounts?tab=transactions',  label: 'Transactions',     icon: ArrowRightLeft, permission: 'finance.transactions.view', basePath: '/admin/accounts', tab: 'transactions' },
      { href: '/admin/accounts?tab=confirmations', label: 'Confirmations',    icon: CheckCircle2,   permission: 'finance.payments.confirm',  basePath: '/admin/accounts', tab: 'confirmations' },
      { href: '/admin/accounts?tab=requests',      label: 'Payment requests', icon: Inbox,          permission: 'finance.payments.request',  basePath: '/admin/accounts', tab: 'requests' },
      { href: '/admin/my-expenses',                label: 'My expenses',      icon: Receipt,        permission: 'finance.expenses.submit' },
      { href: '/admin/salary',                     label: 'Salary',           icon: Banknote,       permission: 'finance.salary.view' },
      { href: '/admin/accounts?tab=pl',            label: 'Profit & loss',    icon: LineChart,      permission: 'finance.reports.view',      basePath: '/admin/accounts', tab: 'pl' },
      { href: '/admin/finance/opening-balances',   label: 'Opening balances', icon: Scale,          permission: ['finance.opening.manage', 'finance.periods.lock'] },
    ],
  },
  {
    label: 'Tax & VAT',
    icon: Calculator,
    items: [
      { href: '/admin/tax',              label: 'Overview',       icon: Calculator,      permission: ['tax.view', 'tax.manage'], exact: true },
      { href: '/admin/tax/vat-return',   label: 'VAT return',     icon: FileSpreadsheet, permission: ['tax.view', 'tax.manage'] },
      { href: '/admin/tax/registers',    label: 'Registers',      icon: BookOpen,        permission: ['tax.view', 'tax.manage'] },
      { href: '/admin/tax/withholding',  label: 'Withholding',    icon: Percent,         permission: ['tax.view', 'tax.manage'] },
      { href: '/admin/tax/certificates', label: 'Certificates',   icon: FileCheck,       permission: ['tax.view', 'tax.manage'] },
      { href: '/admin/tax/notes',        label: 'Credit & debit notes', icon: FileMinus, permission: ['tax.view', 'tax.manage', 'tax.notes.manage'] },
      { href: '/admin/tax/entries',      label: 'Tax ledger',     icon: ListChecks,      permission: ['tax.view', 'tax.manage'] },
      { href: '/admin/tax/settings',     label: 'Settings',       icon: Settings2,       permission: 'tax.manage' },
    ],
  },
  {
    label: 'Inventory',
    icon: Package,
    items: [
      { href: '/admin/inventory',           label: 'Overview',    icon: Package,           permission: ['inventory.view', 'inventory.manage'], exact: true },
      { href: '/admin/inventory/assets',    label: 'Assets',      icon: Laptop,            permission: ['inventory.view', 'inventory.manage'] },
      { href: '/admin/inventory/purchases', label: 'Purchases',   icon: ShoppingCart,      permission: ['inventory.view', 'inventory.purchase'] },
      { href: '/admin/inventory/stock',     label: 'Consumables', icon: Boxes,             permission: ['inventory.view', 'inventory.manage'] },
      { href: '/admin/inventory/audits',    label: 'Audits',      icon: ClipboardCheck,    permission: ['inventory.audit', 'inventory.manage'] },
      { href: '/admin/inventory/reports',   label: 'Reports',     icon: BarChart3,         permission: ['inventory.view', 'inventory.manage'] },
      { href: '/admin/inventory/settings',  label: 'Settings',    icon: SlidersHorizontal, permission: 'inventory.manage' },
    ],
  },
  {
    label: 'People',
    icon: Users,
    items: [
      { href: '/admin/employees',   label: 'Employees',   icon: Users,        permission: 'hr.employees.view' },
      { href: '/admin/freelancers', label: 'Freelancers', icon: UserCog,      permission: 'hr.freelancers.manage' },
      { href: '/admin/vendors',     label: 'Vendors',     icon: Building2,    permission: 'hr.vendors.manage' },
      { href: '/admin/agencies',    label: 'Agencies',    icon: Landmark,     permission: 'hr.agencies.manage' },
      { href: '/admin/attendance',  label: 'Attendance',  icon: CalendarDays, permission: 'hr.attendance.view' },
      { href: '/admin/leaves',      label: 'Leaves',      icon: Clock,        permission: 'hr.leaves.view' },
      { href: '/admin/roles',       label: 'Roles',       icon: ShieldCheck,  permission: 'hr.roles.manage' },
    ],
  },
  {
    label: 'System',
    icon: Settings2,
    items: [
      { href: '/admin/config',        label: 'Configuration', icon: Settings2, permission: 'system.config.view' },
      { href: '/admin/activity-logs', label: 'Activity logs', icon: Activity,  permission: 'system.logs.view' },
    ],
  },
]

// Personal pages — shown in the user menu, not the main nav.
export const ACCOUNT_NAV = [
  // No permission: everyone can complete their own profile/KYC and see their equipment.
  { href: '/admin/profile',       label: 'My profile',    icon: UserCircle },
  { href: '/admin/my-assets',     label: 'My assets',     icon: PackageCheck },
  { href: '/admin/account',       label: 'Account',       icon: UserCog, permission: 'account.profile.view' },
  { href: '/admin/notifications', label: 'Notifications', icon: Bell,    permission: 'account.notifications.view' },
]

// Extra entries that only appear in the command menu.
export const COMMAND_EXTRAS = [
  { group: 'Create', href: '/admin/invoices/new',            label: 'New invoice',       icon: Plus, permission: 'sales.invoices.create' },
  { group: 'Create', href: '/admin/quotations/new',          label: 'New quotation',     icon: Plus, permission: 'sales.quotations.create' },
  { group: 'Create', href: '/admin/projects/new',            label: 'New project',       icon: Plus, permission: 'projects.create' },
  { group: 'Create', href: '/admin/inventory/purchases/new', label: 'New purchase bill', icon: Plus, permission: 'inventory.purchase' },
  { group: 'Configuration', href: '/admin/config?tab=ventures',     label: 'Ventures & services', icon: Settings2,     permission: 'system.config.view' },
  { group: 'Configuration', href: '/admin/config?tab=leads',        label: 'Lead options',        icon: ClipboardList, permission: 'system.config.view' },
  { group: 'Configuration', href: '/admin/config?tab=departments',  label: 'Departments',         icon: Building2,     permission: 'system.config.view' },
  { group: 'Configuration', href: '/admin/config?tab=company',      label: 'Company info',        icon: Building2,     permission: 'system.config.view' },
  { group: 'Configuration', href: '/admin/config?tab=verification', label: 'Verification',        icon: ShieldAlert,   permission: 'system.config.view' },
  { group: 'Configuration', href: '/admin/config?tab=payment',      label: 'Payment methods',     icon: CreditCard,    permission: 'system.config.view' },
  { group: 'Configuration', href: '/admin/config?tab=email',        label: 'Email accounts',      icon: Mail,          roles: ['SUPER_ADMIN'] },
  { group: 'Configuration', href: '/admin/config?tab=whatsapp',     label: 'WhatsApp',            icon: MessageCircle, roles: ['SUPER_ADMIN'] },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function canSee(item, session) {
  const role = session?.user?.role
  if (!role || !STAFF.includes(role)) return false
  if (item.roles && !item.roles.includes(role)) return false
  if (role === 'SUPER_ADMIN') return true
  if (Array.isArray(item.permission)) return item.permission.some(p => canDo(session, p))
  if (item.permission) return canDo(session, item.permission)
  return true
}

/** NAV filtered to what this session can open; empty groups are dropped. */
export function visibleNav(session) {
  return NAV.flatMap(entry => {
    if (!entry.items) return canSee(entry, session) ? [entry] : []
    const items = entry.items.filter(i => canSee(i, session))
    return items.length ? [{ ...entry, items }] : []
  })
}

export function isItemActive(item, pathname, searchParams) {
  const tab = searchParams?.get('tab') ?? null
  const base = item.basePath ?? item.href.split('?')[0]
  if (item.exact) return pathname === base && !tab
  const onBase = pathname === base || pathname.startsWith(`${base}/`)
  if (item.tab) return onBase && tab === item.tab
  return onBase
}

/** Best match for the current route: { group, item } (longest href wins). */
export function findActive(pathname, searchParams) {
  let best = null
  const consider = (item, group) => {
    if (!isItemActive(item, pathname, searchParams)) return
    const len = (item.basePath ?? item.href.split('?')[0]).length + (item.tab ? 1 : 0)
    if (!best || len > best.len) best = { group, item, len }
  }
  for (const entry of NAV) {
    if (entry.items) entry.items.forEach(i => consider(i, entry))
    else consider(entry, null)
  }
  ACCOUNT_NAV.forEach(i => consider(i, { label: 'Account' }))
  return best
}
