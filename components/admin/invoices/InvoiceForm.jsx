'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2, Loader2, ArrowLeft, Layers, FileText, Receipt, Info, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import ClientSearch from '@/components/ui/ClientSearch'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { VAT_TREATMENTS, VAT_RATE_OPTIONS } from '@/lib/tax/catalog'
import { computeInvoiceTotals, previewInvoiceTotals, uniformVatRate } from '@/lib/invoiceTotals'

const ic = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const icSm = 'w-full border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const lc = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5'
const hint = 'text-xs text-gray-400 mt-1'

const TERMS_TEMPLATES = [
  'Payment due within 7 days of invoice date.',
  'Payment due within 15 days of invoice date.',
  'Payment due within 30 days of invoice date.',
  'Advance payment required before work begins.',
  '50% advance, 50% on delivery.',
]

const UNIT_PRESETS = ['job', 'service', 'month', 'hour', 'day', 'page', 'post', 'licence', 'pcs', 'set']

const TREATMENT_HINTS = {
  STANDARD:   'Standard-rated supply — VAT is charged on the value after discount (Mushak-6.3 tax invoice).',
  REDUCED:    'Reduced rate, e.g. IT-enabled services (S099.10) at 5%. No input tax credit on related purchases.',
  ZERO_RATED: 'Export of services paid in foreign currency through a bank — VAT at 0%.',
  EXEMPT:     'Exempt supply — no VAT is charged.',
  NONE:       'Not a VAT invoice — no VAT lines appear on the document.',
}

// Treatments whose lines carry a VAT rate / may carry supplementary duty.
const RATED = ['STANDARD', 'REDUCED']
const SD_OK = ['STANDARD', 'REDUCED', 'EXEMPT']

