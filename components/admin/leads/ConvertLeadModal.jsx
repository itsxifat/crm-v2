'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { RefreshCw, Eye, EyeOff, Copy, Check, UserCheck, ExternalLink } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Select from '@/components/ui/Select'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Input, Field } from '@/components/ui/Input'
import { isStrongPassword } from '@/lib/passwordPolicy'

// Lead fields arrive masked ('+880••••78') for users without PII permissions
const isMasked = (v) => typeof v === 'string' && v.includes('••')

const schema = z.object({
  // A masked lead email is accepted — the server substitutes the real address
  email:    z.string().min(1, 'Email is required for login')
    .refine(v => isMasked(v) || z.string().email().safeParse(v).success, 'Invalid email'),
  password: z.string()
    .refine(v => !v || isStrongPassword(v), 'At least 8 characters with upper & lower case letters, a number and a symbol')
    .optional().or(z.literal('')),
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
  return Math.random().toString(36).slice(-8) + 'aA1!'
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
      // Don't pre-fill masked values — left blank, the server uses the stored lead data
      phone:        isMasked(lead?.phone) ? '' : (lead?.phone ?? ''),
      clientType:   lead?.company ? 'COMPANY' : 'INDIVIDUAL',
      company:      lead?.company      ?? '',
      designation:  lead?.designation  ?? '',
      companyEmail: '',
      companyPhone: '',
      industry:     '',
      website:      '',
      address:      '',
      city:         isMasked(lead?.location) ? '' : (lead?.location ?? ''),
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

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Convert to client"
      description={result ? undefined : lead?.name}
      size="lg"
    >
      {result ? (
        /* ── Success: show the credentials to share ── */
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <UserCheck className="size-4 shrink-0" />
            Client account created. Share these details securely.
          </div>

          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="select-all text-sm font-medium text-gray-900">{result.email}</span>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm text-muted-foreground">Password</span>
              <span className="select-all font-mono text-sm font-medium text-gray-900">{result.tempPassword}</span>
            </div>
          </div>

          <ModalFooter className="sm:justify-between">
            <Button variant="outline" onClick={copyCredentials}>
              {copied ? <Check className="text-emerald-600" /> : <Copy />}
              {copied ? 'Copied' : 'Copy credentials'}
            </Button>
            <a href={`/admin/clients/${result.clientId}`} className={buttonVariants()}>
              View client <ExternalLink />
            </a>
          </ModalFooter>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

          {/* ── Login Credentials ── */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Login</h3>
            <div className="grid gap-4">
              <Field label="Email" required error={errors.email?.message}>
                <Input {...register('email')} type="email" placeholder="client@example.com" invalid={!!errors.email} />
              </Field>
              <Field label="Password" error={errors.password?.message}>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      {...register('password')}
                      type={showPw ? 'text' : 'password'}
                      placeholder="Auto-generated if blank"
                      invalid={!!errors.password}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                      tabIndex={-1}
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <Button variant="outline" onClick={() => { setValue('password', genPassword()); setShowPw(true) }}>
                    <RefreshCw /> Generate
                  </Button>
                </div>
              </Field>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" {...register('requirePasswordChange')} className="rounded border-gray-300" />
                Require password change on first login
              </label>
            </div>
          </section>

          {/* ── Client Profile ── */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Client profile</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required error={errors.name?.message}>
                <Input {...register('name')} placeholder="John Smith" invalid={!!errors.name} />
              </Field>
              <Field label="Phone">
                <Input {...register('phone')} type="tel" placeholder="e.g. 017…" />
              </Field>
              <Field label="Client type">
                <Controller name="clientType" control={control} render={({ field }) => (
                  <Select value={field.value} onChange={field.onChange} options={CLIENT_TYPES} placeholder="Select…" />
                )} />
              </Field>
              <Field label="Designation">
                <Input {...register('designation')} placeholder="e.g. CEO" />
              </Field>
              <Field label="Company">
                <Input {...register('company')} placeholder="Acme Corp" />
              </Field>
              <Field label="Industry">
                <Input {...register('industry')} placeholder="e.g. E-commerce" />
              </Field>
              <Field label="Company email" error={errors.companyEmail?.message}>
                <Input {...register('companyEmail')} type="email" placeholder="info@acme.com" invalid={!!errors.companyEmail} />
              </Field>
              <Field label="Company phone">
                <Input {...register('companyPhone')} type="tel" placeholder="e.g. 02…" />
              </Field>
              <Field label="Website" className="sm:col-span-2">
                <Input {...register('website')} placeholder="https://acme.com" />
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <Input {...register('address')} placeholder="Street address" />
              </Field>
              <Field label="City">
                <Input {...register('city')} placeholder="Dhaka" />
              </Field>
              <Field label="Country">
                <Input {...register('country')} placeholder="Bangladesh" />
              </Field>
            </div>
          </section>

          <ModalFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>
              {!loading && <UserCheck />}
              Convert to client
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  )
}
