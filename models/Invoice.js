import mongoose from 'mongoose'

const InvoiceItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  quantity:    { type: Number, required: true, default: 1 },
  rate:        { type: Number, required: true },
  amount:      { type: Number, required: true },  // quantity * rate
}, { _id: true, toJSON: { virtuals: true, transform(_, ret) { ret.id = ret._id?.toString(); delete ret._id; return ret } } })

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, unique: true, sparse: true },

    clientId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Client',  required: true },
    // One invoice per project — enforced by unique sparse index
    projectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    projectIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],  // legacy / kept for compat

    status: {
      type:    String,
      enum:    ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
      default: 'DRAFT',
    },

    items:     [InvoiceItemSchema],

    issueDate: { type: Date, default: Date.now },
    dueDate:   { type: Date, default: null },

    subtotal:   { type: Number, required: true, default: 0 },
    taxRate:    { type: Number, default: 0 },
    taxAmount:  { type: Number, default: 0 },
    discount:   { type: Number, default: 0 },
    total:      { type: Number, required: true, default: 0 },
    paidAmount: { type: Number, default: 0 },
    currency:   { type: String, default: 'BDT' },

    notes:      { type: String, default: null },
    terms:      { type: String, default: null },

    sentAt:     { type: Date, default: null },
    paidAt:     { type: Date, default: null },

    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// Auto-generate invoiceNumber: ENV-YYMMAXXX (sequential per month)
InvoiceSchema.pre('validate', async function () {
  if (this.invoiceNumber) return
  const now    = new Date()
  const yymm   = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `ENV-${yymm}A`
  const count  = await mongoose.model('Invoice').countDocuments({
    invoiceNumber: { $regex: `^${prefix}` }
  })
  this.invoiceNumber = `${prefix}${String(count + 1).padStart(3, '0')}`
})

// Unique: one invoice per project
InvoiceSchema.index({ projectId: 1 }, { unique: true, sparse: true })

if (mongoose.models.Invoice)     delete mongoose.models.Invoice
if (mongoose.models.InvoiceItem) delete mongoose.models.InvoiceItem

export const InvoiceItem = mongoose.model('InvoiceItem', InvoiceItemSchema)
export default mongoose.model('Invoice', InvoiceSchema)
