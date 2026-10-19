'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Download, ClipboardCheck, RefreshCw, Loader2, AlertTriangle, ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { usePermission } from '@/components/auth/Can'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import EmptyState from '@/components/ui/EmptyState'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardTitle } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { TaxPill, DaysLeftBadge } from '@/components/tax/TaxBadges'
import { useTaxData } from '@/components/tax/useTaxData'
import { tk, fmtDay, fetchJson, todayKey, payeeTypeLabel } from '@/components/tax/taxUi'
import { cn } from '@/lib/utils'

function FileReturnModal({ open, onOpenChange, quarter, filing, pending, onSaved }) {
  const [filedAt, setFiledAt] = useState(todayKey())
  const [ack, setAck] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const amend = !!filing && ['FILED', 'AMENDED'].includes(filing.status)

  useEffect(() => {
    if (!open) return
    setFiledAt(todayKey()); setAck(''); setNotes(''); setFile(null); setError(null)
  }, [open])

  async function submit() {
    if (!filedAt) return setError('Enter the filing date')
    setSaving(true)
    setError(null)
    try {
      const json = await fetchJson('/api/tax/withholding-return', {
        method: 'POST',
        body: { quarter: quarter.key, filedAt, acknowledgementNo: ack || null, notes: notes || null, attachmentUrl: file, amend },
      })
      toast.success(`Withholding return for ${quarter.label} recorded as ${amend ? 'amended' : 'filed'}`)
      for (const w of json.warnings ?? []) toast(w, { duration: 6000 })
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`${amend ? 'Amend' : 'Record'} withholding return — ${quarter?.label ?? ''}`} description="Figures are frozen as filed (s.177)." size="md">
      <div className="space-y-4">
        {pending > 0.005 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {tk(pending)} deducted this quarter isn’t deposited yet. Deposit it before filing.
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Filing date" required hint={quarter ? `Due ${fmtDay(quarter.dueDate)}` : undefined}>
            <DatePicker value={filedAt} onChange={setFiledAt} clearable={false} />
          </Field>
          <Field label="Acknowledgement no.">
            <Input value={ack} onChange={e => setAck(e.target.value)} maxLength={80} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={2} className="min-h-0" value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} />
        </Field>
        <FileUpload value={file} onUploaded={setFile} label="Return / acknowledgement copy" bucket="tax" />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button onClick={submit} loading={saving}>
          {!saving && <ClipboardCheck />}
          {amend ? 'Record amended return' : 'Record as filed'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/** Quarterly withholding tax return (s.177): section-wise summary + payee lines. */
export default function WhtReturnTab({ initialQuarter = null }) {
  const { can } = usePermission()
  const [quarter, setQuarter] = useState(initialQuarter)
  const { data, loading, error, reload } = useTaxData(`/api/tax/withholding-return${quarter ? `?quarter=${encodeURIComponent(quarter)}` : ''}`)
  const [showPayees, setShowPayees] = useState(true)
  const [fileOpen, setFileOpen] = useState(false)

  const q = data?.quarter
  const filed = data?.filing && ['FILED', 'AMENDED'].includes(data.filing.status)
  const csvHref = q ? `/api/tax/withholding-return?quarter=${encodeURIComponent(q.key)}&format=csv` : null
  const quarterOptions = [...(data?.quarters ?? [])]
  if (q && !quarterOptions.some(o => o.key === q.key)) quarterOptions.unshift({ key: q.key, label: `${q.label} (FY ${q.fy} Q${q.q})` })

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{q ? `${q.label} · FY ${q.fy} Q${q.q}` : 'Withholding tax return'}</CardTitle>
              {q && (filed
                ? <TaxPill label={data.filing.status === 'AMENDED' ? 'Amended' : 'Filed'} color="green" />
                : q.ended ? <DaysLeftBadge daysLeft={q.daysLeft} /> : <TaxPill label="Quarter in progress" color="gray" dot={false} />)}
            </div>
            {q && (
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Due {fmtDay(q.dueDate)} (Tofsil-4, s.177)
                {filed && ` · filed ${fmtDay(data.filing.filedAt)}${data.filing.acknowledgementNo ? ` · ack. ${data.filing.acknowledgementNo}` : ''}${data.filing.returnType === 'LATE' ? ' · late' : ''}`}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect className="h-8 w-auto text-[13px]" value={q?.key ?? ''} onChange={e => setQuarter(e.target.value)} aria-label="Quarter">
              {quarterOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </NativeSelect>
            {csvHref && <a href={csvHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}><Download /> Export CSV</a>}
            {q?.ended && can('tax.returns.file') && (
              <Button size="sm" onClick={() => setFileOpen(true)}>
                <ClipboardCheck /> {filed ? 'Amend' : 'Mark as filed'}
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" className="text-gray-500" onClick={reload} aria-label="Refresh"><RefreshCw className={cn(loading && 'animate-spin')} /></Button>
          </div>
        </div>
        {data && (
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-sm sm:grid-cols-5">
            <div><dt className="text-xs text-muted-foreground">Payees</dt><dd className="mt-0.5 font-semibold tabular-nums text-gray-900">{data.totals.payeeCount}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Payments</dt><dd className="mt-0.5 font-semibold tabular-nums text-gray-900">{data.totals.count}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Amount paid</dt><dd className="mt-0.5 font-semibold tabular-nums text-gray-900">{tk(data.totals.base)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Tax deducted</dt><dd className="mt-0.5 font-semibold tabular-nums text-gray-900">{tk(data.totals.deducted)}</dd></div>
            <div>
              <dt className="text-xs text-muted-foreground">Not deposited</dt>
              <dd className={cn('mt-0.5 font-semibold tabular-nums', data.totals.pending > 0.005 ? 'text-red-700' : 'text-gray-900')}>{tk(data.totals.pending)}</dd>
            </div>
          </dl>
        )}
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card className="overflow-hidden">
        <div className="border-b border-gray-100 px-5 py-3">
          <CardTitle>Section-wise summary</CardTitle>
        </div>
        {loading && !data ? (
          <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-gray-400" /></div>
        ) : !data?.sections?.length ? (
          <EmptyState icon={FileText} title="No TDS deducted this quarter" description="A nil return may still be required." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Section</TableHead>
                <TableHead>Nature of payment</TableHead>
                <TableHead className="text-right">Payees</TableHead>
                <TableHead className="text-right">Payments</TableHead>
                <TableHead className="text-right">Amount paid</TableHead>
                <TableHead className="text-right">Tax deducted</TableHead>
                <TableHead className="text-right">Deposited</TableHead>
                <TableHead>Challans</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sections.map(s => (
                <TableRow key={s.code ?? 'none'}>
                  <TableCell className="whitespace-nowrap"><span className="font-medium text-gray-900">s.{s.section}</span> <span className="font-mono text-[11px] text-gray-400">{s.code}</span></TableCell>
                  <TableCell className="min-w-[200px]">{s.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.payeeCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{tk(s.base)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-gray-900">{tk(s.deducted)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {tk(s.deposited)}
                    {s.pending > 0.005 && <span className="block text-[11px] text-red-600">{tk(s.pending)} pending</span>}
                  </TableCell>
                  <TableCell className="max-w-[220px] font-mono text-xs text-muted-foreground">{s.challans.join(', ') || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell className="font-semibold text-gray-900" colSpan={2}>Total</TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-gray-900">{data.totals.payeeCount}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-gray-900">{data.totals.count}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-gray-900">{tk(data.totals.base)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-gray-900">{tk(data.totals.deducted)}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-gray-900">{tk(data.totals.deposited)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{data.totals.challanCount} challan{data.totals.challanCount === 1 ? '' : 's'}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </Card>

      {data?.payees?.length > 0 && (
        <Card className="overflow-hidden">
          <button type="button" onClick={() => setShowPayees(s => !s)}
            className={cn('flex w-full items-center justify-between px-5 py-3 text-left hover:bg-gray-50/70', showPayees && 'border-b border-gray-100')}>
            <CardTitle>Payee-wise details <span className="font-normal text-muted-foreground">({data.payees.length})</span></CardTitle>
            {showPayees ? <ChevronUp className="size-4 text-gray-400" /> : <ChevronDown className="size-4 text-gray-400" />}
          </button>
          {showPayees && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Section</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>TIN</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                  <TableHead className="text-right">Amount paid</TableHead>
                  <TableHead className="text-right">Tax deducted</TableHead>
                  <TableHead className="text-right">Deposited</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payees.map((p, i) => (
                  <TableRow key={`${p.code}-${p.partyName}-${i}`}>
                    <TableCell className="whitespace-nowrap text-gray-600">s.{p.section} <span className="font-mono text-[11px] text-gray-400">{p.code}</span></TableCell>
                    <TableCell className="min-w-[160px]">
                      <p className="font-medium text-gray-900">{p.partyName}</p>
                      <p className="text-[11px] text-muted-foreground">{payeeTypeLabel(p.payeeType)}{p.higherRateCount ? ` · ${p.higherRateCount} at higher rate` : ''}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-600">{p.partyTin || <span className="font-sans text-amber-700">missing</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{tk(p.base)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">{tk(p.deducted)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{tk(p.deposited)}{p.pending > 0.005 && <span className="block text-[11px] text-red-600">{tk(p.pending)} pending</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {q && <FileReturnModal open={fileOpen} onOpenChange={setFileOpen} quarter={q} filing={data?.filing} pending={data?.totals?.pending ?? 0} onSaved={reload} />}
    </div>
  )
}
