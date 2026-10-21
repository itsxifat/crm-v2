'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import Header from './Header'
import CommandMenu from './CommandMenu'
import { RouteGuard } from '@/components/auth/Can'
import { cn } from '@/lib/utils'

export default function DashboardShell({ children }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const pathname = usePathname()
  // App-like pages (the mailbox) fill the panel edge to edge and scroll internally.
  const fullBleed = pathname === '/admin/mail'

  // Restore + persist the collapsed rail across reloads.
  useEffect(() => {
    try { if (localStorage.getItem('sidebar:collapsed') === '1') setCollapsed(true) } catch {}
  }, [])
  function toggleCollapsed() {
    setCollapsed(c => {
      try { localStorage.setItem('sidebar:collapsed', c ? '0' : '1') } catch {}
      return !c
    })
  }

  return (
    <div className="flex h-screen overflow-hidden bg-sidebar">
      {/* Mobile backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] transition-opacity lg:hidden',
          mobileSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={() => setMobileSidebarOpen(false)}
      />

      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      {/* Inset content panel */}
      <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white lg:rounded-xl lg:border lg:border-gray-200/80 lg:shadow-sm">
          <Header
            onMenuClick={() => setMobileSidebarOpen(true)}
            onToggleSidebar={toggleCollapsed}
            onSearchClick={() => setCommandOpen(true)}
          />
          {fullBleed ? (
            <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <RouteGuard>{children}</RouteGuard>
            </main>
          ) : (
            <main className="flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
                <RouteGuard>{children}</RouteGuard>
              </div>
            </main>
          )}
        </div>
      </div>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  )
}
