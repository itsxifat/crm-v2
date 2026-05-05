'use client'

import { useState } from 'react'
import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Lock, AtSign, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

const loginSchema = z.object({
  identifier: z.string().min(1, 'Email or ID is required'),
  password:   z.string().min(1, 'Password is required'),
})

export default function LoginPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl  = searchParams.get('callbackUrl') ?? '/'
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={36} className="h-9 w-auto object-contain" />
        </div>

        {/* Card */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-8">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-gray-900">Sign in</h1>
            <p className="text-sm text-gray-500 mt-1">Enter your credentials to continue</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Email / Phone / Client ID
              </label>
              <div className="relative">
                <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  autoComplete="username"
                  autoFocus
                  placeholder="your@email.com"
                  {...register('identifier')}
                  className={cn(
                    'w-full border rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-white',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors',
                    errors.identifier ? 'border-red-400' : 'border-gray-200'
                  )}
                />
              </div>
              {errors.identifier && <p className="text-xs text-red-500 mt-1">{errors.identifier.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...register('password')}
                  className={cn(
                    'w-full border rounded-xl pl-10 pr-11 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-white',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors',
                    errors.password ? 'border-red-400' : 'border-gray-200'
                  )}
                />
                <button type="button" onClick={() => setShowPass(v => !v)} tabIndex={-1}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
            </div>

            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold mt-2 bg-gray-900 text-white hover:bg-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</> : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-400 text-xs mt-6">
          &copy; {new Date().getFullYear()} Enfinito &mdash; Internal Platform
        </p>
      </div>
    </div>
  )
}
