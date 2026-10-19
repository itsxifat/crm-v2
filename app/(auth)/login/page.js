'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Label } from '@/components/ui/Input'

const loginSchema = z.object({
  identifier: z.string().min(1, 'Email or ID is required'),
  password:   z.string().min(1, 'Password is required'),
})

// Only allow same-origin relative paths as post-login destinations
// (blocks open redirects and javascript:/data: URLs).
function safeCallbackUrl(raw) {
  if (typeof raw !== 'string' || !raw) return '/'
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const url = new URL(raw, origin)
    if (url.origin !== origin) return '/'
    const path = `${url.pathname}${url.search}${url.hash}`
    if (!path.startsWith('/') || path.startsWith('//')) return '/'
    return path
  } catch {
    return '/'
  }
}

export default function LoginPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl  = safeCallbackUrl(searchParams.get('callbackUrl'))
  const passwordSet  = searchParams.get('passwordSet') === '1'
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(loginSchema) })

  async function onSubmit(data) {
    setLoading(true)
    try {
      const result = await signIn('credentials', {
        identifier: data.identifier,
        password:   data.password,
        redirect:   false,
        callbackUrl,
      })
      if (result?.error) {
        toast.error('Invalid credentials. Please try again.')
      } else {
        router.push(callbackUrl)
        router.refresh()
      }
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 sm:p-6">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="mb-6 flex justify-center">
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={28} className="h-7 w-auto object-contain" priority />
        </div>

        <Card className="p-6">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Enter your credentials to continue</p>
          </div>

          {passwordSet && (
            <div className="mb-5 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <p>Password set. Sign in to continue.</p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="identifier">Email, phone or client ID</Label>
              <Input
                id="identifier"
                type="text"
                autoComplete="username"
                autoFocus
                placeholder="you@example.com"
                invalid={!!errors.identifier}
                {...register('identifier')}
              />
              {errors.identifier && <p className="mt-1.5 text-xs text-red-600">{errors.identifier.message}</p>}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <Label htmlFor="password" className="mb-0">Password</Label>
                <Link href="/forgot-password" className="text-[13px] text-muted-foreground underline-offset-4 hover:text-gray-900 hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pr-10"
                  invalid={!!errors.password}
                  {...register('password')}
                />
                <button type="button" onClick={() => setShowPass(v => !v)} tabIndex={-1}
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors hover:text-gray-700">
                  {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {errors.password && <p className="mt-1.5 text-xs text-red-600">{errors.password.message}</p>}
            </div>

            <Button type="submit" loading={loading} className="w-full">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Enfinito
        </p>
      </div>
    </div>
  )
}
