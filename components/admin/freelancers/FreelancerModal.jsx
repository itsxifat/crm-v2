'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Info } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'

const RATE_TYPES    = ['Hourly', 'Daily', 'Fixed', 'Monthly']
const AGENCY_TYPES  = ['Production House', 'Design Studio', 'Marketing Agency', 'IT Company', 'Other']

// ── Schemas ──────────────────────────────────────────────────────────────────

const freelancerSchema = z.object({
  name:       z.string().min(1, 'Name is required'),
  email:      z.string().email('Valid email required'),
  phone:      z.string().optional(),
  skills:     z.string().optional(),
  bio:        z.string().optional(),
  hourlyRate: z.coerce.number().positive().optional().or(z.literal('')),
  rateType:   z.string().optional(),
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
  hourlyRate:         z.coerce.number().positive().optional().or(z.literal('')),
  rateType:           z.string().optional(),
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

function Input({ register, name, type = 'text', placeholder, errors, className = '' }) {
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

  const schema  = type === 'AGENCY' ? agencySchema : freelancerSchema
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (!open) return
    if (isEdit) {
      if (type === 'AGENCY') {
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
          hourlyRate:         freelancer.hourlyRate ?? '',
          rateType:           freelancer.rateType   ?? '',
        })
      } else {
        reset({
          name:       freelancer.userId?.name  ?? '',
          email:      freelancer.userId?.email ?? '',
          phone:      freelancer.userId?.phone ?? '',
          skills:     freelancer.skills        ?? '',
          bio:        freelancer.bio           ?? '',
          hourlyRate: freelancer.hourlyRate    ?? '',
          rateType:   freelancer.rateType      ?? '',
        })
      }
    } else {
      reset({})
    }
  }, [open, isEdit, freelancer, type, reset])

  async function onSubmit(data) {
    let body

    if (type === 'AGENCY') {
      body = {
        type: 'AGENCY',
        email: data.email,
        agencyInfo: {
          agencyName: data.agencyName,
          phone:      data.agencyPhone      || null,
          address:    data.agencyAddress    || null,
          type:       data.agencyType       || null,
        },
        contactPerson: {
          name:        data.contactName        || null,
          phone:       data.contactPhone       || null,
          email:       data.contactEmail       || null,
          designation: data.contactDesignation || null,
        },
        hourlyRate: data.hourlyRate || null,
        rateType:   data.rateType   || null,
      }
    } else {
      body = {
        type: 'FREELANCER',
        name:       data.name,
        email:      data.email,
        phone:      data.phone       || null,
        skills:     data.skills      || null,
        bio:        data.bio         || null,
        hourlyRate: data.hourlyRate  || null,
        rateType:   data.rateType    || null,
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
    ? `Edit ${type === 'AGENCY' ? 'Agency' : 'Freelancer'}`
    : `Add ${type === 'AGENCY' ? 'Agency' : 'Freelancer'}`

  const description = isEdit
    ? `Update ${type === 'AGENCY' ? 'agency' : 'freelancer'} profile`
    : `Create a new ${type === 'AGENCY' ? 'agency partner' : 'freelancer'} account`

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description} size="lg">
      <form id="fl-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">

        {type === 'AGENCY' ? (
          <>
            {/* Agency Information */}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1">Agency Information</p>
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="col-span-2">
                  <Field label="Agency Email *" error={errors.email?.message}>
                    <Input register={register} name="email" type="email" placeholder="agency@example.com" errors={errors} />
                  </Field>
                </div>
                <div className="col-span-2">
                  <Field label="Agency Name *" error={errors.agencyName?.message}>
                    <Input register={register} name="agencyName" placeholder="Acme Production House" errors={errors} />
                  </Field>
                </div>
                <Field label="Phone" error={errors.agencyPhone?.message}>
                  <Input register={register} name="agencyPhone" placeholder="+880 1XXX XXXXXX" errors={errors} />
                </Field>
                <Field label="Agency Type" error={errors.agencyType?.message}>
                  <select {...register('agencyType')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
                    <option value="">Select…</option>
                    {AGENCY_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <div className="col-span-2">
                  <Field label="Address" error={errors.agencyAddress?.message}>
                    <Input register={register} name="agencyAddress" placeholder="123 Main Street, Dhaka" errors={errors} />
                  </Field>
                </div>
              </div>
            </div>

            {/* Contact Person */}
            <div className="border-t border-gray-100 pt-4 space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact Person / Owner</p>
              <div className="grid grid-cols-2 gap-4 pt-2">
                <Field label="Contact Name *" error={errors.contactName?.message}>
                  <Input register={register} name="contactName" placeholder="Full Name" errors={errors} />
                </Field>
                <Field label="Designation" error={errors.contactDesignation?.message}>
                  <Input register={register} name="contactDesignation" placeholder="e.g. CEO, Manager" errors={errors} />
                </Field>
                <Field label="Contact Phone" error={errors.contactPhone?.message}>
                  <Input register={register} name="contactPhone" placeholder="+880 1XXX XXXXXX" errors={errors} />
                </Field>
                <Field label="Contact Email" error={errors.contactEmail?.message}>
                  <Input register={register} name="contactEmail" type="email" placeholder="contact@example.com" errors={errors} />
                </Field>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Freelancer Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Full Name *" error={errors.name?.message}>
                <Input register={register} name="name" placeholder="John Doe" errors={errors} />
              </Field>
              <Field label="Email *" error={errors.email?.message}>
                <Input register={register} name="email" type="email" placeholder="john@example.com" errors={errors} />
              </Field>
              <div className="col-span-2">
                <Field label="Phone" error={errors.phone?.message}>
                  <Input register={register} name="phone" placeholder="+880 1XXX XXXXXX" errors={errors} />
                </Field>
              </div>
            </div>

            <Field label="Skills" error={errors.skills?.message}>
              <Input register={register} name="skills" placeholder="React, Node.js, UI Design…" errors={errors} />
            </Field>

            <Field label="Bio" error={errors.bio?.message}>
              <textarea rows={3} placeholder="Short bio…" {...register('bio')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition resize-none" />
            </Field>

            {/* Invite info box */}
            {!isEdit && (
              <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-700 leading-relaxed">
                  An invitation email will be sent to this address. The freelancer will set their own password to activate their account.
                </p>
              </div>
            )}
          </>
        )}

        {/* Rate Section */}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Rate</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Rate ($)" error={errors.hourlyRate?.message}>
              <input type="number" step="0.01" placeholder="0.00" {...register('hourlyRate')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition" />
            </Field>
            <Field label="Rate Type" error={errors.rateType?.message}>
              <select {...register('rateType')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
                <option value="">Select…</option>
                {RATE_TYPES.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
          </div>
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
          {isEdit ? 'Save Changes' : `Send Invitation`}
        </button>
      </ModalFooter>
    </Modal>
  )
}
