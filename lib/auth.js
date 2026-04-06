import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import connectDB from './mongodb'
import { User, Employee, Freelancer, Client, Vendor, AuditLog, CustomRole } from '@/models'
import { blindIndex } from './encryption'

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

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        identifier: { label: 'Email / Phone / Client ID', type: 'text' },
        password:   { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.identifier || !credentials?.password) return null

        const ip  = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
                 || req?.socket?.remoteAddress
                 || 'unknown'
        const id  = credentials.identifier.trim()
        const rlKey = `${ip}:${id.toLowerCase()}`

        if (!checkLoginRateLimit(rlKey)) {
          throw new Error('Too many login attempts. Try again in 15 minutes.')
        }

        await connectDB()

        // Email and phone are encrypted in the DB; use blind indexes for lookup.
        const emailToken = blindIndex(id, 'users', 'email')
        let user = await User.findOne({ emailIdx: emailToken }).select('+emailIdx +phoneIdx').lean()

        // Try phone blind index
        if (!user) {
          const phoneToken = blindIndex(id, 'users', 'phone')
          user = await User.findOne({ phoneIdx: phoneToken }).select('+emailIdx +phoneIdx').lean()
        }

        // Try client code (clientCode on Client model → get userId)
        if (!user) {
          const client = await Client.findOne({ clientCode: id.toUpperCase() }).select('userId').lean()
          if (client) user = await User.findById(client.userId).lean()
        }

        if (!user || !user.isActive) return null

        const passwordMatch = await bcrypt.compare(credentials.password, user.password)
        if (!passwordMatch) return null

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
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in
        token.id            = user.id
        token.role          = user.role
        token.avatar        = user.avatar
        token.customRoleId  = user.customRoleId  ?? null
        token.permissions   = user.permissions   ?? null
        token.profileStatus = user.profileStatus ?? null
        token.roleSyncedAt  = Date.now()
      } else if (token.id) {
        // Re-sync role & permissions from DB every 5 minutes
        const SYNC_INTERVAL = 5 * 60 * 1000
        if (!token.roleSyncedAt || Date.now() - token.roleSyncedAt > SYNC_INTERVAL) {
          await connectDB()
          const freshUser = await User.findById(token.id).select('role avatar isActive').lean()
          if (freshUser) {
            token.role   = freshUser.role
            token.avatar = freshUser.avatar ?? token.avatar

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
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-next-auth.session-token'
        : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'strict',
        path:     '/',
        secure:   process.env.NODE_ENV === 'production',
      },
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
}
