'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  Loader2, Pencil, Ban, FileCheck, Printer, ExternalLink, AlertTriangle, X,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Input, Textarea, NativeSelect, Label } from '@/components/ui/Input'
import FileUpload from '@/components/ui/FileUpload'
import DocPreview from '@/components/ui/DocPreview'
import { cn } from '@/lib/utils'
import { INPUT_NON_CREDIT_REASONS, VAT_RETURN_NOTES, tdsSectionLabel, catalogTdsSection } from '@/lib/tax/catalog'
import { EntryTypeBadge, EntryStatusBadge, CertificateBadge, DepositBadge, DaysLeftBadge } from './TaxBadges'
import CertificateModal from './CertificateModal'
import VoidEntryModal from './VoidEntryModal'
import { tk, fmtDay, fmtPeriod, fetchJson, payeeTypeLabel } from './taxUi'

const CERT_TYPES = ['VDS_RECEIVABLE', 'TDS_RECEIVABLE', 'VDS_PAYABLE', 'TDS_PAYABLE']
const INSTALMENT_LABELS = { 1: '1st (by 15 Sep)', 2: '2nd (by 15 Dec)', 3: '3rd (by 15 Mar)', 4: '4th (by 15 Jun)' }

function Field({ label, children, className = '' }) {
  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm text-gray-900">{children ?? '—'}</div>
    </div>
  )
}

/**
 * Detail view of one tax entry with edit, certificate, print and void actions.
 * Props: open, onOpenChange, entryId, onChanged()
 */
