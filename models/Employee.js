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

    // Organisational role
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

// ── Employee ID System ────────────────────────────────────────────────────────
// Format : ENF-[DEPT]-[YY]-[SERIAL]-[ALPHA]
// Example: ENF-DEV-24-001-KX
//
//  ENF    — fixed company prefix
//  DEPT   — 3-letter department code  (DEV | MKT | HR | SLS | ACC | OPS | SUP)
//  YY     — last 2 digits of joining year, auto-derived from hireDate
//  SERIAL — 3-digit counter, resets per department per year, starts at 001
//  ALPHA  — 2 random uppercase letters for uniqueness guarantee

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

function _randomAlpha2() {
  return Array.from({ length: 2 }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26))
  ).join('')
}

// Generate the next employee ID for the given department + year.
// Serial resets per dept per year; ALPHA adds collision safety.
export async function generateEmployeeId({ department, hireDate }) {
  const code = normalizeDeptCode(department)
  if (!code) {
    throw new Error(
      `Unknown department "${department}". Valid codes: ${Object.keys(DEPT_CODES).join(', ')}`
    )
  }

  const date = hireDate ? new Date(hireDate) : new Date()
  const yy   = String(date.getFullYear()).slice(-2)
  const prefix = `ENF-${code}-${yy}-`

  // Find all existing IDs for this dept+year to determine max serial
  const existing = await mongoose.model('Employee')
    .find({ employeeId: { $regex: `^${prefix}`, $options: 'i' } }, { employeeId: 1 })
    .lean()

  let maxSerial = 0
  for (const emp of existing) {
    // Format: ENF-DEV-24-001-KX  → parts[3] = "001"
    const parts  = (emp.employeeId ?? '').split('-')
    const serial = parseInt(parts[3], 10)
    if (!isNaN(serial) && serial > maxSerial) maxSerial = serial
  }

  const serial = String(maxSerial + 1).padStart(3, '0')
  const alpha  = _randomAlpha2()

  return `${prefix}${serial}-${alpha}`
}

// Parse a structured employeeId into its components (for sorting/filtering)
export function parseEmployeeId(id) {
  if (!id) return null
  const parts = id.split('-')
  if (parts.length !== 5 || parts[0] !== 'ENF') return null
  return {
    prefix: parts[0],                       // ENF
    dept:   parts[1],                       // DEV
    year:   `20${parts[2]}`,               // 2024
    serial: parseInt(parts[3], 10),         // 1
    alpha:  parts[4],                       // KX
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
      department: this.department,
      hireDate:   this.hireDate,
    })
  } catch (err) {
    console.warn('[Employee] Could not auto-generate employeeId:', err.message)
  }
})

if (mongoose.models.Employee) delete mongoose.models.Employee
export default mongoose.model('Employee', EmployeeSchema)
