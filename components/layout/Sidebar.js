'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { canDo } from '@/lib/rbac'
import {
  LayoutDashboard, Users, UserCheck, Briefcase, ClipboardList,
  FileText, TrendingUp, Settings2,
  Calendar, Clock, FileSignature,
  BarChart3, UserCog, Building2, ChevronLeft, ChevronRight,
  ArrowRightLeft, ArrowDownLeft, ArrowUpRight as ArrowUpRightIcon,
  CheckCircle, Inbox, ChevronDown, ShieldCheck, Activity, Bell, UserCircle,
  PieChart, Wallet, Landmark, Globe, Receipt, CreditCard, Percent,
  BellRing, Mail, KeyRound, LineChart, Store, X, MessageCircle, ShieldAlert,
} from 'lucide-react'
import Image from 'next/image'
import { useState, useEffect, Suspense } from 'react'

const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  MANAGER:     'Manager',
  EMPLOYEE:    'Employee',
  FREELANCER:  'Freelancer',
  CLIENT:      'Client',
  VENDOR:      'Vendor',
}

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
      { href: '/admin/password-requests', label: 'Password Resets', icon: KeyRound, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'sales.customers.passwordReset' },
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
      { href: '/admin/my-expenses',                label: 'My Expenses',           icon: Receipt,        roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permission: 'finance.expenses.submit' },
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
      // No `permission` — always reachable so employees can complete their profile/KYC
      // (required when onboarding is ON, optional when OFF), even on a fresh custom role.
      { href: '/admin/profile',       label: 'My Profile',    icon: UserCircle, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'] },
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
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
        active
          ? 'bg-gray-900 text-white shadow-sm'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        collapsed && 'justify-center px-0'
      )}
    >
      {/* active accent bar (collapsed mode, where there's no label) */}
      {active && collapsed && (
        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gray-900" />
      )}
      <Icon className={cn(
        'w-[18px] h-[18px] shrink-0 transition-colors',
        active ? 'text-white' : 'text-gray-400 group-hover:text-gray-700'
      )} />
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
    const activeNow = parentActive || anyChildActive
    return (
      <Link
        href={item.href}
        title={item.label}
        className={cn(
          'group relative flex items-center justify-center py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
          activeNow
            ? 'bg-gray-900 text-white shadow-sm'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
        )}
      >
        {activeNow && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gray-900" />}
        <Icon className={cn('w-[18px] h-[18px] shrink-0', activeNow ? 'text-white' : 'text-gray-400 group-hover:text-gray-700')} />
      </Link>
    )
  }

  const groupActive = parentActive || anyChildActive
  return (
    <div>
      <div className={cn(
        'group flex items-center rounded-lg text-sm font-medium transition-colors duration-150',
        groupActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      )}>
        <Link href={item.href} className="flex items-center gap-3 flex-1 px-3 py-2.5 min-w-0">
          <Icon className={cn('w-[18px] h-[18px] shrink-0', groupActive ? 'text-gray-900' : 'text-gray-400 group-hover:text-gray-700')} />
          <span className="truncate">{item.label}</span>
        </Link>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
          className="px-2.5 py-2.5 shrink-0 text-gray-400 hover:text-gray-700"
        >
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', open && 'rotate-180')} />
        </button>
      </div>

      <div className={cn('grid transition-all duration-200 ease-in-out', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <ul className="overflow-hidden mt-0.5 ml-[1.4rem] pl-3 border-l border-gray-200 space-y-0.5">
          {visibleChildren.map(child => {
            const CIcon  = child.icon
            const active = isChildActive(child)
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group/c flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors duration-150',
                    active
                      ? 'bg-gray-900 text-white shadow-sm'
                      : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                  )}
                >
                  <CIcon className={cn('w-3.5 h-3.5 shrink-0', active ? 'text-white' : 'text-gray-400 group-hover/c:text-gray-700')} />
                  <span className="truncate">{child.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

// ─── SidebarContent (needs useSearchParams → wrapped in Suspense) ─────────────

function SidebarContent({ mobileOpen, onMobileClose }) {
  const pathname          = usePathname()
  const searchParams      = useSearchParams()
  const { data: session, status } = useSession()
  const [collapsed, setCollapsed] = useState(false)
  const role = session?.user?.role

  // Restore + persist the collapsed preference across reloads.
  useEffect(() => {
    if (localStorage.getItem('sidebar:collapsed') === '1') setCollapsed(true)
  }, [])
  const setCollapsedPersist = (val) => {
    setCollapsed(val)
    try { localStorage.setItem('sidebar:collapsed', val ? '1' : '0') } catch {}
  }

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
              src="/en-icon.png"
              alt="Enfinito"
              width={32}
              height={32}
              className="w-8 h-8 object-contain block"
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
            onClick={() => setCollapsedPersist(true)}
            title="Collapse sidebar"
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-3 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-200 hover:[&::-webkit-scrollbar-thumb]:bg-gray-300 [&::-webkit-scrollbar-track]:bg-transparent">
        {/* Session still resolving on the client → show a skeleton instead of an empty (blank) sidebar */}
        {status === 'loading' ? (
          <div className="space-y-2 px-1 animate-pulse">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-9 rounded-lg bg-gray-100" />
            ))}
          </div>
        ) : !role ? (
          // Authenticated server-side but the client has no session (cookie didn't arrive / fetch failed)
          (!collapsed || isMobile) && (
            <div className="px-2 py-6 text-center space-y-3">
              <p className="text-xs text-gray-400">Couldn’t load your session.</p>
              <button
                onClick={() => window.location.reload()}
                className="text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-1.5 transition-colors"
              >
                Reload
              </button>
            </div>
          )
        ) : NAV_SECTIONS.map((section) => {
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

      {/* Footer: user identity + collapse toggle */}
      {(() => {
        const showCollapsed = collapsed && !isMobile
        const name    = session?.user?.name || 'User'
        const initial = name.trim().charAt(0).toUpperCase() || 'U'
        const roleLbl = ROLE_LABELS[role] ?? role ?? ''
        return (
          <div className="border-t border-gray-200 p-3 shrink-0">
            {showCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <Link href="/admin/account" title={`${name} · ${roleLbl}`}
                  className="w-9 h-9 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-semibold hover:bg-gray-700 transition-colors">
                  {initial}
                </Link>
                <button
                  onClick={() => setCollapsedPersist(false)}
                  title="Expand sidebar"
                  className="w-full flex justify-center p-2 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Link
                href="/admin/account"
                onClick={isMobile ? onMobileClose : undefined}
                className="flex items-center gap-3 px-1.5 py-1 rounded-lg hover:bg-gray-100 transition-colors group"
                title="My Account"
              >
                <div className="w-9 h-9 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
                  <p className="text-xs text-gray-400 truncate">{roleLbl}</p>
                </div>
                <UserCircle className="w-4 h-4 text-gray-300 group-hover:text-gray-500 shrink-0 transition-colors" />
              </Link>
            )}
          </div>
        )
      })()}
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
