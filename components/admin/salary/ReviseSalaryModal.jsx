'use client'

import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input'
import TkAmt from '@/components/ui/TkAmt'
import { TYPE_OPTIONS, monthOptions, computeNewSalary, changeText } from './salaryUi'

/**
 * Propose (or, for an approver, make) a salary change for one employee.
 * `approved` — the employee's approved revisions, so the starting salary is the
 * one in effect the month before the change (a raise already scheduled counts).
 */
export default function ReviseSalaryModal({ employee, approved = [], canApprove, onClose, onDone }) {
  const months = useMemo(() => monthOptions(), [])
  const [form, setForm] = useState({ type: 'INCREMENT', effectiveMonth: months[1]?.value ?? months[0].value, mode: 'percent', value: '', designation: '', reason: '', approveNow: !!canApprove })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Salary in that month so far (an approved change starting earlier or the same month counts).
  const base = useMemo(() => {
    const prior = approved.filter(r => r.effectiveMonth <= form.effectiveMonth).sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth))
    return prior.length ? prior[prior.length - 1].newSalary : (Number(employee.salary) || 0)
  }, [approved, form.effectiveMonth, employee.salary])
  const next = computeNewSalary(base, form.mode, form.value, form.type)

  async function submit(e) {
    e.preventDefault()
    if (!(next > 0)) return toast.error('Enter the new salary, a percentage or an amount')
    setSaving(true)
    try {
      const res = await fetch('/api/salary-revisions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effectiveMonth: form.effectiveMonth, type: form.type, reason: form.reason || null, approveNow: canApprove && form.approveNow,
          items: [{ employeeId: employee.id, newSalary: next, newDesignation: form.type === 'PROMOTION' ? form.designation : null }],
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.failed?.[0]?.error || j.error || 'Could not save')
      const r = j.created?.[0]
      toast.success(r?.status === 'APPROVED' ? 'Salary change approved' : 'Sent for approval')
      for (const w of j.warnings ?? []) toast(w, { duration: 7000 })
      onDone?.()
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal open onOpenChange={o => { if (!o) onClose() }} title={`Revise ${employee.name}'s salary`}
      description={<>Now <span className="font-medium text-gray-900"><TkAmt value={employee.salary ?? 0} /></span> a month{employee.designation ? ` · ${employee.designation}` : ''}</>}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 sm:grid-cols-4">
          {TYPE_OPTIONS.map(t => (
            <button key={t.value} type="button" onClick={() => set('type', t.value)}
              className={cn('rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors', form.type === t.value ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-600 hover:text-gray-900')}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New salary starts from">
            <NativeSelect value={form.effectiveMonth} onChange={e => set('effectiveMonth', e.target.value)}>
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label={form.mode === 'percent' ? 'By (%)' : form.mode === 'amount' ? 'By (৳ a month)' : 'New monthly salary (৳)'}>
            <div className="flex gap-1.5">
              <Input type="number" min="0" step={form.mode === 'percent' ? '0.1' : '1'} value={form.value} autoFocus
                onChange={e => set('value', e.target.value)} placeholder={form.mode === 'percent' ? '10' : form.mode === 'amount' ? '5000' : String(base || '')} />
              <NativeSelect value={form.mode} onChange={e => set('mode', e.target.value)} className="w-24 shrink-0">
                <option value="percent">%</option>
                <option value="amount">৳ +</option>
                <option value="salary">New ৳</option>
              </NativeSelect>
            </div>
          </Field>
        </div>

        {form.type === 'PROMOTION' && (
          <Field label="New designation" required>
            <Input value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="e.g. Senior Video Editor" required />
          </Field>
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-4 py-3">
          <div className="text-[13px] text-muted-foreground">
            <TkAmt value={base} /> → <span className="font-semibold text-gray-900">{next > 0 ? <TkAmt value={next} /> : '—'}</span>
          </div>
          {next > 0 && <span className={cn('text-[13px] font-medium tabular-nums', next >= base ? 'text-emerald-700' : 'text-red-600')}>{changeText(base, next)}</span>}
        </div>

        <Field label="Reason (internal)" hint="Not printed on the letter.">
          <Textarea rows={2} value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="e.g. Annual review 2026 — exceeds expectations" className="min-h-0 resize-none" />
        </Field>

        {canApprove && (
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={form.approveNow} onChange={e => set('approveNow', e.target.checked)} className="size-4 rounded border-gray-300" />
            Approve now (the employee is notified and gets the letter)
          </label>
        )}

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{!saving && <TrendingUp />} {canApprove && form.approveNow ? 'Approve change' : 'Send for approval'}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}
