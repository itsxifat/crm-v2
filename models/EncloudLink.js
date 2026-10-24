import mongoose from 'mongoose'

/**
 * EncloudLink — what the CRM knows about one record in encloud (Enfinito's
 * client-file drive). lib/encloud/sync.js keeps them in step.
 *
 *   CLIENT  — the client's folder (Clients/<name>)
 *   PROJECT — the project's folder inside it
 *   DUE     — an unpaid invoice, which locks the client's files in encloud
 *             until it is paid. Its encloud id is the invoice id.
 *
 * DUE state:
 *   target — what the CRM is trying to make the due (set before each push)
 *   pushed — what encloud confirmed for the last push
 *   remote — the due as encloud last described it (API answer or webhook), as of `asOf`
 *   pushes — the last few pushes, to tell encloud's echoes of them from changes made there
 * A push happens only when the invoice's wanted state differs from `pushed`, so a
 * change made in encloud (a due waived or reopened there) stands until the
 * invoice itself changes in the CRM.
 */
const EncloudLinkSchema = new mongoose.Schema(
  {
    kind:  { type: String, enum: ['CLIENT', 'PROJECT', 'DUE'], required: true },
    refId: { type: mongoose.Schema.Types.ObjectId, required: true },  // Client / Project / Invoice _id

    // CLIENT / PROJECT
    folderId:   { type: String, default: null },
    folderUrl:  { type: String, default: null },   // staff link (encloud sign-in)
    pushedHash: { type: String, default: null },   // hash of the last name/email/status sent

    // DUE
    target: { type: mongoose.Schema.Types.Mixed, default: null },  // { status, amount, clientId, projectId, reference, description }
    pushed: { type: mongoose.Schema.Types.Mixed, default: null },
    remote: { type: mongoose.Schema.Types.Mixed, default: null },  // { status, amount, paidVia, paidAt, asOf }
    // The CRM's own recent pushes (status + when), so encloud's event about one of
    // them is recognised as an echo even when it arrives late, after a newer push.
    pushes: [{
      _id:    false,
      status: { type: String },
      from:   { type: Date },
      to:     { type: Date, default: null },
    }],
    // AUTO — lock while unpaid. OFF — staff chose not to lock this invoice (in the CRM or in encloud).
    mode:      { type: String, enum: ['AUTO', 'OFF'], default: 'AUTO' },
    offReason: { type: String, default: null },
    offBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    offAt:     { type: Date, default: null },

    syncedAt:      { type: Date,   default: null },
    error:         { type: String, default: null },
    errorAt:       { type: Date,   default: null },
    attempts:      { type: Number, default: 0 },
    nextAttemptAt: { type: Date,   default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

EncloudLinkSchema.index({ kind: 1, refId: 1 }, { unique: true })
EncloudLinkSchema.index({ kind: 1, nextAttemptAt: 1 })

if (mongoose.models.EncloudLink) delete mongoose.models.EncloudLink
export default mongoose.model('EncloudLink', EncloudLinkSchema)
