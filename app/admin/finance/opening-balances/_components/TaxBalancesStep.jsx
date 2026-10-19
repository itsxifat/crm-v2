'use client'

import { useState } from 'react'
import { ChevronDown, Edit2, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import ActionMenu from '@/components/ui/ActionMenu'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import { Input, Label } from '@/components/ui/Input'
import { dayKeyLabel, periodLabel } from '@/lib/finance/fiscal'
import { cn } from '@/lib/utils'
import { CERTIFICATE_STATUS_LABELS, OPENING_TAX_META, OPENING_TAX_ORDER } from '../_lib/meta'
import { round2, taxEntryValue } from '../_lib/position'
import TaxOpeningModal from './TaxOpeningModal'
import { Callout, Guidance, Money, apiFetch } from './shared'

const CERT_TONE = {
  PENDING:  'warning',
  RECEIVED: 'success',
  ISSUED:   'success',
}

function VoidModal({ entry, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (!entry) return null
  const meta = OPENING_TAX_META[entry.entryType]

  async function confirm() {
    setBusy(true)
    try {
      await apiFetch(`/api/finance/opening-balances/tax/${entry.id}`, { method: 'DELETE', body: { reason } })
      toast.success('Opening balance removed')
      onDone?.()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!entry} onOpenChange={(o) => { if (!o) onClose() }} title="Remove opening balance?" size="sm">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">
          {meta?.title}: <span className="font-medium text-gray-900"><Money value={taxEntryValue(entry)} /></span>
          {entry.partyName ? ` — ${entry.partyName}` : ''} ({dayKeyLabel(entry.date)}).
          It&apos;s voided, not deleted, so the tax ledger keeps a record.
        </p>
        <div>
          <Label htmlFor="void-reason">Reason <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="void-reason" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="e.g. Entered twice" />
        </div>
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="destructive" onClick={confirm} loading={busy}>Remove</Button>
      </ModalFooter>
    </Modal>
  )
}

function EntryDetail({ entry, type }) {
  const bits = []
  if (entry.documentNo) bits.push(entry.documentNo)
  if (entry.partyBin) bits.push(`BIN ${entry.partyBin}`)
  if (entry.partyTin) bits.push(`TIN ${entry.partyTin}`)
  if (entry.section) bits.push(`s.${entry.section}`)
  if (type === 'INPUT_VAT' || type === 'VDS_RECEIVABLE') {
    if (entry.claimDeadline) bits.push(`claim by ${periodLabel(entry.claimDeadline)} return`)
  }
  if (entry.baseAmount > 0) bits.push(`on ${Number(entry.baseAmount).toLocaleString('en-BD', { maximumFractionDigits: 2 })}`)
  return bits.length ? <p className="max-w-md truncate text-xs text-muted-foreground">{bits.join(' · ')}</p> : null
}

function TaxGroup({ type, entries, readOnly, data, booksLock, onAdd, onEdit, onVoid }) {
  const meta = OPENING_TAX_META[type]
  const [showHelp, setShowHelp] = useState(entries.length === 0)
  const total = round2(entries.reduce((s, e) => s + (e.entryType === 'VAT_BALANCE_BF' && e.balanceSide === 'PAYABLE' ? -taxEntryValue(e) : taxEntryValue(e)), 0))
  const sides = new Set(entries.map(e => e.balanceSide))
  const canAddMore = !(meta.single && sides.has('CREDIT') && sides.has('PAYABLE'))
  const sideLabel = meta.side === 'asset' ? 'Asset' : meta.side === 'liability' ? 'Liability' : 'Credit or payable'

  return (
    <div className="rounded-lg border border-gray-200/80">
      <div className="flex flex-col justify-between gap-2 px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">{meta.title}</h3>
            <Badge variant={meta.side === 'asset' ? 'success' : meta.side === 'liability' ? 'danger' : 'default'}>{sideLabel}</Badge>
          </div>
          <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-gray-900" onClick={() => setShowHelp(v => !v)}>
            What to enter
            <ChevronDown className={cn('size-3.5 transition-transform', showHelp && 'rotate-180')} />
          </button>
        </div>
        <div className="flex items-center gap-3 sm:shrink-0">
          {entries.length > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{entries.length} line{entries.length === 1 ? '' : 's'}</p>
              <Money value={total} className="text-sm font-semibold tabular-nums text-gray-900" />
            </div>
          )}
          {!readOnly && canAddMore && (
            <Button variant="outline" size="xs" onClick={() => onAdd(type, sides.has('CREDIT') ? 'PAYABLE' : 'CREDIT')}>
              <Plus /> {meta.addLabel}
            </Button>
          )}
        </div>
      </div>

      {showHelp && (
        <div className="px-4 pb-3">
          <Guidance what={meta.what} where={meta.where} collapsible={false} />
        </div>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto border-t border-gray-100">
          <table className="w-full min-w-[560px] text-sm">
            <tbody className="divide-y divide-gray-100">
              {entries.map(e => {
                const cert = e.certificate?.status
                // Dated inside the books lock: the figures are fixed, details stay editable.
                const inLock = !!booksLock && !!e.date && e.date <= booksLock
                return (
                  <tr key={e.id} className="align-top transition-colors hover:bg-gray-50/70">
                    <td className="w-28 whitespace-nowrap py-2.5 pl-4 pr-2 text-xs text-muted-foreground">
                      {dayKeyLabel(e.date)}
                      {e.fiscalYear && <span className="block text-[11px] text-gray-400">FY {e.fiscalYear}</span>}
                    </td>
                    <td className="py-2.5 px-2 min-w-0">
                      <p className="text-sm text-gray-900">
                        {type === 'VAT_BALANCE_BF'
                          ? (e.balanceSide === 'PAYABLE' ? 'VAT still owed' : 'Credit carried forward')
                          : (e.partyName || (type === 'ADVANCE_TAX' ? 'Advance tax challan' : '—'))}
                        {e.entryNo && <span className="ml-2 font-mono text-[11px] text-gray-400">{e.entryNo}</span>}
                      </p>
                      <EntryDetail entry={e} type={type} />
                      {e.notes && <p className="max-w-md truncate text-xs text-gray-400">{e.notes}</p>}
                    </td>
                    <td className="w-28 px-2 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        {cert && cert !== 'NOT_REQUIRED' && (
                          <Badge variant={CERT_TONE[cert] ?? 'default'}>Cert. {CERTIFICATE_STATUS_LABELS[cert]?.toLowerCase()}</Badge>
                        )}
                        {e.used && <Badge variant="primary">Used</Badge>}
                        {inLock && !e.used && <Badge>Period locked</Badge>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right">
                      <Money value={taxEntryValue(e)} className="text-sm tabular-nums text-gray-900" />
                      {e.entryType === 'VAT_BALANCE_BF' && e.sdAmount > 0 && (
                        <span className="block text-[11px] text-gray-400">incl. SD {Number(e.sdAmount).toLocaleString('en-BD')}</span>
                      )}
                    </td>
                    <td className="w-10 py-2 pl-1 pr-4 text-right">
                      {!readOnly && !e.used && (
                        <ActionMenu items={[
                          { label: inLock ? 'Edit details' : 'Edit', icon: Edit2, onClick: () => onEdit(e) },
                          { label: 'Remove', icon: Trash2, danger: true, onClick: () => onVoid(e), disabled: inLock, hint: inLock ? 'Locked' : undefined },
                        ]} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {entries.length === 0 && !showHelp && (
        <p className="px-4 pb-3 text-xs text-muted-foreground">Nothing entered{data.asOfDate ? ` as at ${dayKeyLabel(data.asOfDate)}` : ''}.</p>
      )}
    </div>
  )
}

export default function TaxBalancesStep({ data, canEdit, onChanged }) {
  const readOnly = !canEdit || data.openingLocked || !data.goLiveDate
  // Kept after closing so the dialog keeps its content while it animates out.
  const [modal, setModal] = useState({ open: false, type: 'ADVANCE_TAX', entry: null, side: 'CREDIT' })
  const [voiding, setVoiding] = useState(null)
  const byType = Object.fromEntries(OPENING_TAX_ORDER.map(t => [t, []]))
  for (const e of data.taxOpenings ?? []) if (byType[e.entryType]) byType[e.entryType].push(e)

  const vatRegistered = (data.settings?.vat?.registrationType ?? 'REGISTERED') === 'REGISTERED'
  const booksLock = data.settings?.lockedUntil ?? null

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <div>
        <CardTitle as="h2">Tax balances</CardTitle>
        <CardDescription>VAT and income tax at go-live</CardDescription>
      </div>

      {!data.goLiveDate && <Callout tone="warning">Set the go-live date in step 1 first — tax balances must be dated before it.</Callout>}
      {data.openingLocked && <Callout tone="neutral" title="Opening balances are locked">Only a super admin can unlock them (step 5).</Callout>}
      {!vatRegistered && (
        <Callout tone="info">Not VAT registered — skip the VAT sections unless you were registered before.</Callout>
      )}
      {!readOnly && booksLock && (
        <Callout tone="warning" title={`Books locked to ${dayKeyLabel(booksLock)}`}>
          Amounts dated on or before it are fixed (details stay editable); move the books lock back below to change them.
        </Callout>
      )}

      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">VAT (Mushak)</p>
        {['VAT_BALANCE_BF', 'INPUT_VAT', 'VDS_RECEIVABLE', 'VDS_PAYABLE'].map(t => (
          <TaxGroup key={t} type={t} entries={byType[t]} readOnly={readOnly} data={data} booksLock={booksLock}
            onAdd={(type, side) => setModal({ open: true, type, entry: null, side })}
            onEdit={(entry) => setModal({ open: true, type: entry.entryType, entry, side: entry.balanceSide ?? 'CREDIT' })}
            onVoid={setVoiding} />
        ))}
      </div>
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">Income tax</p>
        {['TDS_RECEIVABLE', 'ADVANCE_TAX', 'TDS_PAYABLE'].map(t => (
          <TaxGroup key={t} type={t} entries={byType[t]} readOnly={readOnly} data={data} booksLock={booksLock}
            onAdd={(type, side) => setModal({ open: true, type, entry: null, side })}
            onEdit={(entry) => setModal({ open: true, type: entry.entryType, entry, side: entry.balanceSide ?? 'CREDIT' })}
            onVoid={setVoiding} />
        ))}
      </div>

      <TaxOpeningModal
        open={modal.open}
        onOpenChange={(o) => { if (!o) setModal(m => ({ ...m, open: false })) }}
        entryType={modal.type}
        entry={modal.entry}
        defaultSide={modal.side}
        data={data}
        onSaved={() => onChanged?.()}
      />
      <VoidModal entry={voiding} onClose={() => setVoiding(null)} onDone={() => onChanged?.()} />
    </Card>
  )
}
