export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import crypto from 'crypto'
import { Invoice, Payment, ProjectPayment, Setting } from '@/models'
import { getMyCompanyIds } from '@/lib/clientAccess'
import { escapeHtml } from '@/lib/html'
import { BENGALI_FONT_CSS } from '@/lib/printFonts'
import { isValidObjectId } from '@/lib/objectId'
import { isVatInvoice, taxableValueOf, invoiceVatLabel } from '@/lib/invoiceTotals'
import { paymentSettlement, paymentMethodLabel, settlementParts } from '@/lib/paymentSettlement'
import { BIN_REGEX } from '@/lib/tax/catalog'

function formatCurrency(amount, currency = 'BDT') {
  const n = Number(amount) || 0
  if (!currency || currency === 'BDT') {
    return `৳ ${new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
  }
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
  } catch {
    return `${escapeHtml(currency)} ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
  }
}

function formatDate(date) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Dhaka' })
}

/** Buyer BIN: issue-time snapshot → client BIN → legacy VAT number shaped like a BIN (masked values are skipped). */
function buyerBinOf(inv) {
  const client = inv.clientId && typeof inv.clientId === 'object' ? inv.clientId : null
  if (inv.buyer?.bin) return inv.buyer.bin
  if (client?.bin && !String(client.bin).includes('••')) return client.bin
  const legacy = client?.vatNumber ? String(client.vatNumber).replace(/\s/g, '') : ''
  return legacy && BIN_REGEX.test(legacy) ? client.vatNumber : null
}

