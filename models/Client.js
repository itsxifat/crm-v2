import mongoose from 'mongoose'

const SocialLinkSchema = new mongoose.Schema({
  platform: { type: String }, // 'facebook','instagram','linkedin','twitter','youtube','tiktok','other'
  url:       { type: String },
  label:     { type: String, default: null },
}, { _id: false })

const KycDocSchema = new mongoose.Schema({
  url:      { type: String, required: true },
  name:     { type: String, default: null },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false })

const ClientSchema = new mongoose.Schema(
  {
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    clientCode: { type: String, unique: true, sparse: true },

    // Client type
    clientType:    { type: String, enum: ['INDIVIDUAL', 'COMPANY'], default: 'INDIVIDUAL' },

    // Company info (only if COMPANY)
    company:       { type: String, default: null },
    companyPhone:  { type: String, default: null }, // company's own phone
    companyEmail:  { type: String, default: null }, // company's own email

    // Contact / Concerned person (for COMPANY: person to notify; for INDIVIDUAL: same as user)
    contactPerson: { type: String, default: null }, // contact person name
    // contactPerson phone/email are stored on User (userId.phone / userId.email)

    // Professional
    designation:   { type: String, default: null },
    businessType:  { type: String, default: null },
    industry:      { type: String, default: null },
    priority:      { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'VIP'], default: 'MEDIUM' },

    // Contact
    altPhone:  { type: String, default: null },
    timezone:  { type: String, default: null },
    address:   { type: String, default: null },
    city:      { type: String, default: null },
    country:   { type: String, default: 'Bangladesh' },
    vatNumber: { type: String, default: null },

    // Digital presence
    website:     { type: String, default: null },
    socialLinks: [SocialLinkSchema],

    // Profile logo (URL)
    logo: { type: String, default: null },

    // Internal notes
    notes: { type: String, default: null },

    // KYC
    kyc: {
      status:         { type: String, enum: ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'], default: 'NOT_SUBMITTED' },
      documentType:   { type: String, enum: ['NID', 'PASSPORT', 'TRADE_LICENSE', 'OTHERS', null], default: null },
      documentNumber: { type: String, default: null },
      primaryDoc:     { type: String, default: null },      // single primary file URL
      additionalDocs: [KycDocSchema],                        // multiple additional files
      remarks:        { type: String, default: null },       // admin remarks (rejection reason etc)
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

ClientSchema.pre('save', async function () {
  if (this.clientCode) return
  const count = await mongoose.model('Client').countDocuments()
  const b36   = (count + 1).toString(36).toUpperCase().padStart(5, '0')
  this.clientCode = `CL-${b36}`
})

if (mongoose.models.Client) delete mongoose.models.Client
export default mongoose.model('Client', ClientSchema)
