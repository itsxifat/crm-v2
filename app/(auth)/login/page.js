'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Lock, AtSign, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

const loginSchema = z.object({
  identifier: z.string().min(1, 'Please enter your email, phone, or client ID.'),
  password:   z.string().min(1, 'Password is required.'),
})

const DEMO_ACCOUNTS = [
  { label: 'Super Admin', email: 'admin@en-tech.agency',    password: 'password123' },
  { label: 'Manager',     email: 'manager@en-tech.agency',  password: 'password123' },
  { label: 'Employee',    email: 'john@en-tech.agency',     password: 'password123' },
  { label: 'Client',      email: 'acme@client.com',         password: 'password123' },
  { label: 'Freelancer',  email: 'mike@freelance.com',      password: 'password123' },
]

export default function LoginPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl  = searchParams.get('callbackUrl') ?? '/'
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(loginSchema) })

  function fillDemo(account) {
    setValue('identifier', account.email, { shouldValidate: true })
    setValue('password', account.password, { shouldValidate: true })
  }

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
        toast.error('Invalid email or password. Please try again.')
      } else {
        toast.success('Welcome back!')
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      {/* Background decorations */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4 bg-white rounded-2xl px-6 py-3">
            <img src="/en-logo.png" alt="Enfinito" className="h-10 w-auto object-contain" />
          </div>
          <p className="text-slate-400 mt-1 text-sm">Agency Management Platform</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Sign in to your account</h2>
            <p className="text-slate-400 text-sm mt-1">Enter your credentials to continue</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Identifier */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Email / Phone / Client ID
              </label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="email, phone, or client ID"
                  {...register('identifier')}
                  className={cn(
                    'w-full bg-white/5 border rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500',
                    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors',
                    errors.identifier ? 'border-red-500' : 'border-white/10 hover:border-white/20'
                  )}
                />
              </div>
              {errors.identifier && (
                <p className="mt-1.5 text-xs text-red-400">{errors.identifier.message}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  {...register('password')}
                  className={cn(
                    'w-full bg-white/5 border rounded-xl pl-10 pr-10 py-2.5 text-sm text-white placeholder-slate-500',
                    'focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-colors',
                    errors.password ? 'border-red-500' : 'border-white/10 hover:border-white/20'
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1.5 text-xs text-red-400">{errors.password.message}</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold',
                'bg-primary text-white hover:bg-primary-600 active:bg-primary-700',
                'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-slate-900',
                'transition-colors duration-150',
                'disabled:opacity-60 disabled:cursor-not-allowed'
              )}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Demo accounts */}
          <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
            <p className="text-xs font-semibold text-blue-300 mb-3">
              Demo Site — click any role to auto-fill
            </p>
            <div className="flex flex-wrap gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => fillDemo(account)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:border-white/20 transition-colors"
                >
                  {account.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">All accounts use password: <span className="font-mono text-slate-400">password123</span></p>
          </div>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          &copy; {new Date().getFullYear()} EN-CRM by En-Tech. All rights reserved.
        </p>
      </div>
    </div>
  )
}
