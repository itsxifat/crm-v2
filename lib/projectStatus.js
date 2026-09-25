// Project status state machine — shared by the /status API and the admin UI so
// both offer / enforce exactly the same transitions.
import { FIXED_STATUSES, MONTHLY_STATUSES } from '@/lib/ventures'

// RENEWED is not reachable through the plain status route: renewing a monthly
// project must go through POST /api/projects/:id/renew, which also creates the
// next-period project and the ProjectRenewal record.
export const PROJECT_TRANSITIONS = {
  PENDING:       ['IN_PROGRESS', 'CANCELLED', 'ON_HOLD'],
  IN_PROGRESS:   ['IN_REVIEW', 'REVISION', 'ON_HOLD', 'CANCELLED'],
  IN_REVIEW:     ['APPROVED', 'REVISION', 'IN_PROGRESS'],
  REVISION:      ['IN_PROGRESS', 'IN_REVIEW'],
  SUBMITTED:     ['FEEDBACK', 'APPROVED', 'REVISION', 'CANCELLED'],
  FEEDBACK:      ['REVISION', 'IN_PROGRESS', 'APPROVED', 'CANCELLED'],
  APPROVED:      ['DELIVERED'],
  DELIVERED:     [],
  ACTIVE:        ['EXPIRING_SOON', 'ON_HOLD', 'CANCELLED'],
  EXPIRING_SOON: ['CANCELLED'],
  RENEWED:       ['ACTIVE', 'EXPIRING_SOON'],
  ON_HOLD:       ['IN_PROGRESS', 'ACTIVE', 'CANCELLED'],
  CANCELLED:     [],
}

// Statuses that belong to each project type's lifecycle (ON_HOLD is shared).
export function lifecycleStatuses(projectType) {
  return projectType === 'MONTHLY' ? [...MONTHLY_STATUSES, 'ON_HOLD'] : [...FIXED_STATUSES, 'ON_HOLD']
}

/** Statuses the plain status route may move this project to. */
export function allowedStatusTransitions(project) {
  const lifecycle = lifecycleStatuses(project?.projectType)
  return (PROJECT_TRANSITIONS[project?.status] ?? []).filter(s => lifecycle.includes(s))
}

/** True when a monthly project can be renewed via POST /api/projects/:id/renew. */
export function canRenewProject(project) {
  return project?.projectType === 'MONTHLY' && ['ACTIVE', 'EXPIRING_SOON'].includes(project?.status)
}
