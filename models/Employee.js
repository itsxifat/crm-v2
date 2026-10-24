import mongoose from 'mongoose'
const EmployeeSchema = new mongoose.Schema(
  {
    userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    // stored encrypted
    venture:         { type: String, default: null },
    department:      { type: String, default: null },
    position:        { type: String, default: null },
    designation:     { type: String, default: null },
    // Mixed — encrypted Number on write, decrypted back to Number on read
    salary:          { type: mongoose.Schema.Types.Mixed, default: null },
    hireDate:        { type: Date, default: null },
    employeeId:      { type: String },

    // Personal — all stored encrypted
    phone:            { type: String, default: null },
    secondaryPhone:   { type: String, default: null },
    homePhone:        { type: String, default: null },
    // Mixed — encrypted Date string on write, decrypted back to Date on read
    dateOfBirth:      { type: mongoose.Schema.Types.Mixed, default: null },
    bloodGroup:       { type: String, default: null },
    // Mixed — JSON-serialised array encrypted on write, array on read
    emergencyContacts:{ type: mongoose.Schema.Types.Mixed, default: [] },
    address:          { type: String, default: null },
    nidNumber:        { type: String, default: null },
    photo:            { type: String, default: null },

    // Company-provided
    companyPhone:    { type: String, default: null },
    companyWebmail:  { type: String, default: null },
    // Mixed — JSON array
    companyItems:    { type: mongoose.Schema.Types.Mixed, default: [] },

    // Documents — Mixed array
    documents:            { type: mongoose.Schema.Types.Mixed, default: [] },
    appointmentLetterUrl: { type: String, default: null },
    agreementUrl:         { type: String, default: null },

    // Personal — stored encrypted
    gender:        { type: String, enum: ['MALE', 'FEMALE', 'OTHER', null], default: null },
    nationality:   { type: String, default: null },
    maritalStatus: { type: String, enum: ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', null], default: null },
    passportNumber:{ type: String, default: null },
    tin:           { type: String, default: null },  // e-TIN (12 digits) — salary TDS (s.86) certificates

    customRoleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomRole', default: null },

    // Per-user permission overrides layered on top of the assigned custom role
    // (or the base-role defaults when no custom role is set). `added` grants extra
    // permissions to just this person; `removed` revokes permissions their role
    // would otherwise give them. Effective set = (base ∪ added) − removed.
    permissionOverrides: {
      added:   { type: [String], default: [] },
      removed: { type: [String], default: [] },
    },

    panelAccessGranted: { type: Boolean, default: false },
    panelAccessDate:    { type: Date,    default: null },

    profileStatus:        { type: String, enum: ['CREATED', 'INCOMPLETE', 'PENDING_APPROVAL', 'APPROVED'], default: 'CREATED' },
    profileCompletionPct: { type: Number, default: 0 },
    hrNotes:              { type: String, default: null },  // stored encrypted

    kycApproved:   { type: Boolean, default: false },
    finalApproved: { type: Boolean, default: false },

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

export const VENTURE_PREFIXES = { ENSTUDIO: 'EN', ENTECH: 'ENT', ENMARK: 'ENM' }

export const DEPT_CODES = {
  DEV: 'Development', MKT: 'Marketing', HR: 'Human Resources',
  SLS: 'Sales', ACC: 'Accounting', OPS: 'Operations', SUP: 'Support',
}

export function normalizeDeptCode(dept) {
  if (!dept) return null
  const upper = dept.trim().toUpperCase()
  if (DEPT_CODES[upper]) return upper
  for (const [code, label] of Object.entries(DEPT_CODES)) {
    if (label.toUpperCase() === upper) return code
  }
  // An exact 2-6 letter code (e.g. HRM, DEVOPS) is its own code — check it
  // before the prefix heuristic so it isn't collapsed into HR / DEV.
  if (/^[A-Z]{2,6}$/.test(upper)) return upper
  for (const code of Object.keys(DEPT_CODES)) {
    if (upper.startsWith(code)) return code
  }
  return null
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Next employee ID: venture prefix + department code + hire YYMM + serial, e.g.
 * ENDEV2610001. The serial runs per venture, department and hire year.
 *
 * IDs issued before 2026-10 carry a hyphen (EN-DEV2610001). Without it the
 * venture / department boundary is gone (ENT + DEV and EN + TDEV both read
 * ENTDEV…), so the floor matches those letters with a hyphen allowed between
 * any two of them: every ID that reads the same once the hyphen is dropped
 * shares one series, and the next serial is unique in both shapes.
 */
export async function generateEmployeeId({ venture, department, hireDate }) {
  // Letters only: the department code runs straight into the YYMM digits.
  const code = normalizeDeptCode(department) ?? (department ? String(department).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) : null)
  if (!code) throw new Error('Department is required to generate an employee ID')

  let venturePrefix = (venture && VENTURE_PREFIXES[venture]) ? VENTURE_PREFIXES[venture] : null
  if (!venturePrefix && venture) {
    try {
      const setting = await mongoose.model('Setting').findOne({ key: 'crm_config' }).lean()
      if (setting?.value) {
        const cfg = JSON.parse(setting.value)
        const v = (cfg.ventures ?? []).find(x => x.id === venture)
        if (v?.prefix) venturePrefix = v.prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
      }
    } catch { /* ignore */ }
  }
  if (!venturePrefix) venturePrefix = String(venture ?? 'EN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2) || 'EN'
  const date    = hireDate ? new Date(hireDate) : new Date()
  const yy      = String(date.getFullYear()).slice(-2)
  const mm      = String(date.getMonth() + 1).padStart(2, '0')
  const stem    = `${venturePrefix}${code}`
  const re      = new RegExp(`^${stem.split('').map(escapeRegex).join('-?')}${yy}\\d{2}(\\d{3,})$`, 'i')

  const existing = await mongoose.model('Employee')
    .find({ employeeId: { $regex: re.source, $options: 'i' } }, { employeeId: 1 })
    .lean()

  let maxSerial = 0
  for (const emp of existing) {
    const serial = parseInt(re.exec(emp.employeeId ?? '')?.[1], 10)
    if (!isNaN(serial) && serial > maxSerial) maxSerial = serial
  }
  return `${stem}${yy}${mm}${String(maxSerial + 1).padStart(3, '0')}`
}

/**
 * { prefix, dept, year, month, serial } of a generated employee ID of the built-in
 * ventures (VENTURE_PREFIXES): ENDEV2610001, or the hyphenated EN-DEV2610001.
 * Without the hyphen the venture / department boundary is a best guess: a known
 * department code (DEPT_CODES) wins, else the longest venture prefix. null when
 * the ID does not have that shape.
 */
export function parseEmployeeId(id) {
  const s = String(id ?? '').trim().toUpperCase()
  const m = /^([A-Z]+)(?:-([A-Z]+))?(\d{2})(\d{2})(\d{3,})$/.exec(s)
  if (!m) return null
  const ventures = Object.values(VENTURE_PREFIXES).sort((a, b) => b.length - a.length)
  const splits = m[2] !== undefined
    ? (ventures.includes(m[1]) ? [{ prefix: m[1], dept: m[2] }] : [])
    : ventures.filter(v => m[1].startsWith(v)).map(v => ({ prefix: v, dept: m[1].slice(v.length) }))
  const valid = splits.filter(x => /^[A-Z]{2,6}$/.test(x.dept))
  const pick = valid.find(x => DEPT_CODES[x.dept]) ?? valid[0]
  if (!pick) return null
  return { prefix: pick.prefix, dept: pick.dept, year: `20${m[3]}`, month: m[4], serial: parseInt(m[5], 10) }
}

EmployeeSchema.index(
  { employeeId: 1 },
  { unique: true, partialFilterExpression: { employeeId: { $type: 'string' } } }
)
EmployeeSchema.index({ department: 1, hireDate: 1 })

// employeeId auto-generation must run BEFORE encryption (registered first)
EmployeeSchema.pre('save', async function () {
  if (this.employeeId || !this.department) return
  try {
    this.employeeId = await generateEmployeeId({ venture: this.venture, department: this.department, hireDate: this.hireDate })
  } catch (err) {
    console.warn('[Employee] Could not auto-generate employeeId:', err.message)
  }
})

export function calcProfileCompletion(emp) {
  const checks = [
    !!emp.gender, !!emp.dateOfBirth, !!emp.nationality, !!emp.maritalStatus,
    !!emp.photo, !!emp.phone, !!emp.address,
    Array.isArray(emp.emergencyContacts) && emp.emergencyContacts.length > 0,
    !!emp.nidNumber,
    Array.isArray(emp.documents) && emp.documents.length > 0,
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

// Encryption plugin runs after the employeeId hook (registered later = runs after)

if (mongoose.models.Employee) delete mongoose.models.Employee
export default mongoose.model('Employee', EmployeeSchema)
