import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

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

    customRoleId: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomRole', default: null },

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
  for (const code of Object.keys(DEPT_CODES)) {
    if (upper.startsWith(code)) return code
  }
  if (/^[A-Z]{2,6}$/.test(upper)) return upper
  return null
}

export async function generateEmployeeId({ venture, department, hireDate }) {
  const code = normalizeDeptCode(department) ?? (department ? department.trim().toUpperCase().slice(0, 6) : null)
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
  if (!venturePrefix) venturePrefix = (venture ?? 'EN').slice(0, 2).toUpperCase()
  const date    = hireDate ? new Date(hireDate) : new Date()
  const yy      = String(date.getFullYear()).slice(-2)
  const mm      = String(date.getMonth() + 1).padStart(2, '0')
  const yearPrefix = `${venturePrefix}-${code}${yy}`
  const fullPrefix = `${yearPrefix}${mm}`

  const existing = await mongoose.model('Employee')
    .find({ employeeId: { $regex: `^${yearPrefix}`, $options: 'i' } }, { employeeId: 1 })
    .lean()

  const serialOffset = venturePrefix.length + 1 + code.length + 4
  let maxSerial = 0
  for (const emp of existing) {
    const serial = parseInt((emp.employeeId ?? '').slice(serialOffset), 10)
    if (!isNaN(serial) && serial > maxSerial) maxSerial = serial
  }
  return `${fullPrefix}${String(maxSerial + 1).padStart(3, '0')}`
}

export function parseEmployeeId(id) {
  if (!id) return null
  const match = id.match(/^(EN[TM]?)-([A-Z]{2,4})(\d{2})(\d{2})(\d{3,})$/)
  if (!match) return null
  return { prefix: match[1], dept: match[2], year: `20${match[3]}`, month: match[4], serial: parseInt(match[5], 10) }
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
EmployeeSchema.plugin(encryptionPlugin, {
  collection: 'employees',
  fields: [
    // Identity & role
    { path: 'venture'      },
    { path: 'department'   },
    { path: 'position'     },
    { path: 'designation'  },
    // Financial
    { path: 'salary',             type: 'number' },
    // Contact PII
    { path: 'phone'          },
    { path: 'secondaryPhone' },
    { path: 'homePhone'      },
    { path: 'companyPhone'   },
    { path: 'companyWebmail' },
    // Location
    { path: 'address'        },
    // Identity docs
    { path: 'nidNumber'      },
    { path: 'passportNumber' },
    // Personal
    { path: 'bloodGroup'     },
    { path: 'nationality'    },
    // Dates
    { path: 'dateOfBirth',        type: 'date'   },
    // Composite arrays
    { path: 'emergencyContacts',  type: 'array'  },
    { path: 'companyItems',       type: 'array'  },
    { path: 'documents',          type: 'array'  },
    // Document URLs
    { path: 'appointmentLetterUrl' },
    { path: 'agreementUrl'         },
    // Notes
    { path: 'hrNotes'              },
  ],
})

if (mongoose.models.Employee) delete mongoose.models.Employee
export default mongoose.model('Employee', EmployeeSchema)
