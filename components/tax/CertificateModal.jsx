'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Input, NativeSelect, Field } from '@/components/ui/Input'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { tk, fmtDay, todayKey, fetchJson, sumAmount } from './taxUi'

const COLLECT_TYPES = ['VDS_RECEIVABLE', 'TDS_RECEIVABLE']

/**
 * Record a withholding certificate on one or more entries of ONE party.
 *  - Entries we are owed a certificate for (VDS / TDS deducted by customers) ⇒ RECEIVED.
 *  - Entries we issue (VDS / TDS we deducted) ⇒ ISSUED — use when the certificate was issued outside the system.
 * Also lets the user mark entries "not required" or reset them to pending.
 *
 * Props: open, onOpenChange, entries (rows with id, entryType, entryNo, partyName, date, amount, certificate), onSaved()
 */
export default function CertificateModal({ open, onOpenChange, entries = [], onSaved }) {
  const collect = COLLECT_TYPES.includes(entries[0]?.entryType)
  const isVds = String(entries[0]?.entryType ?? '').startsWith('VDS')
  const doneStatus = collect ? 'RECEIVED' : 'ISSUED'
  const total = useMemo(() => sumAmount(entries), [entries])
  const existing = entries.find(e => e.certificate?.number)?.certificate ?? null

  const [status, setStatus] = useState(doneStatus)
  const [number, setNumber] = useState('')
  const [date, setDate] = useState(null)
  const [url, setUrl] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setStatus(collect ? 'RECEIVED' : 'ISSUED')
    setNumber(existing?.number ?? '')
    setDate(existing?.date ? dhakaDayKey(new Date(existing.date)) : todayKey())
    setUrl(existing?.url ?? null)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const title = collect
    ? (isVds ? 'Record Mushak-6.6 from customer' : 'Record TDS certificate from customer')
    : (isVds ? 'Record Mushak-6.6 issued' : 'Record TDS certificate issued')

  async function submit() {
    setError(null)
    if (status === doneStatus) {
      if (!number.trim()) return setError('Enter the certificate number')
      if (!date) return setError('Enter the certificate date')
    }
    setSaving(true)
    try {
      const body = { status, number: status === doneStatus ? number.trim() : null, date: status === doneStatus ? date : null, url: url || null }
      if (entries.length === 1) {
        await fetchJson(`/api/tax/certificates/${entries[0].id}`, { method: 'POST', body })
      } else {
        await fetchJson('/api/tax/certificates', { method: 'POST', body: { ...body, entryIds: entries.map(e => e.id) } })
      }
      toast.success(status === doneStatus ? `Certificate ${number.trim()} recorded` : 'Certificate status updated')
      onSaved?.()
      onOpenChange?.(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={entries[0]?.partyName ? `${entries[0].partyName} · ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} · ${tk(total)}` : undefined} size="md">
      <div className="space-y-4">
        <ul className="max-h-32 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200/80 text-xs">
          {entries.map(e => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate text-gray-700"><span className="mr-1.5 font-mono text-gray-400">{e.entryNo}</span>{e.documentNo || '—'}</span>
              <span className="shrink-0 text-muted-foreground">{fmtDay(e.date)} · <span className="font-medium text-gray-900 tabular-nums">{tk(e.amount)}</span></span>
            </li>
          ))}
        </ul>

        <Field
          label="Action"
          hint={status === 'NOT_REQUIRED' ? (collect
            ? (isVds ? 'Without a Mushak-6.6 the VDS can’t be claimed.' : 'Without it the AIT credit may be questioned.')
            : 'Only when no certificate is legally required.') : undefined}
        >
          <NativeSelect value={status} onChange={e => setStatus(e.target.value)}>
            <option value={doneStatus}>{collect ? 'Certificate received' : 'Certificate issued'}</option>
            <option value="PENDING">Reset to pending</option>
            <option value="NOT_REQUIRED">Not required</option>
          </NativeSelect>
        </Field>

        {status === doneStatus && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Certificate no." required>
              <Input value={number} onChange={e => setNumber(e.target.value)} maxLength={60} placeholder={isVds ? 'Mushak-6.6 no.' : 'Certificate no.'} />
            </Field>
            <Field label="Certificate date" required hint={collect && isVds ? 'Claim (note 29) within the next 6 periods' : undefined}>
              <DatePicker value={date} onChange={setDate} clearable={false} />
            </Field>
          </div>
        )}

        <FileUpload value={url} onUploaded={setUrl} label="Certificate copy" bucket="tax" />

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={saving}>Cancel</Button>
        <Button onClick={submit} loading={saving}>Save</Button>
      </ModalFooter>
    </Modal>
  )
}
