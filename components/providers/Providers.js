'use client'

import { SessionProvider } from 'next-auth/react'
import { Toaster } from 'react-hot-toast'

export default function Providers({ children, session }) {
  return (
    <SessionProvider
      session={session}
      // Refresh the JWT often so server-side changes (employee onboarding config
      // toggle, HR approval) propagate to the middleware gate quickly — within
      // ~20s automatically, and instantly when the user refocuses the tab.
      refetchInterval={20}
      refetchOnWindowFocus={true}
    >
      {children}
      <Toaster
        position="top-right"
        reverseOrder={false}
        gutter={8}
        containerStyle={{ zIndex: 9999 }}
        toastOptions={{
          duration: 4000,
          // shadcn / sonner look: white card, hairline zinc border, soft shadow
          style: {
            background:   '#fff',
            color:        '#18181b',             // zinc-900
            border:       '1px solid #e4e4e7',   // zinc-200
            borderRadius: '12px',
            boxShadow:    '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
            fontSize:     '0.875rem',            // text-sm
            lineHeight:   '1.25rem',
            fontWeight:   500,
            padding:      '10px 14px',
            maxWidth:     '380px',
          },
          success: {
            iconTheme: {
              primary:   '#10b981',              // emerald-500
              secondary: '#fff',
            },
          },
          error: {
            iconTheme: {
              primary:   '#ef4444',              // red-500
              secondary: '#fff',
            },
          },
          loading: {
            iconTheme: {
              primary:   '#18181b',
              secondary: '#e4e4e7',
            },
          },
        }}
      />
    </SessionProvider>
  )
}
