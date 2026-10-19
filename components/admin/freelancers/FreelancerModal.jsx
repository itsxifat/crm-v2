'use client'

import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import { Label, inputClass, textareaClass, selectClass } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { currencyOptions } from '@/lib/currencies'
import { BIN_REGEX, TIN_REGEX, normalizeBin } from '@/lib/tax/catalog'

const AGENCY_TYPES = ['Production House', 'Design Studio', 'Marketing Agency', 'IT Company', 'Other']

const PAYEE_TYPES = [
  { value: 'INDIVIDUAL',   label: 'Individual (resident)' },
  { value: 'COMPANY',      label: 'Company / firm' },
  { value: 'NON_RESIDENT', label: 'Non-resident (abroad)' },
]

// ── Schemas ──────────────────────────────────────────────────────────────────

// Edit forms are pre-filled from masked API responses ('j•••@g••.com', '••••••').
// Accept an untouched masked value; the API restores the stored value for it.
const masked = z.string().refine(v => v.includes('••'))
const isMasked = v => typeof v === 'string' && v.includes('••')
const binDigits = v => String(v ?? '').replace(/\s+/g, '')
const tinDigits = v => String(v ?? '').replace(/[\s-]+/g, '')

// Tax identity (payee side of TDS / VDS): e-TIN 12 digits, BIN 9 or 13 digits.
const taxFields = {
  tin: z.string().optional()
    .refine(v => !v || isMasked(v) || !tinDigits(v) || TIN_REGEX.test(tinDigits(v)), 'TIN must be the 12-digit e-TIN'),
  bin: z.string().optional()
    .refine(v => !v || !binDigits(v) || BIN_REGEX.test(binDigits(v)), 'BIN must be 9 or 13 digits, e.g. 000123456-0101'),
  payeeType: z.enum(['COMPANY', 'INDIVIDUAL', 'NON_RESIDENT']).optional(),
  hasPsr:    z.boolean().optional(),
}

const salaryFields = {
  employmentMode:  z.enum(['PROJECT', 'SALARY']).default('PROJECT'),
  paymentCurrency: z.string().default('BDT'),
  salaryAmount:    masked.or(z.coerce.number().positive()).optional().or(z.literal('')),
  salaryCurrency:  z.string().optional(),
  salaryDay:       z.coerce.number().int().min(1).max(28).optional().or(z.literal('')),
  salaryStartDate: z.string().optional(),
  salaryEndDate:   z.string().optional(),
}

const freelancerSchema = z.object({
  name:   z.string().min(1, 'Name is required'),
  email:  z.string().email('Valid email required').or(masked),
  phone:  z.string().optional(),
  skills: z.string().optional(),
  bio:    z.string().optional(),
  ...salaryFields,
  ...taxFields,
}).superRefine((d, ctx) => {
  if (d.employmentMode === 'SALARY') {
    if (!d.salaryAmount) ctx.addIssue({ path: ['salaryAmount'], code: 'custom', message: 'Salary amount required' })
    if (!d.salaryDay)    ctx.addIssue({ path: ['salaryDay'], code: 'custom', message: 'Salary day required' })
  }
})

const agencySchema = z.object({
  email:              z.string().email('Valid email required').or(masked),
  agencyName:         z.string().min(1, 'Agency name is required'),
  agencyPhone:        z.string().optional(),
  agencyAddress:      z.string().optional(),
  agencyType:         z.string().optional(),
  contactName:        z.string().min(1, 'Contact name is required'),
  contactPhone:       z.string().optional(),
  contactEmail:       z.string().email().or(masked).optional().or(z.literal('')),
  contactDesignation: z.string().optional(),
  paymentCurrency:    z.string().default('BDT'),
  ...taxFields,
})

