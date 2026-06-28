'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Loader2, RefreshCw, Eye, EyeOff, Copy, Check, UserCheck, ExternalLink } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Select from '@/components/ui/Select'

const schema = z.object({
  email:    z.string().min(1, 'Email is required for login').email('Invalid email'),
  password: z.string().min(6, 'At least 6 characters').optional().or(z.literal('')),
  requirePasswordChange: z.boolean().default(true),
  name:     z.string().min(1, 'Name is required'),
  phone:    z.string().optional().or(z.literal('')),
  clientType: z.enum(['INDIVIDUAL', 'COMPANY']).default('COMPANY'),
  company:      z.string().optional().or(z.literal('')),
  designation:  z.string().optional().or(z.literal('')),
  companyEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  companyPhone: z.string().optional().or(z.literal('')),
  industry:     z.string().optional().or(z.literal('')),
  website:      z.string().optional().or(z.literal('')),
  address:      z.string().optional().or(z.literal('')),
  city:         z.string().optional().or(z.literal('')),
  country:      z.string().optional().or(z.literal('')),
})

const CLIENT_TYPES = [
  { value: 'COMPANY',    label: 'Company' },
  { value: 'INDIVIDUAL', label: 'Individual' },
]

function genPassword() {
  return Math.random().toString(36).slice(-8) + 'A1!'
}

