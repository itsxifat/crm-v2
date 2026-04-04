import mongoose from 'mongoose'

const QuotationItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  venture:     { type: String, default: null },
  service:     { type: String, default: null },
  quantity:    { type: Number, required: true, default: 1 },
  rate:        { type: Number, required: true },
  amount:      { type: Number, required: true },
}, { _id: true })

const QuotationSchema = new mongoose.Schema(
  {
    quotationNumber: { type: String, unique: true, sparse: true },

    // Source — one of these will be set
    sourceType: { type: String, enum: ['LEAD', 'CLIENT'], required: true },
    leadId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead',   default: null },
    clientId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },

    // Snapshot of recipient info at creation time
    recipientName:    { type: String, default: null },
    recipientCompany: { type: String, default: null },
    recipientEmail:   { type: String, default: null },
    recipientPhone:   { type: String, default: null },
    recipientAddress: { type: String, default: null },

    status: {
      type:    String,
      enum:    ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'],
      default: 'DRAFT',
    },

    items:    { type: [QuotationItemSchema], default: [] },

    issueDate:  { type: Date, default: Date.now },
    validUntil: { type: Date, default: null },

    subtotal:  { type: Number, default: 0 },
    taxRate:   { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    discount:  { type: Number, default: 0 },
    total:     { type: Number, default: 0 },
    currency:  { type: String, default: 'BDT' },

    notes:       { type: String, default: null },
    terms:       { type: String, default: null },

    sentAt:     { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },

    createdBy:             { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    duplicatedFromId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// Auto-generate quotation number: ENFQO-YYMMAXXXX
QuotationSchema.pre('validate', async function () {
  if (this.quotationNumber) return
  const now    = new Date()
  const yymm   = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `ENFQO-${yymm}A`
  const count  = await mongoose.model('Quotation').countDocuments({
    quotationNumber: { $regex: `^${prefix}` },
  })
  this.quotationNumber = `${prefix}${String(count + 1).padStart(3, '0')}`
})

if (mongoose.models.Quotation) delete mongoose.models.Quotation
export default mongoose.model('Quotation', QuotationSchema)
