import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import DashboardShell from '@/components/layout/DashboardShell'
import PhoneProvider from '@/components/telephony/PhoneProvider'

export default async function AdminLayout({ children }) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  const adminRoles = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']
  if (!adminRoles.includes(session.user.role)) {
    const portals = {
      CLIENT: '/client',
      FREELANCER: '/freelancer',
      VENDOR: '/vendor',
    }
    redirect(portals[session.user.role] || '/login')
  }

  // The phone wraps the shell so a call survives moving between pages.
  return (
    <PhoneProvider>
      <DashboardShell>
        {children}
      </DashboardShell>
    </PhoneProvider>
  )
}
