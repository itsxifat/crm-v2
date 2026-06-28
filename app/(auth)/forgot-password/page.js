'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Mail, Loader2, CheckCircle, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) { toast.error('Enter your email'); return }
    setLoading(true)
    try {
      const res  = await fetch('/api/account-recovery/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      await res.json().catch(() => ({}))
      setSent(true)
    } catch {
      // Still show the neutral confirmation (no enumeration).
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={32} className="h-8 w-auto object-contain mx-auto" />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
          {sent ? (
            <div className="text-center py-4">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <p className="font-semibold text-gray-800">Request submitted</p>
              <p className="text-sm text-gray-500 mt-1">
                If an account exists for that email, your password reset request has been sent to our team for review.
                You'll receive a reset link by email once it's approved.
              </p>
              <Link href="/login" className="inline-flex items-center gap-1.5 mt-5 text-sm font-medium text-blue-600 hover:text-blue-700">
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-gray-900">Forgot your password?</h1>
              <p className="text-sm text-gray-500 mt-1 mb-5">
                Enter your account email. For security, a reset link is sent only after our team approves your request.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full border border-gray-200 rounded-xl pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Submit reset request
                </button>
              </form>
              <Link href="/login" className="inline-flex items-center gap-1.5 mt-5 text-sm text-gray-400 hover:text-gray-600">
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
