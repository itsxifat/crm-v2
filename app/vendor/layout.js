import Image from 'next/image'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import VendorSidebar, { VendorMobileNav } from './VendorSidebar'

export const metadata = { title: 'Vendor Portal' }

export default async function VendorLayout({ children }) {
  const session = await getServerSession(authOptions)
  if (!session || session.user.role !== 'VENDOR') {
    redirect('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-sidebar">
      <VendorSidebar user={session.user} />

      {/* Inset content panel */}
      <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white lg:rounded-xl lg:border lg:border-gray-200/80 lg:shadow-sm">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-100 bg-white px-3 sm:px-4">
            <VendorMobileNav />
            <div className="ml-auto flex items-center gap-2.5">
              <div className="hidden text-right sm:block">
                <p className="max-w-[180px] truncate text-sm font-medium leading-tight text-gray-900">{session.user.name}</p>
                <p className="text-xs leading-tight text-muted-foreground">Vendor</p>
              </div>
              {session.user.avatar ? (
                <Image src={session.user.avatar} alt="" width={32} height={32} className="size-8 rounded-lg object-cover" />
              ) : (
                <div className="flex size-8 items-center justify-center rounded-lg bg-gray-900 text-xs font-semibold text-white">
                  {session.user.name?.[0]?.toUpperCase() ?? 'V'}
                </div>
              )}
            </div>
          </header>

          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
