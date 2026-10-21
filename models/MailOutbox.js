import mongoose from 'mongoose'
import { OUTBOX_STATUSES } from '../lib/mail/constants'

// Outgoing message queue. Every send goes through here so "undo send" (short
// delay) and "schedule send" (future sendAt) share one path; the mail worker
// (or /api/cron/mail-sync) dispatches due items.
const MailOutboxSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'MailAccount', required: true },
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },   // who sent it
    status:    { type: String, enum: OUTBOX_STATUSES, default: 'QUEUED' },
    sendAt:    { type: Date, required: true },
    scheduled: { type: Boolean, default: false },   // true = user picked "schedule send" (vs undo delay)

    // Compose payload, exactly as POSTed to /api/mail/send (validated).
    // { to, cc, bcc, subject, html, text, attachments, mode, inReplyToId, draftId }
    payload: { type: mongoose.Schema.Types.Mixed, required: true },

    attempts:  { type: Number, default: 0 },
    lastError: { type: String, default: null },
    sentAt:    { type: Date, default: null },
    sentMessageId: { type: String, default: null },  // RFC Message-ID of the sent mail
    lockedAt:  { type: Date, default: null },         // claimed by a dispatcher
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

MailOutboxSchema.index({ status: 1, sendAt: 1 })
MailOutboxSchema.index({ userId: 1, status: 1, sendAt: 1 })
MailOutboxSchema.index({ accountId: 1, status: 1 })

if (mongoose.models.MailOutbox) delete mongoose.models.MailOutbox
export default mongoose.model('MailOutbox', MailOutboxSchema)
