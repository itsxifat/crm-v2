import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

const SocialLinkSchema = new mongoose.Schema({
  platform: { type: String },
  url:       { type: String },
  label:     { type: String, default: null },
}, { _id: false })

const KycDocSchema = new mongoose.Schema({
  url:        { type: String, required: true },
  name:       { type: String, default: null },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false })

const ClientSchema = new mongoose.Schema(
  {
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    clientCode: { type: String, unique: true, sparse: true },
    clientType: { type: String, enum: ['INDIVIDUAL', 'COMPANY'], default: 'INDIVIDUAL' },

    // All content fields stored encrypted
    company:       { type: String, default: null },
    companyPhone:  { type: String, default: null },
    companyEmail:  { type: String, default: null },
    contactPerson: { type: String, default: null },
    designation:   { type: String, default: null },
    businessType:  { type: String, default: null },
    industry:      { type: String, default: null },
    priority:      { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'VIP'], default: 'MEDIUM' },
    altPhone:      { type: String, default: null },
    timezone:      { type: String, default: null },
    address:       { type: String, default: null },
    city:          { type: String, default: null },
    country:       { type: String, default: null },
    vatNumber:     { type: String, default: null },
    website:       { type: String, default: null },
    // Mixed — JSON arrays
    socialLinks:   { type: mongoose.Schema.Types.Mixed, default: [] },
    logo:          { type: String, default: null },
    notes:         { type: String, default: null },

    parentClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },

    kyc: {
      status:         { type: String, enum: ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'], default: 'NOT_SUBMITTED' },
      documentType:   { type: String, enum: ['NID', 'PASSPORT', 'TRADE_LICENSE', 'OTHERS', null], default: null },
      documentNumber: { type: String, default: null },   // encrypted
      primaryDoc:     { type: String, default: null },   // encrypted
      // Mixed — JSON array
      additionalDocs: { type: mongoose.Schema.Types.Mixed, default: [] },
      remarks:        { type: String, default: null },   // encrypted
      reviewedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt:     { type: Date, default: null },
      submittedAt:    { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

ClientSchema.index({ userId: 1 })
ClientSchema.index({ parentClientId: 1 })

ClientSchema.pre('save', async function () {
  if (this.clientCode) return
  const now    = new Date()
  const yy     = String(now.getFullYear()).slice(-2)
  const mm     = String(now.getMonth() + 1).padStart(2, '0')
  const prefix = `ENCL-${yy}${mm}`
  const count  = await mongoose.model('Client').countDocuments({ clientCode: { $regex: `^${prefix}` } })
  const seq    = count + 1
  const letter = String.fromCharCode(65 + Math.floor((seq - 1) / 999))
  const num    = ((seq - 1) % 999) + 1
  this.clientCode = `${prefix}${letter}${String(num).padStart(3, '0')}`
})

ClientSchema.plugin(encryptionPlugin, {
  collection: 'clients',
  fields: [
    { path: 'company'          },
    { path: 'companyPhone'     },
    { path: 'companyEmail'     },
    { path: 'contactPerson'    },
    { path: 'designation'      },
    { path: 'businessType'     },
    { path: 'industry'         },
    { path: 'altPhone'         },
    { path: 'timezone'         },
    { path: 'address'          },
    { path: 'city'             },
    { path: 'country'          },
    { path: 'vatNumber'        },
    { path: 'website'          },
    { path: 'socialLinks',     type: 'array'  },
    { path: 'logo'             },
    { path: 'notes'            },
    { path: 'kyc.documentNumber' },
    { path: 'kyc.primaryDoc'     },
    { path: 'kyc.additionalDocs',type: 'array' },
    { path: 'kyc.remarks'        },
  ],
})

if (mongoose.models.Client) delete mongoose.models.Client
export default mongoose.model('Client', ClientSchema)
