'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Edit2, Save, X, Loader2, Copy, Trash2, Send,
  CheckCircle, XCircle, RotateCcw, Plus, Printer, Receipt, FileText,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import { useConfig } from '@/lib/useConfig'
import { usePermission } from '@/components/auth/Can'
import { computeQuotation, previewQuotation, uniformVatRate, isVatQuotation } from '@/lib/quotation'
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
  DRAFT:    [{ to: 'SENT',     label: 'Mark as Sent',     icon: Send,        cls: 'bg-blue-600 hover:bg-blue-700 text-white' }],
  SENT:     [
    { to: 'ACCEPTED', label: 'Mark Accepted', icon: CheckCircle, cls: 'bg-green-600 hover:bg-green-700 text-white' },
    { to: 'REJECTED', label: 'Mark Rejected', icon: XCircle,     cls: 'bg-red-600 hover:bg-red-700 text-white' },
  ],
  ACCEPTED: [],
  REJECTED: [{ to: 'DRAFT', label: 'Revert to Draft', icon: RotateCcw, cls: 'bg-gray-700 hover:bg-gray-800 text-white' }],
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

const editInput = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const editLabel = 'block text-xs font-medium text-gray-600 mb-1'

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

  if (loading) return (
    <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  )
  if (!q) return (
    <div className="text-center py-20 text-gray-400 space-y-3">
      <FileText className="w-10 h-10 mx-auto opacity-30" />
      <p className="text-sm">{loadError && loadError !== 'Not found' ? loadError : 'Quotation not found.'}</p>
      <div className="flex items-center justify-center gap-4 text-sm">
        {loadError && loadError !== 'Not found' && <button onClick={load} className="text-blue-600 hover:underline">Try again</button>}
        <Link href="/admin/quotations" className="text-blue-600 hover:underline">Back to quotations</Link>
      </div>
    </div>
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
        <div className="print:hidden flex flex-wrap items-center gap-3 mb-4 px-4 pt-4">
          <button onClick={() => setPrintMode(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button onClick={printNow}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800">
            <Printer className="w-4 h-4" /> Print / Save PDF
          </button>
        </div>
        <div className="overflow-x-auto">
          <QuotationPrintView quotation={q} company={company} ventures={ventures} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/admin/quotations" aria-label="Back to quotations" className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900 font-mono">{q.quotationNumber}</h1>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.badge}`}>{s.label}</span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {q.sourceType === 'LEAD' ? `Lead: ${q.leadId?.name || '—'}` : `Client: ${q.clientId?.company || '—'}`}
              {' · '}Issued {fmtDate(q.issueDate)}
              {q.validUntil ? ` · Valid until ${fmtDate(q.validUntil)}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status transitions */}
          {!editing && trans.map(t => (
            <button key={t.to} onClick={() => transition(t.to)} disabled={transitioning}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${t.cls}`}>
              {transitioning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <t.icon className="w-3.5 h-3.5" />}
              {t.label}
            </button>
          ))}

          {!editing && (
            <button onClick={() => setPrintMode(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors">
              <Printer className="w-3.5 h-3.5" /> Print / PDF
            </button>
          )}

          {!editing && can('sales.quotations.create') && (
            <button onClick={duplicate}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              <Copy className="w-3.5 h-3.5" /> Duplicate
            </button>
          )}

          {canEdit && !editing && (
            <button onClick={startEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
              <Edit2 className="w-3.5 h-3.5" /> Edit
            </button>
          )}

          {editing && (
            <>
              <button onClick={cancelEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
              </button>
            </>
          )}

          {!editing && can('sales.quotations.delete') && (
            <button onClick={del} disabled={deleting} aria-label="Delete quotation"
              className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Edit form — only shown when editing */}
      {editing && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            {/* Recipient + Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-5 sm:p-6 border-b border-gray-100">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recipient</p>
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
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Details</p>
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className={editLabel}>Issue Date</label>
                    <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={editInput} />
                  </div>
                  <div>
                    <label className={editLabel}>Valid Until</label>
                    <input type="date" value={validUntil} min={issueDate || undefined} onChange={e => setValidUntil(e.target.value)} className={editInput} />
                  </div>
                  <div>
                    <label className={editLabel}>Currency</label>
                    <select value={currency} onChange={e => setCurrency(e.target.value)} className={editInput}>
                      {QUOTATION_CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      {!QUOTATION_CURRENCIES.some(c => c.value === currency) && <option value={currency}>{currency}</option>}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* VAT */}
          <QuotationVatCard vat={vat} setItems={setItems} isEdit sourceType={q.sourceType} currency={currency} />

          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            {/* Items */}
            <div className="p-5 sm:p-6 space-y-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Items</p>
              {items.map((item, idx) => (
                <QuotationItemCard key={idx} item={item} idx={idx}
                  onChange={(i, u) => setItems(prev => prev.map((x, j) => j === i ? u : x))}
                  onRemove={removeItem}
                  ventures={ventures} ventureCategories={ventureCategories} currency={currency}
                  line={preview.items[idx]} isVat={vat.isVat}
                  showVatRate={vat.perLineVat && vat.ratesOn} defaultVatRate={vat.defaultVatRate}
                  vatTreatment={vat.effectiveTreatment} />
              ))}
              <button type="button" onClick={addItem}
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium pt-1">
                <Plus className="w-4 h-4" /> Add Item
              </button>
            </div>

            {/* Totals */}
            <div className="flex justify-end p-5 sm:p-6 border-t border-gray-100">
              <div className="w-full sm:w-80">
                <QuotationTotals
                  preview={preview} currency={currency} isVat={vat.isVat} vatRowLabel={vatRowLabel}
                  taxRate={taxRate} onTaxRate={setTaxRate} discount={discount} onDiscount={setDiscount}
                  itemPriceOnly={itemPriceOnly} onItemPriceOnly={setItemPriceOnly}
                />
              </div>
            </div>

            {/* Notes & Terms */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 px-5 sm:px-6 pb-6 border-t border-gray-100">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 mt-4">Notes</p>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={5000}
                  placeholder="Notes for client…"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 mt-4">Terms & Conditions</p>
                <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3} maxLength={5000}
                  placeholder="Payment terms, validity…"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={cancelEdit}
              className="px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button onClick={saveEdit} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save changes
            </button>
          </div>
        </div>
      )}

      {/* VAT summary (staff only — the treatment and service code are not printed) */}
      {!editing && showVat && (
        <div className="flex flex-wrap items-center gap-2 text-xs print:hidden">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium">
            <Receipt className="w-3.5 h-3.5" /> {treatmentLabel(q.vatTreatment || 'NONE')}
          </span>
          {q.serviceCode && <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">Service code {q.serviceCode}</span>}
          <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">VAT {fmtMoney(q.vatAmount, q.currency)}</span>
          {Number(q.sdAmount) > 0 && <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">SD {fmtMoney(q.sdAmount, q.currency)}</span>}
          {q.sourceType === 'CLIENT' && !q.buyerBin && (
            <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">Client BIN not on file</span>
          )}
        </div>
      )}

      {/* Quotation document — invoice-style view */}
      {!editing && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
          <QuotationPrintView quotation={q} company={company} ventures={ventures} />
        </div>
      )}

      {/* Timestamps */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-1">
        {q.sentAt     && <p className="text-xs text-gray-400">Sent: {fmtDate(q.sentAt)}</p>}
        {q.acceptedAt && <p className="text-xs text-gray-400">Accepted: {fmtDate(q.acceptedAt)}</p>}
        {q.rejectedAt && <p className="text-xs text-gray-400">Rejected: {fmtDate(q.rejectedAt)}</p>}
        {q.duplicatedFromId && <p className="text-xs text-gray-400">Duplicated from a previous quotation</p>}
        <p className="text-xs text-gray-400 sm:ml-auto">Created by {q.createdBy?.name || 'Unknown'}</p>
      </div>
    </div>
  )
}
