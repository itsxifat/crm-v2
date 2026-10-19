'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { Eye, EyeOff, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { passwordChecklist, isStrongPassword } from '@/lib/passwordPolicy'
import Button from '@/components/ui/Button'
import { Input, Field } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <Image src="/en-logo.png" alt="Enfinito" width={112} height={26} className="mx-auto mb-8 h-[22px] w-auto object-contain" priority />

        <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-xs">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">{firstTime ? 'Set your password' : 'Change password'}</h1>
          {firstTime && <p className="mt-1 text-sm text-muted-foreground">Finish setting up your account.</p>}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {!firstTime && (
              <Field label="Current password">
                <Input
                  type={show ? 'text' : 'password'}
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </Field>
            )}
            <Field label="New password">
              <div className="relative">
                <Input
                  type={show ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-9"
                  required
                />
                <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide passwords' : 'Show passwords'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>
            <Field label="Confirm password">
              <Input
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>

            {/* Strength checklist */}
            <ul className="grid grid-cols-2 gap-1.5">
              {checks.map(c => (
                <li key={c.key} className={cn('flex items-center gap-1.5 text-xs', c.passed ? 'text-emerald-600' : 'text-gray-400')}>
                  {c.passed ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                  {c.label}
                </li>
              ))}
            </ul>

            <Button type="submit" loading={saving} className="w-full">
              {firstTime ? 'Set password & continue' : 'Update password'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
