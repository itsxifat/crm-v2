'use client'

import { useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Info } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Select from '@/components/ui/Select'
import { currencyOptions } from '@/lib/currencies'

const AGENCY_TYPES = ['Production House', 'Design Studio', 'Marketing Agency', 'IT Company', 'Other']

// ── Schemas ──────────────────────────────────────────────────────────────────

const salaryFields = {
  employmentMode:  z.enum(['PROJECT', 'SALARY']).default('PROJECT'),
  paymentCurrency: z.string().default('BDT'),
  salaryAmount:    z.coerce.number().positive().optional().or(z.literal('')),
  salaryCurrency:  z.string().optional(),
  salaryDay:       z.coerce.number().int().min(1).max(28).optional().or(z.literal('')),
  salaryStartDate: z.string().optional(),
  salaryEndDate:   z.string().optional(),
}

const freelancerSchema = z.object({
  name:   z.string().min(1, 'Name is required'),
  email:  z.string().email('Valid email required'),
  phone:  z.string().optional(),
  skills: z.string().optional(),
  bio:    z.string().optional(),
  ...salaryFields,
}).superRefine((d, ctx) => {
  if (d.employmentMode === 'SALARY') {
    if (!d.salaryAmount) ctx.addIssue({ path: ['salaryAmount'], code: 'custom', message: 'Salary amount required' })
    if (!d.salaryDay)    ctx.addIssue({ path: ['salaryDay'], code: 'custom', message: 'Salary day required' })
  }
})

