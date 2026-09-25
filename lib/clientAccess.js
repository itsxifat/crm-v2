import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { Client, User, CompanyMembership } from '@/models'

// Same alphabet used by the legacy client-create flow (no ambiguous chars).
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

export function generateTempPassword(len = 10) {
  return Array.from({ length: len }, () => PW_CHARS[Math.floor(Math.random() * PW_CHARS.length)]).join('')
}

/** Cryptographically-random 6-digit numeric OTP (zero-padded). */
export function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Generate, hash-and-store a 10-minute login OTP on the user; returns the plain code. */
export async function setLoginOtp(user) {
  const code = generateOtp()
  user.loginOtp       = await bcrypt.hash(code, 10)
  user.loginOtpExpiry = new Date(Date.now() + 10 * 60 * 1000)
  await user.save()
  return code
}

/** Verify a submitted OTP against the stored hash + expiry. */
export async function verifyLoginOtp(user, code) {
  if (!user?.loginOtp || !user.loginOtpExpiry) return false
  if (new Date(user.loginOtpExpiry) < new Date()) return false
  return bcrypt.compare(String(code ?? ''), user.loginOtp)
}

/**
 * Companies (Client docs) the given person is an ACTIVE member of.
 * @returns {Promise<Array>} lean Client documents
 */
export async function getMyCompanies(userId) {
  if (!userId) return []
  const memberships = await CompanyMembership
    .find({ userId, status: 'ACTIVE' })
    .select('clientId role')
    .lean()
  if (memberships.length === 0) return []

  const clientIds = memberships.map(m => m.clientId)
  // Deactivated companies grant no portal access to any member.
  const clients   = await Client.find({ _id: { $in: clientIds }, isActive: { $ne: false } }).lean()

  // attach the caller's membership role for convenience
  const roleByClient = new Map(memberships.map(m => [m.clientId.toString(), m.role]))
  return clients.map(c => ({ ...c, membershipRole: roleByClient.get(c._id.toString()) ?? 'MEMBER' }))
}

/**
 * Just the company ids the person is an ACTIVE member of. Use this to scope
 * detail/PDF reads, where the user may legitimately open a record belonging to
 * any of their companies (not only the currently-active one).
 * @returns {Promise<import('mongoose').Types.ObjectId[]>}
 */
export async function getMyCompanyIds(userId) {
  if (!userId) return []
  const memberships = await CompanyMembership.find({ userId, status: 'ACTIVE' }).select('clientId').lean()
  if (memberships.length === 0) return []
  // Drop deactivated companies — they grant no portal access to any member.
  return Client.find({ _id: { $in: memberships.map(m => m.clientId) }, isActive: { $ne: false } }).distinct('_id')
}

/**
 * Resolve the company a CLIENT-role request should act on.
 *
 * Resolution order:
 *   1. session.user.activeClientId, if the caller is an ACTIVE member of it
 *   2. the only company they belong to (keeps single-company users seamless)
 *   3. >1 company & none selected  → { error: 'SELECT_COMPANY' }
 *   4. 0 companies                 → { error: 'NO_COMPANY' }
 *
 * @returns {Promise<{ client?: object, clientId?: import('mongoose').Types.ObjectId, error?: string }>}
 */
export async function resolveActiveClient(session) {
  const userId = session?.user?.id
  if (!userId) return { error: 'NO_COMPANY' }

  const rawMemberships = await CompanyMembership
    .find({ userId, status: 'ACTIVE' })
    .select('clientId')
    .lean()
  if (rawMemberships.length === 0) return { error: 'NO_COMPANY' }

  // Only companies that are still active grant access.
  const activeIds = new Set((await Client.find({
    _id: { $in: rawMemberships.map(m => m.clientId) }, isActive: { $ne: false },
  }).distinct('_id')).map(id => id.toString()))
  const memberships = rawMemberships.filter(m => activeIds.has(m.clientId.toString()))
  if (memberships.length === 0) return { error: 'NO_COMPANY' }

  const allowed = new Set(memberships.map(m => m.clientId.toString()))
  const active  = session?.user?.activeClientId

  let chosenId
  if (active && allowed.has(active.toString())) {
    chosenId = active
  } else if (memberships.length === 1) {
    chosenId = memberships[0].clientId
  } else {
    return { error: 'SELECT_COMPANY' }
  }

  const client = await Client.findOne({ _id: chosenId, isActive: { $ne: false } }).lean()
  if (!client) return { error: 'NO_COMPANY' }
  return { client, clientId: client._id }
}

/**
 * Find a CLIENT user by email or create one. The single source of truth used by
 * every "attach a person to a company" path so behaviour stays consistent.
 *
 * - existing email → returns the user, isNew:false (just link them, no new credentials).
 *                    activationToken is null, unless the person never activated, in which
 *                    case a fresh 7-day token is issued so the caller can re-send the link.
 *                    Throws (err.status = 422) if that email belongs to a non-CLIENT account
 *                    (staff / freelancer / vendor) — those must never become company members.
 * - new email      → creates a CLIENT account with NO usable password and a 7-day
 *                    activation token; the user activates via OTP and sets their own password.
 *
 * @returns {Promise<{ user: object, isNew: boolean, activationToken: string|null }>}
 */
export async function findOrCreateClientUser({ email, name, phone = null }) {
  const normalized = String(email ?? '').trim().toLowerCase()
  if (!normalized) throw new Error('Email is required')

  const existing = await User.findOne({ email: normalized })
  if (existing) {
    if (existing.role !== 'CLIENT') {
      const err = new Error('This email belongs to a non-client account and cannot be linked to a company')
      err.status = 422
      throw err
    }
    // Never activated (first activation email may have failed) → issue a fresh link.
    if (existing.mustChangePassword && !existing.lastLogin && existing.isActive) {
      const activationToken = crypto.randomBytes(32).toString('hex')
      existing.activationToken       = activationToken
      existing.activationTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      await existing.save()
      return { user: existing, isNew: false, activationToken }
    }
    return { user: existing, isNew: false, activationToken: null }
  }

  // Store a random unguessable password so password login is impossible until the
  // user activates and chooses their own.
  const randomPw        = crypto.randomBytes(24).toString('hex')
  const hashed          = await bcrypt.hash(randomPw, 12)
  const activationToken = crypto.randomBytes(32).toString('hex')
  const user = await new User({
    email:                 normalized,
    password:              hashed,
    name:                  (name ?? '').trim() || normalized,
    role:                  'CLIENT',
    phone:                 phone || null,
    isActive:              true,
    mustChangePassword:    true,
    activationToken,
    activationTokenExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }).save()

  return { user, isNew: true, activationToken }
}

/**
 * Upsert an ACTIVE membership linking a person to a company. Re-activates a
 * previously REMOVED row instead of creating a duplicate (respects the unique
 * (userId, clientId) index).
 */
export async function ensureMembership({ userId, clientId, role = 'MEMBER', addedBy = null }) {
  return CompanyMembership.findOneAndUpdate(
    { userId, clientId },
    { $set: { status: 'ACTIVE', role }, $setOnInsert: { addedBy } },
    { new: true, upsert: true },
  )
}
