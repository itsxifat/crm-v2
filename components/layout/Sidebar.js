'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { canDo } from '@/lib/rbac'
import {
  LayoutDashboard, Users, UserCheck, Briefcase, ClipboardList,
  FileText, DollarSign, TrendingUp, Settings2,
  Calendar, Clock, FileSignature,
  BarChart3, UserCog, Building2, ChevronLeft, ChevronRight,
  ArrowRightLeft, ArrowDownLeft, ArrowUpRight as ArrowUpRightIcon,
  CheckCircle, Inbox, ChevronDown, ShieldCheck, Activity, Bell, UserCircle,
  PieChart, Wallet, Landmark, Globe, Receipt, CreditCard, Percent,
  BellRing, Mail, KeyRound, LineChart, Store, X, MessageCircle, ShieldAlert,
} from 'lucide-react'
import Image from 'next/image'
import { useState, Suspense } from 'react'

// ─── Role definitions ─────────────────────────────────────────────────────────
// SUPER_ADMIN : full access
// MANAGER     : operational access (no config/settings)
// EMPLOYEE    : limited — tasks, projects, HR, payment requests only
// FREELANCER  : portal-only, no admin sidebar
// CLIENT      : portal-only

// ─── Nav structure ────────────────────────────────────────────────────────────
// Items can have `children` (sub-links, collapsible).
// `href` on a parent = the base path used for active detection.
// `tab` on children = query param appended as ?tab=value
// `basePath` on items with tabs = the path portion for active detection.

// `permission` — flat RBAC permission string (e.g. 'sales.leads.view').
// When set, item visibility is gated by canDo(session, permission) for all
// non-SUPER_ADMIN roles. SUPER_ADMIN always sees everything.

