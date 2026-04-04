import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import connectDB from './mongodb'
import { User, Employee, Freelancer, Client, Vendor, AuditLog, CustomRole } from '@/models'

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

        await connectDB()

        const id = credentials.identifier.trim()

        // Try email first
        let user = await User.findOne({ email: id.toLowerCase() }).lean()

        // Try phone
        if (!user) {
          user = await User.findOne({ phone: id }).lean()
        }

        // Try client code (clientCode on Client model → get userId)
        if (!user) {
          const client = await Client.findOne({ clientCode: id.toUpperCase() }).select('userId').lean()
          if (client) user = await User.findById(client.userId).lean()
        }

        if (!user || !user.isActive) return null

        const passwordMatch = await bcrypt.compare(credentials.password, user.password)
        if (!passwordMatch) return null

        await User.findByIdAndUpdate(user._id, { lastLogin: new Date() })

        // Fire-and-forget login audit log
        const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
                || req?.socket?.remoteAddress
                || null
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

        // Load custom role permissions for employees
        let customRoleId  = null
        let permissions   = null
        if (user.role === 'EMPLOYEE') {
          const emp = await Employee.findOne({ userId: user._id }).select('customRoleId').lean()
          if (emp?.customRoleId) {
            const customRole = await CustomRole.findById(emp.customRoleId).select('permissions title').lean()
            if (customRole) {
              customRoleId = emp.customRoleId.toString()
              permissions  = customRole.permissions ?? null
            }
          }
        }

        return {
          id:           user._id.toString(),
          email:        user.email,
          name:         user.name,
          role:         user.role,
          avatar:       user.avatar ?? null,
          customRoleId,
          permissions,
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id           = user.id
        token.role         = user.role
        token.avatar       = user.avatar
        token.customRoleId = user.customRoleId ?? null
        token.permissions  = user.permissions  ?? null
      }
      return token
    },

    async session({ session, token }) {
      if (token) {
        session.user.id           = token.id
        session.user.role         = token.role
        session.user.avatar       = token.avatar
        session.user.customRoleId = token.customRoleId ?? null
        session.user.permissions  = token.permissions  ?? null
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
    maxAge:   30 * 24 * 60 * 60, // 30 days
  },

  secret: process.env.NEXTAUTH_SECRET,
}
