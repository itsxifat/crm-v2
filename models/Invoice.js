import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

const InvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, unique: true, sparse: true },

    clientId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Client',  required: true },
    projectId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    projectIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],

    status: {
      type:    String,
      enum:    ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'],
      default: 'DRAFT',
    },

    // Mixed — encrypted JSON array (items contain financial data)
    items: { type: mongoose.Schema.Types.Mixed, default: [] },

    issueDate: { type: Date, default: Date.now },
    dueDate:   { type: Date, default: null },
    sentAt:    { type: Date, default: null },
    paidAt:    { type: Date, default: null },

    // Financial — Mixed (encrypted Number)
    subtotal:   { type: mongoose.Schema.Types.Mixed, default: 0 },
    taxRate:    { type: mongoose.Schema.Types.Mixed, default: 0 },
    taxAmount:  { type: mongoose.Schema.Types.Mixed, default: 0 },
    discount:   { type: mongoose.Schema.Types.Mixed, default: 0 },
    total:      { type: mongoose.Schema.Types.Mixed, default: 0 },
    paidAmount: { type: mongoose.Schema.Types.Mixed, default: 0 },
    currency:   { type: String, default: 'BDT' },

    notes:    { type: String, default: null },
    terms:    { type: String, default: null },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

InvoiceSchema.pre('validate', async function () {
  if (this.invoiceNumber) return
  const now    = new Date()
  const yymm   = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `ENV-${yymm}A`
  const count  = await mongoose.model('Invoice').countDocuments({ invoiceNumber: { $regex: `^${prefix}` } })
  this.invoiceNumber = `${prefix}${String(count + 1).padStart(3, '0')}`
})

InvoiceSchema.index({ projectId: 1 }, { unique: true, sparse: true })

InvoiceSchema.plugin(encryptionPlugin, {
  collection: 'invoices',
  fields: [
    { path: 'items',      type: 'array'  },
    { path: 'subtotal',   type: 'number' },
    { path: 'taxRate',    type: 'number' },
    { path: 'taxAmount',  type: 'number' },
    { path: 'discount',   type: 'number' },
    { path: 'total',      type: 'number' },
    { path: 'paidAmount', type: 'number' },
    { path: 'currency'    },
    { path: 'notes'       },
    { path: 'terms'       },
  ],
})

if (mongoose.models.Invoice) delete mongoose.models.Invoice
export default mongoose.model('Invoice', InvoiceSchema)
