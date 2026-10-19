'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { Loader2, XCircle, CheckCircle2 } from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import { validateStrongPassword } from '@/lib/passwordPolicy'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Input, Field } from '@/components/ui/Input'

function AuthFrame({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={28} className="h-7 w-auto object-contain" priority />
        </div>
        <Card className="p-6">{children}</Card>
      </div>
    </div>
  )
}

function StateIcon({ icon: Icon, className }) {
  return (
    <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
      <Icon className={`size-5 ${className}`} />
    </div>
  )
}

export default function FreelancerInvitePage() {
  const { token }   = useParams()
  const router      = useRouter()

  const [status,   setStatus]   = useState('loading')   // 'loading' | 'valid' | 'invalid' | 'success'
  const [info,     setInfo]     = useState(null)         // { email, name, type }
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch(`/api/freelancers/invite/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.valid) {
          setInfo({ email: data.email, name: data.name, type: data.type })
          setStatus('valid')
        } else {
          setStatus('invalid')
        }
      })
      .catch(() => setStatus('invalid'))
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()

    const pwError = validateStrongPassword(password)
    if (pwError) {
      toast.error(pwError)
      return
    }
    if (password !== confirm) {
      toast.error('Passwords do not match')
      return
    }

    setSubmitting(true)
    try {
      const res  = await fetch(`/api/freelancers/invite/${token}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to activate account')
      setStatus('success')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="size-5 animate-spin text-gray-400" />
      </div>
    )
  }

  if (status === 'invalid') {
    return (
      <AuthFrame>
        <Toaster position="top-center" />
        <div className="text-center">
          <StateIcon icon={XCircle} className="text-red-500" />
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">Link invalid or expired</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Invitation links are valid for 48 hours. Ask your administrator to resend it.
          </p>
        </div>
      </AuthFrame>
    )
  }

  if (status === 'success') {
    return (
      <AuthFrame>
        <div className="text-center">
          <StateIcon icon={CheckCircle2} className="text-emerald-600" />
          <h1 className="text-xl font-semibold tracking-tight text-gray-900">Account activated</h1>
          <p className="mt-2 text-sm text-muted-foreground">You can now sign in to the Enfinito Panel.</p>
          <Button href="/login" className="mt-6 w-full">Go to sign in</Button>
        </div>
      </AuthFrame>
    )
  }

  return (
    <AuthFrame>
      <Toaster position="top-center" />

      <div className="mb-6 text-center">
        <Badge variant="outline" className="mb-3">
          {info?.type === 'AGENCY' ? 'Agency partner' : 'Freelancer'} panel
        </Badge>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Activate your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hi <span className="font-medium text-gray-900">{info?.name}</span>, set your password
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email (readonly) */}
        <Field label="Email" htmlFor="invite-email">
          <Input
            id="invite-email"
            type="email"
            value={info?.email ?? ''}
            readOnly
            className="cursor-not-allowed bg-gray-50 text-gray-500"
          />
        </Field>

        <Field label="Password" htmlFor="invite-password" required hint="8+ characters: upper, lower, number, symbol">
          <Input
            id="invite-password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Field>

        <Field label="Confirm password" htmlFor="invite-confirm" required>
          <Input
            id="invite-confirm"
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
        </Field>

        <Button type="submit" loading={submitting} className="w-full">
          {submitting ? 'Activating…' : 'Activate account'}
        </Button>
      </form>
    </AuthFrame>
  )
}
