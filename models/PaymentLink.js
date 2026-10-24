import mongoose from 'mongoose'

/**
 * PaymentLink — a link the customer opens to pay an invoice online
 * (/pay/<token>). It always charges what is still due on the invoice when it is
 * opened, so it never goes stale; it stops working once revoked. One ACTIVE link
 * per invoice: "Create link" hands back the existing one.
 */
const PaymentLinkSchema = new mongoose.Schema(
  {
    // 32 random bytes, base64url. Never selected by default.
    token: { type: String, required: true, select: false },

    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
    clientId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Client',  default: null },

    status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    revokedAt: { type: Date, default: null },

    views:        { type: Number, default: 0 },
    lastViewedAt: { type: Date, default: null },

    sends: [{
      _id:     false,
      channel: { type: String, enum: ['EMAIL', 'WHATSAPP'] },
      to:      { type: String },
      at:      { type: Date, default: Date.now },
      by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    }],
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; delete ret.token; return ret },
    },
  }
)

PaymentLinkSchema.index({ token: 1 }, { unique: true })
// One active link per invoice; revoked ones are kept for the record.
PaymentLinkSchema.index({ invoiceId: 1 }, { name: 'invoice_active_unique', unique: true, partialFilterExpression: { status: 'ACTIVE' } })

if (mongoose.models.PaymentLink) delete mongoose.models.PaymentLink
export default mongoose.model('PaymentLink', PaymentLinkSchema)
