import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'

const ROLE_DASHBOARDS = {
  SUPER_ADMIN: '/admin',
  MANAGER:     '/admin',
  EMPLOYEE:    '/admin',
  FREELANCER:  '/freelancer',
  CLIENT:      '/client',
  VENDOR:      '/vendor',
}

export default async function RootPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  const destination = ROLE_DASHBOARDS[session.user.role] ?? '/dashboard'
  redirect(destination)
}
