import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
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

  // Employees who still owe onboarding (config ON + not yet HR-approved) must finish
  // their profile first. `needsOnboarding` already encodes the config flag, so turning
  // employee onboarding OFF grants immediate full access. The profile page itself shows
  // the "pending HR review" / "approved" states — no separate dead-end screen.
  if (session.user.needsOnboarding) {
    redirect('/admin/profile')
  }

  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
