import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

const QuotationSchema = new mongoose.Schema(
  {
    quotationNumber: { type: String, unique: true, sparse: true },

    sourceType: { type: String, enum: ['LEAD', 'CLIENT'], required: true },
    leadId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead',   default: null },
    clientId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },

    // Recipient snapshot — all encrypted
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

    // Mixed — encrypted JSON array
    items: { type: mongoose.Schema.Types.Mixed, default: [] },

    issueDate:  { type: Date, default: Date.now },
    validUntil: { type: Date, default: null },
    sentAt:     { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },

    // Financial — Mixed (encrypted Number)
    subtotal:  { type: mongoose.Schema.Types.Mixed, default: 0 },
    taxRate:   { type: mongoose.Schema.Types.Mixed, default: 0 },
    taxAmount: { type: mongoose.Schema.Types.Mixed, default: 0 },
    discount:  { type: mongoose.Schema.Types.Mixed, default: 0 },
    total:     { type: mongoose.Schema.Types.Mixed, default: 0 },
    currency:  { type: String, default: 'BDT' },

    notes:         { type: String,  default: null },
    terms:         { type: String,  default: null },
    itemPriceOnly: { type: Boolean, default: false },

    createdBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User',      default: null },
    duplicatedFromId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

QuotationSchema.plugin(encryptionPlugin, {
  collection: 'quotations',
  fields: [
    { path: 'recipientName'    },
    { path: 'recipientCompany' },
    { path: 'recipientEmail'   },
    { path: 'recipientPhone'   },
    { path: 'recipientAddress' },
    { path: 'items',           type: 'array'  },
    { path: 'subtotal',        type: 'number' },
    { path: 'taxRate',         type: 'number' },
    { path: 'taxAmount',       type: 'number' },
    { path: 'discount',        type: 'number' },
    { path: 'total',           type: 'number' },
    { path: 'currency'         },
    { path: 'notes'            },
    { path: 'terms'            },
  ],
})

if (mongoose.models.Quotation) delete mongoose.models.Quotation
export default mongoose.model('Quotation', QuotationSchema)
