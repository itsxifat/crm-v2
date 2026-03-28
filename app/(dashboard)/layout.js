import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Header  from '@/components/layout/Header'

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

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
