'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { User, Lock, Eye, EyeOff, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition bg-white text-gray-800 placeholder:text-gray-400'

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export default function ClientProfilePage() {
  const { data: session, update } = useSession()
  const user = session?.user

  const [saving, setSaving]     = useState(false)
  const [showOld, setShowOld]   = useState(false)
  const [showNew, setShowNew]   = useState(false)
  const [showCfm, setShowCfm]   = useState(false)

  const [pw, setPw] = useState({ oldPassword: '', newPassword: '', confirm: '' })

  async function handlePasswordChange(e) {
    e.preventDefault()
    if (pw.newPassword.length < 8) { toast.error('New password must be at least 8 characters'); return }
    if (pw.newPassword !== pw.confirm) { toast.error('Passwords do not match'); return }

    setSaving(true)
    try {
      const res  = await fetch('/api/client/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: pw.oldPassword, newPassword: pw.newPassword }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to update password')
      toast.success('Password updated successfully')
      setPw({ oldPassword: '', newPassword: '', confirm: '' })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!user) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  )

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="text-sm text-gray-500 mt-0.5">Your account information</p>
      </div>

      {/* Profile info */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-50">
          <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center shrink-0">
            {user.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar} alt={user.name} className="w-14 h-14 rounded-2xl object-cover" />
            ) : (
              <span className="text-xl font-bold text-blue-700">
                {user.name?.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">{user.name}</p>
            <p className="text-sm text-gray-500">{user.email}</p>
            <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
              Client
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Full Name</p>
            <p className="text-sm text-gray-800">{user.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Email</p>
            <p className="text-sm text-gray-800 break-all">{user.email ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Phone</p>
            <p className="text-sm text-gray-800">{user.phone ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Account Type</p>
            <p className="text-sm text-gray-800">Client Portal</p>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center">
            <Lock className="w-4 h-4 text-gray-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Change Password</p>
            <p className="text-xs text-gray-400">Minimum 8 characters</p>
          </div>
        </div>

        <form onSubmit={handlePasswordChange} className="space-y-4">
          <Field label="Current Password">
            <div className="relative">
              <input type={showOld ? 'text' : 'password'} className={inputCls} placeholder="••••••••"
                value={pw.oldPassword} onChange={e => setPw(p => ({ ...p, oldPassword: e.target.value }))} />
              <button type="button" onClick={() => setShowOld(v => !v)} tabIndex={-1}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="New Password">
              <div className="relative">
                <input type={showNew ? 'text' : 'password'} className={inputCls} placeholder="••••••••"
                  value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} />
                <button type="button" onClick={() => setShowNew(v => !v)} tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
            <Field label="Confirm Password">
              <div className="relative">
                <input type={showCfm ? 'text' : 'password'} className={inputCls} placeholder="••••••••"
                  value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
                <button type="button" onClick={() => setShowCfm(v => !v)} tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showCfm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
          </div>

          <div className="flex justify-end pt-1">
            <button type="submit" disabled={saving || !pw.oldPassword || !pw.newPassword || !pw.confirm}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
