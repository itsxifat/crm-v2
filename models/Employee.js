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

    // Personal details
    phone:            { type: String, default: null },
    secondaryPhone:   { type: String, default: null },
    homePhone:        { type: String, default: null },
    dateOfBirth:      { type: Date,   default: null },
    bloodGroup:       { type: String, default: null },
    emergencyContact: { type: String, default: null },
    address:          { type: String, default: null },
    nidNumber:        { type: String, default: null },
    photo:            { type: String, default: null },

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

    // Additional personal fields (employee fills)
    gender:        { type: String, enum: ['MALE', 'FEMALE', 'OTHER', null], default: null },
    nationality:   { type: String, default: null },
    maritalStatus: { type: String, enum: ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', null], default: null },

    // KYC additional
    passportNumber: { type: String, default: null },

    // Organisational role
    customRoleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomRole', default: null },

    // Panel access
    panelAccessGranted: { type: Boolean, default: false },
    panelAccessDate:    { type: Date,    default: null },

    // Profile onboarding
    profileStatus:        { type: String, enum: ['CREATED', 'INCOMPLETE', 'PENDING_APPROVAL', 'APPROVED'], default: 'CREATED' },
    profileCompletionPct: { type: Number, default: 0 },
    hrNotes:              { type: String, default: null },

    // Data locks
    kycApproved:   { type: Boolean, default: false },  // locks KYC docs after HR approves KYC
    finalApproved: { type: Boolean, default: false },  // set on HR final approval — locks name/phone/email/company/salary

    // Status
    isActive:   { type: Boolean, default: true },
    endDate:    { type: Date,    default: null },
    resigned:   { type: Boolean, default: false },
    resignDate: { type: Date,    default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// ── Employee ID System ────────────────────────────────────────────────────────
// Format : [VENTURE_PREFIX]-[DEPT][YY][MM][SERIAL]
// Examples:
//   ENSTUDIO → EN-MKT2604001
//   ENTECH   → ENT-MKT2604001
//   ENMARK   → ENM-MKT2604001
//
//  VENTURE_PREFIX — venture-specific prefix (EN | ENT | ENM)
//  DEPT           — 3-letter department code  (DEV | MKT | HR | SLS | ACC | OPS | SUP)
//  YY             — last 2 digits of joining year, auto-derived from hireDate
//  MM             — 2-digit joining month (01–12)
//  SERIAL         — counter, resets per department per year, starts at 001; grows beyond 3 digits if needed

export const VENTURE_PREFIXES = {
  ENSTUDIO: 'EN',
  ENTECH:   'ENT',
  ENMARK:   'ENM',
}

export const DEPT_CODES = {
  DEV: 'Development',
  MKT: 'Marketing',
  HR:  'Human Resources',
  SLS: 'Sales',
  ACC: 'Accounting',
  OPS: 'Operations',
  SUP: 'Support',
}

// Normalize free-text department into a known code
// "Development" → "DEV", "dev" → "DEV", "DEV" → "DEV"
export function normalizeDeptCode(dept) {
  if (!dept) return null
  const upper = dept.trim().toUpperCase()
  // Direct code hit
  if (DEPT_CODES[upper]) return upper
  // Full-label match (case-insensitive)
  for (const [code, label] of Object.entries(DEPT_CODES)) {
    if (label.toUpperCase() === upper) return code
  }
  // Prefix match: "DEVELOPMENT" starts with "DEV"
  for (const code of Object.keys(DEPT_CODES)) {
    if (upper.startsWith(code)) return code
  }
  return null
}

// Generate the next employee ID for the given venture + department + hireDate.
// Serial resets per dept per year; expands beyond 3 digits if needed (1000+).
export async function generateEmployeeId({ venture, department, hireDate }) {
  const code = normalizeDeptCode(department)
  if (!code) {
    throw new Error(
      `Unknown department "${department}". Valid codes: ${Object.keys(DEPT_CODES).join(', ')}`
    )
  }

  const venturePrefix = (venture && VENTURE_PREFIXES[venture]) ? VENTURE_PREFIXES[venture] : 'EN'

  const date    = hireDate ? new Date(hireDate) : new Date()
  const yy      = String(date.getFullYear()).slice(-2)
  const mm      = String(date.getMonth() + 1).padStart(2, '0')
  // yearPrefix used for searching all months in this dept+year+venture
  const yearPrefix = `${venturePrefix}-${code}${yy}`
  const fullPrefix = `${yearPrefix}${mm}`

  // Find all existing IDs for this venture+dept+year (across all months) to determine max serial
  const existing = await mongoose.model('Employee')
    .find({ employeeId: { $regex: `^${yearPrefix}`, $options: 'i' } }, { employeeId: 1 })
    .lean()

  // Serial starts after: venturePrefix + '-' (1) + code + YY (2) + MM (2)
  const serialOffset = venturePrefix.length + 1 + code.length + 4

  let maxSerial = 0
  for (const emp of existing) {
    const id     = emp.employeeId ?? ''
    const serial = parseInt(id.slice(serialOffset), 10)
    if (!isNaN(serial) && serial > maxSerial) maxSerial = serial
  }

  // Pad to 3 digits minimum; naturally grows to 4+ digits beyond 999
  const serial = String(maxSerial + 1).padStart(3, '0')

  return `${fullPrefix}${serial}`
}

// Parse a structured employeeId into its components (for sorting/filtering)
// Format: {VENTURE_PREFIX}-{DEPT}{YY}{MM}{SERIAL}
// Examples: EN-MKT2604001, ENT-MKT2604001, ENM-MKT2604001
export function parseEmployeeId(id) {
  if (!id) return null
  // (EN|ENT|ENM)-[2-4 letter dept][YY][MM][3+ digit serial]
  const match = id.match(/^(EN[TM]?)-([A-Z]{2,4})(\d{2})(\d{2})(\d{3,})$/)
  if (!match) return null
  return {
    prefix: match[1],                   // EN | ENT | ENM
    dept:   match[2],                   // MKT
    year:   `20${match[3]}`,            // 2026
    month:  match[4],                   // 04
    serial: parseInt(match[5], 10),     // 1
  }
}

// Only index actual string values — null/absent are excluded
EmployeeSchema.index(
  { employeeId: 1 },
  { unique: true, partialFilterExpression: { employeeId: { $type: 'string' } } }
)

// Also index dept + hireDate for fast serial lookups
EmployeeSchema.index({ department: 1, hireDate: 1 })

// Auto-generate ID on save if department is set and ID is not yet assigned
EmployeeSchema.pre('save', async function () {
  if (this.employeeId) return
  if (!this.department) return
  try {
    this.employeeId = await generateEmployeeId({
      venture:    this.venture,
      department: this.department,
      hireDate:   this.hireDate,
    })
  } catch (err) {
    console.warn('[Employee] Could not auto-generate employeeId:', err.message)
  }
})

// ── Profile Completion ────────────────────────────────────────────────────────
// 10 employee-fillable required fields, each worth 10%.
// Personal (5): gender, dateOfBirth, nationality, maritalStatus, photo
// Contact  (3): phone, address, emergencyContact
// KYC      (2): nidNumber + at least 1 document uploaded
export function calcProfileCompletion(emp) {
  const checks = [
    !!emp.gender,
    !!emp.dateOfBirth,
    !!emp.nationality,
    !!emp.maritalStatus,
    !!emp.photo,
    !!emp.phone,
    !!emp.address,
    !!emp.emergencyContact,
    !!emp.nidNumber,
    Array.isArray(emp.documents) && emp.documents.length > 0,
  ]
  const filled = checks.filter(Boolean).length
  return Math.round((filled / checks.length) * 100)
}

if (mongoose.models.Employee) delete mongoose.models.Employee
export default mongoose.model('Employee', EmployeeSchema)
