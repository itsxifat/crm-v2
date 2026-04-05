'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Edit2, Save, X, Loader2, Copy, Trash2, Send,
  CheckCircle, XCircle, RotateCcw, Plus, Trash, Printer,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import Image from 'next/image'
import { VENTURE_CATEGORIES } from '@/lib/ventures'

const VENTURES = ['ENSTUDIO', 'ENTECH', 'ENMARK']

const STATUS_STYLES = {
  DRAFT:    { badge: 'bg-gray-100 text-gray-600',    label: 'Draft' },
  SENT:     { badge: 'bg-blue-100 text-blue-700',    label: 'Sent' },
  ACCEPTED: { badge: 'bg-green-100 text-green-700',  label: 'Accepted' },
  REJECTED: { badge: 'bg-red-100 text-red-600',      label: 'Rejected' },
}

const TRANSITIONS = {
  DRAFT:    [{ to: 'SENT',     label: 'Mark as Sent',     icon: Send,        cls: 'bg-blue-600 hover:bg-blue-700 text-white' }],
  SENT:     [
    { to: 'ACCEPTED', label: 'Mark Accepted', icon: CheckCircle, cls: 'bg-green-600 hover:bg-green-700 text-white' },
    { to: 'REJECTED', label: 'Mark Rejected', icon: XCircle,     cls: 'bg-red-600 hover:bg-red-700 text-white' },
  ],
  ACCEPTED: [],
  REJECTED: [{ to: 'DRAFT', label: 'Revert to Draft', icon: RotateCcw, cls: 'bg-gray-700 hover:bg-gray-800 text-white' }],
}

const fmt     = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const toDateInput = (d) => d ? new Date(d).toISOString().split('T')[0] : ''
const emptyItem   = () => ({ description: '', venture: '', service_category: '', service: '', quantity: 1, rate: '', amount: 0 })

const VENTURE_LABELS = { ENSTUDIO: 'Enstudio', ENTECH: 'Entech', ENMARK: 'Enmark' }

