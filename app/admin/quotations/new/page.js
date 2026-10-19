'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Field, Input, Textarea, NativeSelect } from '@/components/ui/Input'
import { useConfig } from '@/lib/useConfig'
import { computeQuotation, previewQuotation, uniformVatRate } from '@/lib/quotation'
import QuotationVatCard from '../_components/QuotationVatCard'
import QuotationItemCard from '../_components/QuotationItemCard'
import QuotationTotals from '../_components/QuotationTotals'
import { useQuotationVat } from '../_components/useQuotationVat'
import { emptyItem, buildItemsPayload, fetchJson, QUOTATION_CURRENCIES } from '../_components/quotationUi'

// YYYY-MM-DD in the business timezone (toISOString() would give the UTC date)
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())
// Masked PII placeholders (from /api/leads, /api/clients) must never be copied into the snapshot
const unmasked = (v) => (typeof v === 'string' && v.includes('••') ? '' : (v || ''))

function NewQuotationForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [saving, setSaving] = useState(false)
  const { ventures, ventureCategories } = useConfig()

  // Source — pre-fill from URL params (?sourceType=LEAD&leadId=xxx or ?sourceType=CLIENT&clientId=xxx)
  const [sourceType, setSourceType] = useState(() => (searchParams.get('sourceType') === 'CLIENT' ? 'CLIENT' : 'LEAD'))
  const [leads,   setLeads]   = useState([])
  const [clients, setClients] = useState([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [leadId,   setLeadId]   = useState(() => searchParams.get('leadId') || '')
  const [clientId, setClientId] = useState(() => searchParams.get('clientId') || '')

  // Recipient (snapshot)
  const [recipientName,    setRecipientName]    = useState('')
  const [recipientCompany, setRecipientCompany] = useState('')
  const [recipientEmail,   setRecipientEmail]   = useState('')
  const [recipientPhone,   setRecipientPhone]   = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')

  // Items
  const [items, setItems] = useState([emptyItem()])

  // Financials
  const [taxRate,  setTaxRate]  = useState(0)   // MFS charge %
  const [discount, setDiscount] = useState(0)

  // Dates
  const [issueDate,  setIssueDate]  = useState(today())
  const [validUntil, setValidUntil] = useState('')

  // Misc
  const [currency, setCurrency]           = useState('BDT')
  const [notes, setNotes]                 = useState('')
  const [terms, setTerms]                 = useState('')
  const [itemPriceOnly, setItemPriceOnly] = useState(false)

  // VAT — company defaults (and the client's VAT profile) until the user picks
  const vat = useQuotationVat({ clientId: sourceType === 'CLIENT' && clientId ? clientId : null, setItems })

  // Live totals with exactly the rules the server applies
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

  // Load leads/clients. A record preselected via the URL may be outside the
  // first 200 — fetch it by id and add it to the options.
  useEffect(() => {
    const urlLeadId   = searchParams.get('leadId')
    const urlClientId = searchParams.get('clientId')
    const withRecord = async (list, url) => {
      if (!url || list.some(x => (x.id || x._id) === url.split('/').pop())) return list
      try {
        const r = await fetch(url)
        if (!r.ok) return list
        const j = await r.json()
        return j.data ? [j.data, ...list] : list
      } catch { return list }
    }
    let alive = true
    Promise.all([
      fetch('/api/leads?limit=200').then(r => r.json())
        .then(j => withRecord(j.data ?? [], urlLeadId ? `/api/leads/${urlLeadId}` : null))
        .then(list => { if (alive) setLeads(list) })
        .catch(() => {}),
      fetch('/api/clients?limit=200').then(r => r.json())
        .then(j => withRecord(j.data ?? [], urlClientId ? `/api/clients/${urlClientId}` : null))
        .then(list => { if (alive) setClients(list) })
        .catch(() => {}),
    ]).finally(() => { if (alive) setSourcesLoading(false) })
    return () => { alive = false }
  }, [searchParams])

  // Auto-fill recipient when lead/client selected
  useEffect(() => {
    if (sourceType === 'LEAD' && leadId) {
      const l = leads.find(x => x.id === leadId || x._id === leadId)
      if (l) {
        setRecipientName(unmasked(l.name))
        setRecipientCompany(unmasked(l.company))
        setRecipientEmail(unmasked(l.email))
        setRecipientPhone(unmasked(l.phone))
        setRecipientAddress(unmasked(l.location))
      }
    }
  }, [leadId, leads, sourceType])

  useEffect(() => {
    if (sourceType === 'CLIENT' && clientId) {
      const c = clients.find(x => x.id === clientId || x._id === clientId)
      if (c) {
        setRecipientName(unmasked(c.contactPerson || c.userId?.name))
        setRecipientCompany(unmasked(c.company))
        setRecipientEmail(unmasked(c.userId?.email))
        setRecipientPhone(unmasked(c.userId?.phone))
        setRecipientAddress([c.address, c.city, c.country].map(unmasked).filter(Boolean).join(', '))
      }
    }
  }, [clientId, clients, sourceType])

  function updateItem(idx, updated) {
    setItems(prev => prev.map((it, i) => i === idx ? updated : it))
  }
  function removeItem(idx) {
    setItems(prev => {
      const next = prev.filter((_, i) => i !== idx)
      return next.length ? next : [emptyItem()]
    })
  }
  function addItem() {
    setItems(prev => [...prev, vat.perLineVat ? { ...emptyItem(), vatRate: vat.defaultVatRate } : emptyItem()])
  }

  async function save(e) {
    e.preventDefault()
    if (sourceType === 'LEAD' && !leadId)     return toast.error('Select a lead')
    if (sourceType === 'CLIENT' && !clientId) return toast.error('Select a client')
    if (!items.length) return toast.error('Add at least one item')
    if (validUntil && issueDate && validUntil < issueDate) return toast.error('Valid until cannot be before the issue date')
    // Same rules the server applies (lib/quotation) — fail fast with its message.
    const check = computeQuotation(calcParams)
    if (check.error) return toast.error(check.error)

    setSaving(true)
    try {
      const payload = {
        sourceType,
        leadId:   sourceType === 'LEAD'   ? leadId   : null,
        clientId: sourceType === 'CLIENT' ? clientId : null,
        // Blank recipient fields are snapshotted server-side from the lead/client
        recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
        items: payloadItems,
        issueDate, validUntil: validUntil || null,
        taxRate: Number(taxRate) || 0, discount: Number(discount) || 0,
        currency, notes: notes || null, terms: terms || null,
        itemPriceOnly,
        ...vat.bodyFields(),
      }
      const json = await fetchJson('/api/quotations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      toast.success('Quotation created')
      router.push(`/admin/quotations/${json.data.id}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6" data-component="new-quotation-form">
      <PageHeader
        back="/admin/quotations"
        backLabel="Quotations"
        title="New quotation"
        actions={
          <Button type="submit" loading={saving}>
            {!saving && <Save />}
            Save quotation
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: Source + Recipient + VAT + Items */}
        <div className="min-w-0 space-y-6 lg:col-span-2">

          {/* Source selector */}
          <Card>
            <CardHeader>
              <CardTitle>Source</CardTitle>
              <CardAction>
                <Tabs
                  size="sm"
                  value={sourceType}
                  onChange={t => { setSourceType(t); setLeadId(''); setClientId('') }}
                  tabs={['LEAD', 'CLIENT'].map(t => ({ value: t, label: t[0] + t.slice(1).toLowerCase() }))}
                />
              </CardAction>
            </CardHeader>
            <CardContent>
              {sourceType === 'LEAD' ? (
                <NativeSelect value={leadId} onChange={e => setLeadId(e.target.value)} required aria-label="Lead">
                  <option value="">{sourcesLoading ? 'Loading leads…' : leads.length ? 'Select lead…' : 'No leads found'}</option>
                  {leads.map(l => (
                    <option key={l.id || l._id} value={l.id || l._id}>{l.name}{l.company ? ` (${l.company})` : ''}</option>
                  ))}
                </NativeSelect>
              ) : (
                <NativeSelect value={clientId} onChange={e => setClientId(e.target.value)} required aria-label="Client">
                  <option value="">{sourcesLoading ? 'Loading clients…' : clients.length ? 'Select client…' : 'No clients found'}</option>
                  {clients.map(c => (
                    <option key={c.id || c._id} value={c.id || c._id}>{c.company}{c.contactPerson ? ` — ${c.contactPerson}` : ''}</option>
                  ))}
                </NativeSelect>
              )}
            </CardContent>
          </Card>

          {/* Recipient info */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Recipient</CardTitle>
                <CardDescription>Blank fields are filled from the {sourceType === 'LEAD' ? 'lead' : 'client'} on save</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input value={recipientName} onChange={e => setRecipientName(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Company">
                <Input value={recipientCompany} onChange={e => setRecipientCompany(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Email">
                <Input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} maxLength={200} />
              </Field>
              <Field label="Phone">
                <Input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} maxLength={50} />
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <Input value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)} maxLength={500} />
              </Field>
            </CardContent>
          </Card>

          {/* VAT */}
          <QuotationVatCard vat={vat} setItems={setItems} sourceType={sourceType} currency={currency} />

          {/* Line items */}
          <Card>
            <CardHeader><CardTitle>Items</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {items.map((item, idx) => (
                <QuotationItemCard key={idx} item={item} idx={idx} onChange={updateItem} onRemove={removeItem}
                  ventures={ventures} ventureCategories={ventureCategories} currency={currency}
                  line={preview.items[idx]} isVat={vat.isVat}
                  showVatRate={vat.perLineVat && vat.ratesOn} defaultVatRate={vat.defaultVatRate}
                  vatTreatment={vat.effectiveTreatment} />
              ))}
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus /> Add item
              </Button>
            </CardContent>
          </Card>

          {/* Notes & Terms */}
          <Card>
            <CardHeader><CardTitle>Notes & terms</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Notes">
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} maxLength={5000}
                  placeholder="Notes for the client…" className="resize-none" />
              </Field>
              <Field label="Terms & conditions">
                <Textarea value={terms} onChange={e => setTerms(e.target.value)} rows={4} maxLength={5000}
                  placeholder="Payment terms, validity…" className="resize-none" />
              </Field>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Dates, Financials */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Issue date">
                <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
              </Field>
              <Field label="Valid until">
                <Input type="date" value={validUntil} min={issueDate || undefined} onChange={e => setValidUntil(e.target.value)} />
              </Field>
              <Field label="Currency">
                <NativeSelect value={currency} onChange={e => setCurrency(e.target.value)}>
                  {QUOTATION_CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </NativeSelect>
              </Field>
            </CardContent>
          </Card>

          <Card className="lg:sticky lg:top-4">
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent>
              <QuotationTotals
                preview={preview} currency={currency} isVat={vat.isVat} vatRowLabel={vatRowLabel}
                taxRate={taxRate} onTaxRate={setTaxRate} discount={discount} onDiscount={setDiscount}
                itemPriceOnly={itemPriceOnly} onItemPriceOnly={setItemPriceOnly}
                pendingDefault={!vat.vatTreatment && vat.vatInfoState !== 'loading'}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  )
}

export default function NewQuotationPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <NewQuotationForm />
    </Suspense>
  )
}
