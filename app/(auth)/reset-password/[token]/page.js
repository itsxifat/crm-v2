'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Lock, Loader2, ShieldCheck, Eye, EyeOff, Check, X, AlertCircle, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { passwordChecklist, isStrongPassword } from '@/lib/passwordPolicy'

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

  const ic = 'w-full border border-gray-200 rounded-xl pl-10 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

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
              <p className="font-semibold text-gray-800">Reset link invalid</p>
              <p className="text-sm text-gray-500 mt-1">This link is invalid or has expired. Please submit a new request.</p>
              <Link href="/forgot-password" className="inline-block mt-4 text-sm font-medium text-blue-600 hover:text-blue-700">Request a new link</Link>
            </div>
          )}

          {phase === 'done' && (
            <div className="text-center py-6">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <p className="font-semibold text-gray-800">Password updated</p>
              <p className="text-sm text-gray-500 mt-1">You can now sign in with your new password.</p>
              <button onClick={() => router.replace('/login')} className="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">Go to sign in</button>
            </div>
          )}

          {phase === 'ready' && (
            <>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-blue-600" />
                </div>
                <h1 className="text-lg font-semibold text-gray-900">Set a new password</h1>
              </div>
              <p className="text-sm text-gray-500 mb-5">for <span className="font-medium text-gray-700">{email}</span></p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="New password" className={ic} required />
                  <button type="button" onClick={() => setShow(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Confirm new password" className={ic} required />
                </div>
                <ul className="grid grid-cols-2 gap-1.5">
                  {checks.map(c => (
                    <li key={c.key} className={`flex items-center gap-1.5 text-xs ${c.passed ? 'text-green-600' : 'text-gray-400'}`}>
                      {c.passed ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                      {c.label}
                    </li>
                  ))}
                </ul>
                <button type="submit" disabled={saving} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Update password
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
