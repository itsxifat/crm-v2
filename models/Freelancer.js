import mongoose from 'mongoose'

const FreelancerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    type: { type: String, enum: ['FREELANCER', 'AGENCY'], default: 'FREELANCER' },

    skills:         { type: String, default: null },
    bio:            { type: String, default: null },
    portfolioLinks: { type: String, default: null },

    // Wallet
    walletBalance:       { type: Number, default: 0 },
    pendingBalance:      { type: Number, default: 0 },
    withdrawableBalance: { type: Number, default: 0 },

    rateType:  { type: String, default: null },
    hourlyRate: { type: Number, default: null },

    paymentMethod: {
      method: { type: String, enum: ['BANK', 'BKASH', null], default: null },
      bank: {
        bankName:       { type: String, default: null },
        accountNumber:  { type: String, default: null },
        accountName:    { type: String, default: null },
        routingNumber:  { type: String, default: null },
        swiftCode:      { type: String, default: null },
        branch:         { type: String, default: null },
        division:       { type: String, default: null },
      },
      bkash: {
        accountType:   { type: String, enum: ['Personal', 'Agent', 'Merchant'], default: 'Personal' },
        accountName:   { type: String, default: null },
        accountNumber: { type: String, default: null },
      },
    },

    pricing: [
      {
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'PricingCategory' },
        price:      { type: Number, default: null },
        note:       { type: String, default: null },
      },
    ],

    agencyInfo: {
      agencyName: { type: String, default: null },
      phone:      { type: String, default: null },
      address:    { type: String, default: null },
      type:       { type: String, default: null },
    },

    contactPerson: {
      name:        { type: String, default: null },
      phone:       { type: String, default: null },
      email:       { type: String, default: null },
      designation: { type: String, default: null },
    },

    inviteToken:       { type: String, sparse: true, unique: true, default: null },
    inviteTokenExpiry: { type: Date, default: null },
    inviteAccepted:    { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) {
        ret.id = ret._id.toString()
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

if (mongoose.models.Freelancer) delete mongoose.models.Freelancer
export default mongoose.model('Freelancer', FreelancerSchema)
