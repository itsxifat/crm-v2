'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { CheckCircle, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Label } from '@/components/ui/Input'

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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={28} className="h-7 w-auto object-contain" priority />
        </div>

        <Card className="p-6">
          {sent ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
                <CheckCircle className="size-5 text-emerald-600" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-gray-900">Request submitted</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                If a client account exists for that email, you&apos;ll get a reset link once our team approves it.
              </p>
              <Button href="/login" variant="outline" className="mt-6 w-full">
                <ArrowLeft /> Back to sign in
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-6 text-center">
                <h1 className="text-xl font-semibold tracking-tight text-gray-900">Forgot password?</h1>
                <p className="mt-1 text-sm text-muted-foreground">For client accounts only</p>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <Button type="submit" loading={loading} className="w-full">
                  Request reset link
                </Button>
              </form>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Staff, freelancers and vendors: contact your administrator.
              </p>
            </>
          )}
        </Card>

        {!sent && (
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
