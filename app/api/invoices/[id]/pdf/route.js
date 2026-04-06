export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, Payment } from '@/models'

function formatCurrency(amount, currency = 'BDT') {
  const n = amount ?? 0
  if (!currency || currency === 'BDT') {
    return `৳ ${new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n)
}

function formatDate(date) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// GET /api/invoices/[id]/pdf — returns printable HTML
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const invoice = await Invoice.findById(params.id)
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email phone' } })
      .populate({ path: 'projectId', select: 'name' })

    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [items, payments] = await Promise.all([
      Promise.resolve(Array.isArray(invoice.toJSON().items) ? invoice.toJSON().items : []),
      Payment.find({ invoiceId: params.id }).sort({ createdAt: -1 }),
    ])

    const inv          = invoice.toJSON()
    const client       = inv.clientId
    const companyName    = 'En-Tech Agency'
    const companyAddress = '123 Business Ave, Suite 100, New York, NY 10001'
    const companyEmail   = 'billing@en-tech.agency'
    const companyPhone   = '+1 (555) 000-0000'

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Invoice ${inv.invoiceNumber}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; background: #fff; font-size: 14px; line-height: 1.5; }
  .page { max-width: 800px; margin: 0 auto; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 3px solid #4f46e5; padding-bottom: 24px; }
  .company-name { font-size: 28px; font-weight: 700; color: #4f46e5; }
  .company-info { font-size: 12px; color: #6b7280; margin-top: 6px; }
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
  .billing-section { display: flex; justify-content: space-between; margin-bottom: 36px; }
  .billing-block h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 10px; }
  .billing-block .name { font-size: 16px; font-weight: 600; color: #111827; }
  .billing-block .info { font-size: 13px; color: #6b7280; margin-top: 4px; }
  .dates-block { text-align: right; }
  .dates-block .date-row { display: flex; justify-content: flex-end; gap: 20px; margin-bottom: 6px; }
  .dates-block .label { font-size: 12px; color: #9ca3af; }
  .dates-block .value { font-size: 13px; font-weight: 500; color: #111827; min-width: 120px; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead th { background: #4f46e5; color: #fff; padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  thead th:last-child { text-align: right; }
  thead th:nth-child(2), thead th:nth-child(3) { text-align: right; }
  tbody td { padding: 12px 16px; border-bottom: 1px solid #f3f4f6; color: #374151; }
  tbody td:nth-child(2), tbody td:nth-child(3), tbody td:last-child { text-align: right; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: #f9fafb; }
  .totals-section { display: flex; justify-content: flex-end; margin-bottom: 36px; }
  .totals-table { width: 280px; }
  .totals-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
  .totals-row.final { border-top: 2px solid #4f46e5; border-bottom: none; padding-top: 12px; margin-top: 4px; }
  .totals-row .label { color: #6b7280; font-size: 13px; }
  .totals-row .amount { font-weight: 500; color: #111827; }
  .totals-row.final .label { font-size: 16px; font-weight: 700; color: #111827; }
  .totals-row.final .amount { font-size: 18px; font-weight: 700; color: #4f46e5; }
  .balance-due { background: #eef2ff; border-radius: 8px; padding: 16px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; }
  .balance-due .label { color: #4f46e5; font-weight: 600; }
  .balance-due .amount { color: #4f46e5; font-size: 20px; font-weight: 700; }
  .notes-section { background: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 32px; }
  .notes-section h3 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 10px; }
  .notes-section p { color: #374151; font-size: 13px; line-height: 1.6; }
  .payment-section { margin-bottom: 32px; }
  .payment-section h3 { font-size: 14px; font-weight: 600; color: #111827; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
  .payment-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
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
      <div class="company-name">${companyName}</div>
      <div class="company-info">${companyAddress}<br>${companyEmail} | ${companyPhone}</div>
    </div>
    <div class="invoice-meta">
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-number">#${inv.invoiceNumber}</div>
      <span class="status-badge status-${inv.status}">${inv.status.replace('_', ' ')}</span>
    </div>
  </div>

  <div class="billing-section">
    <div class="billing-block">
      <h3>Bill To</h3>
      <div class="name">${client?.userId?.name ?? 'Client'}</div>
      ${client?.company ? `<div class="info">${client.company}</div>` : ''}
      ${client?.userId?.email ? `<div class="info">${client.userId.email}</div>` : ''}
      ${client?.address ? `<div class="info">${client.address}</div>` : ''}
    </div>
    <div class="billing-block dates-block">
      <h3>Invoice Details</h3>
      <div class="date-row"><span class="label">Issue Date</span><span class="value">${formatDate(inv.issueDate)}</span></div>
      <div class="date-row"><span class="label">Due Date</span><span class="value">${formatDate(inv.dueDate)}</span></div>
      ${inv.projectId ? `<div class="date-row"><span class="label">Project</span><span class="value">${inv.projectId.name}</span></div>` : ''}
      <div class="date-row"><span class="label">Currency</span><span class="value">${inv.currency}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:50%">Description</th>
        <th style="width:15%">Qty</th>
        <th style="width:17.5%">Rate</th>
        <th style="width:17.5%">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(item => `
      <tr>
        <td>${item.description}</td>
        <td>${item.quantity}</td>
        <td>${formatCurrency(item.rate, inv.currency)}</td>
        <td>${formatCurrency(item.amount, inv.currency)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals-section">
    <div class="totals-table">
      <div class="totals-row"><span class="label">Subtotal</span><span class="amount">${formatCurrency(inv.subtotal, inv.currency)}</span></div>
      ${inv.taxRate > 0 ? `<div class="totals-row"><span class="label">Tax (${inv.taxRate}%)</span><span class="amount">${formatCurrency(inv.taxAmount, inv.currency)}</span></div>` : ''}
      ${inv.discount > 0 ? `<div class="totals-row"><span class="label">Discount</span><span class="amount">-${formatCurrency(inv.discount, inv.currency)}</span></div>` : ''}
      <div class="totals-row final"><span class="label">Total</span><span class="amount">${formatCurrency(inv.total, inv.currency)}</span></div>
      ${inv.paidAmount > 0 ? `<div class="totals-row"><span class="label">Amount Paid</span><span class="amount">${formatCurrency(inv.paidAmount, inv.currency)}</span></div>` : ''}
    </div>
  </div>

  ${inv.total - inv.paidAmount > 0 ? `
  <div class="balance-due" style="margin-bottom:32px">
    <span class="label">Balance Due</span>
    <span class="amount">${formatCurrency(inv.total - inv.paidAmount, inv.currency)}</span>
  </div>` : ''}

  ${payments.length > 0 ? `
  <div class="payment-section">
    <h3>Payment History</h3>
    ${payments.map(p => `
    <div class="payment-row">
      <span>${formatDate(p.paidAt)} — ${p.method}${p.reference ? ` (Ref: ${p.reference})` : ''}</span>
      <span style="font-weight:600;color:#065f46">${formatCurrency(p.amount, inv.currency)}</span>
    </div>`).join('')}
  </div>` : ''}

  ${inv.notes ? `
  <div class="notes-section">
    <h3>Notes</h3>
    <p>${inv.notes}</p>
  </div>` : ''}

  <div class="notes-section" style="margin-bottom:32px">
    <h3>Payment Instructions</h3>
    <p>Please transfer the amount to the following account:<br>
    Bank: First National Bank | Account: 0012-3456-789 | Routing: 021000021<br>
    Reference your invoice number <strong>${inv.invoiceNumber}</strong> when making payment.</p>
  </div>

  <div class="footer">
    <p>Thank you for your business! Questions? Contact us at ${companyEmail}</p>
    <p style="margin-top:8px">Generated on ${formatDate(new Date())} | ${companyName}</p>
  </div>
</div>
<script>window.onload = () => window.print()</script>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="invoice-${inv.invoiceNumber}.html"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/invoices/[id]/pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