const NAV_SECTIONS = [
  {
    label: 'Main',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'dashboard.view' },
    ],
  },
  {
    label: 'Sales',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/leads',      label: 'Leads',      icon: TrendingUp,    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'sales.leads.view' },
      { href: '/admin/clients',    label: 'Customers',  icon: UserCheck,     roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'sales.customers.view' },
      { href: '/admin/quotations', label: 'Quotations', icon: FileSignature, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'sales.quotations.view' },
      { href: '/admin/invoices',   label: 'Invoices',   icon: FileText,      roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'sales.invoices.view' },
    ],
  },
  {
    label: 'Projects',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/projects', label: 'Projects', icon: Briefcase,     roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'projects.view' },
      { href: '/admin/tasks',    label: 'Tasks',    icon: ClipboardList, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'tasks.view' },
    ],
  },
  {
    label: 'Finance',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/accounts',                   label: 'Overview',              icon: PieChart,       roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'finance.overview.view', exact: true },
      { href: '/admin/accounts?tab=transactions',  label: 'Transactions',          icon: ArrowRightLeft, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'finance.transactions.view', basePath: '/admin/accounts', tab: 'transactions' },
      { href: '/admin/accounts?tab=confirmations', label: 'Payment Confirmations', icon: CheckCircle,    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'finance.payments.confirm',  basePath: '/admin/accounts', tab: 'confirmations' },
      { href: '/admin/accounts?tab=requests',      label: 'Payment Requests',      icon: Inbox,          roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'finance.payments.request',  basePath: '/admin/accounts', tab: 'requests' },
      { href: '/admin/accounts?tab=withdrawals',   label: 'Withdrawals',           icon: Wallet,         roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'finance.withdrawals.view',  basePath: '/admin/accounts', tab: 'withdrawals' },
      { href: '/admin/accounts?tab=pl',            label: 'P&L Report',            icon: LineChart,      roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'finance.reports.view',      basePath: '/admin/accounts', tab: 'pl' },
    ],
  },
  {
    label: 'HR & People',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/employees',   label: 'Employees',           icon: Users,       roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'hr.employees.view' },
      { href: '/admin/freelancers', label: 'Freelancers',         icon: UserCog,     roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'hr.freelancers.manage' },
      { href: '/admin/vendors',     label: 'Vendors',             icon: Building2,   roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'hr.vendors.manage' },
      { href: '/admin/agencies',    label: 'Agencies',            icon: Landmark,    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'hr.agencies.manage' },
      { href: '/admin/attendance',  label: 'Attendance',          icon: Calendar,    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'hr.attendance.view' },
      { href: '/admin/leaves',      label: 'Leaves',              icon: Clock,       roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'hr.leaves.view' },
      { href: '/admin/roles',       label: 'Roles & Permissions', icon: ShieldCheck, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'hr.roles.manage' },
    ],
  },
  {
    label: 'Analytics',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/reports', label: 'Reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'analytics.reports.view' },
    ],
  },
  {
    label: 'System',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      {
        href: '/admin/config',
        label: 'Configuration',
        icon: Settings2,
        roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
        permission: 'system.config.view',
        children: [
          { href: '/admin/config?tab=ventures',     tab: 'ventures',     label: 'Ventures & Services', icon: Settings2,     roles: ['SUPER_ADMIN'], permission: 'system.config.view' },
          { href: '/admin/config?tab=leads',        tab: 'leads',        label: 'Lead Options',        icon: ClipboardList, roles: ['SUPER_ADMIN'], permission: 'system.config.view' },
          { href: '/admin/config?tab=departments',  tab: 'departments',  label: 'Departments',         icon: Building2,     roles: ['SUPER_ADMIN'], permission: 'system.config.view' },
          { href: '/admin/config?tab=company',      tab: 'company',      label: 'Company Info',        icon: Building2,     roles: ['SUPER_ADMIN'], permission: 'system.config.view' },
          { href: '/admin/config?tab=verification', tab: 'verification', label: 'Verification',        icon: ShieldAlert,   roles: ['SUPER_ADMIN'], permission: 'system.config.view' },
          { href: '/admin/config?tab=payment',      tab: 'payment',      label: 'Payment Methods',     icon: CreditCard,    roles: ['SUPER_ADMIN'], permission: 'system.config.view' },
          { href: '/admin/config?tab=email',        tab: 'email',        label: 'Email Accounts',      icon: Mail,          roles: ['SUPER_ADMIN'], permission: 'system.config.view' },
          { href: '/admin/config?tab=whatsapp',     tab: 'whatsapp',     label: 'WhatsApp',            icon: MessageCircle, roles: ['SUPER_ADMIN'], permission: 'system.config.view' },
        ],
      },
      { href: '/admin/activity-logs', label: 'Activity Logs', icon: Activity, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'system.logs.view' },
    ],
  },
  {
    label: 'Account',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/account',       label: 'My Account',    icon: UserCog, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'account.profile.view' },
      { href: '/admin/notifications', label: 'Notifications', icon: Bell,    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'account.notifications.view' },
    ],
  },
]

// ─── Nav Item (leaf) ──────────────────────────────────────────────────────────

function NavItem({ item, active, collapsed }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
        active
          ? 'bg-gray-900 text-white'
          : 'text-gray-600 hover:bg-gray-900 hover:text-white',
        collapsed && 'justify-center'
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )
}

// ─── Collapsible nav group ────────────────────────────────────────────────────

