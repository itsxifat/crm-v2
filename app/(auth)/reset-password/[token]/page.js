'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Loader2, Eye, EyeOff, Check, X, AlertCircle, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { passwordChecklist, isStrongPassword } from '@/lib/passwordPolicy'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Label } from '@/components/ui/Input'

function StateIcon({ icon: Icon, className }) {
  return (
    <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
      <Icon className={`size-5 ${className}`} />
    </div>
  )
}

export default function ResetPasswordPage() {
  const { token } = useParams()
  const router = useRouter()
  const [phase, setPhase]   = useState('loading') // loading | invalid | ready | done
  const [email, setEmail]   = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [show, setShow]     = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/account-recovery/reset/${token}`)
      .then(r => r.json())
      .then(d => { if (d.valid) { setEmail(d.email); setPhase('ready') } else setPhase('invalid') })
      .catch(() => setPhase('invalid'))
  }, [token])

  const checks = passwordChecklist(password)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isStrongPassword(password)) { toast.error('Please meet all password requirements'); return }
    if (password !== confirm) { toast.error('Passwords do not match'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/account-recovery/reset/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to reset password')
      setPhase('done')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={28} className="h-7 w-auto object-contain" priority />
        </div>
        <Card className="p-6">
          {phase === 'loading' && (
            <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="size-5 animate-spin" /></div>
          )}

          {phase === 'invalid' && (
            <div className="text-center">
              <StateIcon icon={AlertCircle} className="text-red-500" />
              <h1 className="text-xl font-semibold tracking-tight text-gray-900">Reset link invalid</h1>
              <p className="mt-2 text-sm text-muted-foreground">This link is invalid or has expired.</p>
              <Button href="/forgot-password" variant="outline" className="mt-6 w-full">Request a new link</Button>
            </div>
          )}

          {phase === 'done' && (
            <div className="text-center">
              <StateIcon icon={CheckCircle} className="text-emerald-600" />
              <h1 className="text-xl font-semibold tracking-tight text-gray-900">Password updated</h1>
              <p className="mt-2 text-sm text-muted-foreground">Sign in with your new password.</p>
              <Button onClick={() => router.replace('/login')} className="mt-6 w-full">Go to sign in</Button>
            </div>
          )}

          {phase === 'ready' && (
            <>
              <div className="mb-6 text-center">
                <h1 className="text-xl font-semibold tracking-tight text-gray-900">Set a new password</h1>
                <p className="mt-1 truncate text-sm text-muted-foreground">for <span className="font-medium text-gray-900">{email}</span></p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="new-password">New password</Label>
                  <div className="relative">
                    <Input id="new-password" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="pr-10" autoComplete="new-password" required />
                    <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input id="confirm-password" type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" required />
                </div>
                <ul className="grid grid-cols-2 gap-1.5">
                  {checks.map(c => (
                    <li key={c.key} className={`flex items-center gap-1.5 text-xs ${c.passed ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                      {c.passed ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                      {c.label}
                    </li>
                  ))}
                </ul>
                <Button type="submit" loading={saving} className="w-full">
                  Update password
                </Button>
              </form>
            </>
          )}
        </Card>

        {phase === 'ready' && (
          <p className="mt-6 text-center text-sm">
            <Link href="/login" className="text-muted-foreground underline-offset-4 hover:text-gray-900 hover:underline">Back to sign in</Link>
          </p>
        )}
      </div>
    </div>
  )
}
