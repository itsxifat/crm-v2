import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'

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

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
