export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { computeBatchRef } from '@/lib/expensePayment'

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

function payeeOf(e) {
  return (
    e.freelancerId?.userId?.name ??
    e.agencyId?.userId?.name ??
    e.vendorId?.companyName ?? e.vendorId?.name ??
    e.paidToEmployeeId?.userId?.name ??
    e.paidToName ?? '—'
  )
}

// GET /api/expenses/combined-voucher?ids=a,b,c
// Printable, multi-page A4 "Expense Invoice" listing every selected expense as a
// line item — same layout blueprint as the client invoice PDF. Header table
// repeats per page and rows never split across a page break.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    await connectDB()

    const idsParam = new URL(request.url).searchParams.get('ids') ?? ''
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length === 0) return NextResponse.json({ error: 'No expenses selected' }, { status: 422 })

    const rows = await ProjectExpense.find({ _id: { $in: ids } })
      .sort({ date: 1, createdAt: 1 })
      .populate({ path: 'freelancerId',     populate: { path: 'userId', select: 'name' } })
      .populate({ path: 'agencyId',         populate: { path: 'userId', select: 'name' } })
      .populate({ path: 'vendorId',         select: 'name companyName' })
      .populate({ path: 'paidToEmployeeId', populate: { path: 'userId', select: 'name' } })
      .populate({ path: 'projectId',        select: 'name projectCode' })
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const list      = rows.map(r => r.toJSON())
    const batchRef  = computeBatchRef(list)
    const currencies = [...new Set(list.map(e => e.currency ?? 'BDT'))]
    const mixed      = currencies.length > 1
    const totalBDT   = list.reduce((s, e) => s + (e.amountBDT ?? e.amount ?? 0), 0)
    const dates      = [...new Set(list.map(e => formatDate(e.date)))]
    const categories = [...new Set(list.map(e => e.category || '—'))]

    const companyName    = 'En-Tech Agency'
    const companyAddress = '123 Business Ave, Suite 100, New York, NY 10001'
    const companyEmail   = 'billing@en-tech.agency'
    const companyPhone   = '+1 (555) 000-0000'

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Combined Expense Invoice ${batchRef}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; background: #fff; font-size: 14px; line-height: 1.5; }
  .page { max-width: 800px; margin: 0 auto; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; border-bottom: 3px solid #4f46e5; padding-bottom: 24px; }
  .company-name { font-size: 28px; font-weight: 700; color: #4f46e5; }
  .company-info { font-size: 12px; color: #6b7280; margin-top: 6px; }
  .invoice-meta { text-align: right; }
  .invoice-title { font-size: 26px; font-weight: 700; color: #4f46e5; letter-spacing: 2px; }
  .invoice-number { font-size: 14px; color: #6b7280; margin-top: 4px; }
  .status-badge { display: inline-block; padding: 3px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; background: #eef2ff; color: #4f46e5; }
  .billing-section { display: flex; justify-content: space-between; margin-bottom: 36px; }
  .billing-block h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 10px; }
  .billing-block .name { font-size: 16px; font-weight: 600; color: #111827; }
  .billing-block .info { font-size: 13px; color: #6b7280; margin-top: 4px; }
  .dates-block { text-align: right; }
  .dates-block .date-row { display: flex; justify-content: flex-end; gap: 20px; margin-bottom: 6px; }
  .dates-block .label { font-size: 12px; color: #9ca3af; }
  .dates-block .value { font-size: 13px; font-weight: 500; color: #111827; min-width: 140px; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead { display: table-header-group; }
  thead th { background: #4f46e5; color: #fff; padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  thead th:last-child { text-align: right; }
  tbody tr { break-inside: avoid; page-break-inside: avoid; }
  tbody td { padding: 12px 16px; border-bottom: 1px solid #f3f4f6; color: #374151; font-size: 13px; }
  tbody td:last-child { text-align: right; font-weight: 600; }
  tbody tr:hover { background: #f9fafb; }
  .totals-section { display: flex; justify-content: flex-end; margin-bottom: 36px; break-inside: avoid; }
  .totals-table { width: 300px; }
  .totals-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6; }
  .totals-row.final { border-top: 2px solid #4f46e5; border-bottom: none; padding-top: 12px; margin-top: 4px; }
  .totals-row .label { color: #6b7280; font-size: 13px; }
  .totals-row .amount { font-weight: 500; color: #111827; }
  .totals-row.final .label { font-size: 16px; font-weight: 700; color: #111827; }
  .totals-row.final .amount { font-size: 18px; font-weight: 700; color: #4f46e5; }
  .notes-section { background: #f9fafb; border-radius: 8px; padding: 16px 20px; margin-bottom: 28px; break-inside: avoid; }
  .notes-section h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 8px; }
  .notes-section p { color: #374151; font-size: 13px; line-height: 1.6; }
  .signatures { display: flex; justify-content: space-between; gap: 24px; margin-top: 56px; break-inside: avoid; }
  .sign-block { flex: 1; text-align: center; }
  .sign-line { border-top: 1px solid #374151; margin: 0 8px 6px; padding-top: 6px; }
  .sign-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .seal-box { margin-top: 36px; border: 1px dashed #9ca3af; border-radius: 8px; height: 96px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; break-inside: avoid; }
  .footer { text-align: center; padding-top: 24px; margin-top: 32px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .page { padding: 20px; max-width: none; }
  }
  @page { size: A4; margin: 12mm; }
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
      <div class="invoice-title">EXPENSE INVOICE</div>
      <div class="invoice-number">#${batchRef}</div>
      <span class="status-badge">Combined · ${list.length} item${list.length > 1 ? 's' : ''}</span>
    </div>
  </div>

  <div class="billing-section">
    <div class="billing-block">
      <h3>Expense Summary</h3>
      <div class="name">${categories.length === 1 ? categories[0] : 'Multiple categories'}</div>
      <div class="info">${list.length} approved expense${list.length > 1 ? 's' : ''}</div>
    </div>
    <div class="billing-block dates-block">
      <h3>Invoice Details</h3>
      <div class="date-row"><span class="label">Reference</span><span class="value">${batchRef}</span></div>
      <div class="date-row"><span class="label">${dates.length === 1 ? 'Date' : 'Date range'}</span><span class="value">${dates.length === 1 ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}`}</span></div>
      <div class="date-row"><span class="label">Issued</span><span class="value">${formatDate(new Date())}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:14%">Date</th>
        <th style="width:40%">Description</th>
        <th style="width:26%">Paid To</th>
        <th style="width:20%">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${list.map(e => `
      <tr>
        <td>${formatDate(e.date)}</td>
        <td>${e.title}${e.projectId?.name ? `<br><span style="color:#9ca3af;font-size:11px">${e.projectId.name}</span>` : ''}${e.subcategory ? `<br><span style="color:#9ca3af;font-size:11px">${e.category} / ${e.subcategory}</span>` : ''}</td>
        <td>${payeeOf(e)}</td>
        <td>${formatCurrency(e.amount, e.currency)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals-section">
    <div class="totals-table">
      <div class="totals-row"><span class="label">Items</span><span class="amount">${list.length}</span></div>
      ${mixed ? `<div class="totals-row"><span class="label">Currencies</span><span class="amount">${currencies.join(', ')}</span></div>` : ''}
      <div class="totals-row final"><span class="label">Total (BDT)</span><span class="amount">${formatCurrency(totalBDT, 'BDT')}</span></div>
    </div>
  </div>

  ${mixed ? `<div class="notes-section"><h3>Note</h3><p>This combined invoice includes expenses in multiple currencies. The total shown is the BDT-equivalent of the actual amounts spent.</p></div>` : ''}

  <div class="signatures">
    <div class="sign-block"><div class="sign-line"></div><div class="sign-label">Prepared By</div></div>
    <div class="sign-block"><div class="sign-line"></div><div class="sign-label">Approved By / Account Manager</div></div>
    <div class="sign-block"><div class="sign-line"></div><div class="sign-label">Authorised Signatory</div></div>
  </div>

  <div class="seal-box">Company Seal</div>

  <div class="footer">
    <p>Official combined expense record — reference ${batchRef} | Generated on ${formatDate(new Date())} | ${companyName}</p>
  </div>
</div>
<script>window.onload = () => window.print()</script>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="combined-expense-${batchRef}.html"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/expenses/combined-voucher]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
