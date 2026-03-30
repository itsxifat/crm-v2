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
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
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

    // Portfolio grouping — multiple companies owned by the same contact person
    // Set this to the _id of the "primary" individual Client record.
    // All companies under the same owner share the same userId (User account).
    parentClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },

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

// Index for fast lookup by user (non-unique — one person can own multiple company clients)
ClientSchema.index({ userId: 1 })
ClientSchema.index({ parentClientId: 1 })

ClientSchema.pre('save', async function () {
  if (this.clientCode) return
  const now = new Date()
  const yy  = String(now.getFullYear()).slice(-2)
  const mm  = String(now.getMonth() + 1).padStart(2, '0')
  const prefix = `ENCL-${yy}${mm}`

  // Count existing codes for this YYMM to determine next sequence
  const count     = await mongoose.model('Client').countDocuments({ clientCode: { $regex: `^${prefix}` } })
  const seq       = count + 1
  const letterIdx = Math.floor((seq - 1) / 999)           // A=0..998, B=999..1997, …
  const letter    = String.fromCharCode(65 + letterIdx)   // 65 = 'A'
  const num       = ((seq - 1) % 999) + 1
  this.clientCode = `${prefix}${letter}${String(num).padStart(3, '0')}`
})

if (mongoose.models.Client) delete mongoose.models.Client
export default mongoose.model('Client', ClientSchema)
