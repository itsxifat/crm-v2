import mongoose from 'mongoose'
import { FOLDER_ROLES } from '../lib/mail/constants'

// One IMAP mailbox (folder) of a MailAccount plus its sync cursor.
// uidValidity / highestModseq are IMAP 64-bit values, stored as strings.
const MailFolderSchema = new mongoose.Schema(
  {
    accountId:  { type: mongoose.Schema.Types.ObjectId, ref: 'MailAccount', required: true },
    path:       { type: String, required: true },          // full IMAP path, e.g. "INBOX/Clients"
    name:       { type: String, required: true },          // display name (last path segment)
    parentPath: { type: String, default: null },
    delimiter:  { type: String, default: '/' },
    role:       { type: String, enum: FOLDER_ROLES, default: 'CUSTOM' },
    specialUse: { type: String, default: null },           // raw flag, e.g. "\\Sent"
    noSelect:   { type: Boolean, default: false },
    subscribed: { type: Boolean, default: true },

    // Sync state
    uidValidity:   { type: String, default: null },
    uidNext:       { type: Number, default: null },
    highestModseq: { type: String, default: null },
    lastUid:       { type: Number, default: 0 },           // highest UID stored locally
    oldestUid:     { type: Number, default: null },        // lowest UID stored locally (for "load older")
    total:         { type: Number, default: 0 },           // messages on the server
    unread:        { type: Number, default: 0 },           // unseen on the server
    lastSyncAt:    { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

MailFolderSchema.index({ accountId: 1, path: 1 }, { unique: true })
MailFolderSchema.index({ accountId: 1, role: 1 })

if (mongoose.models.MailFolder) delete mongoose.models.MailFolder
export default mongoose.model('MailFolder', MailFolderSchema)
