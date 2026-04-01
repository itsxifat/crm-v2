import mongoose from 'mongoose'

const EmployeeSchema = new mongoose.Schema(
  {
    userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    venture:         { type: String, enum: ['ENSTUDIO', 'ENTECH', 'ENMARK', null], default: null },
    department:      { type: String, default: null },
    position:        { type: String, default: null },   // job title
    designation:     { type: String, default: null },   // official designation
    salary:          { type: Number, default: null },
    hireDate:        { type: Date,   default: null },
    employeeId:      { type: String },

    // Personal details (populated from onboarding selfData)
    phone:            { type: String, default: null },
    secondaryPhone:   { type: String, default: null },
    homePhone:        { type: String, default: null },
    dateOfBirth:      { type: Date,   default: null },
    bloodGroup:       { type: String, default: null },
    emergencyContact: { type: String, default: null },
    address:          { type: String, default: null },
    nidNumber:        { type: String, default: null },
    photo:            { type: String, default: null },  // formal photo URL

    // Company-provided items
    companyPhone:    { type: String, default: null },
    companyWebmail:  { type: String, default: null },
    companyItems:    [{ item: String, value: String, description: { type: String, default: null } }],

    // Documents
    documents: [{
      url:  { type: String, required: true },
      type: { type: String, enum: ['NID','BIRTH_CERTIFICATE','CV','PASSPORT','ACADEMIC','APPOINTMENT','AGREEMENT','PHOTO','OTHER'], default: 'OTHER' },
      name: { type: String, default: null },
    }],
    appointmentLetterUrl: { type: String, default: null },
    agreementUrl:         { type: String, default: null },

    // Organisational role (links to CustomRole for permissions)
    customRoleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomRole', default: null },

    // Panel access
    panelAccessGranted: { type: Boolean, default: false },
    panelAccessDate:    { type: Date,    default: null },

    // Status
    isActive:   { type: Boolean, default: true },
    endDate:    { type: Date,    default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// ── Employee ID generation ────────────────────────────────────────────────────
// Format: ENF-[DEPT][YYMM]-[###]-[PH4]
// Example: ENF-DEV2603-001-4821

export const DEPT_CODES = ['DEV', 'HRM', 'ACC', 'MKT', 'OPS', 'SLS', 'DSN', 'ITF', 'CST']

function _yymm(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d)) return null
  return `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`
}

function _ph4(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

export async function generateEmployeeId({ department, hireDate, phone }) {
  // Normalize: take first 3 uppercase letters, so "Development" → "DEV", "Human Resources" → "HUM"
  const dept = (department || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
  if (!dept) throw new Error('Department is required to generate employee ID')

  const yymm = _yymm(hireDate || new Date())
  if (!yymm) throw new Error('Invalid hireDate — cannot generate employee ID')

  const ph4 = _ph4(phone)
  if (!ph4) throw new Error('Valid phone number with at least 4 digits is required to generate employee ID')

  const prefix = `ENF-${dept}${yymm}-`
  const count = await mongoose.model('Employee').countDocuments({
    employeeId: { $regex: `^${prefix}` },
  })
  const serial = String(count + 1).padStart(3, '0')

  return `${prefix}${serial}-${ph4}`
}

// Only enforce uniqueness on actual string values — null/absent documents are excluded
EmployeeSchema.index(
  { employeeId: 1 },
  { unique: true, partialFilterExpression: { employeeId: { $type: 'string' } } }
)

EmployeeSchema.pre('save', async function () {
  if (this.employeeId) return
  // Only generate if we have enough data; otherwise leave null (HR will assign later)
  if (!this.department || !this.phone) return
  try {
    this.employeeId = await generateEmployeeId({
      department: this.department,
      hireDate:   this.hireDate,
      phone:      this.phone,
    })
  } catch (err) {
    console.warn('[Employee] Could not auto-generate employeeId:', err.message)
  }
})

if (mongoose.models.Employee) delete mongoose.models.Employee
export default mongoose.model('Employee', EmployeeSchema)
