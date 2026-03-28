import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import ClientNav from './ClientNav'

export const metadata = {
  title: { default: 'Client Portal', template: '%s | Client Portal' },
}

export default async function ClientLayout({ children }) {
  const session = await getServerSession(authOptions)

  if (!session || session.user.role !== 'CLIENT') {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <ClientNav user={session.user} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
