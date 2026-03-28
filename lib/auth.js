import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import connectDB from './mongodb'
import { User, Employee, Freelancer, Client, Vendor } from '@/models'

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        identifier: { label: 'Email / Phone / Client ID', type: 'text' },
        password:   { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
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

        return {
          id:     user._id.toString(),
          email:  user.email,
          name:   user.name,
          role:   user.role,
          avatar: user.avatar ?? null,
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id     = user.id
        token.role   = user.role
        token.avatar = user.avatar
      }
      return token
    },

    async session({ session, token }) {
      if (token) {
        session.user.id     = token.id
        session.user.role   = token.role
        session.user.avatar = token.avatar
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
