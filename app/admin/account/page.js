'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Lock, Eye, EyeOff, Loader2, CheckCircle, Shield, UserCog } from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import Avatar from '@/components/ui/Avatar'
import FileUpload from '@/components/ui/FileUpload'

const ROLE_META = {
  SUPER_ADMIN: { label: 'Super Admin', bg: 'bg-red-50',    text: 'text-red-700'    },
  MANAGER:     { label: 'Manager',     bg: 'bg-blue-50',   text: 'text-blue-700'   },
  EMPLOYEE:    { label: 'Employee',    bg: 'bg-gray-100',  text: 'text-gray-600'   },
}

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition bg-white text-gray-800 placeholder:text-gray-400'

function PasswordField({ label, value, onChange, show, onToggle }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{label}</label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          className={inputCls}
          placeholder="••••••••"
          value={value}
          onChange={onChange}
          autoComplete="new-password"
        />
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

export default function AdminAccountPage() {
  const { data: session, update } = useSession()

  // ── Profile ──
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState({ name: '', phone: '', avatar: null })
  const [savingProfile, setSavingProfile] = useState(false)

  // ── Password ──
  const [saving,   setSaving]   = useState(false)
  const [showOld,  setShowOld]  = useState(false)
  const [showNew,  setShowNew]  = useState(false)
  const [showCfm,  setShowCfm]  = useState(false)
  const [pw, setPw] = useState({ old: '', new: '', confirm: '' })

  useEffect(() => {
    fetch('/api/account')
      .then(r => r.json())
      .then(j => {
        if (j.data) {
          setProfile(j.data)
          setForm({ name: j.data.name ?? '', phone: j.data.phone ?? '', avatar: j.data.avatar ?? null })
        }
      })
      .catch(() => toast.error('Failed to load profile'))
      .finally(() => setLoading(false))
  }, [])

  const role     = profile?.role ?? session?.user?.role
  const roleMeta = ROLE_META[role] ?? { label: role, bg: 'bg-gray-100', text: 'text-gray-600' }

  async function saveProfile(e) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSavingProfile(true)
    try {
      const res  = await fetch('/api/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), phone: form.phone.trim() || null, avatar: form.avatar ?? null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success('Profile updated')
      setProfile(p => ({ ...p, ...json.data }))
      await update()   // refresh name/avatar in the session (sidebar + header)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingProfile(false)
    }
  }

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

  if (loading || !profile) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  )

  return (
    <div className="max-w-2xl space-y-6">
      <Toaster position="top-center" />

      <div>
        <h1 className="text-xl font-semibold text-gray-900">My Account</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your profile and security settings</p>
      </div>

      {/* Profile edit */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-9 h-9 bg-gray-50 rounded-xl flex items-center justify-center">
            <UserCog className="w-4 h-4 text-gray-500" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Profile</p>
            <p className="text-xs text-gray-400">Your name, photo and contact number</p>
          </div>
        </div>

        <form onSubmit={saveProfile} className="space-y-5">
          {/* Avatar + identity */}
          <div className="flex items-center gap-4">
            <Avatar name={form.name || profile.name} src={form.avatar} size="lg" />
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-900 truncate">{form.name || profile.name}</p>
              <p className="text-sm text-gray-500 break-all">{profile.email}</p>
              <span className={`inline-flex items-center gap-1 mt-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${roleMeta.bg} ${roleMeta.text}`}>
                <Shield className="w-3 h-3" /> {roleMeta.label}
              </span>
            </div>
          </div>

          <FileUpload
            label="Profile photo"
            value={form.avatar || ''}
            onUploaded={url => setForm(f => ({ ...f, avatar: url || null }))}
            accept="image/*"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Full Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Phone</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+880…" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Email <span className="text-gray-400 normal-case font-normal">(login — read only)</span></label>
              <input value={profile.email} disabled className={`${inputCls} bg-gray-50 text-gray-500 cursor-not-allowed`} />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button type="submit" disabled={savingProfile || !form.name.trim()}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {savingProfile ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </form>
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
          <PasswordField
            label="Current Password"
            value={pw.old}
            onChange={e => setPw(p => ({ ...p, old: e.target.value }))}
            show={showOld}
            onToggle={() => setShowOld(v => !v)}
          />

          <div className="grid grid-cols-2 gap-3">
            <PasswordField
              label="New Password"
              value={pw.new}
              onChange={e => setPw(p => ({ ...p, new: e.target.value }))}
              show={showNew}
              onToggle={() => setShowNew(v => !v)}
            />
            <PasswordField
              label="Confirm Password"
              value={pw.confirm}
              onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))}
              show={showCfm}
              onToggle={() => setShowCfm(v => !v)}
            />
          </div>

          {pw.new && pw.new.length < 8 && (
            <p className="text-xs text-red-500">Password must be at least 8 characters</p>
          )}
          {pw.new && pw.confirm && pw.new !== pw.confirm && (
            <p className="text-xs text-red-500">Passwords do not match</p>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={saving || !pw.old || !pw.new || !pw.confirm}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
