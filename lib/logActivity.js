import { AuditLog } from '@/models'

/**
 * Fire-and-forget activity logger.
 * Never throws — failures are logged to console only.
 *
 * @param {object} opts
 * @param {string}  opts.userId   - Authenticated user's ID
 * @param {string}  opts.userRole - Authenticated user's role
 * @param {string}  opts.action   - e.g. CREATE, UPDATE, DELETE, SEND, STATUS_CHANGE
 * @param {string}  opts.entity   - e.g. INVOICE, PROJECT, CLIENT
 * @param {string}  [opts.entityId]
 * @param {string}  [opts.changes] - JSON-stringified diff or summary
 * @param {Request} [opts.request] - Next.js Request to extract IP / User-Agent from
 */
export function logActivity({ userId, userRole, action, entity, entityId, changes, request }) {
  let ipAddress = null
  let userAgent = null

  if (request) {
    ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    userAgent = request.headers.get('user-agent') ?? null
  }

  AuditLog.create({ userId, userRole, action, entity, entityId: entityId ?? null, changes: changes ?? null, ipAddress, userAgent })
    .catch(err => console.error('[logActivity]', action, entity, err.message))
}
