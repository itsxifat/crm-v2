'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import Image from 'next/image'
import { ShieldCheck, Loader2, Mail, KeyRound, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'

function StateIcon({ icon: Icon, className = 'text-gray-600' }) {
  return (
    <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
      <Icon className={`size-5 ${className}`} />
    </div>
  )
}

export default function ActivateAccountPage() {
  const { token } = useParams()
  const router = useRouter()
  const [phase, setPhase]     = useState('loading') // loading | invalid | ready | code
  const [email, setEmail]     = useState('')
  const [name, setName]       = useState('')
  const [code, setCode]       = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    fetch(`/api/account-recovery/activate/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.valid) { setEmail(d.email); setName(d.name); setPhase('ready') }
        else setPhase('invalid')
      })
      .catch(() => setPhase('invalid'))
  }, [token])

  async function sendCode() {
    setSending(true)
    try {
      const res  = await fetch(`/api/account-recovery/activate/${token}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not send the code')
      toast.success('Login code sent to your email')
      setPhase('code')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSending(false)
    }
  }

  async function verify(e) {
    e.preventDefault()
    if (code.trim().length < 4) { toast.error('Enter the code from your email'); return }
    setVerifying(true)
    try {
      const result = await signIn('credentials', { identifier: email, otp: code.trim(), redirect: false })
      if (result?.error) throw new Error('That code is invalid or has expired')
      // mustChangePassword is true → middleware sends them to set a password
      router.replace('/client/set-password')
      router.refresh()
    } catch (err) {
      toast.error(err.message)
      setVerifying(false)
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
              <h1 className="text-xl font-semibold tracking-tight text-gray-900">Activation link invalid</h1>
              <p className="mt-2 text-sm text-muted-foreground">This link is invalid or has expired. Contact us for a new one.</p>
              <Button href="/login" variant="outline" className="mt-6 w-full">Back to sign in</Button>
            </div>
          )}

          {phase === 'ready' && (
            <div className="text-center">
              <StateIcon icon={ShieldCheck} />
              <h1 className="text-xl font-semibold tracking-tight text-gray-900">Activate your account</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                We&apos;ll email a one-time code to<br /><span className="font-medium text-gray-900">{email}</span>
              </p>
              <Button onClick={sendCode} loading={sending} className="mt-6 w-full">
                {!sending && <Mail />}
                Email me my login code
              </Button>
            </div>
          )}

          {phase === 'code' && (
            <form onSubmit={verify} className="text-center">
              <StateIcon icon={KeyRound} />
              <h1 className="text-xl font-semibold tracking-tight text-gray-900">Enter your code</h1>
              <p className="mt-1 text-sm text-muted-foreground">Check {email} for a 6-digit code (valid 10 minutes).</p>
              <Input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoFocus
                placeholder="••••••"
                aria-label="Login code"
                className="mt-6 h-12 text-center text-xl font-semibold tracking-[0.5em]"
              />
              <Button type="submit" loading={verifying} className="mt-4 w-full">
                Verify &amp; continue
              </Button>
              <button type="button" onClick={sendCode} disabled={sending}
                className="mt-4 text-[13px] text-muted-foreground underline-offset-4 hover:text-gray-900 hover:underline disabled:opacity-50">
                Didn&apos;t get it? Resend code
              </button>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
