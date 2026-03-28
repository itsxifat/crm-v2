'use client'

import { useState } from 'react'
import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Lock, AtSign, Loader2, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

const loginSchema = z.object({
  identifier: z.string().min(1, 'Please enter your email, phone, or client ID.'),
  password:   z.string().min(1, 'Password is required.'),
})

export default function LoginPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl  = searchParams.get('callbackUrl') ?? '/'
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(loginSchema) })

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
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* ── Left panel (branding) — hidden on mobile ── */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 relative bg-gray-950 flex-col justify-between p-12 overflow-hidden">
        {/* Background gradient blobs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-blue-600/20 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[100px] translate-x-1/4 translate-y-1/4" />
          <div className="absolute top-1/2 left-1/2 w-[400px] h-[400px] bg-blue-500/10 rounded-full blur-[80px] -translate-x-1/2 -translate-y-1/2" />
        </div>

        {/* Grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />

        {/* Logo */}
        <div className="relative z-10">
          <div className="inline-flex items-center bg-white/8 border border-white/10 rounded-2xl px-5 py-3 backdrop-blur-sm">
            <Image src="/en-logo.png" alt="Enfinito" width={110} height={32} className="h-8 w-auto object-contain brightness-0 invert" />
          </div>
        </div>

        {/* Center content */}
        <div className="relative z-10 space-y-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 bg-blue-500/15 border border-blue-400/20 rounded-full px-4 py-1.5">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
              <span className="text-blue-300 text-xs font-medium tracking-wide">Agency Management Platform</span>
            </div>
            <h1 className="text-4xl xl:text-5xl font-bold text-white leading-tight tracking-tight">
              Manage your agency<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
                all in one place
              </span>
            </h1>
            <p className="text-gray-400 text-base leading-relaxed max-w-sm">
              Projects, clients, invoices, HR, and finances — streamlined for creative and tech agencies.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {['Projects & Tasks', 'Client Portal', 'Invoicing', 'HR & Payroll', 'Finance'].map(f => (
              <span key={f} className="text-xs text-gray-400 bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10">
          <p className="text-gray-600 text-xs">
            &copy; {new Date().getFullYear()} Enfinito. All rights reserved.
          </p>
        </div>
      </div>

      {/* ── Right panel (form) ── */}
      <div className="flex-1 flex flex-col min-h-screen lg:min-h-0 bg-white">

        {/* Mobile logo */}
        <div className="flex lg:hidden items-center justify-center pt-10 pb-6 px-6 bg-gray-950">
          <div className="inline-flex items-center bg-white/8 border border-white/10 rounded-2xl px-5 py-3">
            <Image src="/en-logo.png" alt="Enfinito" width={100} height={28} className="h-7 w-auto object-contain brightness-0 invert" />
          </div>
        </div>

        {/* Form area */}
        <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-12">
          <div className="w-full max-w-sm">

            {/* Heading */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900 tracking-tight">Welcome back</h2>
              <p className="text-gray-500 text-sm mt-1.5">Sign in to your account to continue</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>

              {/* Identifier */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Email / Phone / Client ID
                </label>
                <div className="relative">
                  <AtSign className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    autoComplete="username"
                    autoFocus
                    placeholder="Enter your email or ID"
                    {...register('identifier')}
                    className={cn(
                      'w-full border rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-white',
                      'focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors',
                      errors.identifier
                        ? 'border-red-400 focus:border-red-400 focus:ring-red-500/20'
                        : 'border-gray-200 hover:border-gray-300'
                    )}
                  />
                </div>
                {errors.identifier && (
                  <p className="text-xs text-red-500">{errors.identifier.message}</p>
                )}
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    {...register('password')}
                    className={cn(
                      'w-full border rounded-xl pl-10 pr-11 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-white',
                      'focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors',
                      errors.password
                        ? 'border-red-400 focus:border-red-400 focus:ring-red-500/20'
                        : 'border-gray-200 hover:border-gray-300'
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-red-500">{errors.password.message}</p>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className={cn(
                  'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold mt-2',
                  'bg-gray-900 text-white hover:bg-gray-800 active:bg-gray-950',
                  'focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2',
                  'transition-all duration-150 shadow-sm',
                  'disabled:opacity-60 disabled:cursor-not-allowed'
                )}
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
                  : <>'Sign in' <ArrowRight className="w-4 h-4" /></>
                }
              </button>
            </form>

            {/* Footer note */}
            <p className="text-center text-gray-400 text-xs mt-8">
              &copy; {new Date().getFullYear()} Enfinito &mdash; Internal Platform
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
