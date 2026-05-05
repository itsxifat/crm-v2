import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

const CommentSchema = new mongoose.Schema(
  {
    text:       { type: String, required: true },
    authorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true, transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; return ret } },
  }
)

const LeadActivitySchema = new mongoose.Schema(
  {
    leadId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    type:          { type: String, required: true },   // encrypted
    note:          { type: String, required: true },   // encrypted
    createdById:   { type: String, required: true },
    createdByName: { type: String, default: null },    // encrypted
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true, transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret } },
  }
)

const LeadSchema = new mongoose.Schema(
  {
    // All contact / business data stored encrypted
    name:             { type: String, required: true, trim: true },
    designation:      { type: String, default: null },
    email:            { type: String, default: null },
    phone:            { type: String, default: null },
    alternativePhone: { type: String, default: null },
    company:          { type: String, default: null },
    location:         { type: String, default: null },

    status: {
      type:    String,
      enum:    ['NEW', 'CONTACTED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST'],
      default: 'NEW',
    },
    priority: {
      type:    String,
      enum:    ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
      default: 'NORMAL',
    },

    // Content fields — encrypted
    category:    { type: String, default: null },
    subcategory: { type: String, default: null },
    service:     { type: String, default: null },
    source:      { type: String, default: null },
    platform:    { type: String, default: null },
    reference:   { type: String, default: null },
    referenceType:{ type: String, enum: ['CLIENT', 'EMPLOYEE', 'LEAD', null], default: null },
    referenceId:  { type: String, default: null },
    // Mixed — encrypted array
    links:        { type: mongoose.Schema.Types.Mixed, default: [] },

    sendingDate:  { type: Date, default: null },
    followUpDate: { type: Date, default: null },

    // Financial — encrypted Number
    value:        { type: mongoose.Schema.Types.Mixed, default: null },
    notes:        { type: String, default: null },
    assignedToId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    lostReason:   { type: String, default: null },
    convertedAt:  { type: Date, default: null },
    // Mixed — encrypted JSON array
    comments:        { type: mongoose.Schema.Types.Mixed, default: [] },
    businessCategory: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

LeadSchema.index({ status: 1, priority: 1 })
LeadSchema.index({ assignedToId: 1 })

LeadSchema.plugin(encryptionPlugin, {
  collection: 'leads',
  fields: [
    { path: 'name'             },
    { path: 'designation'      },
    { path: 'email'            },
    { path: 'phone'            },
    { path: 'alternativePhone' },
    { path: 'company'          },
    { path: 'location'         },
    { path: 'category'         },
    { path: 'subcategory'      },
    { path: 'service'          },
    { path: 'source'           },
    { path: 'platform'         },
    { path: 'reference'        },
    { path: 'referenceId'      },
    { path: 'links',           type: 'array'  },
    { path: 'value',           type: 'number' },
    { path: 'notes'            },
    { path: 'lostReason'       },
    { path: 'comments',        type: 'array'  },
    { path: 'businessCategory' },
  ],
})

LeadActivitySchema.plugin(encryptionPlugin, {
  collection: 'leadactivities',
  fields: [
    { path: 'type'          },
    { path: 'note'          },
    { path: 'createdByName' },
  ],
})

export const LeadActivity = mongoose.models.LeadActivity ?? mongoose.model('LeadActivity', LeadActivitySchema)
export default mongoose.models.Lead ?? mongoose.model('Lead', LeadSchema)
