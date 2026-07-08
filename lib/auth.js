import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import connectDB from './mongodb'
import { getConfig } from '@/lib/getConfig'
import { User, Employee, Freelancer, Client, Vendor, AuditLog, CustomRole, CompanyMembership } from '@/models'
import { applyPermissionOverrides, hasPermissionOverrides, DEFAULT_ROLE_PERMISSIONS } from '@/lib/rbac'

// Resolve the effective permission array for a staff member: the assigned custom
// role's permissions (or the base-role defaults when none is assigned), with the
// person's individual overrides layered on top. Returns { customRoleId, permissions }
// where `permissions` is null only when there is neither a custom role nor any
// overrides — so callers still fall back to DEFAULT_ROLE_PERMISSIONS via canDo().
async function resolveStaffPermissions(emp, role) {
  let customRoleId = null
  let basePerms    = null
  if (emp?.customRoleId) {
    const customRole = await CustomRole.findById(emp.customRoleId).select('permissions').lean()
    if (customRole) {
      customRoleId = emp.customRoleId.toString()
      basePerms    = Array.isArray(customRole.permissions) ? customRole.permissions : []
    }
  }

  const overrides = emp?.permissionOverrides
  let permissions = null
  if (basePerms !== null) {
    // Custom role assigned → start from its permissions, then apply overrides.
    permissions = applyPermissionOverrides(basePerms, overrides)
  } else if (hasPermissionOverrides(overrides)) {
    // No custom role but individual tweaks exist → start from base-role defaults.
    permissions = applyPermissionOverrides(DEFAULT_ROLE_PERMISSIONS[role] ?? [], overrides)
  }
  return { customRoleId, permissions }
}

// Whether an EMPLOYEE must finish profile + KYC before getting panel access.
// Driven by the `verification.employeeOnboarding` config flag (default: required).
// Returns false for non-employees and already-approved profiles, so the gate
// only fires for employees who genuinely still need to onboard. Because this is
// recomputed on every token re-sync, flipping the config later re-gates (or
// frees) employees within the sync window — exactly the "make KYC mandatory and
// they must complete or lose access" behaviour.
async function computeNeedsOnboarding(role, profileStatus) {
  if (role !== 'EMPLOYEE') return false
  if (profileStatus === 'APPROVED') return false
  await connectDB()
  const cfg = await getConfig()
  return cfg?.verification?.employeeOnboarding !== false
}

// Whether a FREELANCER/AGENCY must finish KYC + admin approval before panel access.
// Driven by the `verification.freelancer` config flag (default: required). Mirrors
// computeNeedsOnboarding: false for non-freelancers and already-approved profiles,
// recomputed on every token sync so flipping the config re-gates/frees immediately.
async function computeFreelancerNeedsVerification(role, profileStatus) {
  if (role !== 'FREELANCER') return false
  if (profileStatus === 'APPROVED') return false
  await connectDB()
  const cfg = await getConfig()
  return cfg?.verification?.freelancer !== false
}

// ─── Login rate limiter (per identifier, resets after window) ─────────────────
// Works on single-server / dev; for multi-instance/serverless add Redis.
const _loginAttempts = new Map()
const LOGIN_MAX      = 10          // max failures before lockout
const LOGIN_WINDOW   = 15 * 60 * 1000  // 15-minute rolling window

function checkLoginRateLimit(key) {
  const now    = Date.now()
  const entry  = _loginAttempts.get(key) ?? { count: 0, since: now }
  if (now - entry.since > LOGIN_WINDOW) { entry.count = 0; entry.since = now }
  entry.count += 1
  _loginAttempts.set(key, entry)
  if (entry.count > LOGIN_MAX) return false   // too many attempts
  return true                                 // OK
}
function clearLoginRateLimit(key) { _loginAttempts.delete(key) }