/** Tax-identity part of the request body. An untouched masked TIN is omitted. */
function taxPayload(data, initialTin) {
  const bin = binDigits(data.bin)
  const out = {
    bin:       bin ? (normalizeBin(bin) || bin) : null,
    payeeType: data.payeeType || undefined,
    hasPsr:    !!data.hasPsr,
  }
  if (!(isMasked(data.tin) && data.tin === initialTin)) out.tin = tinDigits(data.tin) || null
  return out
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, required, error, hint, className, children }) {
  return (
    <div className={className}>
      <Label required={required}>{label}</Label>
      {children}
      {error
        ? <p className="mt-1.5 text-xs text-red-600">{error}</p>
        : hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function Input({ register, name, type = 'text', placeholder, className = '', readOnly = false }) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      readOnly={readOnly}
      {...register(name)}
      className={cn(inputClass, readOnly && 'cursor-not-allowed bg-gray-50 text-gray-500', className)}
    />
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-4 border-t border-gray-100 pt-5 first:border-t-0 first:pt-0">
      <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
      {children}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function FreelancerModal({ open, onOpenChange, freelancer, onSaved, defaultType = 'FREELANCER' }) {
  const isEdit = !!freelancer
  const type   = isEdit ? (freelancer.type ?? defaultType) : defaultType
  const isAgency = type === 'AGENCY'

  const schema = isAgency ? agencySchema : freelancerSchema
  const { register, control, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { employmentMode: 'PROJECT', paymentCurrency: 'BDT' },
  })

  const employmentMode = watch('employmentMode')
  const payeeTypeValue = watch('payeeType')
  const hasPsrValue    = watch('hasPsr')
  const initialTin     = isEdit ? (freelancer?.tin ?? '') : ''
  const defaultPayee   = isAgency ? 'COMPANY' : 'INDIVIDUAL'

  useEffect(() => {
    if (!open) return
    // Tax identity defaults shared by both forms.
    const tax = isEdit
      ? {
          tin:       freelancer.tin ?? '',
          bin:       freelancer.bin ?? '',
          payeeType: freelancer.payeeType ?? defaultPayee,
          hasPsr:    !!freelancer.hasPsr,
        }
      : { tin: '', bin: '', payeeType: defaultPayee, hasPsr: false }
    if (isEdit) {
      if (isAgency) {
        reset({
          ...tax,
          email:              freelancer.userId?.email            ?? '',
          agencyName:         freelancer.agencyInfo?.agencyName   ?? '',
          agencyPhone:        freelancer.agencyInfo?.phone        ?? '',
          agencyAddress:      freelancer.agencyInfo?.address      ?? '',
          agencyType:         freelancer.agencyInfo?.type         ?? '',
          contactName:        freelancer.contactPerson?.name      ?? '',
          contactPhone:       freelancer.contactPerson?.phone     ?? '',
          contactEmail:       freelancer.contactPerson?.email     ?? '',
          contactDesignation: freelancer.contactPerson?.designation ?? '',
          paymentCurrency:    freelancer.paymentCurrency ?? 'BDT',
        })
      } else {
        reset({
          ...tax,
          name:            freelancer.userId?.name  ?? '',
          email:           freelancer.userId?.email ?? '',
          phone:           freelancer.userId?.phone ?? '',
          skills:          freelancer.skills        ?? '',
          bio:             freelancer.bio           ?? '',
          employmentMode:  freelancer.employmentMode ?? 'PROJECT',
          paymentCurrency: freelancer.paymentCurrency ?? 'BDT',
          salaryAmount:    freelancer.salaryAmount ?? '',
          salaryCurrency:  freelancer.salaryCurrency ?? '',
          salaryDay:       freelancer.salaryDay ?? '',
          salaryStartDate: freelancer.salaryStartDate ? freelancer.salaryStartDate.slice(0, 10) : '',
          salaryEndDate:   freelancer.salaryEndDate ? freelancer.salaryEndDate.slice(0, 10) : '',
        })
      }
    } else {
      reset({ employmentMode: 'PROJECT', paymentCurrency: 'BDT', ...tax })
    }
  }, [open, isEdit, freelancer, isAgency, reset, defaultPayee])

  async function onSubmit(data) {
   try {
    if (isMasked(data.tin) && data.tin !== initialTin) {
      toast.error('Clear the hidden TIN fully, then type the full 12-digit e-TIN')
      return
    }
    let body
    if (isAgency) {
      body = {
        type: 'AGENCY',
        // The login email can't be changed from this form (the API ignores it on edit).
        ...(!isEdit && { email: data.email }),
        paymentCurrency: data.paymentCurrency || 'BDT',
        agencyInfo: {
          agencyName: data.agencyName,
          phone:      data.agencyPhone   || null,
          address:    data.agencyAddress || null,
          type:       data.agencyType    || null,
        },
        contactPerson: {
          name:        data.contactName        || null,
          phone:       data.contactPhone       || null,
          email:       data.contactEmail       || null,
          designation: data.contactDesignation || null,
        },
        ...taxPayload(data, initialTin),
      }
    } else {
      body = {
        type: 'FREELANCER',
        name:            data.name,
        ...(!isEdit && { email: data.email }),
        phone:           data.phone  || null,
        skills:          data.skills || null,
        bio:             data.bio    || null,
        employmentMode:  data.employmentMode || 'PROJECT',
        paymentCurrency: data.paymentCurrency || 'BDT',
        ...(data.employmentMode === 'SALARY' ? {
          salaryAmount:    isMasked(data.salaryAmount) ? data.salaryAmount : (data.salaryAmount ? Number(data.salaryAmount) : null),
          salaryCurrency:  data.salaryCurrency || data.paymentCurrency || 'BDT',
          salaryDay:       data.salaryDay ? Number(data.salaryDay) : null,
          salaryStartDate: data.salaryStartDate || null,
          salaryEndDate:   data.salaryEndDate || null,
          salaryActive:    Boolean(data.salaryAmount && data.salaryDay),
        } : { employmentMode: 'PROJECT' }),
        ...taxPayload(data, initialTin),
      }
    }

    const url    = isEdit ? `/api/freelancers/${freelancer.id}` : '/api/freelancers'
    const method = isEdit ? 'PUT' : 'POST'
    const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json   = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Surface the first field message of a 422 { details: zod.flatten() }.
      const fieldMsg = Object.values(json?.details?.fieldErrors ?? {}).find(m => Array.isArray(m) && m.length)?.[0]
      throw new Error(fieldMsg ?? json.error ?? `Failed to save (${res.status})`)
    }
    // Pass the whole payload up (not just data) so the caller can report the real
    // email-delivery outcome instead of always claiming "Invitation sent!".
    onSaved(json)
    onOpenChange(false)
   } catch (err) {
    // Previously any failure here threw out of the async submit handler with no
    // UI feedback — the button just "did nothing". Surface it.
    toast.error(err?.message ?? 'Something went wrong')
   }
  }

  const title = isEdit
    ? `Edit ${isAgency ? 'agency' : 'freelancer'}`
    : `New ${isAgency ? 'agency' : 'freelancer'}`

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="lg">
      <form id="fl-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">

        {isAgency ? (
          <>
            <Section title="Agency">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Agency email" required error={errors.email?.message}
                  hint={isEdit ? 'Login email can\'t be changed' : undefined} className="sm:col-span-2">
                  <Input register={register} name="email" type="email" placeholder="agency@example.com" readOnly={isEdit} />
                </Field>
                <Field label="Agency name" required error={errors.agencyName?.message} className="sm:col-span-2">
                  <Input register={register} name="agencyName" placeholder="Acme Production House" />
                </Field>
                <Field label="Phone" error={errors.agencyPhone?.message}>
                  <Input register={register} name="agencyPhone" placeholder="+880 1XXX XXXXXX" />
                </Field>
                <Field label="Agency type" error={errors.agencyType?.message}>
                  <Controller name="agencyType" control={control} render={({ field }) => (
                    <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                      options={AGENCY_TYPES.map(t => ({ value: t, label: t }))} placeholder="Select…" />
                  )} />
                </Field>
                <Field label="Address" error={errors.agencyAddress?.message} className="sm:col-span-2">
                  <Input register={register} name="agencyAddress" placeholder="123 Main Street, Dhaka" />
                </Field>
              </div>
            </Section>

            <Section title="Contact person">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Contact name" required error={errors.contactName?.message}>
                  <Input register={register} name="contactName" placeholder="Full name" />
                </Field>
                <Field label="Designation" error={errors.contactDesignation?.message}>
                  <Input register={register} name="contactDesignation" placeholder="e.g. CEO" />
                </Field>
                <Field label="Contact phone" error={errors.contactPhone?.message}>
                  <Input register={register} name="contactPhone" placeholder="+880 1XXX XXXXXX" />
                </Field>
                <Field label="Contact email" error={errors.contactEmail?.message}>
                  <Input register={register} name="contactEmail" type="email" placeholder="contact@example.com" />
                </Field>
              </div>
            </Section>
          </>
        ) : (
          <Section title="Profile">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" required error={errors.name?.message}>
                <Input register={register} name="name" placeholder="John Doe" />
              </Field>
              <Field label="Email" required error={errors.email?.message}
                hint={isEdit ? 'Login email can\'t be changed' : undefined}>
                <Input register={register} name="email" type="email" placeholder="john@example.com" readOnly={isEdit} />
              </Field>
              <Field label="Phone" error={errors.phone?.message} className="sm:col-span-2">
                <Input register={register} name="phone" placeholder="+880 1XXX XXXXXX" />
              </Field>
              <Field label="Skills" error={errors.skills?.message} className="sm:col-span-2">
                <Input register={register} name="skills" placeholder="React, Node.js, UI design…" />
              </Field>
              <Field label="Bio" error={errors.bio?.message} className="sm:col-span-2">
                <textarea rows={3} placeholder="Short bio…" {...register('bio')}
                  className={cn(textareaClass, 'resize-none')} />
              </Field>
            </div>
          </Section>
        )}

        {/* Tax identity — drives TDS when this person / agency is paid */}
        <Section title="Tax identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="TIN (e-TIN)" error={errors.tin?.message}
              hint={isMasked(initialTin) ? 'Hidden — clear it to enter a new one' : undefined}>
              <Input register={register} name="tin" placeholder="12-digit e-TIN" className="font-mono" />
            </Field>
            <Field label={isAgency ? 'BIN' : 'BIN (if VAT registered)'} error={errors.bin?.message}>
              <Input register={register} name="bin" placeholder="000123456-0101" className="font-mono" />
            </Field>
            <Field label="Payee type" error={errors.payeeType?.message}
              hint={payeeTypeValue === 'NON_RESIDENT' ? 's.119 non-resident TDS rates apply' : undefined}>
              <select {...register('payeeType')} className={selectClass} title="Sets the TDS rate">
                {PAYEE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-start gap-2.5 pb-1">
                <input type="checkbox" {...register('hasPsr')}
                  className="mt-0.5 size-4 rounded border-gray-300" />
                <span>
                  <span className="block text-sm font-medium text-gray-900" title="Proof of return submission">PSR on file</span>
                  <span className={`block text-xs ${hasPsrValue ? 'text-muted-foreground' : 'text-amber-600'}`}>
                    Without PSR, TDS is 1.5× the normal rate.
                  </span>
                </span>
              </label>
            </div>
          </div>
        </Section>

        {/* Engagement & currency */}
        <Section title="Engagement">
          {!isAgency && (
            <Field label="Payment basis">
              <Controller name="employmentMode" control={control} render={({ field }) => (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['PROJECT', 'Per project/task', 'Fixed amount per assignment'],
                    ['SALARY',  'Monthly salary',   'Temporary salaried hire'],
                  ].map(([val, label, hint]) => (
                    <button type="button" key={val} onClick={() => field.onChange(val)}
                      className={cn(
                        'rounded-lg border px-3 py-2.5 text-left transition-colors',
                        field.value === val ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200 hover:bg-gray-50'
                      )}>
                      <p className="text-sm font-medium text-gray-900">{label}</p>
                      <p className="text-xs text-muted-foreground">{hint}</p>
                    </button>
                  ))}
                </div>
              )} />
            </Field>
          )}

          <Field label="Default payment currency" error={errors.paymentCurrency?.message}>
            <Controller name="paymentCurrency" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? 'BDT')}
                options={currencyOptions} placeholder="Select…" />
            )} />
          </Field>

          {!isAgency && employmentMode === 'SALARY' && (
            <div className="grid gap-4 rounded-lg bg-gray-50 p-4 sm:grid-cols-2">
              <Field label="Salary amount" required error={errors.salaryAmount?.message}>
                <Input register={register} name="salaryAmount" type="number" placeholder="0.00" />
              </Field>
              <Field label="Salary currency" error={errors.salaryCurrency?.message}>
                <Controller name="salaryCurrency" control={control} render={({ field }) => (
                  <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                    options={currencyOptions} placeholder="Same as payment" />
                )} />
              </Field>
              <Field label="Pay day of month" required error={errors.salaryDay?.message}>
                <Input register={register} name="salaryDay" type="number" placeholder="1–28" />
              </Field>
              <div className="hidden sm:block" />
              <Field label="Start date" error={errors.salaryStartDate?.message}>
                <Input register={register} name="salaryStartDate" type="date" />
              </Field>
              <Field label="End date" error={errors.salaryEndDate?.message}>
                <Input register={register} name="salaryEndDate" type="date" />
              </Field>
            </div>
          )}
        </Section>
      </form>

      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        {/* Invoke the submit handler directly instead of relying on the
            `form="fl-form"` association across the Radix Dialog portal — that
            link is what silently failed, making the button appear to do nothing. */}
        <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
          {isEdit ? 'Save' : 'Send invitation'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