function ItemCard({ item, idx, onChange, onRemove, editing }) {
  const venture    = item.venture || ''
  const categories = venture ? Object.keys(VENTURE_CATEGORIES[venture] || {}) : []
  const services   = (venture && item.service_category) ? (VENTURE_CATEGORIES[venture][item.service_category] || []) : []

  function upd(field, val) {
    const updated = { ...item, [field]: val }
    if (field === 'venture')          { updated.service_category = ''; updated.service = '' }
    if (field === 'service_category') { updated.service = '' }
    if (field === 'quantity' || field === 'rate') {
      updated.amount = (Number(updated.quantity) || 0) * (Number(updated.rate) || 0)
    }
    onChange(idx, updated)
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
  const labelCls = 'block text-xs text-gray-500 mb-1 font-medium'

  if (!editing) {
    return (
      <div className="border border-gray-100 rounded-xl p-4 space-y-2 bg-gray-50/30">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-medium text-gray-800 flex-1">{item.description || '—'}</p>
          <p className="text-sm font-semibold text-gray-900 shrink-0">{fmt(item.amount)}</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {item.venture  && <span className="font-medium text-gray-700">{VENTURE_LABELS[item.venture] ?? item.venture}</span>}
          {item.service  && <span>{item.service}</span>}
          <span>Qty: {item.quantity} × {fmt(item.rate)}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="border border-gray-100 rounded-xl p-4 space-y-3 bg-gray-50/50">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Item {idx + 1}</span>
        <button type="button" onClick={() => onRemove(idx)}
          className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
          <Trash className="w-3.5 h-3.5" />
        </button>
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <input value={item.description} onChange={e => upd('description', e.target.value)}
          placeholder="Describe the service…" className={inputCls} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Venture</label>
          <select value={item.venture} onChange={e => upd('venture', e.target.value)} className={inputCls}>
            <option value="">None</option>
            {VENTURES.map(v => <option key={v} value={v}>{VENTURE_LABELS[v] ?? v}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <select value={item.service_category || ''} onChange={e => upd('service_category', e.target.value)}
            disabled={!categories.length} className={inputCls + (categories.length ? '' : ' opacity-40 cursor-not-allowed')}>
            <option value="">— Category —</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Service</label>
          <select value={item.service || ''} onChange={e => upd('service', e.target.value)}
            disabled={!services.length} className={inputCls + (services.length ? '' : ' opacity-40 cursor-not-allowed')}>
            <option value="">— Service —</option>
            {services.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Quantity</label>
          <input type="number" min="1" value={item.quantity} onChange={e => upd('quantity', e.target.value)}
            className={inputCls + ' text-right'} />
        </div>
        <div>
          <label className={labelCls}>Rate (৳)</label>
          <input type="number" min="0" value={item.rate} onChange={e => upd('rate', e.target.value)}
            className={inputCls + ' text-right'} />
        </div>
        <div>
          <label className={labelCls}>Amount</label>
          <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-right font-semibold text-gray-800">
            ৳ {(item.amount || 0).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Print / PDF View ─────────────────────────────────────────────────────────

function QuotationPrintView({ quotation: q }) {
  const subtotal  = q.subtotal  ?? 0
  const discount  = q.discount  ?? 0
  const taxAmount = q.taxAmount ?? 0
  const total     = q.total     ?? 0
  const cur       = q.currency  ?? 'BDT'
  const statusStyle = STATUS_STYLES[q.status] ?? STATUS_STYLES.DRAFT

  const isBDT = cur === 'BDT'
  const curSymbol = isBDT ? '৳' : cur
  const Sym = () => isBDT
    ? <span style={{ fontSize: 14, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.5px', fontFamily: 'Georgia, serif' }}>৳</span>
    : <span>{cur}</span>

  const accent = {
    ACCEPTED: '#16a34a', REJECTED: '#dc2626',
    SENT: '#2563eb', DRAFT: '#64748b',
  }[q.status] ?? '#2563eb'

  const TH = (extra = {}) => ({
    padding: '7px 16px', fontSize: 10, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.07em',
    color: '#64748b', borderBottom: '1px solid #e2e8f0',
    background: '#fff', ...extra,
  })
  const TD = (extra = {}) => ({
    padding: '8px 16px', fontSize: 12.5, color: '#334155',
    borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', ...extra,
  })

  return (
    <div id="quotation-print" style={{
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      background: '#ffffff', padding: '36px 56px',
      maxWidth: 820, margin: '0 auto',
    }}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={38} style={{ objectFit: 'contain', display: 'block', marginBottom: 7 }} />
          <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Enfinito Bangladesh</p>
          <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>Savar, Dhaka, Bangladesh</p>
          <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>+8801332818901 - info@enfinito.com</p>
          <p style={{ margin: 0,         fontSize: 11, color: '#64748b' }}>www.enfinito.com</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.5px' }}>Quotation</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>
            Quote No: <strong style={{ color: accent, fontWeight: 700 }}>{q.quotationNumber}</strong>
          </p>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
            {[
              { label: 'Issued', value: fmtDate(q.issueDate) },
              ...(q.validUntil ? [{ label: 'Valid Until', value: fmtDate(q.validUntil) }] : []),
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 60, textAlign: 'right' }}>{row.label}</span>
                <strong style={{ fontSize: 11, color: '#475569', minWidth: 80, textAlign: 'left' }}>{row.value}</strong>
              </div>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>
            Status: <strong style={{ color: accent, fontWeight: 700 }}>{statusStyle.label}</strong>
          </p>
        </div>
      </div>

      {/* ── DIVIDER ── */}
      <div style={{ height: 1, background: '#e2e8f0', marginBottom: 20 }} />

      {/* ── QUOTED TO ── */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Quoted To</p>
        {q.recipientName    && <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{q.recipientName}</p>}
        {q.recipientCompany && <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 700, color: '#64748b' }}>{q.recipientCompany}</p>}
        {q.recipientAddress && <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>{q.recipientAddress}</p>}
        {q.recipientPhone   && <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>Phone: {q.recipientPhone}</p>}
        {q.recipientEmail   && <p style={{ margin: 0,         fontSize: 11, color: '#64748b' }}>Email: {q.recipientEmail}</p>}
      </div>

      {/* ── ITEMS TABLE ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 0 }}>
        <thead>
          <tr>
            <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a' })}>Description</th>
            <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a' })}>Service</th>
            <th style={TH({ textAlign: 'center', borderTop: '2px solid #0f172a' })}>Qty</th>
            <th style={TH({ textAlign: 'right',  borderTop: '2px solid #0f172a', whiteSpace: 'nowrap' })}>Unit Price</th>
            <th style={TH({ textAlign: 'right',  borderTop: '2px solid #0f172a', paddingRight: 0, whiteSpace: 'nowrap' })}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(q.items ?? []).map((item, i) => (
            <tr key={i}>
              <td style={TD({})}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.4 }}>{item.description || '—'}</p>
              </td>
              <td style={TD({})}>
                {item.venture && <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 500, color: '#94a3b8', lineHeight: 1.3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{item.venture}</p>}
                {item.service && <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>{item.service}</p>}
                {!item.venture && !item.service && <span style={{ color: '#94a3b8' }}>—</span>}
              </td>
              <td style={TD({ textAlign: 'center', color: '#64748b' })}>{item.quantity}</td>
              <td style={TD({ textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' })}>
                <Sym />&nbsp;{Number(item.rate).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
              </td>
              <td style={TD({ textAlign: 'right', paddingRight: 0, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' })}>
                <Sym />&nbsp;{(Number(item.quantity) * Number(item.rate)).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── TOTALS ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div style={{ width: 280 }}>
          <div style={{ height: 2, background: '#0f172a', marginBottom: 0 }} />
          {[
            { label: 'Sub Total',  n: subtotal,  prefix: '',  show: true,          valueColor: '#334155' },
            { label: 'Discount',   n: discount,  prefix: '−', show: discount > 0,  valueColor: '#ef4444' },
            { label: `MFS Charge (${q.taxRate ?? 0}%)`, n: taxAmount, prefix: '', show: taxAmount > 0, valueColor: '#334155' },
          ].filter(r => r.show).map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>{row.label}</span>
              <span style={{ fontSize: 12, color: row.valueColor, fontWeight: 500 }}>
                {row.prefix}<Sym />&nbsp;{(row.n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px', marginTop: 3, marginLeft: -16, marginRight: -16, borderRadius: 8, background: '#f8fafc' }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>Total</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}><Sym />&nbsp;{(total).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {/* ── NOTES / TERMS ── */}
      {(q.notes || q.terms) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {q.notes && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Notes</p>
              <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.7 }}>{q.notes}</p>
            </div>
          )}
          {q.terms && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Terms & Conditions</p>
              <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.7 }}>{q.terms}</p>
            </div>
          )}
        </div>
      )}

      {/* ── SYSTEM NOTE ── */}
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16, marginBottom: 20, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.8 }}>
          This is a system generated quotation. No signature is required.
        </p>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, textAlign: 'center' }}>
        <p style={{ margin: '0 0 3px', fontSize: 11, color: '#94a3b8' }}>
          Generated on {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} –{' '}
          {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p style={{ margin: 0, fontSize: 10, color: '#cbd5e1', letterSpacing: '0.04em' }}>
          Powered by Enfinito Technology – Entech
        </p>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function QuotationDetailPage() {
  const { id } = useParams()
  const router  = useRouter()

  const [q,        setQ]        = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [printMode, setPrintMode] = useState(false)

  // Edit form state
  const [recipientName,    setRecipientName]    = useState('')
  const [recipientCompany, setRecipientCompany] = useState('')
  const [recipientEmail,   setRecipientEmail]   = useState('')
  const [recipientPhone,   setRecipientPhone]   = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [items,     setItems]     = useState([])
  const [taxRate,   setTaxRate]   = useState(0)
  const [discount,  setDiscount]  = useState(0)
  const [issueDate,  setIssueDate]  = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [currency,  setCurrency]  = useState('BDT')
  const [notes,     setNotes]     = useState('')
  const [terms,     setTerms]     = useState('')

  const subtotal  = items.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const taxAmount = subtotal * (Number(taxRate) / 100)
  const editTotal = subtotal + taxAmount - Number(discount)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/quotations/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setQ(json.data)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  function startEdit() {
    if (!q) return
    setRecipientName(q.recipientName || '')
    setRecipientCompany(q.recipientCompany || '')
    setRecipientEmail(q.recipientEmail || '')
    setRecipientPhone(q.recipientPhone || '')
    setRecipientAddress(q.recipientAddress || '')
    setItems((q.items || []).map(it => ({ ...it, service_category: '' })))
    setTaxRate(q.taxRate ?? 0)
    setDiscount(q.discount ?? 0)
    setIssueDate(toDateInput(q.issueDate))
    setValidUntil(toDateInput(q.validUntil))
    setCurrency(q.currency || 'BDT')
    setNotes(q.notes || '')
    setTerms(q.terms || '')
    setEditing(true)
  }

  function cancelEdit() { setEditing(false) }

  async function saveEdit() {
    setSaving(true)
    try {
      const payload = {
        recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
        items: items.map(({ service_category, ...rest }) => ({ ...rest, quantity: Number(rest.quantity) || 1, rate: Number(rest.rate) || 0 })),
        issueDate, validUntil: validUntil || null,
        taxRate: Number(taxRate), discount: Number(discount),
        currency, notes: notes || null, terms: terms || null,
      }
      const res  = await fetch(`/api/quotations/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
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
      const res  = await fetch(`/api/quotations/${id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setQ(json.data)
      toast.success(`Status → ${to}`)
    } catch (err) { toast.error(err.message) }
    finally { setTransitioning(false) }
  }

  async function duplicate() {
    try {
      const res  = await fetch(`/api/quotations/${id}/duplicate`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Duplicated')
      router.push(`/admin/quotations/${json.data.id}`)
    } catch (err) { toast.error(err.message) }
  }

  async function del() {
    if (!confirm('Delete this quotation? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/quotations/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Deleted')
      router.push('/admin/quotations')
    } catch (err) { toast.error(err.message) }
    finally { setDeleting(false) }
  }

  function openPrint() {
    setPrintMode(true)
  }

  if (loading) return (
    <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  )
  if (!q) return (
    <div className="text-center py-20 text-gray-400">Quotation not found. <Link href="/admin/quotations" className="text-blue-600">Back</Link></div>
  )

  const s     = STATUS_STYLES[q.status] ?? STATUS_STYLES.DRAFT
  const trans = TRANSITIONS[q.status]   ?? []
  const canEdit = q.status === 'DRAFT'

  if (printMode) {
    return (
      <div>
        <div className="print:hidden flex items-center gap-3 mb-4 px-4 pt-4">
          <button onClick={() => setPrintMode(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button onClick={() => {
              const el = document.getElementById('quotation-print')
              if (!el) return
              const win = window.open('', '_blank')
              win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
                <title>Quotation ${q.quotationNumber}</title>
                <style>
                  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                  * { box-sizing: border-box; margin: 0; padding: 0; }
                  body { font-family: 'Inter','Segoe UI',sans-serif; background:#fff; }
                  @page { margin: 0; size: A4; }
                </style>
              </head><body>${el.outerHTML}</body></html>`)
              win.document.close()
              win.focus()
              setTimeout(() => { win.print(); win.close() }, 500)
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700">
            <Printer className="w-4 h-4" /> Print / Save PDF
          </button>
        </div>
        <QuotationPrintView quotation={q} />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between print:hidden">
        <div className="flex items-center gap-3">
          <Link href="/admin/quotations" className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900 font-mono">{q.quotationNumber}</h1>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.badge}`}>{s.label}</span>
            </div>
            <p className="text-sm text-gray-400 mt-0.5">
              {q.sourceType === 'LEAD' ? `Lead: ${q.leadId?.name || '—'}` : `Client: ${q.clientId?.company || '—'}`}
              {' · '}Issued {fmtDate(q.issueDate)}
              {q.validUntil ? ` · Valid until ${fmtDate(q.validUntil)}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status transitions */}
          {!editing && trans.map(t => (
            <button key={t.to} onClick={() => transition(t.to)} disabled={transitioning}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${t.cls}`}>
              {transitioning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <t.icon className="w-3.5 h-3.5" />}
              {t.label}
            </button>
          ))}

          <button onClick={openPrint}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 transition-colors">
            <Printer className="w-3.5 h-3.5" /> Print / PDF
          </button>

          <button onClick={duplicate}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <Copy className="w-3.5 h-3.5" /> Duplicate
          </button>

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

          <button onClick={del} disabled={deleting}
            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Edit form — only shown when editing */}
      {editing && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {/* Recipient + Dates */}
          <div className="grid grid-cols-2 gap-6 p-6 border-b border-gray-100">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recipient</p>
              <div className="space-y-2">
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)}
                  placeholder="Name" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                <input value={recipientCompany} onChange={e => setRecipientCompany(e.target.value)}
                  placeholder="Company" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                <input value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                  placeholder="Email" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                <input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)}
                  placeholder="Phone" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
                <input value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)}
                  placeholder="Address" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Details</p>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400">Issue Date</label>
                  <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400">Valid Until</label>
                  <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400">Currency</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none">
                    <option value="BDT">BDT (৳)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="p-6 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Items</p>
            {items.map((item, idx) => (
              <ItemCard key={idx} item={item} idx={idx} editing
                onChange={(i, u) => setItems(prev => prev.map((x, j) => j === i ? u : x))}
                onRemove={(i) => setItems(prev => prev.filter((_, j) => j !== i))} />
            ))}
            <button type="button" onClick={() => setItems(prev => [...prev, emptyItem()])}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium pt-1">
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>

          {/* Totals */}
          <div className="flex justify-end p-6 border-t border-gray-100">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Subtotal</span><span>{fmt(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm text-gray-600">Tax (%)</label>
                <input type="number" min="0" max="100" step="0.5" value={taxRate} onChange={e => setTaxRate(e.target.value)}
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none" />
              </div>
              {taxAmount > 0 && (
                <div className="flex justify-between text-sm text-gray-500">
                  <span>Tax Amount</span><span>{fmt(taxAmount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm text-gray-600">Discount (৳)</label>
                <input type="number" min="0" value={discount} onChange={e => setDiscount(e.target.value)}
                  className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none" />
              </div>
              <div className="border-t border-gray-200 pt-2 flex justify-between">
                <span className="text-sm font-semibold text-gray-700">Total</span>
                <span className="text-base font-bold text-gray-900">{fmt(editTotal)}</span>
              </div>
            </div>
          </div>

          {/* Notes & Terms */}
          <div className="grid grid-cols-2 gap-6 px-6 pb-6 border-t border-gray-100">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 mt-4">Notes</p>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="Notes for client…"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none" />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 mt-4">Terms & Conditions</p>
              <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3}
                placeholder="Payment terms, validity…"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none resize-none" />
            </div>
          </div>
        </div>
      )}

      {/* Quotation document — invoice-style view */}
      {!editing && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <QuotationPrintView quotation={q} />
        </div>
      )}

      {/* Timestamps */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-1">
        {q.sentAt     && <p className="text-xs text-gray-400">Sent: {fmtDate(q.sentAt)}</p>}
        {q.acceptedAt && <p className="text-xs text-gray-400">Accepted: {fmtDate(q.acceptedAt)}</p>}
        {q.rejectedAt && <p className="text-xs text-gray-400">Rejected: {fmtDate(q.rejectedAt)}</p>}
        {q.duplicatedFromId && <p className="text-xs text-gray-400">Duplicated from a previous quotation</p>}
        <p className="text-xs text-gray-400 ml-auto">Created by {q.createdBy?.name || 'Unknown'}</p>
      </div>
    </div>
  )
}
