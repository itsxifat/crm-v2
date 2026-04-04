import connectDB from '@/lib/mongodb'
import { Notification } from '@/models'

/**
 * Create a notification for one or more users.
 *
 * @param {Object|Object[]} opts
 * @param {string|string[]} opts.userId  - Recipient user ID(s)
 * @param {string}          opts.title   - Short heading
 * @param {string}          opts.message - Body text
 * @param {string}          opts.type    - e.g. 'TASK', 'INVOICE', 'PAYMENT', 'QUOTATION', 'LEAVE', 'GENERAL'
 * @param {string}          [opts.link]  - Optional link to navigate to
 */
export async function createNotification({ userId, title, message, type, link = null }) {
  try {
    await connectDB()
    const userIds = Array.isArray(userId) ? userId : [userId]
    const docs = userIds
      .filter(Boolean)
      .map(uid => ({ userId: uid, title, message, type, link, isRead: false }))
    if (docs.length) await Notification.insertMany(docs)
  } catch (err) {
    // Non-critical — log but never throw
    console.error('[createNotification]', err)
  }
}
