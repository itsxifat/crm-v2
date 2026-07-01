import mongoose from 'mongoose'
const FreelancerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    type:   { type: String, enum: ['FREELANCER', 'AGENCY'], default: 'FREELANCER' },

    // Profile
    skills:         { type: String, default: null },
    bio:            { type: String, default: null },
    portfolioLinks: { type: String, default: null },

    // Engagement model. PROJECT = paid a fixed agreed amount per project/task,
    // decided at assignment time (no rate stored here). SALARY = temporary
    // salary-based hire, paid a recurring salary like an employee.
    employmentMode:  { type: String, enum: ['PROJECT', 'SALARY'], default: 'PROJECT' },
    // Default currency we pay this person in (overridable per engagement).
    paymentCurrency: { type: String, default: 'BDT' },

    // Salary mode (temporary salary-based freelancer)
    salaryAmount:    { type: Number, default: null },
    salaryCurrency:  { type: String, default: 'BDT' },
    salaryDay:       { type: Number, default: null }, // day of month 1–28
    salaryStartDate: { type: Date,   default: null },
    salaryEndDate:   { type: Date,   default: null },
    salaryActive:    { type: Boolean, default: false },

    // Lifecycle — account disable/reactivate (active flag lives on the linked User)
    disabledAt:     { type: Date, default: null },
    disabledBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    disabledReason: { type: String, default: null },

    paymentMethod: {
      method: { type: String, enum: ['BANK', 'BKASH', null], default: null },
      bank: {
        bankName:      { type: String, default: null }, // encrypted
        accountNumber: { type: String, default: null }, // encrypted
        accountName:   { type: String, default: null }, // encrypted
        routingNumber: { type: String, default: null }, // encrypted
        swiftCode:     { type: String, default: null }, // encrypted
        branch:        { type: String, default: null }, // encrypted
        division:      { type: String, default: null }, // encrypted
      },
      bkash: {
        accountType:   { type: String, enum: ['Personal', 'Agent', 'Merchant'], default: 'Personal' },
        accountName:   { type: String, default: null }, // encrypted
        accountNumber: { type: String, default: null }, // encrypted
      },
    },

    // Pricing — Mixed array
    pricing: { type: mongoose.Schema.Types.Mixed, default: [] },

    agencyInfo: {
      agencyName: { type: String, default: null }, // encrypted
      phone:      { type: String, default: null }, // encrypted
      address:    { type: String, default: null }, // encrypted
      type:       { type: String, default: null }, // encrypted
    },

    contactPerson: {
      name:        { type: String, default: null }, // encrypted
      phone:       { type: String, default: null }, // encrypted
      email:       { type: String, default: null }, // encrypted
      designation: { type: String, default: null }, // encrypted
    },

    inviteToken:       { type: String, sparse: true, unique: true, default: null },
    inviteTokenExpiry: { type: Date, default: null },
    inviteAccepted:    { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

if (mongoose.models.Freelancer) delete mongoose.models.Freelancer
export default mongoose.model('Freelancer', FreelancerSchema)
