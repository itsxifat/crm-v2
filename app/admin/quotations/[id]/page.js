'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Edit2, Save, X, Loader2, Copy, Trash2, Send,
  CheckCircle, XCircle, RotateCcw, Plus, Printer, FileText,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Field, Label, inputClass, selectClass, textareaClass } from '@/components/ui/Input'
import { useConfig } from '@/lib/useConfig'
import { usePermission } from '@/components/auth/Can'
import { computeQuotation, previewQuotation, uniformVatRate, isVatQuotation } from '@/lib/quotation'
import { cn } from '@/lib/utils'
import QuotationVatCard from '../_components/QuotationVatCard'
import QuotationItemCard from '../_components/QuotationItemCard'
import QuotationTotals from '../_components/QuotationTotals'
import QuotationPrintView, { openQuotationPrint } from '../_components/QuotationPrintView'
import { useQuotationVat } from '../_components/useQuotationVat'
import {
  STATUS_STYLES, RATED, QUOTATION_CURRENCIES, emptyItem, toFormItem, buildItemsPayload,
  fetchJson, fmtMoney, treatmentDefaultRate, treatmentLabel,
} from '../_components/quotationUi'

const TRANSITIONS = {
  DRAFT:    [{ to: 'SENT',     label: 'Mark as sent',     icon: Send,        variant: 'default' }],
  SENT:     [
    { to: 'ACCEPTED', label: 'Mark accepted', icon: CheckCircle, variant: 'default' },
    { to: 'REJECTED', label: 'Mark rejected', icon: XCircle,     variant: 'outline' },
  ],
  ACCEPTED: [],
  REJECTED: [{ to: 'DRAFT', label: 'Revert to draft', icon: RotateCcw, variant: 'outline' }],
}

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'
// YYYY-MM-DD in the business timezone (toISOString() would give the UTC date)
const toDateInput = (d) => d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(d)) : ''
// Items don't always carry their category (older quotations) — recover it from the service
const categoryFor = (ventureCategories, venture, service) => {
  if (!venture || !service) return ''
  const cats = ventureCategories?.[venture] || {}
  return Object.keys(cats).find(c => (cats[c] || []).includes(service)) || ''
}

const editInput = inputClass