const blank = v => v === '' || v === null || v === undefined
const money = n => (Number(n) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const emptyItem = () => ({ description: '', quantity: 1, rate: 0, amount: 0, unit: '', vatRate: '', sdRate: '' })
const treatmentDefaultRate = t => VAT_TREATMENTS.find(x => x.value === t)?.defaultRate ?? 0
// Rates a rated treatment may carry — the same rule lib/invoiceTotals enforces
// (the treatment picks the Mushak-9.1 note: STANDARD 15% → note 4, REDUCED → note 7).
const ratesFor = t => (t === 'STANDARD' ? [15]
  : t === 'REDUCED' ? VAT_RATE_OPTIONS.map(Number).filter(r => r > 0 && r < 15)
  : VAT_RATE_OPTIONS.map(Number))

// A stored invoice's line → editable form row (keeps any stored VAT/SD/unit).
function toFormItem(i) {
  return {
    description: i?.description ?? '',
    quantity:    i?.quantity ?? 1,
    rate:        i?.rate ?? 0,
    amount:      Number(i?.amount ?? (Number(i?.quantity) || 0) * (Number(i?.rate) || 0)) || 0,
    unit:        i?.unit ?? '',
    serviceCode: i?.serviceCode ?? null,
    vatRate:     blank(i?.vatRate) ? '' : i.vatRate,
    sdRate:      blank(i?.sdRate) || Number(i.sdRate) === 0 ? '' : i.sdRate,
  }
}

export default function InvoiceForm({ invoice, defaultProjectId, defaultClientId }) {
  const router = useRouter()
  const isEdit = !!invoice

  const storedItems     = Array.isArray(invoice?.items) ? invoice.items : null
  const storedTreatment = isEdit ? (invoice.vatTreatment || 'NONE') : null
  const storedRate      = storedItems ? uniformVatRate(storedItems) : null

  const [clientId,  setClientId]  = useState(invoice?.clientId?.id ?? invoice?.clientId ?? defaultClientId ?? '')
  const [projectId, setProjectId] = useState(
    invoice?.projectId?.id ?? invoice?.projectId ?? defaultProjectId ?? ''
  )
  const [projects,  setProjects]  = useState([])
  const [items,     setItems]     = useState(storedItems?.length ? storedItems.map(toFormItem) : [emptyItem()])
  const [issueDate, setIssueDate] = useState(invoice?.issueDate?.slice(0,10) ?? dhakaDayKey())
  const [dueDate,   setDueDate]   = useState(invoice?.dueDate?.slice(0,10) ?? '')
  const [taxRate,   setTaxRate]   = useState(invoice?.taxRate ?? 0)        // MFS charge %
  const [discount,  setDiscount]  = useState(invoice?.discount ?? 0)
  const [notes,     setNotes]     = useState(invoice?.notes ?? '')
  const [terms,     setTerms]     = useState(invoice?.terms ?? '')
  const [saving,       setSaving]       = useState(false)
  // Invoices already raised against the selected project — context, not a block:
  // a project may carry as many invoices as the billing plan needs.
  const [siblings,     setSiblings]     = useState(null)
  const [siblingsLoading, setSiblingsLoading] = useState(false)

  // ── VAT ────────────────────────────────────────────────────────────────
  // vatTreatment null = "company default" (new invoice whose defaults could not
  // be loaded): the field is then left out of the request and the server applies
  // the finance-settings default.
  const [vatTreatment, setVatTreatment] = useState(storedTreatment)
  // Once the user picks a treatment / rate, defaults never overwrite it (a ref, so
  // a defaults response that arrives later sees the latest value).
  const vatTouched = useRef(isEdit)
  const [defaultVatRate, setDefaultVatRate] = useState(
    storedRate ?? (storedTreatment && RATED.includes(storedTreatment) ? treatmentDefaultRate(storedTreatment) : 15)
  )
  const [serviceCode,  setServiceCode]  = useState(invoice?.serviceCode ?? '')
  const [deliveryDestination, setDeliveryDestination] = useState(invoice?.deliveryDestination ?? '')
  const [perLineVat,   setPerLineVat]   = useState(
    !!storedItems && RATED.includes(storedTreatment) && storedItems.length > 1 && storedRate === null
  )
  const [showSd,       setShowSd]       = useState(!!storedItems?.some(i => (Number(i?.sdRate) || 0) > 0))
  const [vatInfo,      setVatInfo]      = useState(null)        // response of ?view=vat-defaults
  const [vatInfoState, setVatInfoState] = useState('loading')   // loading | ready | failed

  // Company VAT defaults (+ the selected client's VAT profile). New invoices take
  // the defaults until the user picks a treatment; a foreign client suggests
  // zero-rating. Edits keep the stored treatment and only use the client hints.
  useEffect(() => {
    let stale = false
    setVatInfoState('loading')
    fetch(`/api/invoices?view=vat-defaults${clientId ? `&clientId=${encodeURIComponent(clientId)}` : ''}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Failed')
        return j.data
      })
      .then(d => {
        if (stale) return
        setVatInfo(d)
        setVatInfoState('ready')
        if (!vatTouched.current && d) {
          setVatTreatment(d.vatTreatment ?? 'NONE')
          if (RATED.includes(d.vatTreatment)) setDefaultVatRate(Number(d.vatRate) || treatmentDefaultRate(d.vatTreatment))
          if (d.serviceCode) setServiceCode(prev => prev || d.serviceCode)
        }
      })
      .catch(() => { if (!stale) setVatInfoState('failed') })
    return () => { stale = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  // Load projects for client
  useEffect(() => {
    if (!clientId) { setProjects([]); return }
    fetch(`/api/projects?clientId=${clientId}&limit=200`)
      .then(r => r.json())
      .then(j => setProjects(j.data ?? []))
      .catch(() => {})
  }, [clientId])

  // Load the project's existing invoices so the user can see what has already
  // been billed before adding another one.
  useEffect(() => {
    if (!projectId) { setSiblings(null); return }
    // Ignore a response for a project that is no longer selected (a slow reply
    // for project A must not overwrite project B's siblings).
    let stale = false
    setSiblingsLoading(true)
    fetch(`/api/invoices?projectId=${projectId}&limit=100&sort=issueDate&dir=asc`)
      .then(r => r.json())
      .then(j => { if (!stale) setSiblings(j.data ?? []) })
      .catch(() => { if (!stale) setSiblings([]) })
      .finally(() => { if (!stale) setSiblingsLoading(false) })
    return () => { stale = true }
  }, [projectId])

  // What an invoice billed against the project value: its total without VAT/SD
  // (the project value is a net figure; legacy invoices have no VAT so this is
  // their total, exactly as before).
  const billedNet = i => Math.max(0, (Number(i.total) || 0) - (Number(i.vatAmount) || 0) - (Number(i.sdAmount) || 0))

  // Everything already billed against this project (excludes the invoice being
  // edited and any cancelled ones).
  const alreadyBilled = (siblings ?? [])
    .filter(i => i.status !== 'CANCELLED' && i.id !== invoice?.id)
    .reduce((sum, i) => sum + billedNet(i), 0)
  const siblingsHaveVat = (siblings ?? []).some(i => (Number(i.vatAmount) || 0) > 0)

  const selectedProject = projects.find(x => (x.id ?? x._id) === projectId) ?? null
  const projectNet      = selectedProject ? Math.max(0, Number(selectedProject.budget) || 0) : 0
  const remainingToBill = Math.max(0, projectNet - alreadyBilled)

  // Auto-fill the first line when a project is picked (new invoices only), using
  // the amount NOT yet billed rather than the whole contract — that's the number
  // you want on invoice #2 onward.
  useEffect(() => {
    if (isEdit || !projectId || projects.length === 0 || siblings === null) return
    const p = projects.find(x => (x.id ?? x._id) === projectId)
    if (!p) return
    const net  = Math.max(0, Number(p.budget) || 0)
    const done = (siblings ?? []).filter(i => i.status !== 'CANCELLED')
    const rate = Math.max(0, net - done.reduce((sum, i) => sum + billedNet(i), 0))
    const seq  = done.length + 1
    setItems([{
      ...emptyItem(),
      description: done.length > 0
        ? `[${p.projectCode ?? p.name}] ${p.name} — Invoice ${seq}`
        : `[${p.projectCode ?? p.name}] ${p.name}`,
      quantity: 1, rate, amount: rate,
    }])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, projects, siblings])

  const clientProjects = clientId
    ? projects.filter(p => {
        const cid = p.clientId?.id ?? p.clientId?._id ?? p.clientId
        return String(cid) === String(clientId)
      })
    : []

  function updateItem(idx, field, val) {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item
      const updated = { ...item, [field]: val }
      if (field === 'quantity' || field === 'rate')
        updated.amount = (Number(updated.quantity) || 0) * (Number(updated.rate) || 0)
      return updated
    }))
  }

  function addItem() {
    setItems(prev => [...prev, emptyItem()])
  }

  function removeItem(idx) {
    setItems(prev => {
      const next = prev.filter((_, i) => i !== idx)
      return next.length > 0 ? next : [emptyItem()]
    })
  }

  // ── VAT handlers ─────────────────────────────────────────────────────────
  const effectiveTreatment = vatTreatment ?? 'NONE'
  const isVat     = effectiveTreatment !== 'NONE'
  const ratesOn   = RATED.includes(effectiveTreatment)
  const sdAllowed = SD_OK.includes(effectiveTreatment)
  const registrationType = vatInfo?.registrationType ?? null
  const notRegistered    = !!registrationType && registrationType !== 'REGISTERED'
  const clientInfo       = vatInfo?.client ?? null

  function changeTreatment(v) {
    const t = v ?? 'NONE'
    vatTouched.current = true
    setVatTreatment(t)
    if (RATED.includes(t)) {
      const companyRate = vatInfo?.vatTreatment === t && Number(vatInfo?.vatRate) > 0 ? Number(vatInfo.vatRate) : null
      setDefaultVatRate(companyRate ?? treatmentDefaultRate(t))
      // Per-line rates the new treatment cannot carry fall back to the default.
      const allowed = ratesFor(t)
      setItems(prev => prev.map(i => (!blank(i.vatRate) && !allowed.includes(Number(i.vatRate)) ? { ...i, vatRate: '' } : i)))
    }
    if (!RATED.includes(t)) setPerLineVat(false)
    if (!SD_OK.includes(t)) setShowSd(false)
  }

  function changeServiceCode(code, obj) {
    setServiceCode(code ?? '')
    if (!obj || !RATED.includes(effectiveTreatment)) return
    // A service code implies its rate (e.g. S099.10 ITES → reduced 5%, Mushak note 7).
    const rate = blank(obj.vatRate) ? NaN : Number(obj.vatRate)
    const codeTreatment = RATED.includes(obj.treatment)
      ? obj.treatment
      : (rate === 15 ? 'STANDARD' : rate > 0 ? 'REDUCED' : null)
    if (!codeTreatment) return
    if (codeTreatment !== effectiveTreatment) {
      vatTouched.current = true
      setVatTreatment(codeTreatment)
    }
    if (Number.isFinite(rate)) setDefaultVatRate(rate)
  }

  function togglePerLineVat(on) {
    setPerLineVat(on)
    if (on) setItems(prev => prev.map(i => (blank(i.vatRate) ? { ...i, vatRate: defaultVatRate } : i)))
  }

  // Lines exactly as they will be sent: per-line VAT/SD only when those columns are on.
  const payloadItems = items.map(i => ({
    description: i.description,
    quantity:    i.quantity,
    rate:        i.rate,
    unit:        blank(i.unit) ? null : String(i.unit).trim(),
    serviceCode: i.serviceCode || null,
    vatRate:     perLineVat && ratesOn && !blank(i.vatRate) ? Number(i.vatRate) : null,
    sdRate:      showSd && sdAllowed && !blank(i.sdRate) ? Number(i.sdRate) : null,
  }))

  const calcParams = {
    items: payloadItems, taxRate, discount,
    vatTreatment: effectiveTreatment,
    defaultVatRate: ratesOn ? defaultVatRate : 0,
  }
  const preview = previewInvoiceTotals(calcParams)
  const { subtotal, taxAmount, total } = preview
  const discountMax = isVat ? subtotal : subtotal + taxAmount
  const showUnit = isVat || items.some(i => !blank(i.unit))

  const rateOptions = useMemo(() => {
    const set = new Set(ratesFor(effectiveTreatment))
    // keep a stored out-of-range rate visible so the validation message makes sense
    if (Number.isFinite(Number(defaultVatRate))) set.add(Number(defaultVatRate))
    return [...set].sort((a, b) => a - b).map(r => ({ value: String(r), label: `${r}%` }))
  }, [defaultVatRate, effectiveTreatment])

  const lineVatRate  = preview.items.length ? uniformVatRate(preview.items) : null
  const vatRowLabel  = effectiveTreatment === 'ZERO_RATED' ? 'VAT (zero-rated)'
    : effectiveTreatment === 'EXEMPT' ? 'VAT (exempt)'
    : lineVatRate === null ? 'VAT' : `VAT (${lineVatRate}%)`

  async function handleSubmit(e) {
    e.preventDefault()
    if (!clientId) { toast.error('Please select a client'); return }
    if (items.length === 0 || items.every(i => !String(i.description ?? '').trim())) {
      toast.error('Add at least one item'); return
    }
    if (items.some(i => !(Number(i.quantity) > 0))) {
      toast.error('Each item needs a quantity greater than 0'); return
    }
    // Same rules the server applies (lib/invoiceTotals) — fail fast with its message.
    const check = computeInvoiceTotals(calcParams)
    if (check.error) { toast.error(check.error); return }

    setSaving(true)
    try {
      const body = {
        clientId,
        projectId: projectId || null,
        items: payloadItems, issueDate, dueDate: dueDate || null,
        taxRate: Number(taxRate) || 0, discount: Number(discount) || 0,
        notes: notes || null, terms: terms || null, currency: invoice?.currency ?? 'BDT',
        deliveryDestination: deliveryDestination.trim() || null,
      }
      if (vatTreatment) {
        body.vatTreatment = vatTreatment
        body.vatRate      = ratesOn ? Number(defaultVatRate) || 0 : 0
        body.serviceCode  = vatTreatment === 'NONE' ? null : (serviceCode || null)
      }
      const url    = isEdit ? `/api/invoices/${invoice.id}` : '/api/invoices'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()

      if (!res.ok) throw new Error(json.error ?? 'Failed')
      if (json.combined) {
        toast.success(`Invoice created — rolled into combined invoice ${json.combined.combinedNumber}`)
      } else {
        toast.success(isEdit ? 'Invoice updated' : 'Invoice created')
      }
      router.push(`/admin/invoices/${json.data.id}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const visibleIssues = preview.issues.filter(m => m !== 'At least one item required')

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Invoice' : 'New Invoice'}</h1>
          <p className="text-sm text-gray-500">
            {isEdit ? `Editing ${invoice.invoiceNumber}` : 'Bill a project in as many invoices as you need — they roll up into a combined invoice'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client + Project */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6 space-y-5">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Client & Project</h2>

          <div>
            <label className={lc}>Client *</label>
            <ClientSearch
              value={clientId}
              onChange={id => { setClientId(id ?? ''); setProjectId(''); setItems([emptyItem()]) }}
            />
          </div>

          {clientId && (
            <div>
              <label className={lc}>Project</label>
              {clientProjects.length === 0 ? (
                <p className="text-xs text-gray-400">No projects found for this client.</p>
              ) : (
                <Select value={projectId}
                  onChange={v => setProjectId(v ?? '')}
                  options={clientProjects.map(p => ({
                    value: p.id ?? p._id,
                    label: `${p.projectCode} — ${p.name}${p.budget > 0 ? ` (৳${(p.budget || 0).toLocaleString()})` : ''}`,
                  }))}
                  placeholder="— No project (standalone invoice) —"
                  disabled={isEdit}
                />
              )}
              {projectId && siblingsLoading && (
                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking existing invoices…
                </p>
              )}

              {/* What has already been billed on this project */}
              {projectId && !siblingsLoading && (siblings?.length ?? 0) > 0 && (
                <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-semibold text-gray-600 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-gray-400" />
                      {siblings.length} existing invoice{siblings.length === 1 ? '' : 's'} on this project
                    </p>
                    {siblings[0]?.combined && (
                      <Link href={`/admin/invoices/combined/${siblings[0].combined.id}`} target="_blank"
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
                        <Layers className="w-3 h-3" /> {siblings[0].combined.combinedNumber}
                      </Link>
                    )}
                  </div>
                  <ul className="space-y-1 mb-2.5">
                    {siblings.map(i => (
                      <li key={i.id} className="flex items-center justify-between gap-3 text-xs">
                        <Link href={`/admin/invoices/${i.id}`} target="_blank"
                          className="font-mono text-gray-600 hover:text-blue-600 truncate">
                          {i.invoiceNumber}
                          <span className="ml-2 text-gray-400 font-sans">{i.status.replace(/_/g, ' ')}</span>
                        </Link>
                        <span className="text-gray-700 tabular-nums shrink-0">
                          ৳ {money(i.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-gray-200 pt-2 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Already billed{siblingsHaveVat ? ' (excl. VAT)' : ''}</span>
                      <span className="font-semibold text-gray-800 tabular-nums">
                        ৳ {money(alreadyBilled)}
                      </span>
                    </div>
                    {projectNet > 0 && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500">Remaining to bill</span>
                        <span className={`font-semibold tabular-nums ${remainingToBill > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                          ৳ {money(remainingToBill)}
                        </span>
                      </div>
                    )}
                  </div>
                  {!isEdit && (
                    <p className="text-xs text-gray-400 mt-2">
                      Adding a second invoice creates (or updates) this project&rsquo;s combined invoice automatically.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dates */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4">Dates</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lc}>Issue Date *</label>
              <DatePicker value={issueDate || null} onChange={v => setIssueDate(v ?? '')} />
            </div>
            <div>
              <label className={lc}>Due Date</label>
              <DatePicker value={dueDate || null} onChange={v => setDueDate(v ?? '')} />
            </div>
          </div>
        </div>

        {/* VAT */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-gray-400" /> VAT
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">VAT treatment of this supply — drives the Mushak-6.3 tax invoice and the VAT return.</p>
            </div>
            {vatInfoState === 'loading' && !isEdit && (
              <span className="text-xs text-gray-400 flex items-center gap-1 shrink-0">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading defaults…
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lc}>VAT treatment</label>
              <Select
                value={vatTreatment}
                onChange={changeTreatment}
                options={VAT_TREATMENTS.map(t => ({
                  value: t.value,
                  label: t.label,
                  disabled: notRegistered && t.value !== 'NONE',
                }))}
                placeholder="Company default (applied on save)"
              />
              <p className={hint}>
                {vatTreatment
                  ? TREATMENT_HINTS[vatTreatment]
                  : 'The company’s default VAT treatment (Tax & VAT → Tax Settings) is applied when you save.'}
              </p>
            </div>

            {ratesOn && (
              <div>
                <label className={lc}>{perLineVat ? 'Default VAT rate' : 'VAT rate'}</label>
                <Select
                  value={String(defaultVatRate ?? '')}
                  onChange={v => { vatTouched.current = true; setDefaultVatRate(v === null ? 0 : Number(v)) }}
                  options={rateOptions}
                  placeholder="Rate"
                />
                <p className={hint}>
                  {perLineVat ? 'Used for lines without their own VAT %.' : effectiveTreatment === 'REDUCED' ? 'Applied to every line. Turn on “Different VAT per line” to mix reduced rates.' : 'Applied to every line. For a reduced rate (e.g. ITES 5%) choose the “Reduced rate” treatment.'}
                </p>
              </div>
            )}

            {isVat && (
              <div>
                <label className={lc}>Service code</label>
                <TaxCodeSelect
                  kind="VAT_SERVICE"
                  value={serviceCode || null}
                  onChange={changeServiceCode}
                  placeholder="Select service code (e.g. S099.10)"
                  className={ic}
                />
                <p className={hint}>Picking a code sets its VAT rate.</p>
              </div>
            )}

            {isVat && (
              <div>
                <label className={lc}>Delivery / service destination</label>
                <input value={deliveryDestination} onChange={e => setDeliveryDestination(e.target.value)}
                  maxLength={300} placeholder="Where the service is delivered (optional)" className={ic} />
                <p className={hint}>Printed on the Mushak-6.3. Leave blank to use the client&rsquo;s address.</p>
              </div>
            )}
          </div>

          {(ratesOn || sdAllowed) && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              {ratesOn && (
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                  <input type="checkbox" checked={perLineVat} onChange={e => togglePerLineVat(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  Different VAT per line
                </label>
              )}
              {sdAllowed && (
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                  <input type="checkbox" checked={showSd} onChange={e => setShowSd(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  Supplementary duty (SD)
                </label>
              )}
            </div>
          )}

          {/* Context hints */}
          <div className="space-y-2">
            {notRegistered && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                The company is set up as {registrationType === 'TURNOVER' ? 'a turnover-tax enterprise' : 'not VAT registered'}, so invoices cannot carry VAT.
              </p>
            )}
            {clientInfo?.vatRegistrationType === 'FOREIGN' && effectiveTreatment !== 'ZERO_RATED' && isVat && (
              <p className="flex items-start gap-1.5 text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                This is a foreign client — export of services paid in foreign currency through a bank is usually zero-rated.
              </p>
            )}
            {clientInfo && isVat && !clientInfo.hasBin && clientInfo.vatRegistrationType !== 'FOREIGN' && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                This client has no BIN on file. A VAT-registered buyer&rsquo;s BIN must appear on the Mushak-6.3 — add it on the client profile.
              </p>
            )}
            {!isEdit && vatInfoState === 'failed' && !vatTreatment && (
              <p className="flex items-start gap-1.5 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Couldn&rsquo;t load the company&rsquo;s VAT defaults. They will be applied when you save, or pick a treatment above.
              </p>
            )}
          </div>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Line Items</h2>
              <p className="text-xs text-gray-400 mt-0.5">Add all billing milestones, phases, or dues as separate line items.</p>
            </div>
            <button type="button" onClick={addItem}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors shrink-0">
              <Plus className="w-3.5 h-3.5" /> Add Item
            </button>
          </div>

          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full min-w-[620px] border-separate" style={{ borderSpacing: '0 6px' }}>
              <thead>
                <tr className="text-left">
                  <th className="px-1 text-xs font-semibold text-gray-400 uppercase">Description</th>
                  {showUnit && <th className="px-1 w-24 text-xs font-semibold text-gray-400 uppercase">Unit</th>}
                  <th className="px-1 w-20 text-xs font-semibold text-gray-400 uppercase">Qty</th>
                  <th className="px-1 w-28 text-xs font-semibold text-gray-400 uppercase">Rate (৳)</th>
                  {showSd && sdAllowed && <th className="px-1 w-20 text-xs font-semibold text-gray-400 uppercase">SD %</th>}
                  {perLineVat && ratesOn && <th className="px-1 w-24 text-xs font-semibold text-gray-400 uppercase">VAT %</th>}
                  <th className="px-1 w-32 text-xs font-semibold text-gray-400 uppercase text-right">Amount</th>
                  <th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const line = preview.items[idx]
                  return (
                    <tr key={idx} className="align-top">
                      <td className="px-1">
                        <input value={item.description}
                          onChange={e => updateItem(idx, 'description', e.target.value)}
                          placeholder="e.g. Phase 1 — Design, Monthly retainer April…"
                          className={ic} required />
                      </td>
                      {showUnit && (
                        <td className="px-1">
                          <input value={item.unit ?? ''} list="invoice-unit-presets"
                            onChange={e => updateItem(idx, 'unit', e.target.value)}
                            placeholder="job" maxLength={20} className={icSm} />
                        </td>
                      )}
                      <td className="px-1">
                        <input type="number" min="0.01" step="0.01"
                          value={item.quantity}
                          onChange={e => updateItem(idx, 'quantity', e.target.value)}
                          className={icSm} required />
                      </td>
                      <td className="px-1">
                        <input type="number" min="0" step="0.01"
                          value={item.rate}
                          onChange={e => updateItem(idx, 'rate', e.target.value)}
                          className={icSm} />
                      </td>
                      {showSd && sdAllowed && (
                        <td className="px-1">
                          <input type="number" min="0" max="500" step="0.01"
                            value={item.sdRate ?? ''}
                            onChange={e => updateItem(idx, 'sdRate', e.target.value)}
                            placeholder="0" className={icSm} />
                        </td>
                      )}
                      {perLineVat && ratesOn && (
                        <td className="px-1">
                          <select value={blank(item.vatRate) ? '' : String(item.vatRate)}
                            onChange={e => updateItem(idx, 'vatRate', e.target.value)}
                            className={`${icSm} pr-6`}>
                            <option value="">Default ({defaultVatRate}%)</option>
                            {[...new Set([...ratesFor(effectiveTreatment), ...(blank(item.vatRate) ? [] : [Number(item.vatRate)])])]
                              .sort((a, b) => a - b)
                              .map(r => <option key={r} value={String(r)}>{r}%</option>)}
                          </select>
                        </td>
                      )}
                      <td className="px-1 pt-2 text-right">
                        <span className="text-sm font-semibold text-gray-800 tabular-nums">{money(item.amount)}</span>
                        {isVat && line && (line.vatAmount > 0 || line.sdAmount > 0) && (
                          <span className="block text-[11px] text-gray-400 tabular-nums">
                            {line.sdAmount > 0 && <>SD {money(line.sdAmount)} · </>}VAT {money(line.vatAmount)}
                          </span>
                        )}
                      </td>
                      <td className="pt-1 text-right">
                        <button type="button" onClick={() => removeItem(idx)} aria-label="Remove line"
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <datalist id="invoice-unit-presets">
              {UNIT_PRESETS.map(u => <option key={u} value={u} />)}
            </datalist>
          </div>

          {/* Totals */}
          <div className="mt-6 border-t border-gray-100 pt-5 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-semibold text-gray-900 tabular-nums">৳ {money(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-gray-500">Discount (৳)</label>
                {isVat && <p className="text-[11px] text-gray-400">Reduces the VAT base; shared across lines by value.</p>}
              </div>
              <input type="number" min="0" max={Math.max(0, discountMax)} step="0.01" value={discount}
                onChange={e => setDiscount(e.target.value)}
                className="w-28 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {isVat && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Taxable value</span>
                  <span className="text-gray-700 tabular-nums">৳ {money(preview.taxableValue)}</span>
                </div>
                {(preview.sdAmount > 0 || (showSd && sdAllowed)) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Supplementary duty (SD)</span>
                    <span className="text-gray-700 tabular-nums">৳ {money(preview.sdAmount)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{vatRowLabel}</span>
                  <span className="text-gray-700 tabular-nums">৳ {money(preview.vatAmount)}</span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-sm text-gray-500">MFS Charge (%)</label>
                <p className="text-[11px] text-gray-400">Mobile-payment surcharge — not VAT</p>
              </div>
              <input type="number" min="0" max="100" step="0.01" value={taxRate}
                onChange={e => setTaxRate(e.target.value)}
                className="w-28 border border-gray-200 rounded-xl px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {taxAmount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">MFS Charge ({Number(taxRate) || 0}%)</span>
                <span className="text-gray-700 tabular-nums">৳ {money(taxAmount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-gray-200 pt-3">
              <span className="text-base font-bold text-gray-900">Total</span>
              <span className="text-xl font-bold text-blue-700 tabular-nums">৳ {money(total)}</span>
            </div>
            {Number(invoice?.paidAmount) > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-green-600 font-medium">Paid so far</span>
                <span className="text-green-700 font-semibold tabular-nums">৳ {money(invoice.paidAmount)}</span>
              </div>
            )}
            {!vatTreatment && !isEdit && vatInfoState !== 'loading' && (
              <p className="text-xs text-gray-400">VAT, if any, is added on save from the company default.</p>
            )}
            {visibleIssues.length > 0 && (
              <ul className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 space-y-0.5">
                {visibleIssues.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            )}
          </div>
        </div>

        {/* Notes & Terms */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Notes & Terms</h2>
          <div>
            <label className={lc}>Notes (visible to client)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Thank you for your business…"
              className={`${ic} resize-none`} />
          </div>
          <div>
            <label className={lc}>Payment Terms</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {TERMS_TEMPLATES.map(t => (
                <button type="button" key={t} onClick={() => setTerms(t)}
                  className={`px-3 py-1 text-xs rounded-xl border transition-colors ${
                    terms === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-gray-300'
                  }`}>
                  {t.split(' ').slice(0, 5).join(' ')}…
                </button>
              ))}
            </div>
            <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={2}
              placeholder="Payment terms…"
              className={`${ic} resize-none`} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={() => router.back()}
            className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="px-6 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2 shadow-sm">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Invoice'}
          </button>
        </div>
      </form>
    </div>
  )
}
