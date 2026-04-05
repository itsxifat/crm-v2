'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import { sessionCan } from '@/lib/permissions'
import {
  LayoutDashboard, Users, UserCheck, Briefcase, ClipboardList,
  FileText, DollarSign, TrendingUp, Settings, Settings2,
  Calendar, Clock, FolderOpen, FileSignature,
  BarChart3, UserCog, Building2, ChevronLeft, ChevronRight,
  ArrowRightLeft, ArrowDownLeft, ArrowUpRight as ArrowUpRightIcon,
  CheckCircle, Inbox, ChevronDown, ShieldCheck, Activity, Bell, UserCircle,
} from 'lucide-react'
import Image from 'next/image'
import { useState } from 'react'

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

// permKey maps to CustomRole.permissions module keys.
// If set, EMPLOYEE visibility is also gated by sessionCan(user, permKey, 'view').
// SUPER_ADMIN and MANAGER always see all items in their roles array.

const NAV_SECTIONS = [
  {
    label: 'Main',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permKey: 'dashboard' },
    ],
  },
  {
    label: 'CRM',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/leads',   label: 'Leads',   icon: TrendingUp, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permKey: 'leads' },
      { href: '/admin/clients', label: 'Clients', icon: UserCheck,  roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permKey: 'clients' },
    ],
  },
  {
    label: 'Work',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/projects', label: 'Projects', icon: Briefcase,     roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permKey: 'projects' },
      { href: '/admin/tasks',    label: 'Tasks',    icon: ClipboardList, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'] },
    ],
  },
  {
    label: 'Finance',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      {
        href: '/admin/invoices',
        label: 'Invoices',
        icon: FileText,
        roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
        permKey: 'invoices',
      },
      {
        href: '/admin/quotations',
        label: 'Quotations',
        icon: FileSignature,
        roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
      },
      {
        href: '/admin/accounts',
        label: 'Accounts',
        icon: DollarSign,
        roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
        permKey: 'accounts',
        children: [
          {
            href: '/admin/accounts?tab=transactions',
            tab: 'transactions',
            label: 'Transactions',
            icon: ArrowRightLeft,
            roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
            permKey: 'accounts',
          },
          {
            href: '/admin/accounts?tab=income',
            tab: 'income',
            label: 'Income',
            icon: ArrowDownLeft,
            roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
            permKey: 'accounts',
          },
          {
            href: '/admin/accounts?tab=expense',
            tab: 'expense',
            label: 'Expense',
            icon: ArrowUpRightIcon,
            roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
            permKey: 'accounts',
          },
          {
            href: '/admin/accounts?tab=confirmations',
            tab: 'confirmations',
            label: 'Payment Confirmations',
            icon: CheckCircle,
            roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
            permKey: 'accounts',
          },
          {
            href: '/admin/accounts?tab=requests',
            tab: 'requests',
            label: 'Payment Requests',
            icon: Inbox,
            roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
          },
        ],
      },
    ],
  },
  {
    label: 'People',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/employees',   label: 'Employees',           icon: Users,       roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permKey: 'employees' },
      { href: '/admin/freelancers', label: 'Freelancers', icon: UserCog,   roles: ['SUPER_ADMIN', 'MANAGER'] },
      { href: '/admin/vendors',     label: 'Vendors',     icon: Building2, roles: ['SUPER_ADMIN', 'MANAGER'] },
      { href: '/admin/roles',       label: 'Roles & Permissions', icon: ShieldCheck, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'], permKey: 'roles' },
    ],
  },
  {
    label: 'HR',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/attendance', label: 'Attendance', icon: Calendar, roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'] },
      { href: '/admin/leaves',     label: 'Leaves',     icon: Clock,    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'] },
    ],
  },
  {
    label: 'Documents',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/agreements', label: 'Agreements', icon: FileSignature, roles: ['SUPER_ADMIN', 'MANAGER'] },
      { href: '/admin/documents',  label: 'Documents',  icon: FolderOpen,    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'] },
    ],
  },
  {
    label: 'Analytics',
    roles: ['SUPER_ADMIN', 'MANAGER'],
    items: [
      { href: '/admin/reports', label: 'Reports', icon: BarChart3, roles: ['SUPER_ADMIN', 'MANAGER'] },
    ],
  },
  {
    label: 'System',
    roles: ['SUPER_ADMIN', 'MANAGER'],
    items: [
      { href: '/admin/activity-logs', label: 'Activity Logs',  icon: Activity,  roles: ['SUPER_ADMIN', 'MANAGER'] },
      { href: '/admin/config',        label: 'Configuration',  icon: Settings2, roles: ['SUPER_ADMIN'] },
      { href: '/admin/settings',      label: 'Settings',       icon: Settings,  roles: ['SUPER_ADMIN'] },
    ],
  },
  {
    label: 'Account',
    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'],
    items: [
      { href: '/admin/profile',       label: 'My Profile',    icon: UserCircle, roles: ['EMPLOYEE'] },
      { href: '/admin/account',       label: 'My Account',    icon: UserCog,    roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'] },
      { href: '/admin/notifications', label: 'Notifications', icon: Bell,       roles: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'] },
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
    if (role === 'EMPLOYEE' && c.permKey && sessionUser?.permissions) {
      return sessionCan(sessionUser, c.permKey, 'view')
    }
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const pathname          = usePathname()
  const searchParams      = useSearchParams()
  const { data: session } = useSession()
  const [collapsed, setCollapsed] = useState(false)
  const role = session?.user?.role

  function isActive(item) {
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }

  function itemVisible(item) {
    if (!item.roles.includes(role)) return false
    // For EMPLOYEE with a custom role, check permKey if present
    if (role === 'EMPLOYEE' && item.permKey && session?.user?.permissions) {
      return sessionCan(session.user, item.permKey, 'view')
    }
    return true
  }

  return (
    <aside
      className={cn(
        'h-screen bg-white border-r border-gray-200 flex flex-col transition-all duration-300 ease-in-out shrink-0',
        collapsed ? 'w-16' : 'w-[260px]'
      )}
    >
      {/* Logo */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 shrink-0">
        {!collapsed && (
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
        {collapsed && (
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
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {NAV_SECTIONS.map((section) => {
          if (!section.roles.includes(role)) return null

          const visibleItems = section.items.filter(item => itemVisible(item))
          if (visibleItems.length === 0) return null

          return (
            <div key={section.label} className="mb-4">
              {!collapsed && (
                <p className="text-2xs font-semibold text-gray-400 uppercase tracking-wider px-3 mb-1">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {visibleItems.map((item) => (
                  <li key={item.href}>
                    {item.children ? (
                      <NavGroup
                        item={item}
                        role={role}
                        sessionUser={session?.user}
                        pathname={pathname}
                        searchParams={searchParams}
                        collapsed={collapsed}
                      />
                    ) : (
                      <NavItem item={item} active={isActive(item)} collapsed={collapsed} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

      </nav>

      {/* Collapse toggle */}
      {collapsed && (
        <div className="px-3 pb-4">
          <button
            onClick={() => setCollapsed(false)}
            className="w-full flex justify-center p-2.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-900 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </aside>
  )
}
