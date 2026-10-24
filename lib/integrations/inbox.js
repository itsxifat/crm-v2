/**
 * Webhook inbox shared by Enfinito Pay and encloud. Both resend an event until
 * it is acknowledged and may deliver one twice, so each event id runs once: a
 * repeat of a processed event is acknowledged without running again, while a
 * failed one (or one stuck half-way) runs again on the next delivery.
 */
import { IntegrationEvent } from '@/models'

const STUCK_MS = 5 * 60_000

/** @returns {Promise<boolean>} true when this delivery should be processed */
export async function claimEvent(provider, event) {
  try {
    await IntegrationEvent.create({ provider, eventId: String(event.id), type: String(event.type), payload: event, attempts: 1 })
    return true
  } catch (err) {
    if (err?.code !== 11000) throw err
  }
  const retry = await IntegrationEvent.findOneAndUpdate(
    {
      provider, eventId: String(event.id),
      $or: [{ status: 'FAILED' }, { status: 'RECEIVED', updatedAt: { $lt: new Date(Date.now() - STUCK_MS) } }],
    },
    { $set: { status: 'RECEIVED', error: null }, $inc: { attempts: 1 } },
  )
  return !!retry
}

export function finishEvent(provider, event, status, error = null) {
  return IntegrationEvent.updateOne(
    { provider, eventId: String(event.id) },
    { $set: { status, error: error ? String(error).slice(0, 500) : null, processedAt: new Date() } },
  )
}
