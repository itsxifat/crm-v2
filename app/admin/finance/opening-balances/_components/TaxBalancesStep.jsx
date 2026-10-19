'use client'

import { useState } from 'react'
import { ChevronDown, Edit2, Loader2, Plus, Receipt, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import ActionMenu from '@/components/ui/ActionMenu'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { dayKeyLabel, periodLabel } from '@/lib/finance/fiscal'
import { cn } from '@/lib/utils'
import { CERTIFICATE_STATUS_LABELS, OPENING_TAX_META, OPENING_TAX_ORDER } from '../_lib/meta'
import { round2, taxEntryValue } from '../_lib/position'
import TaxOpeningModal from './TaxOpeningModal'
import { Callout, Guidance, Money, apiFetch, btnDanger, btnGhost, cardCls, inputCls, labelCls } from './shared'

const CERT_TONE = {
  PENDING:  'bg-amber-50 text-amber-700',
  RECEIVED: 'bg-emerald-50 text-emerald-700',
  ISSUED:   'bg-emerald-50 text-emerald-700',
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
          The line is voided, not deleted, so the tax ledger keeps a record.
        </p>
        <div>
          <label className={labelCls} htmlFor="void-reason">Reason <span className="text-gray-400 font-normal">(optional)</span></label>
          <input id="void-reason" className={inputCls} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="e.g. Entered twice" />
        </div>
      </div>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" className={btnGhost} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className={btnDanger} onClick={confirm} disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Remove
        </button>
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
  return bits.length ? <p className="text-xs text-gray-500 truncate max-w-md">{bits.join(' · ')}</p> : null
}

function TaxGroup({ type, entries, readOnly, data, booksLock, onAdd, onEdit, onVoid }) {
  const meta = OPENING_TAX_META[type]
  const [showHelp, setShowHelp] = useState(entries.length === 0)
  const total = round2(entries.reduce((s, e) => s + (e.entryType === 'VAT_BALANCE_BF' && e.balanceSide === 'PAYABLE' ? -taxEntryValue(e) : taxEntryValue(e)), 0))
  const sides = new Set(entries.map(e => e.balanceSide))
  const canAddMore = !(meta.single && sides.has('CREDIT') && sides.has('PAYABLE'))
  const sideLabel = meta.side === 'asset' ? 'Asset' : meta.side === 'liability' ? 'Liability' : 'Credit or payable'

  return (
    <div className="rounded-xl border border-gray-100">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 sm:px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900">{meta.title}</h3>
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded font-medium',
              meta.side === 'asset' ? 'bg-emerald-50 text-emerald-700' : meta.side === 'liability' ? 'bg-rose-50 text-rose-700' : 'bg-gray-100 text-gray-600',
            )}>{sideLabel}</span>
          </div>
          <button type="button" className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800" onClick={() => setShowHelp(v => !v)}>
            What to enter & where to find it
            <ChevronDown className={cn('w-3 h-3 transition-transform', showHelp && 'rotate-180')} />
          </button>
        </div>
        <div className="flex items-center gap-3 sm:shrink-0">
          {entries.length > 0 && (
            <div className="text-right">
              <p className="text-[11px] text-gray-400">{entries.length} line{entries.length === 1 ? '' : 's'}</p>
              <Money value={total} className="text-sm font-semibold tabular-nums" />
            </div>
          )}
          {!readOnly && canAddMore && (
            <button type="button" className={cn(btnGhost, 'px-3 py-1.5 text-xs')} onClick={() => onAdd(type, sides.has('CREDIT') ? 'PAYABLE' : 'CREDIT')}>
              <Plus className="w-3.5 h-3.5" /> {meta.addLabel}
            </button>
          )}
        </div>
      </div>

      {showHelp && (
        <div className="px-3 sm:px-4 pb-3">
          <Guidance what={meta.what} where={meta.where} />
        </div>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto border-t border-gray-50">
          <table className="w-full min-w-[560px] text-sm">
            <tbody className="divide-y divide-gray-50">
              {entries.map(e => {
                const cert = e.certificate?.status
                // Dated inside the books lock: the figures are fixed, details stay editable.
                const inLock = !!booksLock && !!e.date && e.date <= booksLock
                return (
                  <tr key={e.id} className="align-top">
                    <td className="py-2.5 pl-3 sm:pl-4 pr-2 w-28 text-xs text-gray-500 whitespace-nowrap">
                      {dayKeyLabel(e.date)}
                      {e.fiscalYear && <span className="block text-[10px] text-gray-400">FY {e.fiscalYear}</span>}
                    </td>
                    <td className="py-2.5 px-2 min-w-0">
                      <p className="text-sm text-gray-900">
                        {type === 'VAT_BALANCE_BF'
                          ? (e.balanceSide === 'PAYABLE' ? 'VAT still owed' : 'Credit carried forward')
                          : (e.partyName || (type === 'ADVANCE_TAX' ? 'Advance tax challan' : '—'))}
                        {e.entryNo && <span className="ml-2 text-[10px] text-gray-400 font-mono">{e.entryNo}</span>}
                      </p>
                      <EntryDetail entry={e} type={type} />
                      {e.notes && <p className="text-[11px] text-gray-400 truncate max-w-md">{e.notes}</p>}
                    </td>
                    <td className="py-2.5 px-2 w-28">
                      {cert && cert !== 'NOT_REQUIRED' && (
                        <span className={cn('inline-block text-[10px] px-1.5 py-0.5 rounded font-medium', CERT_TONE[cert] ?? 'bg-gray-100 text-gray-600')}>
                          Cert. {CERTIFICATE_STATUS_LABELS[cert]?.toLowerCase()}
                        </span>
                      )}
                      {e.used && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">Used</span>}
                      {inLock && !e.used && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">Period locked</span>}
                    </td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap">
                      <Money value={taxEntryValue(e)} className="text-sm tabular-nums" />
                      {e.entryType === 'VAT_BALANCE_BF' && e.sdAmount > 0 && (
                        <span className="block text-[10px] text-gray-400">incl. SD {Number(e.sdAmount).toLocaleString('en-BD')}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 sm:pr-4 pl-1 w-10 text-right">
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
        <p className="px-3 sm:px-4 pb-3 text-xs text-gray-400">Nothing entered{data.asOfDate ? ` as at ${dayKeyLabel(data.asOfDate)}` : ''}.</p>
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
    <div className={`${cardCls} p-4 sm:p-6 space-y-5`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
          <Receipt className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">Step 3 — Tax balances</h2>
          <p className="text-sm text-gray-500">
            VAT and income-tax amounts you could claim or still owed at go-live. Each line becomes an entry in the tax ledger, so certificates, deposits and claim deadlines are tracked from day one.
          </p>
        </div>
      </div>

      {!data.goLiveDate && <Callout tone="warning">Set the go-live date in step 1 before entering tax balances — they must be dated before it.</Callout>}
      {data.openingLocked && <Callout tone="neutral" title="Opening balances are locked">Tax balances are read-only. A super admin can unlock them in step 5.</Callout>}
      {!vatRegistered && (
        <Callout tone="info">Your tax profile says the company is not VAT registered — you can skip the VAT sections unless you were registered before.</Callout>
      )}
      {!readOnly && booksLock && (
        <Callout tone="warning" title={`Books are locked up to ${dayKeyLabel(booksLock)}`}>
          Balances dated on or before that day cannot be added, changed or removed — only their notes, party, document and certificate details can be edited. To change them, move the books lock back in the Period lock card below first.
        </Callout>
      )}

      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">VAT (Mushak)</p>
        {['VAT_BALANCE_BF', 'INPUT_VAT', 'VDS_RECEIVABLE', 'VDS_PAYABLE'].map(t => (
          <TaxGroup key={t} type={t} entries={byType[t]} readOnly={readOnly} data={data} booksLock={booksLock}
            onAdd={(type, side) => setModal({ open: true, type, entry: null, side })}
            onEdit={(entry) => setModal({ open: true, type: entry.entryType, entry, side: entry.balanceSide ?? 'CREDIT' })}
            onVoid={setVoiding} />
        ))}
      </div>
      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Income tax</p>
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
    </div>
  )
}
