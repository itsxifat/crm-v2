'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Trash2, Loader2, ArrowLeft, Layers, Info, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import ClientSearch from '@/components/ui/ClientSearch'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import PageHeader from '@/components/ui/PageHeader'
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/Card'
import { Field, Label, inputClass, textareaClass, selectClass } from '@/components/ui/Input'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { VAT_TREATMENTS, VAT_RATE_OPTIONS } from '@/lib/tax/catalog'
import { computeInvoiceTotals, previewInvoiceTotals, uniformVatRate } from '@/lib/invoiceTotals'
import { cn } from '@/lib/utils'

const ic = inputClass
const icSm = cn(inputClass, 'px-2')
const th = 'px-1 pb-1 text-left text-xs font-medium text-muted-foreground'

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

// One-line versions shown under the field (full text above is the tooltip).
const TREATMENT_SHORT = {
  STANDARD:   'VAT on value after discount (Mushak-6.3)',
  REDUCED:    'e.g. ITES 5% — no input tax credit',
  ZERO_RATED: 'Export of services paid in FX via bank',
  EXEMPT:     'No VAT is charged',
  NONE:       'No VAT lines on the document',
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
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      {/* Header */}
      <div>
        <button type="button" onClick={() => router.back()}
          className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-gray-900">
          <ArrowLeft className="size-3.5" /> Back
        </button>
        <PageHeader
          title={isEdit ? 'Edit invoice' : 'New invoice'}
          description={isEdit ? invoice.invoiceNumber : undefined}
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client + Project */}
        <Card>
          <CardHeader><CardTitle>Client & project</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <Field label="Client" required>
              <ClientSearch
                value={clientId}
                onChange={id => { setClientId(id ?? ''); setProjectId(''); setItems([emptyItem()]) }}
              />
            </Field>

            {clientId && (
              <div>
                <Label>Project</Label>
                {clientProjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No projects for this client</p>
                ) : (
                  <Select value={projectId}
                    onChange={v => setProjectId(v ?? '')}
                    options={clientProjects.map(p => ({
                      value: p.id ?? p._id,
                      label: `${p.projectCode} — ${p.name}${p.budget > 0 ? ` (৳${(p.budget || 0).toLocaleString()})` : ''}`,
                    }))}
                    placeholder="No project (standalone)"
                    disabled={isEdit}
                  />
                )}
                {projectId && siblingsLoading && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Checking existing invoices…
                  </p>
                )}

                {/* What has already been billed on this project */}
                {projectId && !siblingsLoading && (siblings?.length ?? 0) > 0 && (
                  <div className="mt-3 rounded-lg bg-gray-50 p-3.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-gray-900">
                        {siblings.length} existing invoice{siblings.length === 1 ? '' : 's'}
                      </p>
                      {siblings[0]?.combined && (
                        <Link href={`/admin/invoices/combined/${siblings[0].combined.id}`} target="_blank"
                          className="inline-flex items-center gap-1 text-xs font-medium text-gray-900 underline-offset-4 hover:underline">
                          <Layers className="size-3.5 text-gray-500" /> {siblings[0].combined.combinedNumber}
                        </Link>
                      )}
                    </div>
                    <ul className="mb-2.5 space-y-1">
                      {siblings.map(i => (
                        <li key={i.id} className="flex items-center justify-between gap-3 text-xs">
                          <Link href={`/admin/invoices/${i.id}`} target="_blank"
                            className="truncate font-mono text-gray-700 underline-offset-4 hover:text-gray-900 hover:underline">
                            {i.invoiceNumber}
                            <span className="ml-2 font-sans text-muted-foreground">{i.status.replace(/_/g, ' ')}</span>
                          </Link>
                          <span className="shrink-0 tabular-nums text-gray-700">
                            ৳ {money(i.total)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="space-y-1 border-t border-gray-200 pt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Already billed{siblingsHaveVat ? ' (excl. VAT)' : ''}</span>
                        <span className="font-semibold tabular-nums text-gray-900">
                          ৳ {money(alreadyBilled)}
                        </span>
                      </div>
                      {projectNet > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Remaining to bill</span>
                          <span className={cn('font-semibold tabular-nums', remainingToBill > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                            ৳ {money(remainingToBill)}
                          </span>
                        </div>
                      )}
                    </div>
                    {!isEdit && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Rolls into this project&rsquo;s combined invoice.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dates */}
        <Card>
          <CardHeader><CardTitle>Dates</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Issue date" required>
              <DatePicker value={issueDate || null} onChange={v => setIssueDate(v ?? '')} />
            </Field>
            <Field label="Due date">
              <DatePicker value={dueDate || null} onChange={v => setDueDate(v ?? '')} />
            </Field>
          </CardContent>
        </Card>

        {/* VAT */}
        <Card>
          <CardHeader>
            <CardTitle>VAT</CardTitle>
            {vatInfoState === 'loading' && !isEdit && (
              <CardAction className="text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Loading defaults…
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>VAT treatment</Label>
                <Select
                  value={vatTreatment}
                  onChange={changeTreatment}
                  options={VAT_TREATMENTS.map(t => ({
                    value: t.value,
                    label: t.label,
                    disabled: notRegistered && t.value !== 'NONE',
                  }))}
                  placeholder="Company default"
                />
                <p className="mt-1.5 text-xs text-muted-foreground"
                  title={vatTreatment ? TREATMENT_HINTS[vatTreatment] : 'The company’s default VAT treatment (Tax & VAT → Tax Settings) is applied when you save.'}>
                  {vatTreatment ? TREATMENT_SHORT[vatTreatment] : 'Company default applied on save'}
                </p>
              </div>

              {ratesOn && (
                <Field
                  label={perLineVat ? 'Default VAT rate' : 'VAT rate'}
                  hint={perLineVat ? 'For lines without their own rate' : effectiveTreatment === 'REDUCED' ? 'Applies to every line' : 'For ITES 5%, pick “Reduced rate”'}
                >
                  <Select
                    value={String(defaultVatRate ?? '')}
                    onChange={v => { vatTouched.current = true; setDefaultVatRate(v === null ? 0 : Number(v)) }}
                    options={rateOptions}
                    placeholder="Rate"
                  />
                </Field>
              )}

              {isVat && (
                <Field label="Service code" hint="Sets the VAT rate">
                  <TaxCodeSelect
                    kind="VAT_SERVICE"
                    value={serviceCode || null}
                    onChange={changeServiceCode}
                    placeholder="e.g. S099.10"
                    className={selectClass}
                  />
                </Field>
              )}

              {isVat && (
                <Field label="Delivery destination" hint="Blank uses the client’s address">
                  <input value={deliveryDestination} onChange={e => setDeliveryDestination(e.target.value)}
                    maxLength={300} placeholder="Optional" className={ic}
                    title="Printed on the Mushak-6.3" />
                </Field>
              )}
            </div>

            {(ratesOn || sdAllowed) && (
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {ratesOn && (
                  <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={perLineVat} onChange={e => togglePerLineVat(e.target.checked)}
                      className="rounded border-gray-300" />
                    Different VAT per line
                  </label>
                )}
                {sdAllowed && (
                  <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={showSd} onChange={e => setShowSd(e.target.checked)}
                      className="rounded border-gray-300" />
                    Supplementary duty (SD)
                  </label>
                )}
              </div>
            )}

            {/* Context hints */}
            {(notRegistered
              || (clientInfo?.vatRegistrationType === 'FOREIGN' && effectiveTreatment !== 'ZERO_RATED' && isVat)
              || (clientInfo && isVat && !clientInfo.hasBin && clientInfo.vatRegistrationType !== 'FOREIGN')
              || (!isEdit && vatInfoState === 'failed' && !vatTreatment)) && (
              <div className="space-y-2">
                {notRegistered && (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    Company is {registrationType === 'TURNOVER' ? 'a turnover-tax enterprise' : 'not VAT registered'} — invoices can&rsquo;t carry VAT.
                  </p>
                )}
                {clientInfo?.vatRegistrationType === 'FOREIGN' && effectiveTreatment !== 'ZERO_RATED' && isVat && (
                  <p className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
                    <Info className="mt-0.5 size-4 shrink-0" />
                    Foreign client — exports paid in FX through a bank are usually zero-rated.
                  </p>
                )}
                {clientInfo && isVat && !clientInfo.hasBin && clientInfo.vatRegistrationType !== 'FOREIGN' && (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    Client has no BIN on file — it must appear on the Mushak-6.3. Add it on the client profile.
                  </p>
                )}
                {!isEdit && vatInfoState === 'failed' && !vatTreatment && (
                  <p className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
                    <Info className="mt-0.5 size-4 shrink-0 text-gray-500" />
                    Couldn&rsquo;t load VAT defaults — they&rsquo;ll apply on save, or pick a treatment.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Line Items */}
        <Card>
          <CardHeader>
            <CardTitle>Line items</CardTitle>
            <CardAction>
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus /> Add item
              </Button>
            </CardAction>
          </CardHeader>

          <CardContent>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[620px] border-separate" style={{ borderSpacing: '0 6px' }}>
                <thead>
                  <tr>
                    <th className={th}>Description</th>
                    {showUnit && <th className={cn(th, 'w-24')}>Unit</th>}
                    <th className={cn(th, 'w-20')}>Qty</th>
                    <th className={cn(th, 'w-28')}>Rate (৳)</th>
                    {showSd && sdAllowed && <th className={cn(th, 'w-20')}>SD %</th>}
                    {perLineVat && ratesOn && <th className={cn(th, 'w-24')}>VAT %</th>}
                    <th className={cn(th, 'w-32 text-right')}>Amount</th>
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
                            placeholder="e.g. Phase 1 — Design"
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
                              className={cn(selectClass, 'pl-2 pr-7')}>
                              <option value="">Default ({defaultVatRate}%)</option>
                              {[...new Set([...ratesFor(effectiveTreatment), ...(blank(item.vatRate) ? [] : [Number(item.vatRate)])])]
                                .sort((a, b) => a - b)
                                .map(r => <option key={r} value={String(r)}>{r}%</option>)}
                            </select>
                          </td>
                        )}
                        <td className="px-1 pt-2 text-right">
                          <span className="text-sm font-medium tabular-nums text-gray-900">{money(item.amount)}</span>
                          {isVat && line && (line.vatAmount > 0 || line.sdAmount > 0) && (
                            <span className="block text-[11px] tabular-nums text-muted-foreground">
                              {line.sdAmount > 0 && <>SD {money(line.sdAmount)} · </>}VAT {money(line.vatAmount)}
                            </span>
                          )}
                        </td>
                        <td className="pt-0.5 text-right">
                          <Button variant="ghost" size="icon-sm" onClick={() => removeItem(idx)} aria-label="Remove line"
                            className="text-gray-400 hover:bg-red-50 hover:text-red-600">
                            <Trash2 />
                          </Button>
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
            <div className="mt-5 space-y-3 border-t border-gray-100 pt-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium tabular-nums text-gray-900">৳ {money(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <label className="text-sm text-muted-foreground"
                  title={isVat ? 'Reduces the VAT base; shared across lines by value.' : undefined}>
                  Discount (৳)
                </label>
                <input type="number" min="0" max={Math.max(0, discountMax)} step="0.01" value={discount}
                  onChange={e => setDiscount(e.target.value)}
                  title={isVat ? 'Reduces the VAT base; shared across lines by value.' : undefined}
                  className={cn(inputClass, 'h-8 w-28 text-right')} />
              </div>
              {isVat && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Taxable value</span>
                    <span className="tabular-nums text-gray-700">৳ {money(preview.taxableValue)}</span>
                  </div>
                  {(preview.sdAmount > 0 || (showSd && sdAllowed)) && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Supplementary duty (SD)</span>
                      <span className="tabular-nums text-gray-700">৳ {money(preview.sdAmount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{vatRowLabel}</span>
                    <span className="tabular-nums text-gray-700">৳ {money(preview.vatAmount)}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">MFS charge (%)</label>
                  <p className="text-[11px] text-muted-foreground">Mobile-payment surcharge, not VAT</p>
                </div>
                <input type="number" min="0" max="100" step="0.01" value={taxRate}
                  onChange={e => setTaxRate(e.target.value)}
                  className={cn(inputClass, 'h-8 w-28 text-right')} />
              </div>
              {taxAmount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">MFS charge ({Number(taxRate) || 0}%)</span>
                  <span className="tabular-nums text-gray-700">৳ {money(taxAmount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <span className="text-sm font-semibold text-gray-900">Total</span>
                <span className="text-xl font-semibold tracking-tight tabular-nums text-gray-900">৳ {money(total)}</span>
              </div>
              {Number(invoice?.paidAmount) > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-emerald-600">Paid so far</span>
                  <span className="font-semibold tabular-nums text-emerald-700">৳ {money(invoice.paidAmount)}</span>
                </div>
              )}
              {!vatTreatment && !isEdit && vatInfoState !== 'loading' && (
                <p className="text-xs text-muted-foreground">Company-default VAT, if any, is added on save.</p>
              )}
              {visibleIssues.length > 0 && (
                <ul className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                  {visibleIssues.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Notes & Terms */}
        <Card>
          <CardHeader><CardTitle>Notes & terms</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Notes" hint="Visible to the client">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Thank you for your business…"
                className={cn(textareaClass, 'resize-none')} />
            </Field>
            <div>
              <Label>Payment terms</Label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {TERMS_TEMPLATES.map(t => (
                  <button type="button" key={t} onClick={() => setTerms(t)} title={t}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      terms === t
                        ? 'border-gray-900 bg-gray-900 text-white'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    )}>
                    {t.split(' ').slice(0, 5).join(' ')}…
                  </button>
                ))}
              </div>
              <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={2}
                placeholder="Payment terms…"
                className={cn(textareaClass, 'resize-none')} />
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {isEdit ? 'Save changes' : 'Create invoice'}
          </Button>
        </div>
      </form>
    </div>
  )
}
