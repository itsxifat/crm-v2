'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { Eye, EyeOff } from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import { validateStrongPassword } from '@/lib/passwordPolicy'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card'
import { Input, Field } from '@/components/ui/Input'

function PasswordInput({ show, onToggle, ...props }) {
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} className="pr-10" placeholder="••••••••" {...props} />
      <button type="button" onClick={onToggle} tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
        aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

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
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success('Password updated')
      setPw({ old: '', new: '', confirm: '' })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!user) return <PageLoader />

  return (
    <div className="max-w-3xl space-y-6">
      <Toaster position="top-center" />

      <PageHeader title="Account" />

      {/* Profile info */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-900">
            {user.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar} alt={user.name} className="size-12 object-cover" />
            ) : (
              <span className="text-base font-semibold text-white">{user.name?.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-base font-semibold text-gray-900">{user.name}</p>
              <Badge>Vendor</Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-gray-100 pt-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Name</dt>
            <dd className="mt-1 text-sm text-gray-900">{user.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="mt-1 break-all text-sm text-gray-900">{user.email ?? '—'}</dd>
          </div>
        </dl>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Change password</CardTitle>
            <CardDescription>8+ characters, mixed case, number and symbol</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Current password">
              <PasswordInput show={showOld} onToggle={() => setShowOld(v => !v)}
                value={pw.old} onChange={e => setPw(p => ({ ...p, old: e.target.value }))} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New password">
                <PasswordInput show={showNew} onToggle={() => setShowNew(v => !v)}
                  value={pw.new} onChange={e => setPw(p => ({ ...p, new: e.target.value }))} />
              </Field>
              <Field label="Confirm password">
                <PasswordInput show={showCfm} onToggle={() => setShowCfm(v => !v)}
                  value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
              </Field>
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" loading={saving} disabled={!pw.old || !pw.new || !pw.confirm}>
                {saving ? 'Saving…' : 'Update password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
