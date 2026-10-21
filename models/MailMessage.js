import mongoose from 'mongoose'

// Local index of one IMAP message (identified by folder + uidValidity + uid).
// Bodies are cached lazily (`bodyFetched`); `html` / `text` are excluded from
// queries by default — select('+html +text') when reading a message.
const AddressSchema = new mongoose.Schema({
  name:    { type: String, default: '' },
  address: { type: String, default: '' },  // lowercased
}, { _id: false })

const AttachmentSchema = new mongoose.Schema({
  idx:         { type: Number, required: true },   // stable index within the message
  part:        { type: String, default: null },    // IMAP body part id (e.g. "2", "1.2") for direct download
  filename:    { type: String, default: 'attachment' },
  contentType: { type: String, default: 'application/octet-stream' },
  size:        { type: Number, default: 0 },
  cid:         { type: String, default: null },    // Content-ID without <>, for inline images
  inline:      { type: Boolean, default: false },
}, { _id: false })

const MailMessageSchema = new mongoose.Schema(
  {
    accountId:   { type: mongoose.Schema.Types.ObjectId, ref: 'MailAccount', required: true },
    folderId:    { type: mongoose.Schema.Types.ObjectId, ref: 'MailFolder', required: true },
    folderPath:  { type: String, required: true },
    folderRole:  { type: String, default: 'CUSTOM' },  // denormalised MailFolder.role
    uid:         { type: Number, required: true },
    uidValidity: { type: String, required: true },

    messageId:  { type: String, default: null },       // normalised: lowercased, no <>
    inReplyTo:  { type: String, default: null },
    references: [{ type: String }],
    threadKey:  { type: String, default: null },       // root message-id of the conversation

    subject: { type: String, default: '' },
    snippet: { type: String, default: '' },            // ≤ 200 chars of plain text
    from:    { type: AddressSchema, default: () => ({}) },
    to:      [AddressSchema],
    cc:      [AddressSchema],
    bcc:     [AddressSchema],
    replyTo: [AddressSchema],
    date:       { type: Date, default: null },         // header Date (falls back to internal date)
    receivedAt: { type: Date, default: null },         // IMAP INTERNALDATE

    seen:     { type: Boolean, default: false },
    flagged:  { type: Boolean, default: false },
    answered: { type: Boolean, default: false },
    draft:    { type: Boolean, default: false },
    flags:    [{ type: String }],                      // raw IMAP flags / keywords

    size:           { type: Number, default: 0 },
    hasAttachments: { type: Boolean, default: false },
    attachments:    [AttachmentSchema],
    priority:        { type: String, enum: ['high', 'normal', 'low'], default: 'normal' },
    listUnsubscribe: { type: String, default: null },

    bodyFetched: { type: Boolean, default: false },
    html: { type: String, default: null, select: false },   // raw (unsanitised) HTML; sanitise on read
    text: { type: String, default: null, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { if (ret._id != null) ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

MailMessageSchema.index({ folderId: 1, uidValidity: 1, uid: 1 }, { unique: true })
MailMessageSchema.index({ folderId: 1, date: -1 })
MailMessageSchema.index({ accountId: 1, folderRole: 1, date: -1 })
MailMessageSchema.index({ accountId: 1, folderId: 1, seen: 1 })
MailMessageSchema.index({ accountId: 1, flagged: 1, date: -1 })
MailMessageSchema.index({ accountId: 1, threadKey: 1 })
MailMessageSchema.index({ accountId: 1, messageId: 1 })
MailMessageSchema.index({ createdAt: -1 })
MailMessageSchema.index({ 'from.address': 1 })

if (mongoose.models.MailMessage) delete mongoose.models.MailMessage
export default mongoose.model('MailMessage', MailMessageSchema)
