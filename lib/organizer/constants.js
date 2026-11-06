// Organizer — shared server-side constants. Dependency-free (models import it).
// The client-side twin (class maps, labels) lives in components/organizer/constants.js.

export const PALETTE_KEYS = ['zinc', 'blue', 'emerald', 'amber', 'red', 'violet', 'pink', 'teal', 'orange', 'indigo']

export const ORGANIZER_STATUSES = ['ACTIVE', 'ARCHIVED']
export const REPEAT_VALUES      = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
export const TODO_STATUSES      = ['OPEN', 'IN_PROGRESS', 'DONE']
export const TODO_PRIORITIES    = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

/** Numeric rank stored alongside priority so it sorts (LOW 1 … URGENT 4). */
export const PRIORITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 }
export const STATUS_RANK   = { OPEN: 1, IN_PROGRESS: 2, DONE: 3 }

export const TAG_MAX_COUNT  = 10
export const TAG_MAX_LENGTH = 30

/** Hard caps for list endpoints. */
export const ORGANIZER_LIST_CAP   = 500
export const EVENT_SPAN_MAX_DAYS  = 400
export const DEFAULT_PAGE_LIMIT   = 100
export const MAX_PAGE_LIMIT       = 500

/** AuditLog entity names. */
export const ENTITY = {
  ORGANIZER: 'ORGANIZER',
  CALENDAR:  'ORGANIZER_CALENDAR',
  EVENT:     'ORGANIZER_EVENT',
  LIST:      'ORGANIZER_TODO_LIST',
  TODO:      'ORGANIZER_TODO',
  NOTE:      'ORGANIZER_NOTE',
}
