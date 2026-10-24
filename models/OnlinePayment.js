import mongoose from 'mongoose'

/**
 * OnlinePayment — one payment taken online through Enfinito Pay.
 *
 *   source CRM     — a checkout the CRM opened (payment link or client portal).
 *                    `status` follows the checkout at Enfinito Pay.
 *   source ENCLOUD — the customer paid on an encloud link and encloud reported the
 *                    paid due (webhook due.paid). Recorded already PAID.
 *
 * `booking` is the accounting side: the money is booked as a confirmed
 * ProjectPayment (lib/onlinePayments.js bookOnlinePayment). REVIEW means it could
 * not be booked automatically and waits for finance in Payment Confirmations.
 */
const OnlinePaymentSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['ENFINITO_PAY'], default: 'ENFINITO_PAY' },
    source:   { type: String, enum: ['CRM', 'ENCLOUD'], required: true },

    invoiceId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice',     required: true },
    clientId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Client',      default: null },
    projectId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Project',     default: null },
    paymentLinkId: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentLink', default: null },

    amount:     { type: Number, required: true },   // what was asked
    amountPaid: { type: Number, default: null },    // what Enfinito Pay / encloud reported paid
    currency:   { type: String, default: 'BDT' },

    status: {
      type:    String,
      enum:    ['INITIATED', 'FAILED', 'PAID', 'CANCELLED', 'EXPIRED', 'REFUNDED'],
      default: 'INITIATED',
    },

    // ── Enfinito Pay checkout (source CRM) ──
    checkoutId:  { type: String, default: undefined },   // cs_…
    checkoutUrl: { type: String, default: null },
    expiresAt:   { type: Date,   default: null },
    livemode:    { type: Boolean, default: null },

    // ── What Enfinito Pay reported once paid ──
    method:               { type: String, default: null },   // bkash, nagad, visa…
    transactionId:        { type: String, default: null },   // gateway transaction id
    gatewayInvoiceNumber: { type: String, default: null },
    payerMobile:          { type: String, default: null },   // masked by the gateway
    paidAt:               { type: Date,   default: null },

    // ── Paid on an encloud link (source ENCLOUD) ──
    // 'encloud:due:<due id>:<paid_at>' — one row per time a due is paid.
    externalRef:  { type: String, default: undefined },
    encloudDueId: { type: Number, default: null },

    startedVia: { type: String, enum: ['PAYMENT_LINK', 'CLIENT_PORTAL', 'ENCLOUD'], required: true },
    startedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },  // a signed-in client
    payerEmail: { type: String, default: null },

    booking: {
      status: { type: String, enum: ['PENDING', 'BOOKING', 'BOOKED', 'REVIEW'], default: 'PENDING' },
      note:   { type: String, default: null },
      at:     { type: Date,   default: null },
    },
    projectPaymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectPayment', default: null },

    note:  { type: String, default: null },
    // Short trail of what was heard about this payment (webhook / return / reconcile).
    events: [{
      _id:    false,
      type:   { type: String },
      via:    { type: String },
      at:     { type: Date, default: Date.now },
    }],
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

OnlinePaymentSchema.index({ checkoutId: 1 }, { unique: true, partialFilterExpression: { checkoutId: { $type: 'string' } } })
OnlinePaymentSchema.index({ externalRef: 1 }, { unique: true, partialFilterExpression: { externalRef: { $type: 'string' } } })
OnlinePaymentSchema.index({ invoiceId: 1, createdAt: -1 })
OnlinePaymentSchema.index({ status: 1, createdAt: 1 })
OnlinePaymentSchema.index({ 'booking.status': 1, updatedAt: 1 })

if (mongoose.models.OnlinePayment) delete mongoose.models.OnlinePayment
export default mongoose.model('OnlinePayment', OnlinePaymentSchema)
