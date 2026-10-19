'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, FileMinus, FilePlus, Info, Loader2, Plus, Trash2, Wand2, Ban } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import { Input, Textarea, NativeSelect, Label, Field, inputClass, selectClass } from '@/components/ui/Input'
import MoneyAccountSelect, { useMoneyAccounts, invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import { CREDIT_NOTE_REASONS, VAT_TREATMENTS, round2 } from '@/lib/tax/catalog'
import { formatMoney } from '@/lib/currencies'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { cn } from '@/lib/utils'

/**
 * Credit note (Mushak-6.7) / debit note (Mushak-6.8) against an issued invoice,
 * plus the cancel dialog. Used by the invoice detail page and Tax → Credit/Debit Notes.
 */

const NO_VAT = ['ZERO_RATED', 'EXEMPT', 'NONE']
const NO_SD = ['ZERO_RATED', 'NONE']
const EPS = 0.01

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 'HH:mm' now in Dhaka. */
function dhakaTimeNow() {
  return new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(11, 16)
}

let keySeq = 0
const newLine = (patch = {}) => ({ key: `l${++keySeq}`, description: '', quantity: '1', value: '', vatRate: '', sdRate: '', ...patch })

/** Is `rate` one of the rates the invoice allows on a note line (ctx.vatRates / ctx.sdRates)? */
const rateIn = (rate, list) => list.some(r => Math.abs(r - rate) < 0.005)
const pctList = (list) => list.map(r => `${r}%`).join(' / ')

function lineCalc(line, treatment, defaultVatRate) {
  const value = round2(num(line.value))
  const vatRate = NO_VAT.includes(treatment) ? 0 : (line.vatRate === '' || line.vatRate === null || line.vatRate === undefined ? num(defaultVatRate) : num(line.vatRate))
  const sdRate = NO_SD.includes(treatment) ? 0 : num(line.sdRate)
  const sd = round2((value * Math.max(0, sdRate)) / 100)
  const vat = round2(((value + sd) * Math.max(0, vatRate)) / 100)
  return { value, vatRate, sdRate, sd, vat, total: round2(value + sd + vat) }
}

/**
 * Invoice lines → note lines (value = the line's taxable value, net of discount).
 * Rates come from the line when the invoice allows them on a note, else the default.
 */
function linesFromInvoice(invoice, ctx) {
  let items = invoice?.items
  if (typeof items === 'string') {
    try { items = JSON.parse(items) } catch { items = [] }
  }
  if (!Array.isArray(items)) return []
  const vatRates = ctx?.vatRates ?? []
  const sdRates = ctx?.sdRates ?? []
  const has = (v) => v != null && v !== '' && Number.isFinite(Number(v))
  return items.filter(Boolean).map(it => {
    const amount = it.amount != null ? num(it.amount) : num(it.quantity) * num(it.rate)
    const taxable = it.taxableValue != null && it.taxableValue !== '' ? num(it.taxableValue) : Math.max(0, amount - num(it.discountShare))
    return newLine({
      description: String(it.description ?? '').trim() || 'Invoice line',
      quantity: String(num(it.quantity) > 0 ? num(it.quantity) : 1),
      value: String(round2(taxable)),
      vatRate: has(it.vatRate) && (!vatRates.length || rateIn(num(it.vatRate), vatRates)) ? String(num(it.vatRate)) : '',
      sdRate: has(it.sdRate) && (!sdRates.length || rateIn(num(it.sdRate), sdRates)) ? String(num(it.sdRate)) : '',
    })
  }).filter(l => num(l.value) > 0)
}

function firstError(json) {
  const d = json?.details
  if (d?.fieldErrors) {
    for (const v of Object.values(d.fieldErrors)) if (Array.isArray(v) && v[0]) return v[0]
  }
  if (Array.isArray(d?.formErrors) && d.formErrors[0]) return d.formErrors[0]
  if (Array.isArray(d) && d[0]) return d[0]
  return json?.error || 'Failed'
}

/** Selectable option card (kind / settlement). */
function OptionCard({ active, onClick, icon: Icon, label, hint }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
        active ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200/80 hover:bg-gray-50/70')}>
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-gray-500" />}
      <span>
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}

export default function CreditNoteModal({ open, onOpenChange, invoice, initialKind = 'CREDIT', onIssued }) {
  const [ctx, setCtx] = useState(null)
  const [ctxError, setCtxError] = useState(null)
  const [loadingCtx, setLoadingCtx] = useState(false)
  const [kind, setKind] = useState(initialKind)
  const [reason, setReason] = useState('DISCOUNT')
  const [reasonText, setReasonText] = useState('')
  const [lines, setLines] = useState(() => [newLine()])
  const [settlement, setSettlement] = useState('ADJUST_INVOICE')
  const [refundAccountId, setRefundAccountId] = useState(null)
  const [refundDate, setRefundDate] = useState(dhakaDayKey())
  const [issueDate, setIssueDate] = useState(dhakaDayKey())
  const [issueTime, setIssueTime] = useState(dhakaTimeNow())
  const [dateTouched, setDateTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const { accounts } = useMoneyAccounts()

  const invoiceId = invoice?.id ?? invoice?._id ?? null
  const currency = String(invoice?.currency || 'BDT').toUpperCase()
  const money = (n) => formatMoney(n, currency)

  // Reset whenever the dialog opens for an invoice.
  useEffect(() => {
    if (!open) return
    setKind(initialKind)
    setReason(initialKind === 'DEBIT' ? 'ERROR_CORRECTION' : 'DISCOUNT')
    setReasonText('')
    setLines([newLine()])
    setSettlement('ADJUST_INVOICE')
    setRefundAccountId(null)
    setRefundDate(dhakaDayKey())
    setIssueDate(dhakaDayKey())
    setIssueTime(dhakaTimeNow())
    setDateTouched(false)
  }, [open, initialKind, invoiceId])

  // Limits (due, refundable, VAT still creditable) from the server.
  useEffect(() => {
    if (!open || !invoiceId) return undefined
    let alive = true
    setLoadingCtx(true)
    setCtxError(null)
    fetch(`/api/credit-notes?invoiceId=${invoiceId}&limit=1`)
      .then(async r => {
        const json = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(json.error || 'Couldn’t load invoice limits')
        if (alive) setCtx(json.context ?? null)
      })
      .catch(err => { if (alive) setCtxError(err.message) })
      .finally(() => { if (alive) setLoadingCtx(false) })
    return () => { alive = false }
  }, [open, invoiceId])

  const treatment = ctx?.treatment ?? (invoice?.vatTreatment || 'NONE')
  const isVat = treatment !== 'NONE'
  const showVatCol = isVat && !NO_VAT.includes(treatment)
  const showSdCol = !NO_SD.includes(treatment) && (!!ctx?.hasSd || lines.some(l => num(l.sdRate) > 0))
  const defaultVatRate = ctx?.vatRate ?? 0
  // A note adjusts the original supply at its original rates — only these are accepted.
  const vatRates = Array.isArray(ctx?.vatRates) ? ctx.vatRates : []
  const sdRates = Array.isArray(ctx?.sdRates) ? ctx.sdRates : []
  const treatmentLabel = VAT_TREATMENTS.find(t => t.value === treatment)?.label ?? treatment

  const calc = useMemo(() => {
    const rows = lines.map(l => ({ l, c: lineCalc(l, treatment, defaultVatRate) }))
    const value = round2(rows.reduce((s, r) => s + r.c.value, 0))
    const sd = round2(rows.reduce((s, r) => s + r.c.sd, 0))
    const vat = round2(rows.reduce((s, r) => s + r.c.vat, 0))
    return { rows, value, sd, vat, total: round2(value + sd + vat) }
  }, [lines, treatment, defaultVatRate])

  const isCredit = kind === 'CREDIT'
  const effSettlement = isCredit ? settlement : 'ADJUST_INVOICE'
  const limit = !ctx ? null : (!isCredit ? null : (effSettlement === 'REFUND' ? ctx.maxRefund : ctx.maxAdjust))

  const problems = []
  if (calc.total > 0 && limit !== null && calc.total > limit + EPS) {
    problems.push(effSettlement === 'REFUND'
      ? `A refund can be at most ${money(limit)} (received and not yet refunded).`
      : `Adjusting against the invoice is limited to ${money(limit)}${ctx?.pending > 0 ? ` (${money(ctx.pending)} awaits payment confirmation)` : ' (the amount due)'} — use a refund for money already received.`)
  }
  if (isCredit && ctx && isVat && calc.vat > ctx.maxCreditVat + EPS) {
    problems.push(`VAT on this note (${money(calc.vat)}) exceeds the VAT still on the invoice (${money(ctx.maxCreditVat)}).`)
  }
  if (isCredit && ctx && calc.total > Math.max(0, ctx.total - ctx.creditTotal) + EPS) {
    problems.push(`Credit notes can’t exceed what was billed — ${money(Math.max(0, ctx.total - ctx.creditTotal))} remains.`)
  }
  if (ctx && showVatCol && vatRates.length && calc.rows.some(r => !rateIn(r.c.vatRate, vatRates))) {
    problems.push(`Every line must use the invoice’s VAT rate (${pctList(vatRates)}).`)
  }
  if (ctx && !NO_SD.includes(treatment) && sdRates.length && calc.rows.some(r => !rateIn(r.c.sdRate, sdRates))) {
    problems.push(sdRates.length === 1
      ? 'This invoice charged no supplementary duty, so the note can’t carry SD.'
      : `SD must be a rate the invoice charged (${pctList(sdRates)}).`)
  }
  const needsAccount = isCredit && effSettlement === 'REFUND' && accounts.length > 0
  const buyerBinMissing = isVat && !(invoice?.buyer?.bin || invoice?.clientId?.bin) && calc.vat > 5000

  function updateLine(key, patch) {
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  function fillFromInvoice() {
    const ls = linesFromInvoice(invoice, ctx)
    if (!ls.length) { toast.error('This invoice has no lines to copy'); return }
    setLines(ls)
    if (isCredit && reason === 'DISCOUNT') setReason('CANCELLED_SUPPLY')
  }

  async function submit() {
    if (!invoiceId) return
    for (const [i, l] of lines.entries()) {
      if (!String(l.description).trim()) { toast.error(`Line ${i + 1}: add a description`); return }
      if (!(num(l.value) > 0)) { toast.error(`Line ${i + 1}: enter a value greater than 0`); return }
      if (!(num(l.quantity) > 0)) { toast.error(`Line ${i + 1}: quantity must be greater than 0`); return }
    }
    if (reason === 'OTHER' && !reasonText.trim()) { toast.error('Describe the reason for the note'); return }
    if (needsAccount && !refundAccountId) { toast.error('Choose the account the refund is paid from'); return }
    if (problems.length) { toast.error(problems[0]); return }

    setSaving(true)
    try {
      const body = {
        kind,
        invoiceId,
        reason,
        reasonText: reasonText.trim() || null,
        items: lines.map(l => ({
          description: String(l.description).trim(),
          quantity: num(l.quantity) || 1,
          value: round2(num(l.value)),
          vatRate: showVatCol ? (l.vatRate === '' ? null : num(l.vatRate)) : null,
          sdRate: showSdCol && l.sdRate !== '' ? num(l.sdRate) : null,
        })),
        settlement: effSettlement,
        refundAccountId: effSettlement === 'REFUND' ? refundAccountId : null,
        refundDate: effSettlement === 'REFUND' ? refundDate : null,
        ...(dateTouched ? { issueDate, issueTime } : {}),
      }
      const res = await fetch('/api/credit-notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(firstError(json))
      toast.success(`${isCredit ? 'Credit' : 'Debit'} note ${json.data?.noteNo ?? ''} issued`)
      if (json.warning) toast(json.warning, { icon: <AlertTriangle className="size-4 text-amber-600" />, duration: 8000 })
      if (effSettlement === 'REFUND') invalidateMoneyAccounts()
      onIssued?.(json.data, json)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const title = isCredit ? 'Issue credit note (Mushak-6.7)' : 'Issue debit note (Mushak-6.8)'
  const cellInput = cn(inputClass, 'px-2 text-right tabular-nums')

  return (
    <Modal open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v) }} title={title}
      description={invoice ? `Against invoice ${invoice.invoiceNumber ?? ''}` : undefined} size="xl">
      <div className="space-y-5">
        {/* Kind */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            { k: 'CREDIT', label: 'Credit note', hint: 'Reduces the invoice and its VAT (9.1 note 31)', Icon: FileMinus },
            { k: 'DEBIT', label: 'Debit note', hint: 'Adds to the invoice and its VAT (9.1 note 26)', Icon: FilePlus },
          ].map(({ k, label, hint, Icon }) => (
            <OptionCard key={k} active={kind === k} icon={Icon} label={label} hint={hint} onClick={() => {
              setKind(k)
              if (k === 'DEBIT' && ['DISCOUNT', 'CANCELLED_SUPPLY', 'RETURN'].includes(reason)) setReason('ERROR_CORRECTION')
            }} />
          ))}
        </div>

        {/* Invoice context */}
        <div className="rounded-lg bg-gray-50 px-4 py-3 text-xs text-muted-foreground">
          {loadingCtx ? (
            <span className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin" /> Loading invoice balances…</span>
          ) : ctxError ? (
            <span className="text-red-600">{ctxError}</span>
          ) : ctx ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <span>Billed <span className="block text-sm font-medium tabular-nums text-gray-900">{money(ctx.total)}</span></span>
              <span>Due <span className="block text-sm font-medium tabular-nums text-gray-900">{money(ctx.due)}</span></span>
              <span>Received (cash) <span className="block text-sm font-medium tabular-nums text-gray-900">{money(Math.max(0, ctx.cashReceived - ctx.refunded))}</span></span>
              <span>VAT still on invoice <span className="block text-sm font-medium tabular-nums text-gray-900">{money(ctx.maxCreditVat)}</span></span>
              <span className="col-span-2 sm:col-span-4">VAT treatment: {treatmentLabel}{ctx.creditTotal > 0 ? ` · Credited so far ${money(ctx.creditTotal)}` : ''}{ctx.debitTotal > 0 ? ` · Debited so far ${money(ctx.debitTotal)}` : ''}</span>
            </div>
          ) : null}
        </div>
        {!isVat && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" />
            No VAT on this invoice: the note only changes the amount billed and isn’t a Mushak document.
          </p>
        )}

        {/* Reason */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Reason" required>
            <NativeSelect value={reason} onChange={e => setReason(e.target.value)}>
              {CREDIT_NOTE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Details" required={reason === 'OTHER'} className="sm:col-span-2">
            <Input value={reasonText} onChange={e => setReasonText(e.target.value)} maxLength={1000}
              placeholder={isCredit ? 'e.g. 10% loyalty discount' : 'e.g. 2 extra landing pages'} />
          </Field>
        </div>

        {/* Lines */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-900">
              {isCredit ? 'Decrease' : 'Increase'} <span className="font-normal text-muted-foreground">· value excl. VAT</span>
            </p>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={fillFromInvoice}>
                <Wand2 className="size-3.5" /> Copy invoice lines
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setLines(ls => [...ls, newLine({ vatRate: '' })])}>
                <Plus className="size-3.5" /> Add line
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200/80">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-muted-foreground">
                  <th className="h-9 px-3 text-left font-medium">Description</th>
                  <th className="h-9 w-20 px-2 text-right font-medium">Qty</th>
                  <th className="h-9 w-32 px-2 text-right font-medium">Value</th>
                  {showSdCol && <th className="h-9 w-20 px-2 text-right font-medium">SD %</th>}
                  {showVatCol && <th className="h-9 w-20 px-2 text-right font-medium">VAT %</th>}
                  {isVat && <th className="h-9 w-28 px-2 text-right font-medium">VAT</th>}
                  <th className="h-9 w-32 px-3 text-right font-medium">Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {calc.rows.map(r => (
                  <tr key={r.l.key} className="align-top">
                    <td className="px-3 py-2">
                      <input value={r.l.description} onChange={e => updateLine(r.l.key, { description: e.target.value })}
                        placeholder="Description" aria-label="Description" className={inputClass} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" min="0" step="any" value={r.l.quantity} onChange={e => updateLine(r.l.key, { quantity: e.target.value })}
                        aria-label="Quantity" className={cellInput} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" min="0" step="0.01" value={r.l.value} onChange={e => updateLine(r.l.key, { value: e.target.value })}
                        placeholder="0.00" aria-label="Value excluding VAT" className={cellInput} />
                    </td>
                    {showSdCol && (
                      <td className="px-2 py-2">
                        {sdRates.length > 1 ? (
                          <select value={rateIn(r.c.sdRate, sdRates) ? String(r.c.sdRate) : ''} onChange={e => updateLine(r.l.key, { sdRate: e.target.value })}
                            aria-label="SD rate" className={cn(selectClass, 'pl-2 pr-6 text-right')}>
                            {!rateIn(r.c.sdRate, sdRates) && <option value="" disabled>{r.c.sdRate}%</option>}
                            {sdRates.map(v => <option key={v} value={String(v)}>{v}%</option>)}
                          </select>
                        ) : (
                          <span title="Supplementary duty charged on the invoice"
                            className={cn('block pt-2 text-right tabular-nums', sdRates.length && !rateIn(r.c.sdRate, sdRates) ? 'text-red-600' : 'text-gray-600')}>
                            {r.c.sdRate}%
                          </span>
                        )}
                      </td>
                    )}
                    {showVatCol && (
                      <td className="px-2 py-2">
                        {vatRates.length > 1 ? (
                          <select value={rateIn(r.c.vatRate, vatRates) ? String(r.c.vatRate) : ''} onChange={e => updateLine(r.l.key, { vatRate: e.target.value })}
                            aria-label="VAT rate" className={cn(selectClass, 'pl-2 pr-6 text-right')}>
                            {!rateIn(r.c.vatRate, vatRates) && <option value="" disabled>{r.c.vatRate}%</option>}
                            {vatRates.map(v => <option key={v} value={String(v)}>{v}%</option>)}
                          </select>
                        ) : (
                          <span title="The VAT rate charged on the invoice"
                            className={cn('block pt-2 text-right tabular-nums', vatRates.length && !rateIn(r.c.vatRate, vatRates) ? 'text-red-600' : 'text-gray-600')}>
                            {r.c.vatRate}%
                          </span>
                        )}
                      </td>
                    )}
                    {isVat && <td className="whitespace-nowrap px-2 py-2 pt-4 text-right tabular-nums text-gray-600">{money(r.c.vat)}</td>}
                    <td className="whitespace-nowrap px-3 py-2 pt-4 text-right font-medium tabular-nums text-gray-900">{money(r.c.total)}</td>
                    <td className="px-1 py-2">
                      <Button variant="ghost" size="icon-sm" onClick={() => setLines(ls => (ls.length > 1 ? ls.filter(l => l.key !== r.l.key) : ls))}
                        disabled={lines.length <= 1} aria-label="Remove line" className="text-gray-400 hover:text-red-600">
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end">
            <div className="w-full space-y-1 text-sm sm:w-72">
              <div className="flex justify-between text-gray-600"><span>Value</span><span className="tabular-nums">{money(calc.value)}</span></div>
              {calc.sd > 0 && <div className="flex justify-between text-gray-600"><span>SD</span><span className="tabular-nums">{money(calc.sd)}</span></div>}
              {isVat && <div className="flex justify-between text-gray-600"><span>VAT</span><span className="tabular-nums">{money(calc.vat)}</span></div>}
              <div className="flex justify-between border-t border-gray-100 pt-1 font-semibold text-gray-900">
                <span>{isCredit ? 'Credit total' : 'Debit total'}</span><span className="tabular-nums">{money(calc.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Settlement */}
        {isCredit ? (
          <div>
            <Label>Settlement</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { v: 'ADJUST_INVOICE', label: 'Adjust against the invoice', hint: ctx ? `Reduces the amount due — up to ${money(ctx.maxAdjust)}` : 'Reduces the amount due' },
                { v: 'REFUND', label: 'Refund to the client', hint: ctx ? `Pays money back — up to ${money(ctx.maxRefund)}` : 'Pays money back from an account' },
              ].map(o => (
                <OptionCard key={o.v} active={settlement === o.v} label={o.label} hint={o.hint} onClick={() => setSettlement(o.v)} />
              ))}
            </div>
            {settlement === 'REFUND' && (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Refund paid from" required={needsAccount} className="sm:col-span-2">
                  <MoneyAccountSelect value={refundAccountId} onChange={id => setRefundAccountId(id)} currency={currency} />
                </Field>
                <Field label="Refund date">
                  <DatePicker value={refundDate} onChange={v => setRefundDate(v ?? dhakaDayKey())} clearable={false} />
                </Field>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Added to the invoice balance.</p>
        )}

        {/* Issue date */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Issue date">
            <DatePicker value={issueDate} onChange={v => { setIssueDate(v ?? dhakaDayKey()); setDateTouched(true) }} clearable={false} />
          </Field>
          <Field label="Issue time (Dhaka)">
            <Input type="time" value={issueTime} onChange={e => { setIssueTime(e.target.value); setDateTouched(true) }} />
          </Field>
          <p className="text-xs text-muted-foreground sm:pt-8">
            {isVat ? `Goes in the issue month’s VAT return (note ${isCredit ? '31' : '26'}).` : 'No VAT return effect.'}
          </p>
        </div>

        {(problems.length > 0 || buyerBinMissing) && (
          <div className="space-y-2">
            {problems.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                {problems.map((p, i) => (
                  <p key={i} className="flex items-start gap-2"><Ban className="mt-0.5 size-4 shrink-0" />{p}</p>
                ))}
              </div>
            )}
            {buyerBinMissing && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                Client BIN missing — required when the note’s VAT exceeds Tk 5,000. Add it on the client profile.
              </p>
            )}
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={loadingCtx || calc.total <= 0 || problems.length > 0}>
          {!saving && (isCredit ? <FileMinus /> : <FilePlus />)}
          Issue {isCredit ? 'credit' : 'debit'} note
        </Button>
      </ModalFooter>
    </Modal>
  )
}

/** Cancel an issued note (reverses its effect; latest note first). */
export function CancelNoteModal({ open, onOpenChange, note, onCancelled }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (open) setReason('') }, [open, note?.id])

  async function submit() {
    if (reason.trim().length < 5) { toast.error('Give a reason (at least 5 characters)'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/credit-notes/${note.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reason: reason.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(firstError(json))
      toast.success(`Note ${note.noteNo} cancelled`)
      if (note.settlement === 'REFUND') invalidateMoneyAccounts()
      onCancelled?.(json.data)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!note) return null
  const effect = note.kind === 'DEBIT'
    ? 'The debit amount is taken off the invoice again.'
    : note.settlement === 'REFUND'
      ? 'The refund is reversed in the ledger (money back into the account).'
      : 'The credit is removed, so the amount due goes up again.'

  return (
    <Modal open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v) }} title={`Cancel ${note.noteNo}`}
      description="Only the latest note on an invoice can be cancelled." size="md">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          {effect} The VAT entry is voided — not allowed once the note is in a filed VAT return; issue an opposite note instead.
        </p>
        <Field label="Reason" required>
          <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
            placeholder="Why is this note being cancelled?" className="resize-none" />
        </Field>
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Keep note
        </Button>
        <Button variant="destructive" onClick={submit} loading={saving}>
          {!saving && <Ban />} Cancel note
        </Button>
      </ModalFooter>
    </Modal>
  )
}
