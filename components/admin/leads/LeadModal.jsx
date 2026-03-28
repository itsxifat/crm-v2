'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'

const schema = z.object({
  name:         z.string().min(1, 'Name is required'),
  email:        z.string().email('Invalid email').optional().or(z.literal('')).nullable(),
  phone:        z.string().optional().nullable(),
  company:      z.string().optional().nullable(),
  industry:     z.string().optional().nullable(),
  source:       z.string().optional().nullable(),
  status:       z.enum(['NEW','CONTACTED','PROPOSAL_SENT','NEGOTIATION','WON','LOST']).default('NEW'),
  value:        z.string().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  followUpDate: z.string().optional().nullable(),
  notes:        z.string().optional().nullable(),
})

const SOURCES = [
  { value: 'website',        label: 'Website' },
  { value: 'referral',       label: 'Referral' },
  { value: 'social_media',   label: 'Social Media' },
  { value: 'email_campaign', label: 'Email Campaign' },
  { value: 'cold_outreach',  label: 'Cold Outreach' },
  { value: 'other',          label: 'Other' },
]

const STATUSES = [
  { value: 'NEW',           label: 'New' },
  { value: 'CONTACTED',     label: 'Contacted' },
  { value: 'PROPOSAL_SENT', label: 'Proposal Sent' },
  { value: 'NEGOTIATION',   label: 'Negotiation' },
  { value: 'WON',           label: 'Won' },
  { value: 'LOST',          label: 'Lost' },
]

export default function LeadModal({ open, onClose, lead, onSuccess }) {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading]     = useState(false)
  const isEdit = !!lead

  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name:         '',
      email:        '',
      phone:        '',
      company:      '',
      industry:     '',
      source:       '',
      status:       'NEW',
      value:        '',
      assignedToId: '',
      followUpDate: '',
      notes:        '',
    },
  })

  useEffect(() => {
    if (open) {
      if (lead) {
        reset({
          name:         lead.name         ?? '',
          email:        lead.email         ?? '',
          phone:        lead.phone         ?? '',
          company:      lead.company       ?? '',
          industry:     lead.industry      ?? '',
          source:       lead.source        ?? '',
          status:       lead.status        ?? 'NEW',
          value:        lead.value ? String(lead.value) : '',
          assignedToId: lead.assignedToId  ?? '',
          followUpDate: lead.followUpDate ? new Date(lead.followUpDate).toISOString().slice(0, 10) : '',
          notes:        lead.notes         ?? '',
        })
      } else {
        reset({
          name: '', email: '', phone: '', company: '', industry: '',
          source: '', status: 'NEW', value: '', assignedToId: '', followUpDate: '', notes: '',
        })
      }
      // Fetch employees for assignment dropdown
      fetch('/api/employees?limit=100')
        .then((r) => r.json())
        .then((d) => setEmployees(d.data ?? []))
        .catch(() => {})
    }
  }, [open, lead, reset])

  const onSubmit = async (values) => {
    setLoading(true)
    try {
      const payload = {
        ...values,
        email:        values.email     || null,
        phone:        values.phone     || null,
        company:      values.company   || null,
        industry:     values.industry  || null,
        source:       values.source    || null,
        value:        values.value ? parseFloat(values.value) : null,
        assignedToId: values.assignedToId || null,
        followUpDate: values.followUpDate ? new Date(values.followUpDate).toISOString() : null,
        notes:        values.notes     || null,
      }

      const url    = isEdit ? `/api/leads/${lead.id}` : '/api/leads'
      const method = isEdit ? 'PUT' : 'POST'

      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error ?? 'Something went wrong')

      toast.success(isEdit ? 'Lead updated successfully' : 'Lead created successfully')
      onSuccess?.(data.data)
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inputClass = (error) =>
    `w-full px-3 py-2 text-sm border rounded-lg bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${error ? 'border-red-300' : 'border-gray-200'}`

  const labelClass = 'block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide'

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={isEdit ? 'Edit Lead' : 'Add New Lead'}
      description={isEdit ? 'Update lead information' : 'Fill in the details to create a new lead'}
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Row 1: Name + Email */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Name *</label>
            <input {...register('name')} placeholder="John Smith" className={inputClass(errors.name)} />
            {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input {...register('email')} type="email" placeholder="john@example.com" className={inputClass(errors.email)} />
            {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
          </div>
        </div>

        {/* Row 2: Phone + Company */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Phone</label>
            <input {...register('phone')} type="tel" placeholder="+1 234 567 8900" className={inputClass(errors.phone)} />
          </div>
          <div>
            <label className={labelClass}>Company</label>
            <input {...register('company')} placeholder="Acme Corp" className={inputClass(errors.company)} />
          </div>
        </div>

        {/* Row 3: Industry + Source */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Industry</label>
            <input {...register('industry')} placeholder="Technology" className={inputClass(errors.industry)} />
          </div>
          <div>
            <label className={labelClass}>Source</label>
            <select {...register('source')} className={inputClass(errors.source)}>
              <option value="">Select source</option>
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 4: Status + Value */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Status</label>
            <select {...register('status')} className={inputClass(errors.status)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Deal Value ($)</label>
            <input {...register('value')} type="number" step="0.01" min="0" placeholder="0.00" className={inputClass(errors.value)} />
          </div>
        </div>

        {/* Row 5: Assigned To + Follow-up Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Assigned To</label>
            <select {...register('assignedToId')} className={inputClass(errors.assignedToId)}>
              <option value="">Unassigned</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.user?.name ?? emp.id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Follow-up Date</label>
            <input {...register('followUpDate')} type="date" className={inputClass(errors.followUpDate)} />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className={labelClass}>Notes</label>
          <textarea
            {...register('notes')}
            rows={3}
            placeholder="Add any relevant notes..."
            className={inputClass(errors.notes) + ' resize-none'}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Lead'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