const agencySchema = z.object({
  email:              z.string().email('Valid email required'),
  agencyName:         z.string().min(1, 'Agency name is required'),
  agencyPhone:        z.string().optional(),
  agencyAddress:      z.string().optional(),
  agencyType:         z.string().optional(),
  contactName:        z.string().min(1, 'Contact name is required'),
  contactPhone:       z.string().optional(),
  contactEmail:       z.string().email().optional().or(z.literal('')),
  contactDesignation: z.string().optional(),
  paymentCurrency:    z.string().default('BDT'),
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, error, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}

function Input({ register, name, type = 'text', placeholder, className = '' }) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      {...register(name)}
      className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition ${className}`}
    />
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

  useEffect(() => {
    if (!open) return
    if (isEdit) {
      if (isAgency) {
        reset({
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
      reset({ employmentMode: 'PROJECT', paymentCurrency: 'BDT' })
    }
  }, [open, isEdit, freelancer, isAgency, reset])

  async function onSubmit(data) {
    let body
    if (isAgency) {
      body = {
        type: 'AGENCY',
        email: data.email,
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
      }
    } else {
      body = {
        type: 'FREELANCER',
        name:            data.name,
        email:           data.email,
        phone:           data.phone  || null,
        skills:          data.skills || null,
        bio:             data.bio    || null,
        employmentMode:  data.employmentMode || 'PROJECT',
        paymentCurrency: data.paymentCurrency || 'BDT',
        ...(data.employmentMode === 'SALARY' ? {
          salaryAmount:    data.salaryAmount ? Number(data.salaryAmount) : null,
          salaryCurrency:  data.salaryCurrency || data.paymentCurrency || 'BDT',
          salaryDay:       data.salaryDay ? Number(data.salaryDay) : null,
          salaryStartDate: data.salaryStartDate || null,
          salaryEndDate:   data.salaryEndDate || null,
          salaryActive:    Boolean(data.salaryAmount && data.salaryDay),
        } : { employmentMode: 'PROJECT' }),
      }
    }

    const url    = isEdit ? `/api/freelancers/${freelancer.id}` : '/api/freelancers'
    const method = isEdit ? 'PUT' : 'POST'
    const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json   = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Failed to save')
    onSaved(json.data)
    onOpenChange(false)
  }

  const title = isEdit
    ? `Edit ${isAgency ? 'Agency' : 'Freelancer'}`
    : `Add ${isAgency ? 'Agency' : 'Freelancer'}`
  const description = isEdit
    ? `Update ${isAgency ? 'agency' : 'freelancer'} profile`
    : `Create a new ${isAgency ? 'agency partner' : 'freelancer'} account`

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description} size="lg">
      <form id="fl-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">

        {isAgency ? (
          <>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1">Agency Information</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="sm:col-span-2">
                  <Field label="Agency Email *" error={errors.email?.message}>
                    <Input register={register} name="email" type="email" placeholder="agency@example.com" />
                  </Field>
                </div>
                <div className="sm:col-span-2">
                  <Field label="Agency Name *" error={errors.agencyName?.message}>
                    <Input register={register} name="agencyName" placeholder="Acme Production House" />
                  </Field>
                </div>
                <Field label="Phone" error={errors.agencyPhone?.message}>
                  <Input register={register} name="agencyPhone" placeholder="+880 1XXX XXXXXX" />
                </Field>
                <Field label="Agency Type" error={errors.agencyType?.message}>
                  <Controller name="agencyType" control={control} render={({ field }) => (
                    <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                      options={AGENCY_TYPES.map(t => ({ value: t, label: t }))} placeholder="Select…" />
                  )} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Address" error={errors.agencyAddress?.message}>
                    <Input register={register} name="agencyAddress" placeholder="123 Main Street, Dhaka" />
                  </Field>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact Person / Owner</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <Field label="Contact Name *" error={errors.contactName?.message}>
                  <Input register={register} name="contactName" placeholder="Full Name" />
                </Field>
                <Field label="Designation" error={errors.contactDesignation?.message}>
                  <Input register={register} name="contactDesignation" placeholder="e.g. CEO, Manager" />
                </Field>
                <Field label="Contact Phone" error={errors.contactPhone?.message}>
                  <Input register={register} name="contactPhone" placeholder="+880 1XXX XXXXXX" />
                </Field>
                <Field label="Contact Email" error={errors.contactEmail?.message}>
                  <Input register={register} name="contactEmail" type="email" placeholder="contact@example.com" />
                </Field>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name *" error={errors.name?.message}>
                <Input register={register} name="name" placeholder="John Doe" />
              </Field>
              <Field label="Email *" error={errors.email?.message}>
                <Input register={register} name="email" type="email" placeholder="john@example.com" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Phone" error={errors.phone?.message}>
                  <Input register={register} name="phone" placeholder="+880 1XXX XXXXXX" />
                </Field>
              </div>
            </div>

            <Field label="Skills" error={errors.skills?.message}>
              <Input register={register} name="skills" placeholder="React, Node.js, UI Design…" />
            </Field>

            <Field label="Bio" error={errors.bio?.message}>
              <textarea rows={3} placeholder="Short bio…" {...register('bio')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition resize-none" />
            </Field>

            {!isEdit && (
              <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-700 leading-relaxed">
                  No rate is set here — pay is agreed per project/task when you engage them.
                  An invitation email lets the freelancer set their own password.
                </p>
              </div>
            )}
          </>
        )}

        {/* Engagement & currency */}
        <div className="border-t border-gray-100 pt-4 space-y-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Engagement</p>

          {!isAgency && (
            <Field label="How is this freelancer paid?">
              <Controller name="employmentMode" control={control} render={({ field }) => (
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['PROJECT', 'Per project/task', 'Fixed amount agreed at assignment'],
                    ['SALARY',  'Monthly salary',   'Temporary salary-based hire'],
                  ].map(([val, label, hint]) => (
                    <button type="button" key={val} onClick={() => field.onChange(val)}
                      className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
                        field.value === val ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                      }`}>
                      <p className="text-sm font-medium text-gray-900">{label}</p>
                      <p className="text-xs text-gray-400">{hint}</p>
                    </button>
                  ))}
                </div>
              )} />
            </Field>
          )}

          <Field label="Default payment currency" error={errors.paymentCurrency?.message}>
            <Controller name="paymentCurrency" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? 'BDT')}
                options={currencyOptions} placeholder="Select currency…" />
            )} />
          </Field>

          {!isAgency && employmentMode === 'SALARY' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-indigo-50/50 border border-indigo-100 rounded-xl p-4">
              <Field label="Salary amount *" error={errors.salaryAmount?.message}>
                <Input register={register} name="salaryAmount" type="number" placeholder="0.00" />
              </Field>
              <Field label="Salary currency" error={errors.salaryCurrency?.message}>
                <Controller name="salaryCurrency" control={control} render={({ field }) => (
                  <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                    options={currencyOptions} placeholder="Same as payment currency" />
                )} />
              </Field>
              <Field label="Pay on day of month *" error={errors.salaryDay?.message}>
                <Input register={register} name="salaryDay" type="number" placeholder="1–28" />
              </Field>
              <div />
              <Field label="Start date" error={errors.salaryStartDate?.message}>
                <Input register={register} name="salaryStartDate" type="date" />
              </Field>
              <Field label="End date (temporary)" error={errors.salaryEndDate?.message}>
                <Input register={register} name="salaryEndDate" type="date" />
              </Field>
            </div>
          )}
        </div>
      </form>

      <ModalFooter>
        <button type="button" onClick={() => onOpenChange(false)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="submit" form="fl-form" disabled={isSubmitting}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2">
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save Changes' : 'Send Invitation'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
