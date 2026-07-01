export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense } from '@/models'
import { canDo } from '@/lib/rbac'

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

// Whole-number to English words (for the official "amount in words" line).
function numToWords(num) {
  const n = Math.floor(Math.abs(num ?? 0))
  if (n === 0) return 'Zero'
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  const below1000 = (x) => {
    let s = ''
    if (x >= 100) { s += ones[Math.floor(x / 100)] + ' Hundred '; x %= 100 }
    if (x >= 20) { s += tens[Math.floor(x / 10)] + ' '; x %= 10 }
    if (x > 0) s += ones[x] + ' '
    return s
  }
  let words = ''
  const units = [['Billion',1e9],['Million',1e6],['Thousand',1e3]]
  let rest = n
  for (const [name, value] of units) {
    if (rest >= value) { words += below1000(Math.floor(rest / value)) + name + ' '; rest %= value }
  }
  words += below1000(rest)
  return words.trim()
}

const PAYEE_LABEL = {
  FREELANCER: 'Freelancer', AGENCY: 'Agency', VENDOR: 'Vendor',
  SALARY: 'Employee / Freelancer', REIMBURSEMENT: 'Employee (Reimbursement)',
  PROJECT: 'Payee', OTHER: 'Payee',
}

// GET /api/expenses/[id]/voucher — printable A4 expense voucher (staff, after approval)
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER','EMPLOYEE'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const expense = await ProjectExpense.findById(params.id)
      .populate({ path: 'freelancerId',     populate: { path: 'userId', select: 'name' } })
      .populate({ path: 'agencyId',         populate: { path: 'userId', select: 'name' } })
      .populate({ path: 'vendorId',         select: 'name companyName' })
      .populate({ path: 'paidToEmployeeId', populate: { path: 'userId', select: 'name' } })
      .populate({ path: 'projectId',        select: 'name projectCode venture' })
      .populate('submittedBy', 'name')
      .populate('reviewedBy', 'name')
      .populate('paidBy', 'name')
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Non-confirmers may only print their own submissions.
    const canConfirm = canDo(session, 'finance.payments.confirm')
    if (!canConfirm && String(expense.submittedBy?._id ?? expense.submittedBy) !== session.user.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (expense.status === 'PENDING')
      return NextResponse.json({ error: 'Voucher is available only after the expense is approved' }, { status: 422 })

    const e = expense.toJSON()
    const payee =
      e.freelancerId?.userId?.name ??
      e.agencyId?.userId?.name ??
      e.vendorId?.companyName ?? e.vendorId?.name ??
      e.paidToEmployeeId?.userId?.name ??
      e.paidToName ?? '—'

    const companyName    = 'En-Tech Agency'
    const companyAddress = '123 Business Ave, Suite 100'
    const amountStr      = formatCurrency(e.amount, e.currency)
    const inWords        = `${numToWords(e.amount)} ${e.currency}${(e.currency === 'BDT') ? ' Only' : ''}`

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Expense Voucher ${e.expenseInvoiceNo ?? ''}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; background: #fff; font-size: 14px; line-height: 1.5; }
  .page { max-width: 800px; margin: 0 auto; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; border-bottom: 3px solid #4f46e5; padding-bottom: 20px; }
  .company-name { font-size: 26px; font-weight: 700; color: #4f46e5; }
  .company-info { font-size: 12px; color: #6b7280; margin-top: 6px; }
  .doc-meta { text-align: right; }
  .doc-title { font-size: 26px; font-weight: 700; color: #4f46e5; letter-spacing: 2px; }
  .doc-number { font-size: 14px; color: #6b7280; margin-top: 4px; }
  .status-badge { display: inline-block; padding: 3px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; }
  .status-APPROVED { background: #dbeafe; color: #1d4ed8; }
  .status-PAID { background: #d1fae5; color: #065f46; }
  .status-REJECTED { background: #fee2e2; color: #991b1b; }
  .meta-grid { display: flex; justify-content: space-between; margin-bottom: 28px; gap: 32px; }
  .meta-block h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 8px; }
  .meta-block .name { font-size: 16px; font-weight: 600; color: #111827; }
  .meta-block .info { font-size: 13px; color: #6b7280; margin-top: 3px; }
  .meta-block.right { text-align: right; }
  .row { display: flex; justify-content: flex-end; gap: 20px; margin-bottom: 5px; }
  .row .label { font-size: 12px; color: #9ca3af; }
  .row .value { font-size: 13px; font-weight: 500; color: #111827; min-width: 130px; text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  thead th { background: #4f46e5; color: #fff; padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
  thead th:last-child { text-align: right; }
  tbody td { padding: 12px 16px; border-bottom: 1px solid #f3f4f6; color: #374151; }
  tbody td:last-child { text-align: right; font-weight: 600; }
  .amount-words { background: #f9fafb; border-radius: 8px; padding: 14px 16px; margin-bottom: 28px; font-size: 13px; }
  .amount-words .label { color: #9ca3af; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .notes-section { background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 28px; }
  .notes-section h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #9ca3af; margin-bottom: 8px; }
  .notes-section p { color: #374151; font-size: 13px; line-height: 1.6; }
  .signatures { display: flex; justify-content: space-between; gap: 24px; margin-top: 64px; }
  .sign-block { flex: 1; text-align: center; }
  .sign-line { border-top: 1px solid #374151; margin: 0 8px 6px; padding-top: 6px; }
  .sign-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .seal-box { margin-top: 40px; border: 1px dashed #9ca3af; border-radius: 8px; height: 96px; display: flex; align-items: center; justify-content: center; color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; }
  .footer { text-align: center; padding-top: 24px; margin-top: 32px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .page { padding: 20px; }
  }
  @page { size: A4; margin: 12mm; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="company-name">${companyName}</div>
      <div class="company-info">${companyAddress}</div>
    </div>
    <div class="doc-meta">
      <div class="doc-title">EXPENSE VOUCHER</div>
      <div class="doc-number">#${e.expenseInvoiceNo ?? '—'}</div>
      <span class="status-badge status-${e.status}">${e.status}</span>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-block">
      <h3>Paid To — ${PAYEE_LABEL[e.origin] ?? 'Payee'}</h3>
      <div class="name">${payee}</div>
      ${e.projectId ? `<div class="info">Project: ${e.projectId.name}${e.projectId.projectCode ? ` (${e.projectId.projectCode})` : ''}</div>` : ''}
      ${e.venture && !e.projectId ? `<div class="info">Venture: ${e.venture}</div>` : ''}
    </div>
    <div class="meta-block right">
      <h3>Voucher Details</h3>
      <div class="row"><span class="label">Voucher No</span><span class="value">${e.expenseInvoiceNo ?? '—'}</span></div>
      <div class="row"><span class="label">Expense Date</span><span class="value">${formatDate(e.date)}</span></div>
      <div class="row"><span class="label">Category</span><span class="value">${e.category ?? '—'}${e.subcategory ? ` / ${e.subcategory}` : ''}</span></div>
      <div class="row"><span class="label">Currency</span><span class="value">${e.currency ?? 'BDT'}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr><th style="width:75%">Description</th><th style="width:25%">Amount</th></tr>
    </thead>
    <tbody>
      <tr><td>${e.title}</td><td>${amountStr}</td></tr>
    </tbody>
  </table>

  <div class="amount-words">
    <div class="label">Amount in Words</div>
    ${inWords}
  </div>

  ${e.notes ? `
  <div class="notes-section">
    <h3>Description / Reason</h3>
    <p>${e.notes}</p>
  </div>` : ''}

  <div class="signatures">
    <div class="sign-block"><div class="sign-line"></div><div class="sign-label">Prepared By${e.submittedBy?.name ? `<br>${e.submittedBy.name}` : ''}</div></div>
    <div class="sign-block"><div class="sign-line"></div><div class="sign-label">Approved By / Account Manager${e.reviewedBy?.name ? `<br>${e.reviewedBy.name}` : ''}</div></div>
    <div class="sign-block"><div class="sign-line"></div><div class="sign-label">Authorised Signatory</div></div>
  </div>

  <div class="seal-box">Company Seal</div>

  <div class="footer">
    <p>Official expense record — voucher ${e.expenseInvoiceNo ?? ''} | Generated on ${formatDate(new Date())} | ${companyName}</p>
  </div>
</div>
<script>window.onload = () => window.print()</script>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="voucher-${e.expenseInvoiceNo ?? e.id}.html"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/expenses/[id]/voucher]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
