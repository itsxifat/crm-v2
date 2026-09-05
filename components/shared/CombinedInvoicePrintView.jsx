'use client'

import Image from 'next/image'

// Shared, print-ready COMBINED invoice layout, used by both the admin and the
// client portal so the two always render identically.
//
// A combined invoice consolidates every issued invoice raised against one
// project. Each child appears as its own block (its line items, its own paid /
// due figures) and the document closes with a grand summary.

const STATUS_LABELS = {
  SENT:           'Awaiting Payment',
  PARTIALLY_PAID: 'Partially Paid',
  PAID:           'Paid',
  OVERDUE:        'Overdue',
  EMPTY:          'No Issued Invoices',
}

const CHILD_STATUS_COLORS = {
  PAID:           '#16a34a',
  PARTIALLY_PAID: '#d97706',
  OVERDUE:        '#dc2626',
  SENT:           '#2563eb',
  DRAFT:          '#64748b',
  CANCELLED:      '#94a3b8',
}

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

/**
 * Opens the on-screen combined invoice (#combined-invoice-print) in a print
 * window. Mirrors openInvoicePrint() so printed output matches the page exactly.
 */
export function openCombinedInvoicePrint(combinedNumber) {
  const el = document.getElementById('combined-invoice-print')
  if (!el) return
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <base href="${window.location.origin}/" />
    <title>Combined Invoice ${combinedNumber ?? ''}</title>
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

export default function CombinedInvoicePrintView({ combined, company = {} }) {
  if (!combined) return null

  const client   = combined.clientId
  const user     = client?.userId
  const project  = combined.projectId
  const children = combined.children ?? []
  const t        = combined.totals ?? {}
  const cur      = combined.currency ?? 'BDT'
  const isBDT    = cur === 'BDT'

  const statusLabel = STATUS_LABELS[combined.status] ?? combined.status
  const accent = {
    PAID: '#16a34a', PARTIALLY_PAID: '#d97706', OVERDUE: '#dc2626',
    SENT: '#2563eb', EMPTY: '#94a3b8',
  }[combined.status] ?? '#2563eb'

  const Sym = () => isBDT
    ? <span style={{ fontSize: 14, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.5px', fontFamily: 'Georgia, serif' }}>৳</span>
    : <span>{cur}</span>

  const money = (v) => (Number(v) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })

  const TH = (extra = {}) => ({
    padding: '7px 12px', fontSize: 10, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.07em',
    color: '#64748b', borderBottom: '1px solid #e2e8f0',
    background: '#fff', ...extra,
  })
  const TD = (extra = {}) => ({
    padding: '7px 12px', fontSize: 12, color: '#334155',
    borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', ...extra,
  })

  return (
    <div id="combined-invoice-print" style={{
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
          <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.5px' }}>Combined Invoice</p>
          <p style={{ margin: '2px 0 0', fontSize: 10, fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Consolidated statement — {children.length} invoice{children.length === 1 ? '' : 's'}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>
            Reference: <strong style={{ color: accent, fontWeight: 700 }}>{combined.combinedNumber}</strong>
          </p>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
            {[
              { label: 'From', value: fmtDate(combined.issueDate) },
              { label: 'Due',  value: fmtDate(combined.dueDate) },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 36, textAlign: 'right' }}>{row.label}</span>
                <strong style={{ fontSize: 11, color: '#475569', minWidth: 80, textAlign: 'left' }}>{row.value}</strong>
              </div>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>
            Status: <strong style={{ color: accent, fontWeight: 700 }}>{statusLabel}</strong>
          </p>
        </div>
      </div>

      <div style={{ height: 1, background: '#e2e8f0', marginBottom: 20 }} />

      {/* ── PARTIES ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 22 }}>
        <div>
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
          {client?.designation && <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>{client.designation}</p>}
          {(client?.address || client?.city || client?.country) && (
            <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>
              {[client.address, client.city, client.country].filter(Boolean).join(', ')}
            </p>
          )}
          {user?.phone && <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>Phone: {user.phone}</p>}
        </div>
        <div>
          <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Project</p>
          <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{project?.name ?? '—'}</p>
          {project?.projectCode && <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>Code: #{project.projectCode}</p>}
          {project?.venture     && <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>{project.venture}{project.category ? ` · ${project.category}` : ''}</p>}
        </div>
      </div>

      {/* ── SUMMARY OF CHILD INVOICES ── */}
      <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>
        Invoices Included
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
        <thead>
          <tr>
            <th style={TH({ textAlign: 'left',  borderTop: '2px solid #0f172a', paddingLeft: 0 })}>Invoice No</th>
            <th style={TH({ textAlign: 'left',  borderTop: '2px solid #0f172a' })}>Issued</th>
            <th style={TH({ textAlign: 'left',  borderTop: '2px solid #0f172a' })}>Due</th>
            <th style={TH({ textAlign: 'left',  borderTop: '2px solid #0f172a' })}>Status</th>
            <th style={TH({ textAlign: 'right', borderTop: '2px solid #0f172a', whiteSpace: 'nowrap' })}>Amount</th>
            <th style={TH({ textAlign: 'right', borderTop: '2px solid #0f172a', whiteSpace: 'nowrap' })}>Paid</th>
            <th style={TH({ textAlign: 'right', borderTop: '2px solid #0f172a', paddingRight: 0, whiteSpace: 'nowrap' })}>Due</th>
          </tr>
        </thead>
        <tbody>
          {children.map(c => (
            <tr key={c.id}>
              <td style={TD({ paddingLeft: 0, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' })}>{c.invoiceNumber}</td>
              <td style={TD({ color: '#64748b', whiteSpace: 'nowrap' })}>{fmtDate(c.issueDate)}</td>
              <td style={TD({ color: '#64748b', whiteSpace: 'nowrap' })}>{fmtDate(c.dueDate)}</td>
              <td style={TD({ whiteSpace: 'nowrap' })}>
                <span style={{ color: CHILD_STATUS_COLORS[c.status] ?? '#64748b', fontWeight: 600, fontSize: 11 }}>
                  {c.status.replace(/_/g, ' ')}
                </span>
              </td>
              <td style={TD({ textAlign: 'right', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' })}><Sym />&nbsp;{money(c.total)}</td>
              <td style={TD({ textAlign: 'right', color: '#16a34a', whiteSpace: 'nowrap' })}><Sym />&nbsp;{money(c.paidAmount)}</td>
              <td style={TD({ textAlign: 'right', paddingRight: 0, fontWeight: 700, color: c.due > 0.01 ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' })}>
                <Sym />&nbsp;{money(c.due)}
              </td>
            </tr>
          ))}
          {children.length === 0 && (
            <tr>
              <td colSpan={7} style={TD({ textAlign: 'center', color: '#94a3b8', padding: '20px 12px' })}>
                No issued invoices for this project yet.
              </td>
            </tr>
          )}
        </tbody>
        {children.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={4} style={{ padding: '8px 12px 8px 0', fontSize: 12, fontWeight: 700, color: '#0f172a', borderTop: '2px solid #0f172a' }}>
                Total ({children.length} invoice{children.length === 1 ? '' : 's'})
              </td>
              <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, textAlign: 'right', color: '#0f172a', borderTop: '2px solid #0f172a', whiteSpace: 'nowrap' }}><Sym />&nbsp;{money(t.total)}</td>
              <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, textAlign: 'right', color: '#16a34a', borderTop: '2px solid #0f172a', whiteSpace: 'nowrap' }}><Sym />&nbsp;{money(t.paidAmount)}</td>
              <td style={{ padding: '8px 0 8px 12px', fontSize: 12, fontWeight: 700, textAlign: 'right', color: t.due > 0.01 ? '#dc2626' : '#16a34a', borderTop: '2px solid #0f172a', whiteSpace: 'nowrap' }}><Sym />&nbsp;{money(t.due)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* ── FULL LINE ITEMS, GROUPED BY INVOICE ── */}
      {children.length > 0 && (
        <>
          <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>
            Itemised Breakdown
          </p>
          {children.map(c => (
            <div key={c.id} style={{ marginBottom: 18, border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
              }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{c.invoiceNumber}</span>
                  <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 8 }}>
                    Issued {fmtDate(c.issueDate)}{c.dueDate ? ` · Due ${fmtDate(c.dueDate)}` : ''}
                  </span>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: CHILD_STATUS_COLORS[c.status] ?? '#64748b' }}>
                  {c.status.replace(/_/g, ' ')}
                </span>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH({ textAlign: 'left' })}>Description</th>
                    <th style={TH({ textAlign: 'center', width: 60 })}>Qty</th>
                    <th style={TH({ textAlign: 'right', width: 110, whiteSpace: 'nowrap' })}>Unit Price</th>
                    <th style={TH({ textAlign: 'right', width: 120, whiteSpace: 'nowrap' })}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(c.items ?? []).map((item, i) => {
                    // Descriptions may carry a "[PROJECT-CODE] " prefix and an
                    // optional " — detail" tail; split them for readability.
                    const codeMatch = item.description?.match(/^\[([^\]]+)\]/)
                    const rawDesc   = codeMatch ? item.description.slice(codeMatch[0].length).trim() : (item.description ?? '')
                    const split     = rawDesc.match(/^([^—\n]+?)(?:\s*—\s*|\n)([\s\S]*)$/)
                    const title     = split ? split[1].trim() : rawDesc
                    const detail    = split ? split[2].trim() : ''
                    return (
                      <tr key={i}>
                        <td style={TD()}>
                          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: '#0f172a', lineHeight: 1.4 }}>{title || '—'}</p>
                          {detail && <p style={{ margin: '3px 0 0', fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>{detail}</p>}
                        </td>
                        <td style={TD({ textAlign: 'center', color: '#64748b' })}>{item.quantity}</td>
                        <td style={TD({ textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' })}><Sym />&nbsp;{money(item.rate)}</td>
                        <td style={TD({ textAlign: 'right', fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap' })}>
                          <Sym />&nbsp;{money((Number(item.quantity) || 0) * (Number(item.rate) || 0))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Per-invoice totals */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 14px', background: '#fbfdff' }}>
                <div style={{ width: 260 }}>
                  {[
                    { label: 'Sub Total', v: c.subtotal, show: true,             color: '#334155', prefix: '' },
                    { label: 'Discount',  v: c.discount, show: c.discount > 0,   color: '#ef4444', prefix: '−' },
                    { label: `MFS Charge (${c.taxRate ?? 0}%)`, v: c.taxAmount, show: c.taxAmount > 0, color: '#334155', prefix: '' },
                  ].filter(r => r.show).map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                      <span style={{ fontSize: 11, color: '#64748b' }}>{r.label}</span>
                      <span style={{ fontSize: 11, color: r.color, fontWeight: 500 }}>{r.prefix}<Sym />&nbsp;{money(r.v)}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderTop: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>Invoice Total</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}><Sym />&nbsp;{money(c.total)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                    <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 500 }}>Paid</span>
                    <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 500 }}>−<Sym />&nbsp;{money(c.paidAmount)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderTop: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: c.due > 0.01 ? '#dc2626' : '#16a34a' }}>Due</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: c.due > 0.01 ? '#dc2626' : '#16a34a' }}><Sym />&nbsp;{money(c.due)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── GRAND TOTAL ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div style={{ width: 300 }}>
          <div style={{ height: 2, background: '#0f172a', marginBottom: 0 }} />
          {[
            { label: 'Combined Sub Total', v: t.subtotal,  show: true,             color: '#334155', prefix: '' },
            { label: 'Total Discount',     v: t.discount,  show: t.discount > 0,   color: '#ef4444', prefix: '−' },
            { label: 'Total MFS Charge',   v: t.taxAmount, show: t.taxAmount > 0,  color: '#334155', prefix: '' },
          ].filter(r => r.show).map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>{r.label}</span>
              <span style={{ fontSize: 12, color: r.color, fontWeight: 500 }}>{r.prefix}<Sym />&nbsp;{money(r.v)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Total Payable</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}><Sym />&nbsp;{money(t.total)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>Total Paid</span>
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>−<Sym />&nbsp;{money(t.paidAmount)}</span>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', padding: '9px 16px',
            marginTop: 3, marginLeft: -16, marginRight: -16, borderRadius: 8,
            background: t.due > 0.01 ? '#fef2f2' : '#f0fdf4',
          }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: t.due > 0.01 ? '#dc2626' : '#16a34a' }}>Total Due</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: t.due > 0.01 ? '#dc2626' : '#16a34a' }}><Sym />&nbsp;{money(t.due)}</span>
          </div>
        </div>
      </div>

      {/* ── PAYMENTS RECEIVED ── */}
      {(combined.payments?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>
            Payments Received
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH({ textAlign: 'left',   paddingLeft: 0, borderTop: '2px solid #0f172a' })}>Date</th>
                <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a' })}>Gateway / Method</th>
                <th style={TH({ textAlign: 'center', borderTop: '2px solid #0f172a' })}>Reference</th>
                <th style={TH({ textAlign: 'right',  paddingRight: 0, borderTop: '2px solid #0f172a' })}>Paid Amount</th>
              </tr>
            </thead>
            <tbody>
              {combined.payments.map(p => (
                <tr key={p.id}>
                  <td style={TD({ paddingLeft: 0 })}>{fmtDate(p.paymentDate ?? p.createdAt)}</td>
                  <td style={TD()}>{(p.paymentMethod ?? '—').replace(/_/g, ' ')}</td>
                  <td style={TD({ textAlign: 'center', fontFamily: 'monospace', fontSize: 11 })}>{p.txnId ?? p.reference ?? '—'}</td>
                  <td style={TD({ textAlign: 'right', paddingRight: 0, color: '#16a34a', fontWeight: 600 })}><Sym />&nbsp;{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── NOTES / TERMS ── */}
      {(combined.notes || combined.terms) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {combined.notes && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Notes</p>
              <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.7 }}>{combined.notes}</p>
            </div>
          )}
          {combined.terms && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Payment Terms</p>
              <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.7 }}>{combined.terms}</p>
            </div>
          )}
        </div>
      )}

      {/* ── SYSTEM NOTE ── */}
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16, marginBottom: 20, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.8 }}>
          This combined invoice consolidates the {children.length} invoice{children.length === 1 ? '' : 's'} listed above and
          reflects their current balances. It is system generated — no signature is required.
        </p>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, textAlign: 'center' }}>
        <p style={{ margin: '0 0 3px', fontSize: 11, color: '#94a3b8' }}>
          Generated on {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} –{' '}
          {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </p>
        {company.name && (
          <p style={{ margin: 0, fontSize: 10, color: '#cbd5e1', letterSpacing: '0.04em' }}>{company.name}</p>
        )}
      </div>
    </div>
  )
}
