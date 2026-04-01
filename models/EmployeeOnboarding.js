import mongoose from 'mongoose'
import crypto from 'crypto'

const DocSchema = new mongoose.Schema({
  name: { type: String, default: null },
  url:  { type: String, required: true },
  type: { type: String, enum: ['NID', 'BIRTH_CERTIFICATE', 'CV', 'PASSPORT', 'ACADEMIC', 'OTHER'], default: 'OTHER' },
}, { _id: false })

const CompanyItemSchema = new mongoose.Schema({
  item:        { type: String },   // e.g. "Phone Number", "Webmail"
  value:       { type: String },   // e.g. "+880...", "john@en-tech.agency"
  description: { type: String, default: null },
}, { _id: false })

const EmployeeOnboardingSchema = new mongoose.Schema(
  {
    token:     { type: String, unique: true, default: () => crypto.randomBytes(24).toString('hex') },
    email:     { type: String, default: null },   // optional pre-fill
    status:    { type: String, enum: ['PENDING_SUBMISSION', 'SUBMITTED', 'APPROVED', 'COMPLETED', 'REJECTED'], default: 'PENDING_SUBMISSION' },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // 7 days

    // ── Employee fills ─────────────────────────────────────────────────────────
    selfData: {
      name:             { type: String, default: null },
      email:            { type: String, default: null },
      phone:            { type: String, default: null },   // primary
      secondaryPhone:   { type: String, default: null },
      homePhone:        { type: String, default: null },
      dateOfBirth:      { type: Date,   default: null },
      nidNumber:        { type: String, default: null },
      address:          { type: String, default: null },
      emergencyContact: { type: String, default: null },   // name + phone
      bloodGroup:       { type: String, default: null },
      photo:            { type: String, default: null },   // formal photo URL
      documents:        [DocSchema],
    },

    // ── HR fills ───────────────────────────────────────────────────────────────
    hrData: {
      venture:              { type: String, enum: ['ENSTUDIO', 'ENTECH', 'ENMARK', null], default: null },
      department:           { type: String, default: null },
      position:             { type: String, default: null },
      designation:          { type: String, default: null },
      salary:               { type: Number, default: null },
      hireDate:             { type: Date,   default: null },
      role:                 { type: String, enum: ['EMPLOYEE', 'MANAGER', 'SUPER_ADMIN'], default: 'EMPLOYEE' },
      customRoleId:         { type: mongoose.Schema.Types.ObjectId, ref: 'CustomRole', default: null },
      appointmentLetterUrl: { type: String, default: null },
      agreementUrl:         { type: String, default: null },
      panelAccessGranted:   { type: Boolean, default: false },
      password:             { type: String, default: null }, // optional manual password
      // Company-provided items
      companyPhone:    { type: String, default: null },
      companyWebmail:  { type: String, default: null },
      companyItems:    [CompanyItemSchema],
    },

    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    submittedAt: { type: Date, default: null },
    approvedAt:  { type: Date, default: null },
    employeeId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    hrNote:      { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

if (mongoose.models.EmployeeOnboarding) delete mongoose.models.EmployeeOnboarding
export default mongoose.model('EmployeeOnboarding', EmployeeOnboardingSchema)
