'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Eye, EyeOff } from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import { validateStrongPassword } from '@/lib/passwordPolicy'
import Avatar from '@/components/ui/Avatar'
import FileUpload from '@/components/ui/FileUpload'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import PageHeader from '@/components/ui/PageHeader'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card'
import { Input, Field } from '@/components/ui/Input'
import { PageLoader } from '@/components/ui/LoadingSpinner'

const ROLE_META = {
  SUPER_ADMIN: { label: 'Super admin', variant: 'danger'  },
  MANAGER:     { label: 'Manager',     variant: 'primary' },
  EMPLOYEE:    { label: 'Employee',    variant: 'default' },
}

function PasswordField({ label, value, onChange, show, onToggle, error, className }) {
  return (
    <Field label={label} error={error || undefined} className={className}>
      <div className="relative">
        <Input
          type={show ? 'text' : 'password'}
          className="pr-10"
          placeholder="••••••••"
          value={value}
          onChange={onChange}
          autoComplete="new-password"
          invalid={!!error}
        />
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </Field>
  )
}

export default function AdminAccountPage() {
  const { data: session, update } = useSession()

  // ── Profile ──
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState({ name: '', email: '', phone: '', avatar: null })
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
          setForm({ name: j.data.name ?? '', email: j.data.email ?? '', phone: j.data.phone ?? '', avatar: j.data.avatar ?? null })
        }
      })
      .catch(() => toast.error("Couldn't load profile"))
      .finally(() => setLoading(false))
  }, [])

  const role     = profile?.role ?? session?.user?.role
  const roleMeta = ROLE_META[role] ?? { label: role, variant: 'default' }

  async function saveProfile(e) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSavingProfile(true)
    try {
      const res  = await fetch('/api/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || null, avatar: form.avatar ?? null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Couldn't save profile")
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
    const pwError = validateStrongPassword(pw.new)
    if (pwError)               { toast.error(pwError); return }
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
      if (!res.ok) throw new Error(json.error ?? "Couldn't update password")
      toast.success('Password updated')
      setPw({ old: '', new: '', confirm: '' })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading || !profile) return <PageLoader />

  const newPwError     = pw.new && validateStrongPassword(pw.new)
  const confirmPwError = pw.new && pw.confirm && pw.new !== pw.confirm ? 'Passwords do not match' : null

  return (
    <div className="max-w-3xl space-y-6">
      <Toaster position="top-center" />

      <PageHeader title="Account" />

      {/* Profile edit */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>

        <form onSubmit={saveProfile}>
          <CardContent className="space-y-5">
            {/* Avatar + identity */}
            <div className="flex items-center gap-4">
              <Avatar name={form.name || profile.name} src={form.avatar} size="lg" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-base font-semibold text-gray-900">{form.name || profile.name}</p>
                  <Badge variant={roleMeta.variant}>{roleMeta.label}</Badge>
                </div>
                <p className="break-all text-sm text-muted-foreground">{form.email || profile.email}</p>
              </div>
            </div>

            <FileUpload
              label="Profile photo"
              value={form.avatar || ''}
              onUploaded={url => setForm(f => ({ ...f, avatar: url || null }))}
              accept="image/*"
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name">
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Your name" />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+880…" />
              </Field>
              <Field label="Email" hint="Used to sign in; changes apply next login." className="sm:col-span-2">
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="you@example.com" />
              </Field>
            </div>
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit" loading={savingProfile} disabled={!form.name.trim()}>
              {savingProfile ? 'Saving…' : 'Save profile'}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Change password</CardTitle>
            <CardDescription>8+ characters, mixed case, number, symbol</CardDescription>
          </div>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <PasswordField
                label="Current password"
                className="sm:col-span-2"
                value={pw.old}
                onChange={e => setPw(p => ({ ...p, old: e.target.value }))}
                show={showOld}
                onToggle={() => setShowOld(v => !v)}
              />
              <PasswordField
                label="New password"
                value={pw.new}
                onChange={e => setPw(p => ({ ...p, new: e.target.value }))}
                show={showNew}
                onToggle={() => setShowNew(v => !v)}
                error={newPwError}
              />
              <PasswordField
                label="Confirm password"
                value={pw.confirm}
                onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))}
                show={showCfm}
                onToggle={() => setShowCfm(v => !v)}
                error={confirmPwError}
              />
            </div>
          </CardContent>

          <CardFooter className="justify-end">
            <Button type="submit" loading={saving} disabled={!pw.old || !pw.new || !pw.confirm}>
              {saving ? 'Saving…' : 'Update password'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
