import mongoose from 'mongoose'
import { SYNC_STATUSES, MAIL_LIMITS } from '../lib/mail/constants'

// A shared mailbox (IMAP + SMTP credentials) added by an admin and assigned to staff.
// `password` holds the AES-256-GCM wire format from lib/encryption (never plaintext)
// and is excluded from queries by default — use lib/mail/credentials to read it.
const ServerSchema = new mongoose.Schema({
  host:   { type: String, required: true, trim: true },
  port:   { type: Number, required: true, min: 1, max: 65535 },
  secure: { type: Boolean, default: true }, // true = TLS on connect, false = STARTTLS
}, { _id: false })

const MailAccountSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },             // label, e.g. "Sales"
    email:    { type: String, required: true, lowercase: true, trim: true },
    fromName: { type: String, default: '', trim: true },
    username: { type: String, required: true, trim: true },             // login (usually the email)
    password: { type: String, required: true, select: false },          // encrypted
    provider: { type: String, default: 'custom' },                      // MAIL_PROVIDERS key
    imap:     { type: ServerSchema, required: true },
    smtp:     { type: ServerSchema, required: true },
    signature: { type: String, default: '' },                           // HTML
    color:     { type: String, default: '#18181b' },

    // Staff (User ids) allowed to use this mailbox. Admins (mail.manage) can use every account.
    assignedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    isActive:    { type: Boolean, default: true },
    syncEnabled: { type: Boolean, default: true },
    options: {
      saveSentCopy:     { type: Boolean, default: true },  // APPEND to Sent after SMTP send
      realtime:         { type: Boolean, default: true },  // keep an IMAP IDLE connection open
      initialSyncLimit: { type: Number, default: MAIL_LIMITS.defaultInitialSync, min: 50, max: 5000 },
    },

    sync: {
      status:        { type: String, enum: SYNC_STATUSES, default: 'PENDING' },
      lastSyncAt:    { type: Date, default: null },
      lastSuccessAt: { type: Date, default: null },
      lastError:     { type: String, default: null },
      lastErrorAt:   { type: Date, default: null },
      idle:          { type: Boolean, default: false },   // live IDLE connection open
      idleSince:     { type: Date, default: null },
      messageCount:  { type: Number, default: 0 },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; delete ret.password; return ret },
    },
  }
)

MailAccountSchema.index({ email: 1 }, { unique: true })
MailAccountSchema.index({ assignedUsers: 1 })
MailAccountSchema.index({ isActive: 1, syncEnabled: 1 })

if (mongoose.models.MailAccount) delete mongoose.models.MailAccount
export default mongoose.model('MailAccount', MailAccountSchema)
