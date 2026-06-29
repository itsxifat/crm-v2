import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import connectDB from './mongodb'
import { User, Employee, Freelancer, Client, Vendor, AuditLog, CustomRole, CompanyMembership } from '@/models'

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
          const emp = await Employee.findOne({ userId: user._id }).select('customRoleId profileStatus').lean()
          profileStatus = emp?.profileStatus ?? null
          if (emp?.customRoleId) {
            const customRole = await CustomRole.findById(emp.customRoleId).select('permissions').lean()
            if (customRole) {
              customRoleId = emp.customRoleId.toString()
              // permissions is a flat string array e.g. ['sales.leads.view', 'projects.create']
              permissions  = Array.isArray(customRole.permissions) ? customRole.permissions : []
            }
          }
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
      } else if (trigger === 'update' && session) {
        // Client-initiated session.update() — switch active company / refresh flags.
        await connectDB()
        if (session.activeClientId) {
          const ok = await CompanyMembership.exists({
            userId: token.id, clientId: session.activeClientId, status: 'ACTIVE',
          })
          if (ok) token.activeClientId = session.activeClientId.toString()
        }
        // Reflect a just-completed password change immediately.
        const fresh = await User.findById(token.id).select('mustChangePassword').lean()
        if (fresh) token.mustChangePassword = fresh.mustChangePassword ?? false
      } else if (token.id) {
        // Re-sync role & permissions from DB every 5 minutes
        const SYNC_INTERVAL = 5 * 60 * 1000
        if (!token.roleSyncedAt || Date.now() - token.roleSyncedAt > SYNC_INTERVAL) {
          await connectDB()
          const freshUser = await User.findById(token.id).select('role avatar isActive mustChangePassword').lean()
          if (freshUser) {
            token.role   = freshUser.role
            token.avatar = freshUser.avatar ?? token.avatar
            token.mustChangePassword = freshUser.mustChangePassword ?? false

            if (freshUser.role === 'EMPLOYEE' || freshUser.role === 'MANAGER') {
              const emp = await Employee.findOne({ userId: token.id }).select('customRoleId profileStatus').lean()
              token.profileStatus = emp?.profileStatus ?? null
              if (emp?.customRoleId) {
                const customRole = await CustomRole.findById(emp.customRoleId).select('permissions').lean()
                token.customRoleId = emp.customRoleId.toString()
                // flat string array
                token.permissions  = Array.isArray(customRole?.permissions) ? customRole.permissions : []
              } else {
                token.customRoleId = null
                token.permissions  = null
              }
            } else {
              token.customRoleId = null
              token.permissions  = null
            }

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
