'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card'
import { Input, Field } from '@/components/ui/Input'
import { PageLoader } from '@/components/ui/LoadingSpinner'

// Password input with a show/hide toggle.
function PasswordInput({ show, onToggle, ...props }) {
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} className="pr-9" placeholder="••••••••" {...props} />
      <button type="button" onClick={onToggle} tabIndex={-1} aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

function InfoItem({ label, children, className }) {
  return (
    <div className={className}>
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-gray-900">{children}</dd>
    </div>
  )
}

export default function ClientProfilePage() {
  const { data: session, update } = useSession()
  const user = session?.user

  // Phone is not carried in the session token — load it from the account API.
  const [phone, setPhone] = useState(null)
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetch('/api/account')
      .then(r => (r.ok ? r.json() : null))
      .then(json => { if (!cancelled) setPhone(json?.data?.phone || null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [userId])

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
      toast.success('Password updated')
      setPw({ oldPassword: '', newPassword: '', confirm: '' })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!user) return <PageLoader />

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Profile" />

      {/* Profile info */}
      <Card>
        <div className="flex items-center gap-4 border-b border-gray-100 p-5">
          {user.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar} alt={user.name} className="size-12 shrink-0 rounded-full object-cover ring-1 ring-black/5" />
          ) : (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gray-900 text-base font-semibold text-white">
              {user.name?.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-gray-900">{user.name}</p>
              <Badge>Client</Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <dl className="grid gap-5 p-5 sm:grid-cols-2">
          <InfoItem label="Full name">{user.name ?? '—'}</InfoItem>
          <InfoItem label="Email"><span className="break-all">{user.email ?? '—'}</span></InfoItem>
          <InfoItem label="Phone">{phone ?? '—'}</InfoItem>
          <InfoItem label="Account type">Client portal</InfoItem>
        </dl>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Minimum 8 characters</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <Field label="Current password">
              <PasswordInput show={showOld} onToggle={() => setShowOld(v => !v)}
                value={pw.oldPassword} onChange={e => setPw(p => ({ ...p, oldPassword: e.target.value }))} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New password">
                <PasswordInput show={showNew} onToggle={() => setShowNew(v => !v)}
                  value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} />
              </Field>
              <Field label="Confirm password">
                <PasswordInput show={showCfm} onToggle={() => setShowCfm(v => !v)}
                  value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
              </Field>
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" loading={saving} disabled={!pw.oldPassword || !pw.newPassword || !pw.confirm}>
                Update password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