export default function ConvertLeadModal({ open, onClose, lead, onSuccess }) {
  const [loading, setLoading]   = useState(false)
  const [showPw,  setShowPw]    = useState(false)
  const [result,  setResult]    = useState(null)   // { clientId, email, tempPassword }
  const [copied,  setCopied]    = useState(false)

  const { register, handleSubmit, reset, control, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      email: '', password: '', requirePasswordChange: true, name: '', phone: '',
      clientType: 'COMPANY', company: '', designation: '', companyEmail: '',
      companyPhone: '', industry: '', website: '', address: '', city: '', country: '',
    },
  })

  useEffect(() => {
    if (!open) return
    setResult(null)
    setShowPw(false)
    setCopied(false)
    reset({
      email:        lead?.email        ?? '',
      password:     '',
      requirePasswordChange: true,
      name:         lead?.name         ?? '',
      phone:        lead?.phone        ?? '',
      clientType:   lead?.company ? 'COMPANY' : 'INDIVIDUAL',
      company:      lead?.company      ?? '',
      designation:  lead?.designation  ?? '',
      companyEmail: '',
      companyPhone: '',
      industry:     '',
      website:      '',
      address:      '',
      city:         lead?.location     ?? '',
      country:      '',
    })
    // Key on lead?.id (not the object) so a post-convert refresh of the lead
    // prop doesn't re-run this effect and wipe the success view.
  }, [open, lead?.id, reset]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values) => {
    setLoading(true)
    try {
      const payload = {
        email:    values.email.trim(),
        password: values.password?.trim() || null,
        requirePasswordChange: values.requirePasswordChange,
        name:     values.name.trim(),
        phone:    values.phone?.trim() || null,
        clientType:   values.clientType,
        company:      values.company?.trim()      || null,
        designation:  values.designation?.trim()  || null,
        companyEmail: values.companyEmail?.trim() || null,
        companyPhone: values.companyPhone?.trim() || null,
        industry:     values.industry?.trim()     || null,
        website:      values.website?.trim()       || null,
        address:      values.address?.trim()       || null,
        city:         values.city?.trim()          || null,
        country:      values.country?.trim()       || null,
      }
      const res  = await fetch(`/api/leads/${lead.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Conversion failed')
      toast.success('Lead converted to client')
      setResult({
        clientId:     data.data?.clientId,
        email:        data.data?.email,
        tempPassword: data.data?.tempPassword,
      })
      onSuccess?.(data.data)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyCredentials = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(`Email: ${result.email}\nPassword: ${result.tempPassword}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy')
    }
  }

  const ic  = (err) => `w-full px-3 py-2 text-sm border rounded-lg bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${err ? 'border-red-300' : 'border-gray-200'}`
  const lc  = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide'
  const sec = 'text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 mb-3'

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Convert Lead to Client"
      description={result ? 'Client account created — share these login details' : `Set login credentials and fill in the client profile for ${lead?.name ?? ''}`}
      size="lg"
    >
      {result ? (
        /* ── Success: show the credentials to share ── */
        <div className="space-y-5">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-100">
            <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-sm text-green-800">
              The client can now log in with the credentials below. Make sure to share them securely.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</span>
              <span className="text-sm font-medium text-gray-900 select-all">{result.email}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Password</span>
              <span className="text-sm font-mono font-medium text-gray-900 select-all">{result.tempPassword}</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={copyCredentials}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy credentials'}
            </button>
            <a
              href={`/admin/clients/${result.clientId}`}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              View Client <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

          {/* ── Login Credentials ── */}
          <div>
            <p className={sec}>Login Credentials</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={lc}>Email *</label>
                <input {...register('email')} type="email" placeholder="client@example.com" className={ic(errors.email)} />
                {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
                <p className="mt-1 text-xs text-gray-400">Used by the client to log in.</p>
              </div>
              <div className="sm:col-span-2">
                <label className={lc}>Password</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      {...register('password')}
                      type={showPw ? 'text' : 'password'}
                      placeholder="Leave blank to auto-generate"
                      className={ic(errors.password) + ' pr-10'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      tabIndex={-1}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setValue('password', genPassword()); setShowPw(true) }}
                    className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 shrink-0 flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Generate
                  </button>
                </div>
                {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="checkbox" {...register('requirePasswordChange')} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  Require password change on first login
                </label>
              </div>
            </div>
          </div>

          {/* ── Client Profile ── */}
          <div>
            <p className={sec}>Client Profile</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={lc}>Name *</label>
                <input {...register('name')} placeholder="John Smith" className={ic(errors.name)} />
                {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
              </div>
              <div>
                <label className={lc}>Phone</label>
                <input {...register('phone')} type="tel" placeholder="+880 1X XX XXX XXX" className={ic()} />
              </div>
              <div>
                <label className={lc}>Client Type</label>
                <Controller name="clientType" control={control} render={({ field }) => (
                  <Select value={field.value} onChange={field.onChange} options={CLIENT_TYPES} placeholder="Select type…" />
                )} />
              </div>
              <div>
                <label className={lc}>Designation</label>
                <input {...register('designation')} placeholder="CEO, Marketing Head…" className={ic()} />
              </div>
              <div>
                <label className={lc}>Company</label>
                <input {...register('company')} placeholder="Acme Corp" className={ic()} />
              </div>
              <div>
                <label className={lc}>Industry</label>
                <input {...register('industry')} placeholder="E-commerce, Healthcare…" className={ic()} />
              </div>
              <div>
                <label className={lc}>Company Email</label>
                <input {...register('companyEmail')} type="email" placeholder="info@acme.com" className={ic(errors.companyEmail)} />
                {errors.companyEmail && <p className="mt-1 text-xs text-red-500">{errors.companyEmail.message}</p>}
              </div>
              <div>
                <label className={lc}>Company Phone</label>
                <input {...register('companyPhone')} type="tel" placeholder="+880 …" className={ic()} />
              </div>
              <div className="sm:col-span-2">
                <label className={lc}>Website</label>
                <input {...register('website')} placeholder="https://acme.com" className={ic()} />
              </div>
              <div className="sm:col-span-2">
                <label className={lc}>Address</label>
                <input {...register('address')} placeholder="Street address…" className={ic()} />
              </div>
              <div>
                <label className={lc}>City</label>
                <input {...register('city')} placeholder="Dhaka" className={ic()} />
              </div>
              <div>
                <label className={lc}>Country</label>
                <input {...register('country')} placeholder="Bangladesh" className={ic()} />
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="px-5 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
              Convert to Client
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
