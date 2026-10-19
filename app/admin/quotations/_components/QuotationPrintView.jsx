'use client'

import Image from 'next/image'
import { isVatQuotation, quotationTaxableValue, quotationVatLabel, quotationLineAmount } from '@/lib/quotation'
import { STATUS_STYLES } from './quotationUi'
import { BENGALI_FONT_CSS } from '@/lib/printFonts'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'
const fmtNum  = (v) => (Number(v) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })
const isMasked = (v) => typeof v === 'string' && v.includes('••')

/**
 * Print-ready quotation (also the on-screen document on the detail page).
 * Legacy (non-VAT) quotations render exactly as before; VAT quotations add the
 * seller / buyer BIN, per-line VAT % and VAT columns and the Taxable value /
 * SD / VAT totals rows. `itemPriceOnly` still hides the totals block.
 *
 *   company   { name, address, phone, email, website, bin, tin }
 */
export default function QuotationPrintView({ quotation: q, company = {}, ventures = [] }) {
  const subtotal      = Number(q.subtotal)  || 0
  const discount      = Number(q.discount)  || 0
  const taxAmount     = Number(q.taxAmount) || 0
  const total         = Number(q.total)     || 0
  const cur           = q.currency ?? 'BDT'
  const itemPriceOnly = !!q.itemPriceOnly
  const statusStyle   = STATUS_STYLES[q.status] ?? STATUS_STYLES.DRAFT

  const showVat      = isVatQuotation(q)
  const vatAmount    = Number(q.vatAmount) || 0
  const sdAmount     = Number(q.sdAmount)  || 0
  const taxableValue = quotationTaxableValue(q)
  const showSdCol    = showVat && (sdAmount > 0 || (q.items ?? []).some(i => (Number(i?.sdAmount) || 0) > 0))
  const sellerBin    = company.bin && !isMasked(company.bin) ? company.bin : null
  const sellerTin    = company.tin && !isMasked(company.tin) ? company.tin : null
  const buyerBin     = q.buyerBin && !isMasked(q.buyerBin) ? q.buyerBin : null

  const isBDT = cur === 'BDT'
  const Sym = () => isBDT
    ? <span style={{ fontFamily: 'var(--font-bengali), serif', fontSize: '1.05em', lineHeight: 1 }}>৳</span>
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
  const lastCol = showVat ? {} : { paddingRight: 0 }

  return (
    <div id="quotation-print" style={{
      fontFamily: "'Inter', 'Segoe UI', var(--font-bengali), sans-serif",
      background: '#ffffff', padding: '36px 56px',
      maxWidth: 820, minWidth: 640, margin: '0 auto',
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
          {(sellerBin || (showVat && sellerTin)) && (
            <p style={{ margin: '3px 0 0', fontSize: 11, color: '#475569', fontWeight: 600 }}>
              {[sellerBin && `BIN: ${sellerBin}`, showVat && sellerTin && `TIN: ${sellerTin}`].filter(Boolean).join('  ·  ')}
            </p>
          )}
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
        {buyerBin && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#475569', fontWeight: 600 }}>BIN: {buyerBin}</p>}
      </div>

      {/* ── ITEMS TABLE ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 0 }}>
        <thead>
          <tr>
            <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a' })}>Description</th>
            <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a' })}>Service</th>
            <th style={TH({ textAlign: 'center', borderTop: '2px solid #0f172a' })}>Qty</th>
            <th style={TH({ textAlign: 'right',  borderTop: '2px solid #0f172a', whiteSpace: 'nowrap' })}>Unit Price</th>
            <th style={TH({ textAlign: 'right',  borderTop: '2px solid #0f172a', whiteSpace: 'nowrap', ...lastCol })}>Amount</th>
            {showSdCol && <th style={TH({ textAlign: 'right', borderTop: '2px solid #0f172a', whiteSpace: 'nowrap', padding: '7px 8px' })}>SD</th>}
            {showVat && <th style={TH({ textAlign: 'center', borderTop: '2px solid #0f172a', whiteSpace: 'nowrap', padding: '7px 8px' })}>VAT %</th>}
            {showVat && <th style={TH({ textAlign: 'right', borderTop: '2px solid #0f172a', paddingRight: 0, whiteSpace: 'nowrap' })}>VAT</th>}
          </tr>
        </thead>
        <tbody>
          {(q.items ?? []).map((item, i) => (
            <tr key={i}>
              <td style={TD({})}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.4 }}>{item.description || '—'}</p>
              </td>
              <td style={TD({})}>
                {item.venture && <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 500, color: '#94a3b8', lineHeight: 1.3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{ventures.find(v => v.id === item.venture)?.label ?? item.venture}</p>}
                {item.service && <p style={{ margin: 0, fontSize: 12, color: '#475569' }}>{item.service}</p>}
                {!item.venture && !item.service && <span style={{ color: '#94a3b8' }}>—</span>}
              </td>
              <td style={TD({ textAlign: 'center', color: '#64748b' })}>{item.quantity}</td>
              <td style={TD({ textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' })}>
                <Sym />&nbsp;{Number(item.rate || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
              </td>
              <td style={TD({ textAlign: 'right', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', ...lastCol })}>
                <Sym />&nbsp;{quotationLineAmount(item).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
              </td>
              {showSdCol && (
                <td style={TD({ textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap', padding: '8px 8px' })}>
                  {(Number(item.sdAmount) || 0) > 0 ? <><Sym />&nbsp;{fmtNum(item.sdAmount)}</> : '—'}
                </td>
              )}
              {showVat && (
                <td style={TD({ textAlign: 'center', color: '#64748b', whiteSpace: 'nowrap', padding: '8px 8px' })}>
                  {Number(item.vatRate) || 0}%
                </td>
              )}
              {showVat && (
                <td style={TD({ textAlign: 'right', paddingRight: 0, color: '#334155', whiteSpace: 'nowrap' })}>
                  <Sym />&nbsp;{fmtNum(item.vatAmount)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {itemPriceOnly && showVat && (
        <p style={{ margin: '8px 0 16px', fontSize: 10.5, color: '#64748b' }}>
          Unit prices and amounts exclude VAT; VAT is charged at the rate shown on each line{discount > 0 ? ', on the value after discount' : ''}.
        </p>
      )}

      {/* ── TOTALS ── */}
      {!itemPriceOnly && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
          <div style={{ width: 280 }}>
            <div style={{ height: 2, background: '#0f172a', marginBottom: 0 }} />
            {[
              { label: 'Sub Total',     n: subtotal,     prefix: '',  show: true,                     valueColor: '#334155' },
              { label: 'Discount',      n: discount,     prefix: '−', show: discount > 0,             valueColor: '#ef4444' },
              { label: 'Taxable value', n: taxableValue, prefix: '',  show: showVat,                  valueColor: '#334155' },
              { label: 'SD',            n: sdAmount,     prefix: '',  show: showVat && sdAmount > 0,  valueColor: '#334155' },
              { label: quotationVatLabel(q), n: vatAmount, prefix: '', show: showVat,                valueColor: '#334155' },
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
              <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{showVat ? 'Total (incl. VAT)' : 'Total'}</span>
              <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}><Sym />&nbsp;{(total).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── NOTES / TERMS ── */}
      {(q.notes || q.terms) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {q.notes && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Notes</p>
              <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{q.notes}</p>
            </div>
          )}
          {q.terms && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Terms & Conditions</p>
              <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{q.terms}</p>
            </div>
          )}
        </div>
      )}

      {/* ── SYSTEM NOTE ── */}
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16, marginBottom: 20, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.8 }}>
          This is a system generated quotation. No signature is required.
          {showVat && <><br />This quotation is not a tax invoice; a VAT invoice (Mushak-6.3) is issued on billing.</>}
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

/**
 * Open #quotation-print in a print window and trigger print / save-as-PDF.
 * Returns false when the browser blocked the popup.
 */
export function openQuotationPrint(quotationNumber) {
  const el = document.getElementById('quotation-print')
  if (!el) return false
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <base href="${window.location.origin}/" />
    <title>Quotation ${quotationNumber ?? ''}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
      ${BENGALI_FONT_CSS}
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Inter','Segoe UI',var(--font-bengali),sans-serif; background:#fff; }
      #quotation-print { min-width: 0 !important; }
      @page { margin: 0; size: A4; }
    </style>
  </head><body>${el.outerHTML}</body></html>`)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print(); win.close() }, 500)
  return true
}
