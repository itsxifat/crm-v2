/**
 * RBAC — Role-Based Access Control
 *
 * Permission naming convention: [module].[feature].[action]
 * Examples: sales.leads.view  |  projects.create  |  hr.roles.manage
 *
 * All permission strings live here as the single source of truth.
 * Both backend (API routes) and frontend (Sidebar, buttons) use these.
 */

// ─── Module / Permission Definitions ─────────────────────────────────────────

export const PERMISSION_MODULES = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    permissions: [
      { key: 'dashboard.view', label: 'View Dashboard' },
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    permissions: [
      { key: 'sales.leads.view',         label: 'View Leads' },
      { key: 'sales.leads.create',       label: 'Create Leads' },
      { key: 'sales.leads.update',       label: 'Edit Leads' },
      { key: 'sales.leads.delete',       label: 'Delete Leads' },
      { key: 'sales.leads.assign',       label: 'Assign Leads' },
      { key: 'sales.customers.view',     label: 'View Customers' },
      { key: 'sales.customers.create',   label: 'Add Customers' },
      { key: 'sales.customers.update',   label: 'Edit Customers' },
      { key: 'sales.customers.delete',   label: 'Delete Customers' },
      { key: 'sales.quotations.view',    label: 'View Quotations' },
      { key: 'sales.quotations.create',  label: 'Create Quotations' },
      { key: 'sales.quotations.update',  label: 'Edit Quotations' },
      { key: 'sales.quotations.delete',  label: 'Delete Quotations' },
      { key: 'sales.quotations.approve', label: 'Approve Quotations' },
      { key: 'sales.invoices.view',      label: 'View Invoices' },
      { key: 'sales.invoices.create',    label: 'Create Invoices' },
      { key: 'sales.invoices.update',    label: 'Edit Invoices' },
      { key: 'sales.invoices.delete',    label: 'Delete Invoices' },
      { key: 'sales.invoices.send',      label: 'Send Invoices' },
    ],
  },
  {
    key: 'projects',
    label: 'Projects & Tasks',
    permissions: [
      { key: 'projects.view',   label: 'View Projects' },
      { key: 'projects.create', label: 'Create Projects' },
      { key: 'projects.update', label: 'Edit Projects' },
      { key: 'projects.delete', label: 'Delete Projects' },
      { key: 'projects.assign', label: 'Assign Projects' },
      { key: 'tasks.view',      label: 'View Tasks' },
      { key: 'tasks.create',    label: 'Create Tasks' },
      { key: 'tasks.update',    label: 'Edit Tasks' },
      { key: 'tasks.delete',    label: 'Delete Tasks' },
      { key: 'tasks.assign',    label: 'Assign Tasks' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    permissions: [
      { key: 'finance.overview.view',       label: 'Finance Overview' },
      { key: 'finance.transactions.view',   label: 'View Transactions' },
      { key: 'finance.transactions.create', label: 'Add Transactions' },
      { key: 'finance.transactions.update', label: 'Edit Transactions' },
      { key: 'finance.transactions.delete', label: 'Delete Transactions' },
      { key: 'finance.payments.request',    label: 'Request Payments' },
      { key: 'finance.payments.confirm',    label: 'Confirm Payments' },
      { key: 'finance.withdrawals.view',    label: 'View Withdrawals' },
      { key: 'finance.withdrawals.approve', label: 'Approve Withdrawals' },
      { key: 'finance.accounts.view',       label: 'View Accounts' },
      { key: 'finance.accounts.manage',     label: 'Manage Accounts' },
      { key: 'finance.reports.view',        label: 'Finance Reports' },
    ],
  },
  {
    key: 'hr',
    label: 'HR & People',
    permissions: [
      { key: 'hr.employees.view',    label: 'View Employees' },
      { key: 'hr.employees.create',  label: 'Add Employees' },
      { key: 'hr.employees.update',  label: 'Edit Employees' },
      { key: 'hr.employees.delete',  label: 'Delete Employees' },
      { key: 'hr.freelancers.manage',label: 'Manage Freelancers' },
      { key: 'hr.vendors.manage',    label: 'Manage Vendors' },
      { key: 'hr.agencies.manage',   label: 'Manage Agencies' },
      { key: 'hr.attendance.view',   label: 'View Attendance' },
      { key: 'hr.attendance.manage', label: 'Manage Attendance' },
      { key: 'hr.leaves.view',       label: 'View Leaves' },
      { key: 'hr.leaves.approve',    label: 'Approve Leaves' },
      { key: 'hr.roles.manage',      label: 'Manage Roles & Permissions' },
    ],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    permissions: [
      { key: 'analytics.reports.view', label: 'View Reports' },
    ],
  },
  {
    key: 'system',
    label: 'System',
    permissions: [
      { key: 'system.config.view',   label: 'View Configuration' },
      { key: 'system.config.update', label: 'Update Configuration' },
      { key: 'system.logs.view',     label: 'View Activity Logs' },
    ],
  },
  {
    key: 'account',
    label: 'Account',
    permissions: [
      { key: 'account.profile.view',       label: 'View Profile' },
      { key: 'account.profile.update',     label: 'Update Profile' },
      { key: 'account.notifications.view', label: 'View Notifications' },
    ],
  },
]

// Flat list of all permission strings (derived from modules above)
export const ALL_PERMISSIONS = PERMISSION_MODULES.flatMap(m => m.permissions.map(p => p.key))

// ─── Default Role Permission Sets ─────────────────────────────────────────────

export const DEFAULT_ROLE_PERMISSIONS = {
  SUPER_ADMIN: ALL_PERMISSIONS,

  MANAGER: [
    'dashboard.view',
    // Sales — full
    'sales.leads.view', 'sales.leads.create', 'sales.leads.update', 'sales.leads.delete', 'sales.leads.assign',
    'sales.customers.view', 'sales.customers.create', 'sales.customers.update', 'sales.customers.delete',
    'sales.quotations.view', 'sales.quotations.create', 'sales.quotations.update', 'sales.quotations.delete', 'sales.quotations.approve',
    'sales.invoices.view', 'sales.invoices.create', 'sales.invoices.update', 'sales.invoices.delete', 'sales.invoices.send',
    // Projects — full
    'projects.view', 'projects.create', 'projects.update', 'projects.delete', 'projects.assign',
    'tasks.view', 'tasks.create', 'tasks.update', 'tasks.delete', 'tasks.assign',
    // Finance — view only + payments
    'finance.overview.view',
    'finance.transactions.view',
    'finance.payments.request', 'finance.payments.confirm',
    'finance.withdrawals.view', 'finance.withdrawals.approve',
    'finance.accounts.view',
    'finance.reports.view',
    // HR — most (no delete employees, no role management by default)
    'hr.employees.view', 'hr.employees.create', 'hr.employees.update',
    'hr.freelancers.manage', 'hr.vendors.manage', 'hr.agencies.manage',
    'hr.attendance.view', 'hr.attendance.manage',
    'hr.leaves.view', 'hr.leaves.approve',
    // Analytics
    'analytics.reports.view',
    // System — view only
    'system.config.view', 'system.logs.view',
    // Account
    'account.profile.view', 'account.profile.update', 'account.notifications.view',
  ],

  EMPLOYEE: [
    'dashboard.view',
    // Sales — leads only, no delete
    'sales.leads.view', 'sales.leads.create', 'sales.leads.update',
    // Projects — view only
    'projects.view',
    // Tasks — full except delete/assign
    'tasks.view', 'tasks.create', 'tasks.update',
    // Finance — payment request only
    'finance.payments.request',
    // HR — own attendance and leaves
    'hr.attendance.view',
    'hr.leaves.view',
    // Account
    'account.profile.view', 'account.profile.update', 'account.notifications.view',
  ],
}

// ─── Permission Check Functions ───────────────────────────────────────────────

/**
 * Check if a flat permissions array contains a specific permission.
 * @param {string[]|null|undefined} permissions
 * @param {string} permission
 * @returns {boolean}
 */
export function hasPermission(permissions, permission) {
  if (!Array.isArray(permissions)) return false
  return permissions.includes(permission)
}

/**
 * Check if a flat permissions array contains ANY of the given permissions.
 * @param {string[]|null|undefined} permissions
 * @param {string[]} permissionList
 * @returns {boolean}
 */
export function hasAnyPermission(permissions, permissionList) {
  if (!Array.isArray(permissions)) return false
  return permissionList.some(p => permissions.includes(p))
}

/**
 * Session-level permission check.
 * - SUPER_ADMIN always passes.
 * - External roles (FREELANCER, CLIENT, VENDOR) always fail admin permissions.
 * - EMPLOYEE / MANAGER with custom role → use their permissions array.
 * - EMPLOYEE / MANAGER without custom role → fall back to DEFAULT_ROLE_PERMISSIONS.
 *
 * @param {object} session — next-auth session object
 * @param {string} permission — e.g. 'sales.leads.create'
 * @returns {boolean}
 */
export function canDo(session, permission) {
  const user = session?.user
  if (!user) return false

  const { role, permissions } = user

  if (role === 'SUPER_ADMIN') return true
  if (['FREELANCER', 'CLIENT', 'VENDOR'].includes(role)) return false

  // Use custom role permissions if assigned
  if (Array.isArray(permissions) && permissions.length > 0) {
    return permissions.includes(permission)
  }

  // Fall back to default role permissions
  return DEFAULT_ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

/**
 * Check if session user has ANY of the given permissions.
 * @param {object} session
 * @param {string[]} permissionList
 * @returns {boolean}
 */
export function canDoAny(session, permissionList) {
  return permissionList.some(p => canDo(session, p))
}

/**
 * Returns a 403 NextResponse if the session lacks the given permission.
 * Returns null if access is granted (proceed normally).
 *
 * Usage in API routes:
 *   const denied = requirePerm(session, 'sales.leads.create')
 *   if (denied) return denied
 *
 * @param {object} session
 * @param {string} permission
 * @returns {NextResponse|null}
 */
export function requirePerm(session, permission) {
  if (!session) {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  if (!canDo(session, permission)) {
    const { NextResponse } = require('next/server')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

/**
 * Get all permissions that belong to a specific top-level module.
 * @param {string} moduleKey — e.g. 'sales', 'finance', 'hr'
 * @returns {string[]}
 */
export function getModulePermissions(moduleKey) {
  const mod = PERMISSION_MODULES.find(m => m.key === moduleKey)
  return mod ? mod.permissions.map(p => p.key) : []
}

/**
 * Get the human-readable label for a permission string.
 * @param {string} permKey
 * @returns {string}
 */
export function getPermissionLabel(permKey) {
  for (const mod of PERMISSION_MODULES) {
    const found = mod.permissions.find(p => p.key === permKey)
    if (found) return found.label
  }
  return permKey
}
