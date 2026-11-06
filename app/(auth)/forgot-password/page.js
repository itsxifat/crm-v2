'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, CheckCircle, Eye, EyeOff, Check, X, KeyRound, MailCheck, LockKeyhole } from 'lucide-react'
import toast from 'react-hot-toast'
import { passwordChecklist, isStrongPassword } from '@/lib/passwordPolicy'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Label } from '@/components/ui/Input'

const CODE_LEN = 6

function StateIcon({ icon: Icon, className = 'text-gray-700' }) {
  return (
    <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
      <Icon className={`size-5 ${className}`} />
    </div>
  )
}

// Six boxes over one transparent input — keeps paste, mobile keyboards and
// one-time-code autofill working natively.
function CodeInput({ value, onChange, disabled }) {
  const [focused, setFocused] = useState(false)
  const active = Math.min(value.length, CODE_LEN - 1)
  return (
    <div className="relative">
      <div className="grid grid-cols-6 gap-2" aria-hidden="true">
        {Array.from({ length: CODE_LEN }, (_, i) => (
          <div
            key={i}
            className={cn(
              'flex h-12 items-center justify-center rounded-lg border bg-white text-xl font-semibold tabular-nums text-gray-900 shadow-xs transition-colors',
              focused && i === active ? 'border-gray-900 ring-2 ring-gray-900/10' : 'border-gray-200',
              disabled && 'opacity-60',
            )}
          >
            {value[i] ?? ''}
          </div>
        ))}
      </div>
      <input
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, CODE_LEN))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={CODE_LEN}
        autoFocus
        disabled={disabled}
        aria-label="6-digit code"
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none"
      />
    </div>
  )
}

async function post(url, body) {
  const res  = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

export default function ForgotPasswordPage() {
  const [step, setStep]         = useState('email') // email | code | password | done
  const [email, setEmail]       = useState('')
  const [code, setCode]         = useState('')
  const [token, setToken]       = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [show, setShow]         = useState(false)
  const [busy, setBusy]         = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const verifying = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function sendCode(e) {
    e?.preventDefault()
    const addr = email.trim()
    if (!addr) { toast.error('Enter your email'); return }
    setBusy(true)
    try {
      const { ok, json } = await post('/api/account-recovery/request', { email: addr })
      if (!ok) throw new Error(json.error ?? 'Could not send the code')
      setCode('')
      setCooldown(json.cooldown ?? 60)
      if (step === 'code') toast.success('New code sent')
      setStep('code')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(e) {
    e?.preventDefault()
    if (code.length !== CODE_LEN) { toast.error('Enter the 6-digit code'); return }
    if (verifying.current) return
    verifying.current = true
    setBusy(true)
    try {
      const { ok, json } = await post('/api/account-recovery/verify', { email: email.trim(), code })
      if (!ok) throw new Error(json.error ?? 'Incorrect or expired code')
      setToken(json.resetToken)
      setStep('password')
    } catch (err) {
      toast.error(err.message)
      setCode('')
    } finally {
      verifying.current = false
      setBusy(false)
    }
  }

  // Submit as soon as the last digit lands.
  useEffect(() => {
    if (step === 'code' && code.length === CODE_LEN) verifyCode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step])

  async function resetPassword(e) {
    e.preventDefault()
    if (!isStrongPassword(password)) { toast.error('Please meet all password requirements'); return }
    if (password !== confirm) { toast.error('Passwords do not match'); return }
    setBusy(true)
    try {
      const { ok, json } = await post('/api/account-recovery/reset', { token, password })
      if (!ok) {
        if (json.code === 'EXPIRED') { setToken(''); setCode(''); setPassword(''); setConfirm(''); setStep('email') }
        throw new Error(json.error ?? 'Could not update your password')
      }
      setToken('')
      setStep('done')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  function changeEmail() {
    setCode(''); setCooldown(0); setStep('email')
  }

  const checks = passwordChecklist(password)

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={28} className="h-7 w-auto object-contain" priority />
        </div>

        <Card className="p-6">
          {step === 'email' && (
            <>
              <div className="mb-6 text-center">
                <StateIcon icon={KeyRound} />
                <h1 className="text-xl font-semibold tracking-tight text-gray-900">Forgot password?</h1>
                <p className="mt-1 text-sm text-muted-foreground">We&apos;ll email you a 6-digit code</p>
              </div>
              <form onSubmit={sendCode} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoFocus
                    required
                  />
                </div>
                <Button type="submit" loading={busy} className="w-full">Send code</Button>
              </form>
            </>
          )}

          {step === 'code' && (
            <form onSubmit={verifyCode}>
              <div className="mb-6 text-center">
                <StateIcon icon={MailCheck} />
                <h1 className="text-xl font-semibold tracking-tight text-gray-900">Check your email</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enter the code sent to<br /><span className="font-medium text-gray-900">{email.trim()}</span>
                </p>
              </div>
              <CodeInput value={code} onChange={setCode} disabled={busy} />
              <Button type="submit" loading={busy} disabled={code.length !== CODE_LEN} className="mt-4 w-full">Verify code</Button>
              <div className="mt-4 flex items-center justify-between text-[13px]">
                <button type="button" onClick={changeEmail} className="text-muted-foreground underline-offset-4 hover:text-gray-900 hover:underline">
                  Change email
                </button>
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={busy || cooldown > 0}
                  className="text-muted-foreground underline-offset-4 hover:text-gray-900 hover:underline disabled:pointer-events-none disabled:opacity-60"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
              <p className="mt-4 text-center text-xs text-muted-foreground">Not there? Check spam or promotions.</p>
            </form>
          )}

          {step === 'password' && (
            <>
              <div className="mb-6 text-center">
                <StateIcon icon={LockKeyhole} />
                <h1 className="text-xl font-semibold tracking-tight text-gray-900">Set a new password</h1>
                <p className="mt-1 truncate text-sm text-muted-foreground">for <span className="font-medium text-gray-900">{email.trim()}</span></p>
              </div>
              <form onSubmit={resetPassword} className="space-y-4">
                <input type="email" value={email.trim()} autoComplete="username" readOnly hidden />
                <div>
                  <Label htmlFor="new-password">New password</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={show ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="pr-10"
                      autoComplete="new-password"
                      autoFocus
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShow(s => !s)}
                      aria-label={show ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                    >
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type={show ? 'text' : 'password'}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <ul className="grid grid-cols-2 gap-1.5">
                  {checks.map(c => (
                    <li key={c.key} className={`flex items-center gap-1.5 text-xs ${c.passed ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                      {c.passed ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                      {c.label}
                    </li>
                  ))}
                </ul>
                <Button type="submit" loading={busy} className="w-full">Update password</Button>
              </form>
            </>
          )}

          {step === 'done' && (
            <div className="text-center">
              <StateIcon icon={CheckCircle} className="text-emerald-600" />
              <h1 className="text-xl font-semibold tracking-tight text-gray-900">Password updated</h1>
              <p className="mt-2 text-sm text-muted-foreground">Sign in with your new password.</p>
              <Button href="/login" className="mt-6 w-full">Go to sign in</Button>
            </div>
          )}
        </Card>

        {step !== 'done' && (
          <p className="mt-6 text-center text-sm">
            <Link href="/login" className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:text-gray-900 hover:underline">
              <ArrowLeft className="size-4" /> Back to sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
