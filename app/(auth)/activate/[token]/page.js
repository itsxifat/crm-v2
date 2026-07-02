'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import Image from 'next/image'
import Link from 'next/link'
import { ShieldCheck, Loader2, Mail, KeyRound, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={32} className="h-8 w-auto object-contain mx-auto" />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
          {phase === 'loading' && (
            <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
          )}

          {phase === 'invalid' && (
            <div className="text-center py-6">
              <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
              <p className="font-semibold text-gray-800">Activation link invalid</p>
              <p className="text-sm text-gray-500 mt-1">This link is invalid or has expired. Please contact us to get a new one.</p>
              <Link href="/login" className="inline-block mt-4 text-sm font-medium text-blue-600 hover:text-blue-700">Back to sign in</Link>
            </div>
          )}

          {phase === 'ready' && (
            <div className="text-center">
              <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
                <ShieldCheck className="w-6 h-6 text-blue-600" />
              </div>
              <h1 className="text-lg font-semibold text-gray-900">Activate your account</h1>
              <p className="text-sm text-gray-500 mt-1">
                We'll email a one-time login code to<br /><span className="font-medium text-gray-700">{email}</span>
              </p>
              <button
                onClick={sendCode}
                disabled={sending}
                className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                Email me my login code
              </button>
            </div>
          )}

          {phase === 'code' && (
            <form onSubmit={verify} className="text-center">
              <div className="w-11 h-11 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
                <KeyRound className="w-6 h-6 text-blue-600" />
              </div>
              <h1 className="text-lg font-semibold text-gray-900">Enter your code</h1>
              <p className="text-sm text-gray-500 mt-1">Check {email} for a 6-digit code (valid 10 minutes).</p>
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoFocus
                placeholder="••••••"
                className="mt-5 w-full text-center tracking-[0.5em] text-2xl font-semibold border border-gray-200 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={verifying}
                className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {verifying && <Loader2 className="w-4 h-4 animate-spin" />}
                Verify &amp; continue
              </button>
              <button type="button" onClick={sendCode} disabled={sending} className="mt-3 text-xs text-gray-400 hover:text-gray-600">
                Didn't get it? Resend code
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