// GET /api/client/invoices/[id]/pdf — returns printable HTML for the client
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const clientIds = await getMyCompanyIds(session.user.id)
    if (!clientIds.length) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const invoice = await Invoice.findOne({ _id: params.id, clientId: { $in: clientIds }, status: { $ne: 'DRAFT' } })
      .populate({ path: 'clientId', select: 'company address city country bin vatNumber userId', populate: { path: 'userId', select: 'name email' } })
      // Never name a project of another company (old mismatched invoices).
      .populate({ path: 'projectId', select: 'name', match: { clientId: { $in: clientIds } } })

    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Payment history: confirmed ProjectPayments (the main flow) plus any
    // legacy Payment rows, newest first. Company letterhead from Settings.
    const [projectPayments, legacyPayments, settingsDocs] = await Promise.all([
      ProjectPayment.find({ invoiceId: params.id, status: 'CONFIRMED' }).sort({ paymentDate: -1 }).lean(),
      Payment.find({ invoiceId: params.id }).sort({ createdAt: -1 }).lean(),
      Setting.find({ group: 'company' }).lean(),
    ])
    // Each row shows what it SETTLED (cash + VDS + TDS withheld at source), so
    // the rows add up to "Amount paid / settled" (same as the staff print).
    const payments = [
      ...projectPayments.map(p => ({
        date: p.paymentDate ?? p.confirmedAt ?? p.createdAt,
        method: paymentMethodLabel(p.paymentMethod),
        reference: null,
        ...paymentSettlement(p),
      })),
      ...legacyPayments.map(p => ({
        date: p.paidAt ?? p.createdAt,
        method: paymentMethodLabel(p.method),
        reference: p.reference,
        ...paymentSettlement({ amount: p.amount }),
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date))

    const cfg = {}
    settingsDocs.forEach(d => { cfg[d.key] = d.value })

    const inv  = invoice.toJSON()
    const html = renderInvoiceHtml({ inv, payments, cfg, nonce: crypto.randomBytes(16).toString('base64') })

    return new Response(html.body, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="invoice-${String(inv.invoiceNumber ?? '').replace(/[^A-Za-z0-9_-]/g, '')}.html"`,
        // Only our own nonce'd print script may run in this document.
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'nonce-${html.nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
      },
    })
  } catch (err) {
    console.error('[GET /api/client/invoices/:id/pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function renderInvoiceHtml({ inv, payments, cfg, nonce }) {
  const e        = escapeHtml
  const cur      = inv.currency ?? 'BDT'
  const items    = Array.isArray(inv.items) ? inv.items : []
  const client   = inv.clientId && typeof inv.clientId === 'object' ? inv.clientId : null
  const company  = {
    name:    cfg.company_name    || inv.seller?.name    || '',
    address: cfg.company_address || inv.seller?.address || '',
    phone:   cfg.company_phone   || '',
    email:   cfg.company_email   || '',
    website: cfg.company_website || '',
    bin:     inv.seller?.bin || cfg.company_bin || '',
    tin:     cfg.company_tin || '',
  }

  const subtotal   = Number(inv.subtotal)   || 0
  const discount   = Number(inv.discount)   || 0
  const taxRate    = Number(inv.taxRate)    || 0
  const taxAmount  = Number(inv.taxAmount)  || 0
  const total      = Number(inv.total)      || 0
  const paidAmount = Number(inv.paidAmount) || 0
  const balance    = Math.max(0, Math.round((total - paidAmount) * 100) / 100)

  const showVat    = isVatInvoice(inv)
  const vatAmount  = Number(inv.vatAmount) || 0
  const sdAmount   = Number(inv.sdAmount)  || 0
  const showSdCol  = showVat && (sdAmount > 0 || items.some(i => (Number(i?.sdAmount) || 0) > 0))
  const buyerBin   = buyerBinOf(inv)

  const withheldVds = Number(inv.withheldVds)    || 0
  const withheldTds = Number(inv.withheldTds)    || 0
  const credited    = Number(inv.creditedAmount) || 0
  // Debit notes (Mushak-6.8) raise `total` by their gross amount (value + VAT +
  // SD) but leave subtotal / VAT as invoiced — a row explains the difference.
  const debited     = Number(inv.debitedAmount)  || 0
  const hasBreakdown = withheldVds + withheldTds + credited > 0.005
  const cashReceived = Math.max(0, paidAmount - withheldVds - withheldTds - credited)

  const contact = [company.address, [company.email, company.phone].filter(Boolean).join(' | '), company.website]
    .filter(Boolean).map(e).join('<br>')
  const ids = [company.bin && `BIN: ${e(company.bin)}`, company.tin && `TIN: ${e(company.tin)}`].filter(Boolean).join(' &nbsp;·&nbsp; ')

  const row = (label, value, cls = '') => `<div class="totals-row ${cls}"><span class="label">${label}</span><span class="amount">${value}</span></div>`
  // "Cash … · VDS … · TDS …" line under a payment row that had tax withheld.
  const breakdown = (p) => p.hasWithholding
    ? `<div class="payment-sub">${settlementParts(p).map(([k, v]) => `${k} ${formatCurrency(v, cur)}`).join(' · ')}</div>`
    : ''

  const body = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Invoice ${e(inv.invoiceNumber)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  ${BENGALI_FONT_CSS}
  body { font-family: 'Segoe UI', Arial, var(--font-bengali), sans-serif; color: #1a1a2e; background: #fff; font-size: 14px; line-height: 1.5; }
  .page { max-width: 800px; margin: 0 auto; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 3px solid #4f46e5; padding-bottom: 24px; }
  .company-name { font-size: 28px; font-weight: 700; color: #4f46e5; }
  .company-info { font-size: 12px; color: #6b7280; margin-top: 6px; }
  .company-ids { font-size: 12px; color: #374151; font-weight: 600; margin-top: 4px; }
  .invoice-meta { text-align: right; }
  .invoice-title { font-size: 32px; font-weight: 700; color: #4f46e5; letter-spacing: 2px; }
  .invoice-number { font-size: 14px; color: #6b7280; margin-top: 4px; }
  .status-badge { display: inline-block; padding: 3px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; }
  .status-DRAFT { background: #f3f4f6; color: #6b7280; }
  .status-SENT { background: #dbeafe; color: #1d4ed8; }
  .status-PAID { background: #d1fae5; color: #065f46; }
  .status-PARTIALLY_PAID { background: #fef3c7; color: #92400e; }
  .status-OVERDUE { background: #fee2e2; color: #991b1b; }
  .status-CANCELLED { background: #f3f4f6; color: #6b7280; }
  .billing-section { display: flex; justify-content: space-between; margin-bottom: 36px; gap: 24px; }
  .billing-block h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 10px; }
  .billing-block .name { font-size: 16px; font-weight: 600; color: #111827; }
  .billing-block .info { font-size: 13px; color: #6b7280; margin-top: 4px; }
  .billing-block .ids { font-size: 13px; color: #374151; font-weight: 600; margin-top: 4px; }
  .dates-block { text-align: right; }
  .dates-block .date-row { display: flex; justify-content: flex-end; gap: 20px; margin-bottom: 6px; }
  .dates-block .label { font-size: 12px; color: #9ca3af; }
  .dates-block .value { font-size: 13px; font-weight: 500; color: #111827; min-width: 120px; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #4f46e5; color: #fff; padding: 12px 12px; text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  tbody td { padding: 12px 12px; border-bottom: 1px solid #f3f4f6; color: #374151; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  th.ctr, td.ctr { text-align: center; white-space: nowrap; }
  td .unit { font-size: 11px; color: #9ca3af; }
  tbody tr:last-child td { border-bottom: none; }
  .totals-section { display: flex; justify-content: flex-end; margin-bottom: 36px; }
  .totals-table { width: 300px; }
  .totals-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
  .totals-row.final { border-top: 2px solid #4f46e5; border-bottom: none; padding-top: 12px; margin-top: 4px; }
  .totals-row.sub { padding: 3px 0 3px 10px; border-bottom: none; }
  .totals-row.sub .label, .totals-row.sub .amount { font-size: 12px; color: #6b7280; font-weight: 400; }
  .totals-row .label { color: #6b7280; font-size: 13px; }
  .totals-row .amount { font-weight: 500; color: #111827; }
  .totals-row.final .label { font-size: 16px; font-weight: 700; color: #111827; }
  .totals-row.final .amount { font-size: 18px; font-weight: 700; color: #4f46e5; }
  .balance-due { background: #eef2ff; border-radius: 8px; padding: 16px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; }
  .balance-due .label { color: #4f46e5; font-weight: 600; }
  .balance-due .amount { color: #4f46e5; font-size: 20px; font-weight: 700; }
  .notes-section { background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 32px; }
  .notes-section h3 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 10px; }
  .notes-section p { color: #374151; font-size: 13px; line-height: 1.6; white-space: pre-line; }
  .payment-section { margin-bottom: 32px; }
  .payment-section h3 { font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
  .payment-item { border-bottom: 1px solid #f3f4f6; }
  .payment-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 13px; }
  .payment-sub { font-size: 12px; color: #6b7280; padding: 0 0 8px; margin-top: -4px; }
  .footer { text-align: center; padding-top: 24px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .page { padding: 20px; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      ${company.name ? `<div class="company-name">${e(company.name)}</div>` : ''}
      ${contact ? `<div class="company-info">${contact}</div>` : ''}
      ${ids ? `<div class="company-ids">${ids}</div>` : ''}
    </div>
    <div class="invoice-meta">
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-number">#${e(inv.invoiceNumber)}</div>
      <span class="status-badge status-${e(inv.status)}">${e(String(inv.status ?? '').replace(/_/g, ' '))}</span>
    </div>
  </div>

  <div class="billing-section">
    <div class="billing-block">
      <h3>Bill To</h3>
      <div class="name">${e(client?.company || client?.userId?.name || 'Client')}</div>
      ${client?.company && client?.userId?.name ? `<div class="info">${e(client.userId.name)}</div>` : ''}
      ${client?.userId?.email ? `<div class="info">${e(client.userId.email)}</div>` : ''}
      ${client?.address || client?.city || client?.country
        ? `<div class="info">${e([client.address, client.city, client.country].filter(Boolean).join(', '))}</div>` : ''}
      ${buyerBin ? `<div class="ids">BIN: ${e(buyerBin)}</div>` : ''}
      ${showVat && inv.deliveryDestination ? `<div class="info">Delivery destination: ${e(inv.deliveryDestination)}</div>` : ''}
    </div>
    <div class="billing-block dates-block">
      <h3>Invoice Details</h3>
      <div class="date-row"><span class="label">Issue Date</span><span class="value">${formatDate(inv.issueDate)}</span></div>
      <div class="date-row"><span class="label">Due Date</span><span class="value">${formatDate(inv.dueDate)}</span></div>
      ${inv.projectId?.name ? `<div class="date-row"><span class="label">Project</span><span class="value">${e(inv.projectId.name)}</span></div>` : ''}
      <div class="date-row"><span class="label">Currency</span><span class="value">${e(cur)}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="ctr">Qty</th>
        <th class="num">Rate</th>
        <th class="num">Amount</th>
        ${showSdCol ? '<th class="num">SD</th>' : ''}
        ${showVat ? '<th class="ctr">VAT %</th><th class="num">VAT</th>' : ''}
      </tr>
    </thead>
    <tbody>
      ${items.map(item => `
      <tr>
        <td>${e(item.description)}</td>
        <td class="ctr">${e(item.quantity)}${item.unit ? ` <span class="unit">${e(item.unit)}</span>` : ''}</td>
        <td class="num">${formatCurrency(item.rate, cur)}</td>
        <td class="num">${formatCurrency(item.amount ?? (Number(item.quantity) || 0) * (Number(item.rate) || 0), cur)}</td>
        ${showSdCol ? `<td class="num">${(Number(item.sdAmount) || 0) > 0 ? formatCurrency(item.sdAmount, cur) : '—'}</td>` : ''}
        ${showVat ? `<td class="ctr">${e(Number(item.vatRate) || 0)}%</td><td class="num">${formatCurrency(item.vatAmount, cur)}</td>` : ''}
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals-section">
    <div class="totals-table">
      ${row('Subtotal', formatCurrency(subtotal, cur))}
      ${discount > 0 ? row('Discount', `-${formatCurrency(discount, cur)}`) : ''}
      ${showVat ? row('Taxable value', formatCurrency(taxableValueOf(inv), cur)) : ''}
      ${showVat && sdAmount > 0 ? row('SD', formatCurrency(sdAmount, cur)) : ''}
      ${showVat ? row(e(invoiceVatLabel(inv)), formatCurrency(vatAmount, cur)) : ''}
      ${taxAmount > 0 ? row(`MFS Charge (${e(taxRate)}%)`, formatCurrency(taxAmount, cur)) : ''}
      ${debited > 0 ? row(showVat ? 'Debit notes (Mushak-6.8, incl. VAT)' : 'Debit notes', `+${formatCurrency(debited, cur)}`) : ''}
      ${row('Total', formatCurrency(total, cur), 'final')}
      ${paidAmount > 0 ? row(hasBreakdown ? 'Amount paid / settled' : 'Amount Paid', formatCurrency(paidAmount, cur)) : ''}
      ${hasBreakdown ? [
        row('Received', formatCurrency(cashReceived, cur), 'sub'),
        withheldVds > 0 ? row('VAT deducted at source (VDS)', formatCurrency(withheldVds, cur), 'sub') : '',
        withheldTds > 0 ? row('Income tax deducted (TDS/AIT)', formatCurrency(withheldTds, cur), 'sub') : '',
        credited > 0 ? row('Credit notes', formatCurrency(credited, cur), 'sub') : '',
      ].join('') : ''}
    </div>
  </div>

  ${balance > 0 ? `
  <div class="balance-due" style="margin-bottom:32px">
    <span class="label">Balance Due</span>
    <span class="amount">${formatCurrency(balance, cur)}</span>
  </div>` : ''}

  ${payments.length > 0 ? `
  <div class="payment-section">
    <h3>Payment History</h3>
    ${payments.map(p => `
    <div class="payment-item">
    <div class="payment-row">
      <span>${formatDate(p.date)} — ${e(p.method)}${p.reference ? ` (Ref: ${e(p.reference)})` : ''}</span>
      <span style="font-weight:600;color:#065f46">${formatCurrency(p.settled, cur)}</span>
    </div>${breakdown(p)}
    </div>`).join('')}
  </div>` : ''}

  ${inv.notes ? `
  <div class="notes-section">
    <h3>Notes</h3>
    <p>${e(inv.notes)}</p>
  </div>` : ''}

  ${inv.terms ? `
  <div class="notes-section">
    <h3>Payment Terms</h3>
    <p>${e(inv.terms)}</p>
  </div>` : ''}

  ${balance > 0 ? `
  <div class="notes-section" style="margin-bottom:32px">
    <h3>Payment Reference</h3>
    <p>Please quote invoice number <strong>${e(inv.invoiceNumber)}</strong> with your payment.</p>
  </div>` : ''}

  <div class="footer">
    ${company.email ? `<p>Thank you for your business! Questions? Contact us at ${e(company.email)}</p>` : '<p>Thank you for your business!</p>'}
    <p style="margin-top:8px">Generated on ${formatDate(new Date())}${company.name ? ` | ${e(company.name)}` : ''}</p>
  </div>
</div>
<script nonce="${nonce}">window.onload = () => window.print()</script>
</body>
</html>`

  return { body, nonce }
}
