import Image from 'next/image'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import FreelancerSidebar from './FreelancerSidebar'

export const metadata = { title: 'Freelancer Portal' }

export default async function FreelancerLayout({ children }) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'FREELANCER') {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <FreelancerSidebar user={session.user} />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 bg-white border-b border-gray-100 flex items-center px-6 shrink-0">
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-800">{session.user.name}</p>
              <p className="text-xs text-gray-400">Freelancer</p>
            </div>
            {session.user.avatar ? (
              <Image src={session.user.avatar} alt="" width={32} height={32} className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                {session.user.name?.[0]?.toUpperCase() ?? 'F'}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
