'use client'

import Image from 'next/image'

// Shared, print-ready invoice layout used by BOTH the admin invoice detail page
// and the client invoice detail page, so the two always render identically.

const STATUS_LABELS = {
  DRAFT:          'Draft',
  SENT:           'Sent',
  PARTIALLY_PAID: 'Partially Paid',
  PAID:           'Paid',
  OVERDUE:        'Overdue',
  CANCELLED:      'Cancelled',
}

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Opens the on-screen invoice (#invoice-print, rendered by InvoicePrintView) in a
// print window and triggers the browser print / save-as-PDF dialog. Both the admin
// and client invoice pages call this, so the printed output is byte-identical to
// the invoice shown on the page — no separate server-rendered template to drift.
export function openInvoicePrint(invoiceNumber) {
  const el = document.getElementById('invoice-print')
  if (!el) return
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <base href="${window.location.origin}/" />
    <title>Invoice ${invoiceNumber ?? ''}</title>
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
}

export default function InvoicePrintView({ invoice, payments = [], company = {} }) {
  const client     = invoice.clientId
  const user       = client?.userId
  const paidAmount = invoice.paidAmount ?? 0
  const subtotal   = invoice.subtotal   ?? 0
  const discount   = invoice.discount   ?? 0
  const taxAmount  = invoice.taxAmount  ?? 0
  const total      = invoice.total      ?? 0
  const balance    = Math.max(0, total - paidAmount)
  const cur        = invoice.currency   ?? 'BDT'
  const statusLabel = STATUS_LABELS[invoice.status] ?? STATUS_LABELS.DRAFT

  const isBDT = cur === 'BDT'
  const curSymbol = isBDT ? '৳' : cur
  const Sym = () => isBDT
    ? <span style={{ fontSize: 14, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.5px', fontFamily: 'Georgia, serif' }}>৳</span>
    : <span>{cur}</span>

  const accent = {
    PAID: '#16a34a', PARTIALLY_PAID: '#d97706', OVERDUE: '#dc2626',
    SENT: '#2563eb', DRAFT: '#64748b', CANCELLED: '#94a3b8',
  }[invoice.status] ?? '#2563eb'

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
    <div id="invoice-print" style={{
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      background: '#ffffff', padding: '36px 56px',
      maxWidth: 820, margin: '0 auto',
    }}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Image src="/en-logo.png" alt={company.name || 'Logo'} width={120} height={38} style={{ objectFit: 'contain', display: 'block', marginBottom: 7 }} />
          {company.name    && <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{company.name}</p>}
          {company.address && <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>{company.address}</p>}
          {(company.phone || company.email) && (
            <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>
              {[company.phone, company.email].filter(Boolean).join(' – ')}
            </p>
          )}
          {company.website && <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>{company.website}</p>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.5px' }}>Invoice</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>
            Invoice No: <strong style={{ color: accent, fontWeight: 700 }}>{invoice.invoiceNumber}</strong>
          </p>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
            {[
              { label: 'Issued', value: fmtDate(invoice.issueDate) },
              { label: 'Due',    value: fmtDate(invoice.dueDate) },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 36, textAlign: 'right' }}>{row.label}</span>
                <strong style={{ fontSize: 11, color: '#475569', minWidth: 80, textAlign: 'left' }}>{row.value}</strong>
              </div>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>
            Invoice Status: <strong style={{ color: accent, fontWeight: 700 }}>{statusLabel}</strong>
          </p>
        </div>
      </div>

      {/* ── DIVIDER ── */}
      <div style={{ height: 1, background: '#e2e8f0', marginBottom: 20 }} />

      {/* ── INVOICED TO ── */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Invoiced To</p>
        <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
          {client?.company ?? user?.name ?? '—'}
          {client?.clientCode && (
            <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>
              (Client ID: #{client.clientCode})
            </span>
          )}
        </p>
        {user?.name          && <p style={{ margin: '0 0 1px', fontSize: 11, fontWeight: 700, color: '#64748b' }}>{user.name}</p>}
        {client?.designation && <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 400, color: '#64748b' }}>{client.designation}</p>}
        {(client?.address || client?.city || client?.country) && (
          <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>
            {[client.address, client.city, client.country].filter(Boolean).join(', ')}
          </p>
        )}
        {user?.phone && <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>Phone: {user.phone}</p>}
      </div>

      {/* ── ITEMS TABLE ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 0 }}>
        <thead>
          <tr>
            <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a', paddingLeft: 0 })}>ID</th>
            <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a' })}>Description</th>
            <th style={TH({ textAlign: 'center', borderTop: '2px solid #0f172a' })}>Qty</th>
            <th style={TH({ textAlign: 'right',  borderTop: '2px solid #0f172a', whiteSpace: 'nowrap' })}>Unit Price</th>
            <th style={TH({ textAlign: 'right',  borderTop: '2px solid #0f172a', paddingRight: 0, whiteSpace: 'nowrap' })}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items?.map((item, i) => {
            const projectMatch = item.description?.match(/^\[([^\]]+)\]/)
            const projectCode  = projectMatch
              ? projectMatch[1]
              : (invoice.projectIds?.[i]?.projectCode ?? invoice.projectIds?.[0]?.projectCode ?? '—')
            const rawDesc  = projectMatch
              ? item.description.slice(projectMatch[0].length).trim()
              : (item.description ?? '')
            const splitMatch = rawDesc.match(/^([^—\n]+?)(?:\s*—\s*|\n)([\s\S]*)$/)
            const descTitle  = splitMatch ? splitMatch[1].trim() : rawDesc
            const descDetail = splitMatch ? splitMatch[2].trim() : ''
            const project = invoice.projectIds?.[i] ?? invoice.projectIds?.[0]
            const venture = project?.venture
            return (
              <tr key={i}>
                <td style={TD({ paddingLeft: 0, fontSize: 12, fontWeight: 500, color: '#334155', whiteSpace: 'nowrap' })}>
                  #{projectCode}
                </td>
                <td style={TD({})}>
                  {venture && <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 500, color: '#94a3b8', lineHeight: 1.3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{venture}</p>}
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.4 }}>{descTitle}</p>
                  {descDetail && <p style={{ margin: '3px 0 0', fontSize: 10, fontWeight: 400, color: '#64748b', lineHeight: 1.6 }}>{descDetail}</p>}
                </td>
                <td style={TD({ textAlign: 'center', color: '#64748b' })}>{item.quantity}</td>
                <td style={TD({ textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' })}>
                  <Sym />&nbsp;{Number(item.rate).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                </td>
                <td style={TD({ textAlign: 'right', paddingRight: 0, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' })}>
                  <Sym />&nbsp;{(Number(item.quantity) * Number(item.rate)).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* ── TOTALS ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div style={{ width: 280 }}>
          <div style={{ height: 2, background: '#0f172a', marginBottom: 0 }} />
          {[
            { label: 'Sub Total',   n: subtotal,  prefix: '',  show: true,          valueColor: '#334155' },
            { label: 'Discount',    n: discount,  prefix: '−', show: discount > 0,  valueColor: '#ef4444' },
            { label: `MFS Charge (${invoice.taxRate ?? 0}%)`, n: taxAmount, prefix: '', show: taxAmount > 0, valueColor: '#334155' },
          ].filter(r => r.show).map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>{row.label}</span>
              <span style={{ fontSize: 12, color: row.valueColor, fontWeight: 500 }}>
                {row.prefix}<Sym />&nbsp;{(row.n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Payable</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}><Sym />&nbsp;{(total).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>Paid</span>
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>−<Sym />&nbsp;{(paidAmount).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px', marginTop: 3, marginLeft: -16, marginRight: -16, borderRadius: 8, background: balance > 0.01 ? '#fef2f2' : '#f0fdf4' }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: balance > 0.01 ? '#dc2626' : '#16a34a' }}>Due</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: balance > 0.01 ? '#dc2626' : '#16a34a' }}><Sym />&nbsp;{(balance).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {/* ── TRANSACTIONS ── */}
      {payments.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Transaction Details</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH({ textAlign: 'left',   paddingLeft: 0, borderTop: '2px solid #0f172a' })}>Date</th>
                <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a' })}>Gateway / Method</th>
                <th style={TH({ textAlign: 'center', borderTop: '2px solid #0f172a' })}>Transaction ID</th>
                <th style={TH({ textAlign: 'right',  paddingRight: 0, borderTop: '2px solid #0f172a' })}>Paid Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={i}>
                  <td style={TD({ paddingLeft: 0 })}>{fmtDate(p.paymentDate ?? p.createdAt)}</td>
                  <td style={TD()}>{(p.paymentMethod ?? '—').replace(/_/g, ' ')}</td>
                  <td style={TD({ textAlign: 'center', fontFamily: 'monospace', fontSize: 11 })}>{p.transactionId ?? p.txnId ?? '—'}</td>
                  <td style={TD({ textAlign: 'right', paddingRight: 0, color: '#16a34a', fontWeight: 600 })}><Sym />&nbsp;{(p.amount ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── NOTES / TERMS ── */}
      {(invoice.notes || invoice.terms) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {invoice.notes && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Notes</p>
              <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.7 }}>{invoice.notes}</p>
            </div>
          )}
          {invoice.terms && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Payment Terms</p>
              <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.7 }}>{invoice.terms}</p>
            </div>
          )}
        </div>
      )}

      {/* ── SYSTEM NOTE ── */}
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16, marginBottom: 20, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.8 }}>
          This is a system generated invoice. No signature is required.
        </p>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, textAlign: 'center' }}>
        <p style={{ margin: '0 0 3px', fontSize: 11, color: '#94a3b8' }}>
          Generated on {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} –{' '}
          {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </p>
        {company.name && (
          <p style={{ margin: 0, fontSize: 10, color: '#cbd5e1', letterSpacing: '0.04em' }}>
            {company.name}
          </p>
        )}
      </div>
    </div>
  )
}