function NavGroup({ item, role, sessionUser, pathname, searchParams, collapsed }) {
  const currentTab   = searchParams?.get('tab') ?? ''
  const isOnBasePath = pathname === item.href || pathname.startsWith(`${item.href}/`)

  const [open, setOpen] = useState(() => isOnBasePath)
  const Icon = item.icon

  const visibleChildren = item.children.filter(c => {
    if (!c.roles.includes(role)) return false
    if (role === 'SUPER_ADMIN') return true
    if (c.permission) return canDo({ user: sessionUser }, c.permission)
    return true
  })

  const isChildActive = (child) => {
    if (!isOnBasePath) return false
    return currentTab === child.tab
  }

  const anyChildActive = visibleChildren.some(c => isChildActive(c))
  const parentActive   = isOnBasePath && !currentTab

  if (collapsed) {
    return (
      <Link
        href={item.href}
        title={item.label}
        className={cn(
          'flex items-center justify-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
          (parentActive || anyChildActive)
            ? 'bg-gray-900 text-white'
            : 'text-gray-600 hover:bg-gray-900 hover:text-white'
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
      </Link>
    )
  }

  return (
    <div>
      <div className={cn(
        'flex items-center rounded-lg text-sm font-medium transition-colors duration-150',
        (parentActive || anyChildActive)
          ? 'bg-gray-100 text-gray-900'
          : 'text-gray-600 hover:bg-gray-900 hover:text-white'
      )}>
        <Link href={item.href} className="flex items-center gap-3 flex-1 px-3 py-2.5 min-w-0">
          <Icon className="w-4 h-4 shrink-0" />
          <span className="truncate">{item.label}</span>
        </Link>
        <button onClick={() => setOpen(o => !o)} className="px-2.5 py-2.5 shrink-0">
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <ul className="mt-0.5 ml-3 pl-3 border-l border-gray-200 space-y-0.5">
          {visibleChildren.map(child => {
            const CIcon  = child.icon
            const active = isChildActive(child)
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  className={cn(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors duration-150',
                    active
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-500 hover:bg-gray-900 hover:text-white'
                  )}
                >
                  <CIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{child.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── SidebarContent (needs useSearchParams → wrapped in Suspense) ─────────────

function SidebarContent({ mobileOpen, onMobileClose }) {
  const pathname          = usePathname()
  const searchParams      = useSearchParams()
  const { data: session } = useSession()
  const [collapsed, setCollapsed] = useState(false)
  const role = session?.user?.role

  function isActive(item) {
    if (item.exact) return pathname === item.href.split('?')[0] && !searchParams?.get('tab')
    const pathToCheck = item.basePath ?? item.href.split('?')[0]
    const onBasePath  = pathname === pathToCheck || pathname.startsWith(`${pathToCheck}/`)
    if (item.tab) {
      return onBasePath && searchParams?.get('tab') === item.tab
    }
    return onBasePath
  }

  function itemVisible(item) {
    if (!item.roles.includes(role)) return false
    if (role === 'SUPER_ADMIN') return true
    if (item.permission) return canDo(session, item.permission)
    return true
  }

  const sidebarContent = (isMobile = false) => (
    <>
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 shrink-0">
        {(!collapsed || isMobile) && (
          <div className="flex items-center min-w-0">
            <Image
              src="/en-logo.png"
              alt="Enfinito"
              width={120}
              height={28}
              className="h-7 w-auto object-contain block"
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          </div>
        )}
        {collapsed && !isMobile && (
          <div className="mx-auto flex items-center justify-center">
            <Image
              src="/en-logo.png"
              alt="Enfinito"
              width={28}
              height={28}
              className="w-7 h-7 object-contain block"
              onError={e => { e.currentTarget.style.display = 'none' }}
            />
          </div>
        )}
        {isMobile ? (
          <button
            onClick={onMobileClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        ) : !collapsed ? (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {NAV_SECTIONS.map((section) => {
          if (!section.roles.includes(role)) return null

          const visibleItems = section.items.filter(item => itemVisible(item))
          if (visibleItems.length === 0) return null

          return (
            <div key={section.label} className="mb-4">
              {(!collapsed || isMobile) && (
                <p className="text-2xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-1">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {visibleItems.map((item) => (
                  <li key={item.href} onClick={isMobile ? onMobileClose : undefined}>
                    {item.children ? (
                      <NavGroup
                        item={item}
                        role={role}
                        sessionUser={session?.user}
                        pathname={pathname}
                        searchParams={searchParams}
                        collapsed={collapsed && !isMobile}
                      />
                    ) : (
                      <NavItem item={item} active={isActive(item)} collapsed={collapsed && !isMobile} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* Collapse toggle (desktop only) */}
      {collapsed && !isMobile && (
        <div className="px-3 pb-4">
          <button
            onClick={() => setCollapsed(false)}
            className="w-full flex justify-center p-2.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-900 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden lg:flex h-screen bg-white border-r border-gray-200 flex-col transition-all duration-300 ease-in-out shrink-0',
          collapsed ? 'w-16' : 'w-[260px]'
        )}
      >
        {sidebarContent(false)}
      </aside>

      {/* Mobile sidebar drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-[260px] bg-white border-r border-gray-200 flex flex-col transition-transform duration-300 ease-in-out lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent(true)}
      </aside>
    </>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar({ mobileOpen = false, onMobileClose }) {
  return (
    <Suspense fallback={null}>
      <SidebarContent mobileOpen={mobileOpen} onMobileClose={onMobileClose} />
    </Suspense>
  )
}
