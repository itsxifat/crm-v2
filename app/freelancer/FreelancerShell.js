'use client'

import { useState } from 'react'
import FreelancerSidebar from './FreelancerSidebar'
import FreelancerHeader from './FreelancerHeader'

export default function FreelancerShell({ user, portalType, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-gray-50 flex overflow-hidden">
      <FreelancerSidebar
        user={user}
        portalType={portalType}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <FreelancerHeader
          user={user}
          portalType={portalType}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-4 sm:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
