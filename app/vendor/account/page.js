'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { Lock, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition bg-white text-gray-800 placeholder:text-gray-400'

export default function VendorAccountPage() {
  const { data: session } = useSession()
  const user = session?.user

  const [saving,  setSaving]  = useState(false)
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showCfm, setShowCfm] = useState(false)
  const [pw, setPw] = useState({ old: '', new: '', confirm: '' })

  async function handleSubmit(e) {
    e.preventDefault()
    if (pw.new.length < 8)    { toast.error('New password must be at least 8 characters'); return }
    if (pw.new !== pw.confirm) { toast.error('Passwords do not match'); return }
    if (pw.old === pw.new)     { toast.error('New password must differ from current'); return }

    setSaving(true)
    try {
      const res  = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: pw.old, newPassword: pw.new }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success('Password updated successfully')
      setPw({ old: '', new: '', confirm: '' })
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
    <div className="max-w-xl space-y-6">
      <Toaster position="top-center" />

      <div>
        <h1 className="text-xl font-semibold text-gray-900">My Account</h1>
        <p className="text-sm text-gray-400 mt-0.5">Your profile and security settings</p>
      </div>

      {/* Profile info */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <div className="flex items-center gap-4 mb-5 pb-5 border-b border-gray-50">
          <div className="w-12 h-12 rounded-2xl bg-orange-100 flex items-center justify-center shrink-0">
            {user.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar} alt={user.name} className="w-12 h-12 rounded-2xl object-cover" />
            ) : (
              <span className="text-lg font-bold text-orange-700">{user.name?.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">{user.name}</p>
            <p className="text-sm text-gray-500">{user.email}</p>
            <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700">
              Vendor
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Name</p>
            <p className="text-sm text-gray-800">{user.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Email</p>
            <p className="text-sm text-gray-800 break-all">{user.email ?? '—'}</p>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center">
            <Lock className="w-4 h-4 text-gray-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Change Password</p>
            <p className="text-xs text-gray-400">Minimum 8 characters</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Current Password</label>
            <div className="relative">
              <input type={showOld ? 'text' : 'password'} className={inputCls} placeholder="••••••••"
                value={pw.old} onChange={e => setPw(p => ({ ...p, old: e.target.value }))} />
              <button type="button" onClick={() => setShowOld(v => !v)} tabIndex={-1}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">New Password</label>
              <div className="relative">
                <input type={showNew ? 'text' : 'password'} className={inputCls} placeholder="••••••••"
                  value={pw.new} onChange={e => setPw(p => ({ ...p, new: e.target.value }))} />
                <button type="button" onClick={() => setShowNew(v => !v)} tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Confirm Password</label>
              <div className="relative">
                <input type={showCfm ? 'text' : 'password'} className={inputCls} placeholder="••••••••"
                  value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
                <button type="button" onClick={() => setShowCfm(v => !v)} tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showCfm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button type="submit" disabled={saving || !pw.old || !pw.new || !pw.confirm}
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
