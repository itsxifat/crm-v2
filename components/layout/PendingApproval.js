'use client'

import { signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Clock, LogOut } from 'lucide-react'

const STATUS_LABELS = {
  CREATED:          'Your account has been created.',
  INCOMPLETE:       'Your profile is incomplete.',
  PENDING_APPROVAL: 'Your profile has been submitted and is under review.',
}

export default function PendingApproval({ name, profileStatus }) {
  const router = useRouter()

  async function handleSignOut() {
    await signOut({ redirect: false })
    router.push('/login')
  }

  const statusNote = STATUS_LABELS[profileStatus] ?? 'Your account is being processed.'

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center">
          <Clock className="w-8 h-8 text-yellow-500" />
        </div>

        <h1 className="text-2xl font-semibold text-gray-900 mb-2">
          Waiting for Verification
        </h1>

        <p className="text-gray-500 mb-1">
          Hi {name}, {statusNote}
        </p>

        <p className="text-gray-400 text-sm mb-8">
          Your account is pending HR approval. You will gain full access once an administrator approves your profile. Please check back later or contact your HR team.
        </p>

        <button
          onClick={handleSignOut}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </main>
  )
}
