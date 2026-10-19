'use client'

import { useState } from 'react'
import Image from 'next/image'
import { signOut } from 'next-auth/react'
import { Eye, EyeOff, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { passwordChecklist, isStrongPassword } from '@/lib/passwordPolicy'
import Button from '@/components/ui/Button'
import { Input, Field } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <Image src="/en-logo.png" alt="Enfinito" width={112} height={26} className="mx-auto mb-8 h-[22px] w-auto object-contain" priority />

        <div className="rounded-xl border border-gray-200/80 bg-white p-6 shadow-xs">
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">Set your password</h1>
          <p className="mt-1 text-sm text-muted-foreground">Finish setting up your account.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
              Set password &amp; continue
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
