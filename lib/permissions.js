/**
 * Permission definitions for each role in EN-CRM.
 *
 * Structure:
 *   PERMISSIONS[role][resource] = { action: boolean, ... }
 *
 * Usage:
 *   can('MANAGER', 'leads', 'delete')  // → false
 *   canAny(['SUPER_ADMIN','MANAGER'], 'invoices', 'create')
 */

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  MANAGER:     'MANAGER',
  EMPLOYEE:    'EMPLOYEE',
  FREELANCER:  'FREELANCER',
  CLIENT:      'CLIENT',
  VENDOR:      'VENDOR',
}

// Helper that produces a full CRUD object
const crud = (c, r, u, d) => ({ create: c, read: r, update: u, delete: d })

// Full access shorthand
const full   = () => crud(true, true, true, true)
// Read-only shorthand
const ro     = () => crud(false, true, false, false)
// No access
const none   = () => crud(false, false, false, false)

export const PERMISSIONS = {
  SUPER_ADMIN: {
    users:         full(),
    leads:         full(),
    clients:       full(),
    projects:      full(),
    tasks:         full(),
    invoices:      full(),
    payments:      full(),
    transactions:  full(),
    employees:     full(),
    freelancers:   full(),
    vendors:       full(),
    agreements:    full(),
    documents:     full(),
    reports:       full(),
    settings:      full(),
    messages:      full(),
    notifications: full(),
    attendance:    full(),
    leaves:        full(),
    timesheets:    full(),
    withdrawals:   full(),
    earnings:      full(),
    milestones:    full(),
    comments:      full(),
    auditLogs:     ro(),
  },

  MANAGER: {
    users:         crud(true,  true,  true,  false),
    leads:         full(),
    clients:       full(),
    projects:      full(),
    tasks:         full(),
    invoices:      full(),
    payments:      crud(true, true, true, false),
    transactions:  full(),
    employees:     crud(true, true, true, false),
    freelancers:   full(),
    vendors:       full(),
    agreements:    full(),
    documents:     full(),
    reports:       ro(),
    settings:      crud(false, true, true, false),
    messages:      full(),
    notifications: full(),
    attendance:    full(),
    leaves:        full(),
    timesheets:    full(),
    withdrawals:   crud(false, true, true, false),
    earnings:      full(),
    milestones:    full(),
    comments:      full(),
    auditLogs:     ro(),
  },

  EMPLOYEE: {
    users:         crud(false, false, false, false),
    leads:         crud(true,  true,  true,  false),
    clients:       ro(),
    projects:      ro(),
    tasks:         crud(true, true, true, false),
    invoices:      ro(),
    payments:      none(),
    transactions:  none(),
    employees:     none(),
    freelancers:   none(),
    vendors:       none(),
    agreements:    ro(),
    documents:     crud(true, true, false, false),
    reports:       none(),
    settings:      none(),
    messages:      full(),
    notifications: full(),
    attendance:    crud(true, true, false, false),
    leaves:        crud(true, true, false, false),
    timesheets:    crud(true, true, true, false),
    withdrawals:   none(),
    earnings:      none(),
    milestones:    ro(),
    comments:      full(),
    auditLogs:     none(),
  },

  FREELANCER: {
    users:         none(),
    leads:         none(),
    clients:       none(),
    projects:      ro(),
    tasks:         crud(false, true, true, false),
    invoices:      none(),
    payments:      none(),
    transactions:  none(),
    employees:     none(),
    freelancers:   crud(false, true, true, false), // own profile only
    vendors:       none(),
    agreements:    ro(),
    documents:     crud(true, true, false, false),
    reports:       none(),
    settings:      none(),
    messages:      full(),
    notifications: full(),
    attendance:    none(),
    leaves:        none(),
    timesheets:    crud(true, true, true, false),
    withdrawals:   crud(true, true, false, false),
    earnings:      ro(),
    milestones:    ro(),
    comments:      full(),
    auditLogs:     none(),
  },

  CLIENT: {
    users:         none(),
    leads:         none(),
    clients:       crud(false, true, true, false), // own profile only
    projects:      ro(),
    tasks:         ro(),
    invoices:      ro(),
    payments:      none(),
    transactions:  none(),
    employees:     none(),
    freelancers:   none(),
    vendors:       none(),
    agreements:    ro(),
    documents:     ro(),
    reports:       none(),
    settings:      none(),
    messages:      full(),
    notifications: full(),
    attendance:    none(),
    leaves:        none(),
    timesheets:    none(),
    withdrawals:   none(),
    earnings:      none(),
    milestones:    ro(),
    comments:      crud(true, true, false, false),
    auditLogs:     none(),
  },

  VENDOR: {
    users:         none(),
    leads:         none(),
    clients:       none(),
    projects:      ro(),
    tasks:         none(),
    invoices:      none(),
    payments:      none(),
    transactions:  none(),
    employees:     none(),
    freelancers:   none(),
    vendors:       crud(false, true, true, false), // own profile only
    agreements:    ro(),
    documents:     crud(true, true, false, false),
    reports:       none(),
    settings:      none(),
    messages:      full(),
    notifications: full(),
    attendance:    none(),
    leaves:        none(),
    timesheets:    none(),
    withdrawals:   none(),
    earnings:      none(),
    milestones:    none(),
    comments:      none(),
    auditLogs:     none(),
  },
}

// ---------------------------------------------------------------------------
// Permission check functions
// ---------------------------------------------------------------------------

/**
 * Check if a role can perform an action on a resource.
 * @param {string} role
 * @param {string} resource
 * @param {'create'|'read'|'update'|'delete'} action
 * @returns {boolean}
 */
export function can(role, resource, action) {
  return PERMISSIONS[role]?.[resource]?.[action] === true
}

/**
 * Check if ANY of the provided roles can perform the action.
 * @param {string[]} roles
 * @param {string}   resource
 * @param {string}   action
 * @returns {boolean}
 */
export function canAny(roles, resource, action) {
  return roles.some((r) => can(r, resource, action))
}

/**
 * Check if a role has full CRUD access to a resource.
 * @param {string} role
 * @param {string} resource
 * @returns {boolean}
 */
export function hasFullAccess(role, resource) {
  const p = PERMISSIONS[role]?.[resource]
  return p ? p.create && p.read && p.update && p.delete : false
}

/**
 * Returns all allowed actions for a role on a resource.
 * @param {string} role
 * @param {string} resource
 * @returns {string[]}
 */
export function getAllowedActions(role, resource) {
  const p = PERMISSIONS[role]?.[resource] ?? {}
  return Object.entries(p)
    .filter(([, allowed]) => allowed)
    .map(([action]) => action)
}

/**
 * Determine if a role is an internal (staff) role.
 */
export function isInternalRole(role) {
  return [ROLES.SUPER_ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE].includes(role)
}

/**
 * Determine if a role is an external (non-staff) role.
 */
export function isExternalRole(role) {
  return [ROLES.CLIENT, ROLES.FREELANCER, ROLES.VENDOR].includes(role)
}