export default function QuotationDetailPage() {
  const { id } = useParams()
  const router  = useRouter()
  const { ventures, ventureCategories } = useConfig()
  const { can } = usePermission()

  const [q,         setQ]         = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [editing,   setEditing]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [printMode, setPrintMode] = useState(false)
  const [company,   setCompany]   = useState({})

  // Edit form state
  const [recipientName,    setRecipientName]    = useState('')
  const [recipientCompany, setRecipientCompany] = useState('')
  const [recipientEmail,   setRecipientEmail]   = useState('')
  const [recipientPhone,   setRecipientPhone]   = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [items,      setItems]      = useState([])
  const [taxRate,    setTaxRate]    = useState(0)   // MFS charge %
  const [discount,   setDiscount]   = useState(0)
  const [issueDate,  setIssueDate]  = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [currency,      setCurrency]      = useState('BDT')
  const [notes,         setNotes]         = useState('')
  const [terms,         setTerms]         = useState('')
  const [itemPriceOnly, setItemPriceOnly] = useState(false)

  const clientRef = q?.sourceType === 'CLIENT' ? (q?.clientId?.id ?? q?.clientId?._id ?? null) : null
  const vat = useQuotationVat({ clientId: clientRef, enabled: editing, setItems })

  // Live totals while editing — the same rules the server applies
  const payloadItems = buildItemsPayload(items, { perLineVat: vat.perLineVat, ratesOn: vat.ratesOn })
  const calcParams = {
    items: payloadItems, taxRate, discount,
    vatTreatment: vat.effectiveTreatment,
    defaultVatRate: vat.ratesOn ? vat.defaultVatRate : 0,
  }
  const preview = previewQuotation(calcParams)
  const lineRate = preview.items.length ? uniformVatRate(preview.items) : null
  const vatRowLabel = vat.effectiveTreatment === 'ZERO_RATED' ? 'VAT (zero-rated)'
    : vat.effectiveTreatment === 'EXEMPT' ? 'VAT (exempt)'
    : lineRate === null ? 'VAT' : `VAT (${lineRate}%)`

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const json = await fetchJson(`/api/quotations/${id}`)
      setQ(json.data)
    } catch (err) {
      setLoadError(err.message)
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/settings?group=company')
      .then(r => r.json())
      .then(j => {
        const d = j.data ?? {}
        setCompany({
          name:    d.company_name    ?? '',
          address: d.company_address ?? '',
          phone:   d.company_phone   ?? '',
          email:   d.company_email   ?? '',
          website: d.company_website ?? '',
          bin:     d.company_bin     ?? '',
          tin:     d.company_tin     ?? '',
        })
      })
      .catch(() => {})
  }, [])

  function startEdit() {
    if (!q) return
    const treatment  = q.vatTreatment || 'NONE'
    const storedRate = uniformVatRate(q.items)
    const perLine    = RATED.includes(treatment) && (q.items?.length ?? 0) > 1 && storedRate === null
    setRecipientName(q.recipientName || '')
    setRecipientCompany(q.recipientCompany || '')
    setRecipientEmail(q.recipientEmail || '')
    setRecipientPhone(q.recipientPhone || '')
    setRecipientAddress(q.recipientAddress || '')
    setItems((q.items?.length ? q.items : [emptyItem()]).map(it => {
      const row = toFormItem(it, (venture, service) => categoryFor(ventureCategories, venture, service))
      // Per-line rates are only kept when the quote really mixes rates
      return perLine ? row : { ...row, vatRate: '' }
    }))
    setTaxRate(q.taxRate ?? 0)
    setDiscount(q.discount ?? 0)
    setIssueDate(toDateInput(q.issueDate))
    setValidUntil(toDateInput(q.validUntil))
    setCurrency(q.currency || 'BDT')
    setNotes(q.notes || '')
    setTerms(q.terms || '')
    setItemPriceOnly(!!q.itemPriceOnly)
    vat.reset({
      vatTreatment:   treatment,
      defaultVatRate: storedRate ?? (RATED.includes(treatment) ? treatmentDefaultRate(treatment) : 15),
      serviceCode:    q.serviceCode ?? '',
      perLineVat:     perLine,
    })
    setEditing(true)
  }

  function cancelEdit() { setEditing(false) }

  function addItem() {
    setItems(prev => [...prev, vat.perLineVat ? { ...emptyItem(), vatRate: vat.defaultVatRate } : emptyItem()])
  }
  function removeItem(idx) {
    setItems(prev => {
      const next = prev.filter((_, j) => j !== idx)
      return next.length ? next : [emptyItem()]
    })
  }

  async function saveEdit() {
    if (!items.length) return toast.error('Add at least one item')
    if (validUntil && issueDate && validUntil < issueDate) return toast.error('Valid until cannot be before the issue date')
    const check = computeQuotation(calcParams)
    if (check.error) return toast.error(check.error)
    setSaving(true)
    try {
      const payload = {
        recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
        items: payloadItems,
        issueDate, validUntil: validUntil || null,
        taxRate: Number(taxRate) || 0, discount: Number(discount) || 0,
        currency, notes: notes || null, terms: terms || null,
        itemPriceOnly,
        ...vat.bodyFields(),
      }
      const json = await fetchJson(`/api/quotations/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      setQ(json.data)
      setEditing(false)
      toast.success('Saved')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function transition(to) {
    setTransitioning(true)
    try {
      const json = await fetchJson(`/api/quotations/${id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }),
      })
      setQ(json.data)
      toast.success(`Status → ${STATUS_STYLES[to]?.label ?? to}`)
    } catch (err) { toast.error(err.message) }
    finally { setTransitioning(false) }
  }

  async function duplicate() {
    try {
      const json = await fetchJson(`/api/quotations/${id}/duplicate`, { method: 'POST' })
      toast.success('Duplicated')
      router.push(`/admin/quotations/${json.data.id}`)
    } catch (err) { toast.error(err.message) }
  }

  async function del() {
    if (!confirm('Delete this quotation? This cannot be undone.')) return
    setDeleting(true)
    try {
      await fetchJson(`/api/quotations/${id}`, { method: 'DELETE' })
      toast.success('Deleted')
      router.push('/admin/quotations')
    } catch (err) { toast.error(err.message) }
    finally { setDeleting(false) }
  }

  function printNow() {
    if (!openQuotationPrint(q?.quotationNumber)) toast.error('Allow pop-ups for this site to print the quotation')
  }

  if (loading) return <PageLoader />
  if (!q) return (
    <EmptyState
      icon={FileText}
      title={loadError && loadError !== 'Not found' ? loadError : 'Quotation not found'}
      action={
        <div className="flex items-center justify-center gap-2">
          {loadError && loadError !== 'Not found' && <Button variant="outline" size="sm" onClick={load}>Try again</Button>}
          <Button variant="outline" size="sm" href="/admin/quotations">Back to quotations</Button>
        </div>
      }
    />
  )

  const s     = STATUS_STYLES[q.status] ?? STATUS_STYLES.DRAFT
  // Accept / Reject are approval decisions; other transitions need edit rights
  const trans = (TRANSITIONS[q.status] ?? []).filter(t =>
    (t.to === 'ACCEPTED' || t.to === 'REJECTED') ? can('sales.quotations.approve') : can('sales.quotations.update'))
  const canEdit = q.status === 'DRAFT' && can('sales.quotations.update')
  const showVat = isVatQuotation(q)

  if (printMode) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="outline" onClick={() => setPrintMode(false)}>
            <ArrowLeft /> Back
          </Button>
          <Button onClick={printNow}>
            <Printer /> Print / save PDF
          </Button>
        </div>
        <div className="overflow-x-auto">
          <QuotationPrintView quotation={q} company={company} ventures={ventures} />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        className="print:hidden"
        back="/admin/quotations"
        backLabel="Quotations"
        title={q.quotationNumber}
        meta={<Badge variant={s.variant} dot>{s.label}</Badge>}
        description={
          <>
            {q.sourceType === 'LEAD' ? `Lead: ${q.leadId?.name || '—'}` : `Client: ${q.clientId?.company || '—'}`}
            {' · '}Issued {fmtDate(q.issueDate)}
            {q.validUntil ? ` · Valid until ${fmtDate(q.validUntil)}` : ''}
          </>
        }
        actions={
          editing ? (
            <>
              <Button variant="outline" onClick={cancelEdit}>
                <X /> Cancel
              </Button>
              <Button onClick={saveEdit} loading={saving}>
                {!saving && <Save />} Save
              </Button>
            </>
          ) : (
            <>
              {can('sales.quotations.delete') && (
                <Button variant="ghost" size="icon" onClick={del} disabled={deleting} aria-label="Delete quotation" title="Delete"
                  className="text-gray-500 hover:bg-red-50 hover:text-red-600">
                  {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </Button>
              )}
              {can('sales.quotations.create') && (
                <Button variant="outline" onClick={duplicate}>
                  <Copy /> Duplicate
                </Button>
              )}
              <Button variant="outline" onClick={() => setPrintMode(true)}>
                <Printer /> Print / PDF
              </Button>
              {canEdit && (
                <Button variant={trans.some(t => t.variant === 'default') ? 'outline' : 'default'} onClick={startEdit}>
                  <Edit2 /> Edit
                </Button>
              )}
              {/* Status transitions */}
              {trans.map(t => (
                <Button key={t.to} variant={t.variant} onClick={() => transition(t.to)} loading={transitioning}>
                  {!transitioning && <t.icon />}
                  {t.label}
                </Button>
              ))}
            </>
          )
        }
      />

      {/* Edit form — only shown when editing */}
      {editing && (
        <div className="space-y-6">
          {/* Recipient + Dates */}
          <Card className="grid grid-cols-1 gap-6 p-6 sm:grid-cols-2">
            <div>
              <CardTitle className="mb-3">Recipient</CardTitle>
              <div className="space-y-2">
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)} maxLength={200}
                  placeholder="Name" aria-label="Recipient name" className={editInput} />
                <input value={recipientCompany} onChange={e => setRecipientCompany(e.target.value)} maxLength={200}
                  placeholder="Company" aria-label="Recipient company" className={editInput} />
                <input value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} maxLength={200}
                  placeholder="Email" aria-label="Recipient email" className={editInput} />
                <input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} maxLength={50}
                  placeholder="Phone" aria-label="Recipient phone" className={editInput} />
                <input value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)} maxLength={500}
                  placeholder="Address" aria-label="Recipient address" className={editInput} />
              </div>
            </div>
            <div>
              <CardTitle className="mb-3">Details</CardTitle>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <Label>Issue date</Label>
                  <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={editInput} />
                </div>
                <div>
                  <Label>Valid until</Label>
                  <input type="date" value={validUntil} min={issueDate || undefined} onChange={e => setValidUntil(e.target.value)} className={editInput} />
                </div>
                <div>
                  <Label>Currency</Label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className={selectClass}>
                    {QUOTATION_CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    {!QUOTATION_CURRENCIES.some(c => c.value === currency) && <option value={currency}>{currency}</option>}
                  </select>
                </div>
              </div>
            </div>
          </Card>

          {/* VAT */}
          <QuotationVatCard vat={vat} setItems={setItems} isEdit sourceType={q.sourceType} currency={currency} />

          <Card className="overflow-hidden">
            {/* Items */}
            <CardHeader><CardTitle>Items</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {items.map((item, idx) => (
                <QuotationItemCard key={idx} item={item} idx={idx}
                  onChange={(i, u) => setItems(prev => prev.map((x, j) => j === i ? u : x))}
                  onRemove={removeItem}
                  ventures={ventures} ventureCategories={ventureCategories} currency={currency}
                  line={preview.items[idx]} isVat={vat.isVat}
                  showVatRate={vat.perLineVat && vat.ratesOn} defaultVatRate={vat.defaultVatRate}
                  vatTreatment={vat.effectiveTreatment} />
              ))}
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus /> Add item
              </Button>
            </CardContent>

            {/* Totals */}
            <div className="flex justify-end border-t border-gray-100 p-5 sm:p-6">
              <div className="w-full sm:w-80">
                <QuotationTotals
                  preview={preview} currency={currency} isVat={vat.isVat} vatRowLabel={vatRowLabel}
                  taxRate={taxRate} onTaxRate={setTaxRate} discount={discount} onDiscount={setDiscount}
                  itemPriceOnly={itemPriceOnly} onItemPriceOnly={setItemPriceOnly}
                />
              </div>
            </div>

            {/* Notes & Terms */}
            <div className="grid grid-cols-1 gap-4 border-t border-gray-100 p-5 sm:grid-cols-2 sm:p-6">
              <Field label="Notes">
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={5000}
                  placeholder="Notes for the client…"
                  className={cn(textareaClass, 'resize-none')} />
              </Field>
              <Field label="Terms & conditions">
                <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3} maxLength={5000}
                  placeholder="Payment terms, validity…"
                  className={cn(textareaClass, 'resize-none')} />
              </Field>
            </div>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={cancelEdit}>
              Cancel
            </Button>
            <Button onClick={saveEdit} loading={saving}>
              {!saving && <Save />} Save changes
            </Button>
          </div>
        </div>
      )}

      {/* VAT summary (staff only — the treatment and service code are not printed) */}
      {!editing && showVat && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Badge variant="success">{treatmentLabel(q.vatTreatment || 'NONE')}</Badge>
          {q.serviceCode && <Badge>Service code {q.serviceCode}</Badge>}
          <Badge>VAT {fmtMoney(q.vatAmount, q.currency)}</Badge>
          {Number(q.sdAmount) > 0 && <Badge>SD {fmtMoney(q.sdAmount, q.currency)}</Badge>}
          {q.sourceType === 'CLIENT' && !q.buyerBin && (
            <Badge variant="warning">Client BIN not on file</Badge>
          )}
        </div>
      )}

      {/* Quotation document — invoice-style view */}
      {!editing && (
        <Card className="overflow-x-auto">
          <QuotationPrintView quotation={q} company={company} ventures={ventures} />
        </Card>
      )}

      {/* Timestamps */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-1 text-xs text-muted-foreground">
        {q.sentAt     && <p>Sent {fmtDate(q.sentAt)}</p>}
        {q.acceptedAt && <p>Accepted {fmtDate(q.acceptedAt)}</p>}
        {q.rejectedAt && <p>Rejected {fmtDate(q.rejectedAt)}</p>}
        {q.duplicatedFromId && <p>Duplicated from a previous quotation</p>}
        <p className="sm:ml-auto">Created by {q.createdBy?.name || 'Unknown'}</p>
      </div>
    </div>
  )
}
