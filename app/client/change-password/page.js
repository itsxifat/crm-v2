'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { Lock, Loader2, ShieldCheck, Eye, EyeOff, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { passwordChecklist, isStrongPassword } from '@/lib/passwordPolicy'

export default function ClientChangePasswordPage() {
  const router = useRouter()
  const { data: session, update } = useSession()
  const firstTime = session?.user?.mustChangePassword === true

  const [oldPassword, setOldPassword] = useState('')
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
        body: JSON.stringify({ oldPassword: firstTime ? undefined : oldPassword, newPassword }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to update password')
      if (firstTime) {
        // First-time setup: sign out and re-login with the new password so the
        // token is rebuilt cleanly (no mustChangePassword/company-gate races).
        toast.success('Password set — please sign in')
        await signOut({ callbackUrl: '/login?passwordSet=1' })
        return
      }
      await update()  // refresh the session after a normal password change
      toast.success('Password updated')
      router.replace('/client')
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
          <h1 className="text-lg font-semibold text-gray-900">{firstTime ? 'Set your password' : 'Change password'}</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          {firstTime
            ? 'Choose a strong password to finish setting up your account.'
            : 'Update the password you use to sign in.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!firstTime && (
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type={show ? 'text' : 'password'}
                value={oldPassword}
                onChange={e => setOldPassword(e.target.value)}
                placeholder="Current password"
                className={ic}
                required
              />
            </div>
          )}
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
            {firstTime ? 'Set password & continue' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
