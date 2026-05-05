import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Header  from '@/components/layout/Header'
import PendingApproval from '@/components/layout/PendingApproval'
import DashboardShell from '@/components/layout/DashboardShell'

export default async function DashboardLayout({ children }) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/login')
  }

  // External roles should not see the internal dashboard layout
  const externalRoles = ['CLIENT', 'FREELANCER', 'VENDOR']
  if (externalRoles.includes(session.user.role)) {
    const portals = {
      CLIENT:     '/client/dashboard',
      FREELANCER: '/freelancer/dashboard',
      VENDOR:     '/vendor/dashboard',
    }
    redirect(portals[session.user.role])
  }

  // Employees/Managers who haven't been HR-approved yet see only a waiting screen
  const staffRoles = ['EMPLOYEE', 'MANAGER']
  if (staffRoles.includes(session.user.role) && session.user.profileStatus !== 'APPROVED') {
    return (
      <div className="flex h-screen flex-col bg-gray-50">
        <Header />
        <PendingApproval
          name={session.user.name}
          profileStatus={session.user.profileStatus}
        />
      </div>
    )
  }

  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
