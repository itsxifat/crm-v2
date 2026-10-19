'use client'

import { useState } from 'react'
import FreelancerSidebar from './FreelancerSidebar'
import FreelancerHeader from './FreelancerHeader'

export default function FreelancerShell({ user, portalType, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-sidebar">
      <FreelancerSidebar
        user={user}
        portalType={portalType}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Inset content panel */}
      <div className="flex min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white lg:rounded-xl lg:border lg:border-gray-200/80 lg:shadow-sm">
          <FreelancerHeader
            user={user}
            portalType={portalType}
            onMenuClick={() => setSidebarOpen(true)}
          />
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
