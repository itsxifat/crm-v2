'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { Lock, Loader2, ShieldCheck, Eye, EyeOff, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { passwordChecklist, isStrongPassword } from '@/lib/passwordPolicy'

// First-time password set for a just-activated client. Unlike /client/change-password
// this page NEVER asks for a current password — the client doesn't have one yet
// (they got here via an emailed activation OTP). The authenticated session is
// sufficient; the API skips the old-password check while mustChangePassword is set.
export default function ClientSetPasswordPage() {
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm]         = useState('')
  const [show, setShow]               = useState(false)
  const [saving, setSaving]           = useState(false)

  const checks = passwordChecklist(newPassword)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isStrongPassword(newPassword)) { toast.error('Please meet all password requirements'); return }
    if (newPassword !== confirm) { toast.error('Passwords do not match'); return }
    setSaving(true)
    try {
      const res  = await fetch('/api/client/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to set password')
      // Setup complete. Rather than soft-navigating into the panel (which races
      // the session refresh and often bounces the client right back here), sign
      // them out and send them to a clean login with their new password. This
      // rebuilds the token from scratch — mustChangePassword cleared and company
      // gating resolved — so the first real sign-in lands them properly.
      toast.success('Password set — please sign in')
      await signOut({ callbackUrl: '/login?passwordSet=1' })
    } catch (err) {
      toast.error(err.message)
      setSaving(false)
    }
  }

  const ic = 'w-full border border-gray-200 rounded-xl pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Set your password</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Choose a strong password to finish setting up your account.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type={show ? 'text' : 'password'}
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="New password"
              className={ic}
              required
            />
            <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              className={ic}
              required
            />
          </div>

          {/* Strength checklist */}
          <ul className="grid grid-cols-2 gap-1.5">
            {checks.map(c => (
              <li key={c.key} className={`flex items-center gap-1.5 text-xs ${c.passed ? 'text-green-600' : 'text-gray-400'}`}>
                {c.passed ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                {c.label}
              </li>
            ))}
          </ul>

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Set password &amp; continue
          </button>
        </form>
      </div>
    </div>
  )
}