export default function TaxEntryDetailModal({ open, onOpenChange, entryId, onChanged }) {
  const [entry, setEntry] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [certOpen, setCertOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)

  const load = useCallback(async () => {
    if (!entryId) return
    setLoading(true)
    setError(null)
    try {
      const json = await fetchJson(`/api/tax/entries/${entryId}`)
      setEntry(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [entryId])

  useEffect(() => {
    if (open) { setEditing(false); load() } else { setEntry(null) }
  }, [open, load])

  function startEdit() {
    setDraft({
      notes: entry.notes ?? '',
      documentNo: entry.documentNo ?? '',
      partyName: entry.partyName ?? '',
      partyBin: entry.partyBin ?? '',
      partyAddress: entry.partyAddress ?? '',
      attachments: entry.attachments ?? [],
      instalment: entry.instalment ? String(entry.instalment) : '',
    })
    setEditing(true)
  }

  async function saveEdit() {
    setSaving(true)
    try {
      const body = { notes: draft.notes, attachments: draft.attachments }
      if (entry.status === 'ACTIVE') {
        if ((draft.documentNo ?? '') !== (entry.documentNo ?? '')) body.documentNo = draft.documentNo
        if (entry.entryType === 'ADVANCE_TAX' && (draft.instalment || '') !== (entry.instalment ? String(entry.instalment) : '')) {
          body.instalment = draft.instalment ? Number(draft.instalment) : null
        }
        if (!entry.permissions?.inFiledReturn) {
          if ((draft.partyName ?? '') !== (entry.partyName ?? '') && draft.partyName) body.partyName = draft.partyName
          if ((draft.partyBin ?? '') !== (entry.partyBin ?? '')) body.partyBin = draft.partyBin
          if ((draft.partyAddress ?? '') !== (entry.partyAddress ?? '')) body.partyAddress = draft.partyAddress
        }
      }
      await fetchJson(`/api/tax/entries/${entry.id}`, { method: 'PUT', body })
      toast.success('Entry updated')
      setEditing(false)
      await load()
      onChanged?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const e = entry
  const isCert = e && CERT_TYPES.includes(e.entryType)
  const issueType = e?.entryType === 'VDS_PAYABLE' ? 'vds' : e?.entryType === 'TDS_PAYABLE' ? 'tds' : null
  // The server resolves the section from Tax settings (custom sections included); the catalog is the fallback.
  const sectionRow = e?.section ? (e.sectionInfo ?? catalogTdsSection(e.section, e.date)) : null
  const allocations = e?.deposit?.allocations ?? []
  const shareOf = new Map((e?.settledAllocations ?? []).map(a => [String(a.entryId), a.amount]))
  const noteId = e && ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(e.entryType) && e.creditNoteId
    ? (typeof e.creditNoteId === 'object' ? (e.creditNoteId.id ?? e.creditNoteId._id ?? null) : String(e.creditNoteId))
    : null

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title={e ? e.entryNo : 'Tax entry'} description={e ? `${e.typeLabel} · ${fmtDay(e.date)} · ${fmtPeriod(e.period)} · FY ${e.fiscalYear}` : undefined} size="lg">
        <div>
          {loading && !e && <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-gray-400" /></div>}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{error}</span>
            </div>
          )}
          {e && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <EntryTypeBadge type={e.entryType} />
                <EntryStatusBadge status={e.status} />
                {e.isOpening && <span className="text-xs text-muted-foreground">Opening balance</span>}
                {e.note != null && <span className="text-xs text-muted-foreground">Mushak-9.1 note {e.note}{VAT_RETURN_NOTES[e.note] ? ` — ${VAT_RETURN_NOTES[e.note].label}` : ''}</span>}
              </div>

              {e.status === 'VOID' && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  Voided {fmtDay(e.voidedAt)}{e.voidedBy?.name ? ` by ${e.voidedBy.name}` : ''} — {e.voidReason}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 rounded-lg bg-gray-50 p-4 sm:grid-cols-4">
                <Field label="Tax amount"><span className="font-semibold tabular-nums">{tk(e.amount)}</span></Field>
                <Field label="Base / value"><span className="tabular-nums">{tk(e.baseAmount)}</span></Field>
                <Field label="Rate">{e.rate != null ? `${e.rate}%` : '—'}</Field>
                <Field label="SD">{e.sdAmount ? tk(e.sdAmount) : '—'}</Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Party">
                  {e.partyName || '—'}
                  {e.partyBin && <span className="block font-mono text-xs text-muted-foreground">BIN {e.partyBin}</span>}
                  {e.partyTin && <span className="block font-mono text-xs text-muted-foreground">TIN {e.partyTin}</span>}
                  {e.payeeType && <span className="block text-xs text-muted-foreground">{payeeTypeLabel(e.payeeType)}</span>}
                </Field>
                <Field label="Document">
                  {e.documentNo || '—'}
                  {e.documentDate && <span className="block text-xs text-muted-foreground">{fmtDay(e.documentDate)}</span>}
                </Field>
                {e.treatment && <Field label="VAT treatment">{e.treatment.replace('_', ' ').toLowerCase()}{e.serviceCode ? ` · ${e.serviceCode}` : ''}</Field>}
                {e.entryType === 'INPUT_VAT' && (
                  <Field label="Input tax credit">
                    {e.creditable ? 'Creditable' : `Not creditable — ${INPUT_NON_CREDIT_REASONS[e.nonCreditReason] ?? e.nonCreditReason ?? 'reason not set'}`}
                    {e.claimPeriod ? <span className="block text-xs text-muted-foreground">Claimed in {fmtPeriod(e.claimPeriod)}</span>
                      : e.claimDeadline ? <span className="block text-xs text-muted-foreground">Claim by {fmtPeriod(e.claimDeadline)}</span> : null}
                  </Field>
                )}
                {e.section && (
                  <Field label="TDS section">
                    {sectionRow?.section ? tdsSectionLabel(sectionRow) : sectionRow?.label ? `${e.section} — ${sectionRow.label}` : e.section}
                    {e.higherRateApplied && <span className="block text-xs text-amber-700">Higher rate: {e.higherRateReason || 's.142'}</span>}
                  </Field>
                )}
                {e.entryType === 'ADVANCE_TAX' && (
                  <Field label="Instalment">{e.instalment ? `${INSTALMENT_LABELS[e.instalment]} of 4` : 'Not stated'}</Field>
                )}
                {e.adjustmentDirection && <Field label="Adjustment">{e.adjustmentDirection === 'INCREASE' ? 'Increasing' : 'Decreasing'} · note {e.adjustmentNote}</Field>}
                {e.balanceSide && <Field label="Balance side">{e.balanceSide === 'CREDIT' ? 'Credit carried forward' : 'Payable'}</Field>}
                {e.filingId && <Field label="Return">{e.filingId.periodKey} · {String(e.filingId.status).toLowerCase()}</Field>}
                <Field label="Source">
                  {e.source?.href ? <Link href={e.source.href} className="inline-flex items-center gap-1 font-medium text-gray-900 underline-offset-4 hover:underline">{e.source.label}<ExternalLink className="size-3.5 text-gray-400" /></Link> : e.source?.label}
                </Field>
              </div>

              {(isCert || ['TDS_PAYABLE', 'VDS_PAYABLE', 'TDS_DEPOSIT', 'VAT_PAYMENT', 'ADVANCE_TAX'].includes(e.entryType)) && (
                <div className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200/80 p-4 sm:grid-cols-2">
                  {isCert && (
                    <Field label="Certificate">
                      <div className="flex flex-wrap items-center gap-2">
                        <CertificateBadge certificate={e.certificate} />
                        {e.certificate?.number && <span className="font-mono text-xs">{e.certificate.number}</span>}
                        {e.certificate?.date && <span className="text-xs text-muted-foreground">{fmtDay(e.certificate.date)}</span>}
                      </div>
                      {e.certificateDue && e.certificate?.status === 'PENDING' && (
                        <p className="mt-1 text-xs text-muted-foreground">{e.certificateDue.label} {e.certificateDue.date ? fmtDay(e.certificateDue.date) : e.certificateDue.text}</p>
                      )}
                      {e.certificateReadiness && !e.certificateReadiness.ready && e.certificate?.status === 'PENDING' && (
                        <p className="mt-1 text-xs text-amber-700">{e.certificateReadiness.reason}</p>
                      )}
                      {e.certificate?.url && <div className="mt-1"><DocPreview url={e.certificate.url} label="Certificate copy" compact /></div>}
                    </Field>
                  )}
                  {e.deposit && e.deposit.status !== 'NOT_REQUIRED' && (
                    <Field label="Deposit">
                      <div className="flex flex-wrap items-center gap-2">
                        <DepositBadge deposit={e.deposit} />
                        {e.depositDue && <DaysLeftBadge daysLeft={e.depositDue.daysLeft} />}
                      </div>
                      {e.depositPaid > 0 && e.depositBalance > 0 && (
                        <p className="mt-1 text-xs text-blue-700">{tk(e.depositPaid)} of {tk(e.amount)} deposited · {tk(e.depositBalance)} still to deposit</p>
                      )}
                      {allocations.length > 1 || (allocations.length === 1 && e.deposit.status !== 'DEPOSITED') ? (
                        <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                          {allocations.map((a, i) => (
                            <li key={`${a.depositEntryId ?? i}`}>Challan <span className="font-mono">{a.challanNo || '—'}</span>{a.date ? ` · ${fmtDay(a.date)}` : ''} · {tk(a.amount)}</li>
                          ))}
                        </ul>
                      ) : e.deposit.challanNo && <p className="mt-1 text-xs text-gray-600">Challan <span className="font-mono">{e.deposit.challanNo}</span>{e.deposit.date ? ` · ${fmtDay(e.deposit.date)}` : ''}</p>}
                      {e.challan?.bank && <p className="text-xs text-muted-foreground">{[e.challan.bank, e.challan.branch].filter(Boolean).join(', ')}</p>}
                      {(e.deposit.accountCode || e.challan?.accountCode) && <p className="font-mono text-xs text-muted-foreground">{e.deposit.accountCode || e.challan?.accountCode}</p>}
                      {e.depositDue && <p className="text-xs text-muted-foreground">Due {fmtDay(e.depositDue.dueDate)}</p>}
                    </Field>
                  )}
                </div>
              )}

              {e.settledEntryIds?.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[13px] font-medium text-gray-900">Settles {e.settledEntryIds.length} deduction{e.settledEntryIds.length === 1 ? '' : 's'}</h4>
                  <ul className="max-h-40 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200/80 text-xs">
                    {e.settledEntryIds.map(s => (
                      <li key={s.id} className="flex justify-between gap-3 px-3 py-2">
                        <span className="truncate text-gray-700"><span className="mr-1.5 font-mono text-gray-400">{s.entryNo}</span>{s.partyName || '—'}{s.section ? ` · ${s.section}` : ''}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {fmtDay(s.date)} · <span className="font-medium text-gray-900 tabular-nums">{tk(shareOf.get(String(s.id)) ?? s.amount)}</span>
                          {shareOf.has(String(s.id)) && shareOf.get(String(s.id)) < (Number(s.amount) || 0) - 0.005 && <span className="text-gray-400"> of {tk(s.amount)} (part)</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {e.transactions?.length > 0 && (
                <div>
                  <h4 className="mb-2 text-[13px] font-medium text-gray-900">Money movements</h4>
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200/80 text-xs">
                    {e.transactions.map(t => (
                      <li key={t.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                        <span className="min-w-0 text-gray-700">
                          <span className="mr-1.5 font-mono text-gray-400">{t.txnId}</span>
                          {t.category}{t.account ? ` · ${t.account.name}${t.account.last4 ? ` ••${t.account.last4}` : ''}` : ''}
                          {t.reversedBy && <span className="ml-1.5 text-red-600">reversed by {t.reversedBy}</span>}
                          {t.reversal && <span className="ml-1.5 text-muted-foreground">(reversal)</span>}
                        </span>
                        <span className={cn('font-medium tabular-nums', t.type === 'EXPENSE' ? 'text-red-600' : 'text-emerald-700')}>
                          {t.type === 'EXPENSE' ? '−' : '+'}{tk(t.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!editing && (
                <>
                  {e.notes && <Field label="Notes"><span className="whitespace-pre-wrap">{e.notes}</span></Field>}
                  {e.attachments?.length > 0 && (
                    <Field label="Attachments">
                      <div className="flex flex-wrap gap-2">{e.attachments.map(u => <DocPreview key={u} url={u} compact />)}</div>
                    </Field>
                  )}
                  <p className="text-xs text-muted-foreground">Created {fmtDay(e.createdAt)}{e.createdBy?.name ? ` by ${e.createdBy.name}` : ''}</p>
                </>
              )}

              {editing && (
                <div className="space-y-4 rounded-lg border border-gray-200/80 p-4">
                  {e.status === 'ACTIVE' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label>{['TDS_DEPOSIT', 'VAT_PAYMENT', 'ADVANCE_TAX'].includes(e.entryType) ? 'Challan no.' : 'Document no.'}</Label>
                        <Input value={draft.documentNo} onChange={ev => setDraft(d => ({ ...d, documentNo: ev.target.value }))} maxLength={80} />
                      </div>
                      {e.entryType === 'ADVANCE_TAX' && (
                        <div>
                          <Label>Instalment</Label>
                          <NativeSelect value={draft.instalment} onChange={ev => setDraft(d => ({ ...d, instalment: ev.target.value }))}>
                            <option value="">Not stated</option>
                            {[1, 2, 3, 4].map(i => <option key={i} value={String(i)}>{INSTALMENT_LABELS[i]}</option>)}
                          </NativeSelect>
                        </div>
                      )}
                      {!e.permissions?.inFiledReturn && (
                        <>
                          <div>
                            <Label>Party name</Label>
                            <Input value={draft.partyName} onChange={ev => setDraft(d => ({ ...d, partyName: ev.target.value }))} maxLength={200} />
                          </div>
                          <div>
                            <Label>Party BIN</Label>
                            <Input className="font-mono" value={draft.partyBin} onChange={ev => setDraft(d => ({ ...d, partyBin: ev.target.value }))} />
                          </div>
                          <div className="sm:col-span-2">
                            <Label>Party address</Label>
                            <Input value={draft.partyAddress} onChange={ev => setDraft(d => ({ ...d, partyAddress: ev.target.value }))} maxLength={500} />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <div>
                    <Label>Notes</Label>
                    <Textarea rows={3} value={draft.notes} onChange={ev => setDraft(d => ({ ...d, notes: ev.target.value }))} maxLength={2000} />
                  </div>
                  <div>
                    <Label>Attachments</Label>
                    {(draft.attachments ?? []).length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {(draft.attachments ?? []).map(u => (
                          <span key={u} className="inline-flex items-center gap-1">
                            <DocPreview url={u} compact />
                            <Button variant="ghost" size="icon-xs" className="text-gray-400 hover:text-red-600" onClick={() => setDraft(d => ({ ...d, attachments: d.attachments.filter(x => x !== u) }))} aria-label="Remove attachment">
                              <X />
                            </Button>
                          </span>
                        ))}
                      </div>
                    )}
                    {(draft.attachments ?? []).length < 10 && (
                      <FileUpload value={null} onUploaded={(url) => setDraft(d => ({ ...d, attachments: [...(d.attachments ?? []), url] }))} label="" bucket="tax" />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {e && (
          <ModalFooter className="flex-wrap">
            {editing ? (
              <>
                <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                <Button onClick={saveEdit} loading={saving}>Save</Button>
              </>
            ) : (
              <>
                {e.permissions?.canVoid && (
                  <Button variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700 sm:mr-auto" onClick={() => setVoidOpen(true)}>
                    <Ban /> Void
                  </Button>
                )}
                {!e.permissions?.canVoid && e.permissions?.voidBlockedReason && e.status === 'ACTIVE' && (
                  <span className="max-w-xs text-xs text-muted-foreground sm:mr-auto">{e.permissions.voidBlockedReason}</span>
                )}
                {noteId && (
                  <a href={`/api/credit-notes/${noteId}/print`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}>
                    <Printer /> {e.entryType === 'DEBIT_NOTE' ? 'Print Mushak-6.8' : 'Print Mushak-6.7'}
                  </a>
                )}
                {issueType && e.certificate?.number && (
                  <Button variant="outline" onClick={() => window.open(`/api/tax/certificates/${issueType}/print?ids=${e.id}`, '_blank')}>
                    <Printer /> Print certificate
                  </Button>
                )}
                {isCert && e.status === 'ACTIVE' && e.permissions?.canEdit && (
                  <Button variant="outline" onClick={() => setCertOpen(true)}>
                    <FileCheck /> Certificate
                  </Button>
                )}
                {e.permissions?.canEdit && (
                  <Button onClick={startEdit}>
                    <Pencil /> Edit
                  </Button>
                )}
              </>
            )}
          </ModalFooter>
        )}
      </Modal>

      {e && (
        <>
          <CertificateModal open={certOpen} onOpenChange={setCertOpen} entries={[e]} onSaved={() => { load(); onChanged?.() }} />
          <VoidEntryModal open={voidOpen} onOpenChange={setVoidOpen} entry={e} onSaved={() => { load(); onChanged?.() }} />
        </>
      )}
    </>
  )
}