// Use secure (__Secure- / secure-flag) cookies only when actually served over
// HTTPS. Derived from NEXTAUTH_URL so plain-HTTP deployments (e.g. raw IPv6)
// can still set the session cookie. NextAuth uses the same rule for its other
// cookies (csrf / callback), keeping them consistent.
const useSecureCookies = (process.env.NEXTAUTH_URL || '').startsWith('https://')

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        identifier: { label: 'Email / Phone / Client ID', type: 'text' },
        password:   { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        // Accept either a password OR a first-time activation OTP.
        if (!credentials?.identifier || (!credentials?.password && !credentials?.otp)) return null

        const ip  = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
                 || req?.socket?.remoteAddress
                 || 'unknown'
        const id  = credentials.identifier.trim()
        const rlKey = `${ip}:${id.toLowerCase()}`

        if (!checkLoginRateLimit(rlKey)) {
          throw new Error('Too many login attempts. Try again in 15 minutes.')
        }

        await connectDB()

        // Look up by email (case-insensitive), then phone, then client code.
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        let user = await User.findOne({ email: { $regex: `^${escaped}$`, $options: 'i' } }).lean()

        if (!user) {
          user = await User.findOne({ phone: id }).lean()
        }

        // Try client code (clientCode on Client model → get userId)
        if (!user) {
          const client = await Client.findOne({ clientCode: id.toUpperCase() }).select('userId').lean()
          if (client) user = await User.findById(client.userId).lean()
        }

        if (!user || !user.isActive) return null

        if (credentials.otp) {
          // First-time activation via emailed OTP — only valid until a password is set.
          if (!user.mustChangePassword) return null
          const otpOk = !!user.loginOtp
            && !!user.loginOtpExpiry && new Date(user.loginOtpExpiry) > new Date()
            && await bcrypt.compare(String(credentials.otp), user.loginOtp)
          if (!otpOk) return null
          // Burn the OTP + activation token so neither can be reused.
          await User.findByIdAndUpdate(user._id, {
            $set: { loginOtp: null, loginOtpExpiry: null, activationToken: null, activationTokenExpiry: null },
          })
        } else {
          const passwordMatch = await bcrypt.compare(credentials.password, user.password)
          if (!passwordMatch) return null
        }

        clearLoginRateLimit(rlKey)
        await User.findByIdAndUpdate(user._id, { lastLogin: new Date() })

        // Fire-and-forget login audit log
        const ua = req?.headers?.['user-agent'] || null
        AuditLog.create({
          userId:    user._id,
          userRole:  user.role,
          action:    'LOGIN',
          entity:    'USER',
          entityId:  user._id.toString(),
          ipAddress: ip,
          userAgent: ua,
        }).catch(err => console.error('[AuditLog] LOGIN entry failed:', err))

        // Load custom role permissions (flat string array) and profile status
        let customRoleId  = null
        let permissions   = null
        let profileStatus = null
        if (user.role === 'EMPLOYEE' || user.role === 'MANAGER') {
          const emp = await Employee.findOne({ userId: user._id }).select('customRoleId permissionOverrides profileStatus').lean()
          profileStatus = emp?.profileStatus ?? null
          // Custom role permissions + this person's individual overrides.
          ;({ customRoleId, permissions } = await resolveStaffPermissions(emp, user.role))
        } else if (user.role === 'FREELANCER') {
          const fl = await Freelancer.findOne({ userId: user._id }).select('profileStatus').lean()
          profileStatus = fl?.profileStatus ?? null
        }

        return {
          id:            user._id.toString(),
          email:         user.email,
          name:          user.name,
          role:          user.role,
          avatar:        user.avatar ?? null,
          customRoleId,
          permissions,
          profileStatus,
          mustChangePassword: user.mustChangePassword ?? false,
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        // Initial sign-in
        token.id            = user.id
        token.role          = user.role
        token.avatar        = user.avatar
        token.customRoleId  = user.customRoleId  ?? null
        token.permissions   = user.permissions   ?? null
        token.profileStatus = user.profileStatus ?? null
        token.mustChangePassword = user.mustChangePassword ?? false
        token.needsOnboarding = await computeNeedsOnboarding(user.role, token.profileStatus)
        token.needsVerification = await computeFreelancerNeedsVerification(user.role, token.profileStatus)
        token.roleSyncedAt  = Date.now()
        // CLIENT: record how many companies they belong to so the router only
        // forces the chooser when there's an actual choice (2+). Exactly one →
        // pre-select it; zero (an individual with no company yet) → no gate, they
        // use the panel as a personal/empty workspace.
        if (user.role === 'CLIENT') {
          await connectDB()
          const memberships = await CompanyMembership.find({ userId: user.id, status: 'ACTIVE' }).select('clientId').lean()
          token.companyCount   = memberships.length
          token.activeClientId = memberships.length === 1 ? memberships[0].clientId.toString() : null
        }
      } else if (trigger === 'update') {
        // Client-initiated session.update() — switch active company / refresh flags.
        // update() may be called with NO argument (e.g. the change-password page
        // refreshing flags after a first-time set), so `session` can be undefined.
        // Don't gate on it — otherwise the refresh below silently no-ops and the
        // stale mustChangePassword=true bounces the client back into the form.
        await connectDB()
        if (session?.activeClientId) {
          const ok = await CompanyMembership.exists({
            userId: token.id, clientId: session.activeClientId, status: 'ACTIVE',
          })
          if (ok) token.activeClientId = session.activeClientId.toString()
        }
        // Reflect a just-completed password change / profile edit immediately.
        const fresh = await User.findById(token.id).select('mustChangePassword name email avatar').lean()
        if (fresh) {
          token.mustChangePassword = fresh.mustChangePassword ?? false
          token.name   = fresh.name ?? token.name
          token.email  = fresh.email ?? token.email
          token.avatar = fresh.avatar ?? null
        }
        // Refresh the employee onboarding gate (e.g. profile just completed/approved).
        if (token.role === 'EMPLOYEE') {
          const emp = await Employee.findOne({ userId: token.id }).select('profileStatus').lean()
          token.profileStatus   = emp?.profileStatus ?? null
          token.needsOnboarding = await computeNeedsOnboarding('EMPLOYEE', token.profileStatus)
        } else if (token.role === 'FREELANCER') {
          const fl = await Freelancer.findOne({ userId: token.id }).select('profileStatus').lean()
          token.profileStatus     = fl?.profileStatus ?? null
          token.needsVerification = await computeFreelancerNeedsVerification('FREELANCER', token.profileStatus)
        }
      } else if (token.id) {
        // Re-sync role & permissions from DB every 5 minutes
        const SYNC_INTERVAL = 5 * 60 * 1000
        const dueForFullSync = !token.roleSyncedAt || Date.now() - token.roleSyncedAt > SYNC_INTERVAL
        if (dueForFullSync) {
          await connectDB()
          const freshUser = await User.findById(token.id).select('role avatar isActive mustChangePassword').lean()
          if (freshUser) {
            token.role   = freshUser.role
            token.avatar = freshUser.avatar ?? token.avatar
            token.mustChangePassword = freshUser.mustChangePassword ?? false

            if (freshUser.role === 'EMPLOYEE' || freshUser.role === 'MANAGER') {
              const emp = await Employee.findOne({ userId: token.id }).select('customRoleId permissionOverrides profileStatus').lean()
              token.profileStatus = emp?.profileStatus ?? null
              const rbac = await resolveStaffPermissions(emp, freshUser.role)
              token.customRoleId = rbac.customRoleId
              token.permissions  = rbac.permissions
            } else if (freshUser.role === 'FREELANCER') {
              const fl = await Freelancer.findOne({ userId: token.id }).select('profileStatus').lean()
              token.profileStatus = fl?.profileStatus ?? null
              token.customRoleId  = null
              token.permissions   = null
            } else {
              token.customRoleId = null
              token.permissions  = null
            }

            // Re-evaluate the gates every sync so config changes (toggling KYC on/off)
            // take effect within the sync window.
            token.needsOnboarding   = await computeNeedsOnboarding(freshUser.role, token.profileStatus)
            token.needsVerification = await computeFreelancerNeedsVerification(freshUser.role, token.profileStatus)

            // Keep the CLIENT's company count fresh (it drives the chooser gate)
            // and self-heal a missing active selection when they belong to exactly
            // one company (covers sessions issued before companyCount existed, or a
            // user just added to their first company).
            if (freshUser.role === 'CLIENT') {
              const memberships = await CompanyMembership.find({ userId: token.id, status: 'ACTIVE' }).select('clientId').lean()
              token.companyCount = memberships.length
              if (!token.activeClientId && memberships.length === 1) {
                token.activeClientId = memberships[0].clientId.toString()
              }
            }
          }
          token.roleSyncedAt = Date.now()
        } else if (token.role === 'EMPLOYEE') {
          // Between full syncs, keep ONLY the onboarding gate live so config toggles
          // and HR approvals take effect immediately (not up to 5 min later). Cheap:
          // one profileStatus read + short-cached config. With the SessionProvider
          // refetch (on interval + tab focus), freeing/gating an employee applies
          // within seconds on their next request.
          await connectDB()
          const emp = await Employee.findOne({ userId: token.id }).select('profileStatus').lean()
          token.profileStatus   = emp?.profileStatus ?? null
          token.needsOnboarding = await computeNeedsOnboarding('EMPLOYEE', token.profileStatus)
        } else if (token.role === 'FREELANCER') {
          // Same immediate-propagation treatment for the freelancer/agency KYC gate.
          await connectDB()
          const fl = await Freelancer.findOne({ userId: token.id }).select('profileStatus').lean()
          token.profileStatus     = fl?.profileStatus ?? null
          token.needsVerification = await computeFreelancerNeedsVerification('FREELANCER', token.profileStatus)
        }
      }
      return token
    },

    async session({ session, token }) {
      if (token) {
        session.user.id            = token.id
        session.user.role          = token.role
        session.user.avatar        = token.avatar
        session.user.customRoleId  = token.customRoleId  ?? null
        session.user.permissions   = token.permissions   ?? null
        session.user.profileStatus = token.profileStatus ?? null
        session.user.needsOnboarding     = token.needsOnboarding     ?? false
        session.user.needsVerification   = token.needsVerification   ?? false
        session.user.activeClientId      = token.activeClientId      ?? null
        session.user.companyCount        = token.companyCount        ?? 0
        session.user.mustChangePassword  = token.mustChangePassword  ?? false
      }
      return session
    },
  },

  pages: {
    signIn: '/login',
    error:  '/login',
  },

  session: {
    strategy: 'jwt',
    maxAge:   8 * 60 * 60, // 8-hour sessions
  },

  // Harden session cookies
  cookies: {
    sessionToken: {
      name: useSecureCookies
        ? '__Secure-next-auth.session-token'
        : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'strict',
        path:     '/',
        secure:   useSecureCookies,
      },
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
}
