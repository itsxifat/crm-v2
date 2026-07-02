export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense, Setting } from '@/models'
import { canDo } from '@/lib/rbac'
import { getConfig } from '@/lib/getConfig'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Currency amount, matching the client invoice's ৳-in-serif treatment for BDT.
function money(amount, currency = 'BDT') {
  const n = (amount ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })
  if (!currency || currency === 'BDT') {
    return `<span style="font-family:Georgia,serif;font-weight:400;font-size:1.05em;letter-spacing:-0.5px">৳</span>&nbsp;${n}`
  }
  return `${currency}&nbsp;${n}`
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

const PAYEE_LABEL = {
  FREELANCER: 'Freelancer', AGENCY: 'Agency', VENDOR: 'Vendor',
  SALARY: 'Salary', REIMBURSEMENT: 'Reimbursement', PROJECT: 'Project', OTHER: 'Expense',
}
const STATUS_LABEL = { APPROVED: 'Approved', PAID: 'Paid', REJECTED: 'Rejected', PENDING: 'Pending' }
const STATUS_ACCENT = { PAID: '#16a34a', APPROVED: '#2563eb', REJECTED: '#dc2626', PENDING: '#d97706' }

const TH = 'padding:7px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#64748b;border-bottom:1px solid #e2e8f0;background:#fff;border-top:2px solid #0f172a;'
const TD = 'padding:8px 16px;font-size:12.5px;color:#334155;border-bottom:1px solid #f1f5f9;vertical-align:top;'

// GET /api/expenses/[id]/voucher — printable A4 payment voucher, visually
// identical to the client invoice (components/shared/InvoicePrintView.jsx):
// Inter font, logo header, #0f172a accents, same table + totals + transaction
// details styling. Available once the expense is approved.
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER','EMPLOYEE'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const [expense, settingsDocs, appCfg] = await Promise.all([
      ProjectExpense.findById(params.id)
        .populate({ path: 'freelancerId',     populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'agencyId',         populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'vendorId',         select: 'name companyName' })
        .populate({ path: 'paidToEmployeeId', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'projectId',        select: 'name projectCode venture' })
        .populate('submittedBy', 'name'),
      Setting.find({ group: 'company' }).lean(),
      getConfig(),
    ])
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Non-confirmers may only print their own submissions.
    const canConfirm = canDo(session, 'finance.payments.confirm')
    if (!canConfirm && String(expense.submittedBy?._id ?? expense.submittedBy) !== session.user.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (expense.status === 'PENDING')
      return NextResponse.json({ error: 'Voucher is available only after the expense is approved' }, { status: 422 })

    const cfg = {}
    settingsDocs.forEach(d => { cfg[d.key] = d.value })
    const company = {
      name:    cfg.company_name    ?? 'Enfinito Bangladesh',
      address: cfg.company_address ?? '',
      phone:   cfg.company_phone   ?? '',
      email:   cfg.company_email   ?? '',
      website: cfg.company_website ?? '',
    }
    const contactLine = [company.phone, company.email].filter(Boolean).join(' – ')

    const e   = expense.toJSON()
    const cur = e.currency ?? 'BDT'
    const paid = e.status === 'PAID'
    const methodLabel = appCfg.paymentMethods?.find(m => m.value === e.paymentMethod)?.label ?? e.paymentMethod ?? null
    // Payment is recorded at approval, so show it from the APPROVED stage onward.
    const hasTxn = (methodLabel || e.paymentTxnId)
    const statusLabel  = STATUS_LABEL[e.status] ?? e.status
    const accent       = STATUS_ACCENT[e.status] ?? '#2563eb'
    const payee        = payeeOf(e)

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<base href="${new URL(request.url).origin}/" />
<title>Payment Voucher ${e.expenseId ?? ''}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter','Segoe UI',sans-serif; background: #fff; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @page { size: A4; margin: 14mm 12mm; }
</style>
</head>
<body>
<div style="max-width:780px;margin:0 auto;padding:8px 0;">

  <!-- HEADER -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;">
    <div>
      <img src="/en-logo.png" alt="${company.name}" width="120" height="38" style="object-fit:contain;display:block;margin-bottom:7px;" />
      ${company.name    ? `<p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#0f172a;">${company.name}</p>` : ''}
      ${company.address ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">${company.address}</p>` : ''}
      ${contactLine     ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">${contactLine}</p>` : ''}
      ${company.website ? `<p style="margin:0;font-size:11px;color:#64748b;">${company.website}</p>` : ''}
    </div>
    <div style="text-align:right;">
      <p style="margin:0;font-size:26px;font-weight:700;color:#0f172a;letter-spacing:-0.5px;">Payment Voucher</p>
      <p style="margin:4px 0 0;font-size:13px;font-weight:700;color:#94a3b8;">Voucher No: <strong style="color:${accent};font-weight:700;">${e.expenseId ?? e.expenseInvoiceNo ?? '—'}</strong></p>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:3px;align-items:flex-end;">
        <div style="display:flex;gap:6px;align-items:baseline;">
          <span style="font-size:11px;color:#94a3b8;min-width:44px;text-align:right;">Issued</span>
          <strong style="font-size:11px;color:#475569;min-width:100px;text-align:left;">${fmtDate(e.reviewedAt ?? e.createdAt)}</strong>
        </div>
        <div style="display:flex;gap:6px;align-items:baseline;">
          <span style="font-size:11px;color:#94a3b8;min-width:44px;text-align:right;">Date</span>
          <strong style="font-size:11px;color:#475569;min-width:100px;text-align:left;">${fmtDate(e.date)}</strong>
        </div>
      </div>
      <p style="margin:10px 0 0;font-size:13px;font-weight:700;color:#94a3b8;">Status: <strong style="color:${accent};font-weight:700;">${statusLabel}</strong></p>
    </div>
  </div>

  <!-- DIVIDER -->
  <div style="height:1px;background:#e2e8f0;margin-bottom:20px;"></div>

  <!-- PAID TO -->
  <div style="margin-bottom:20px;">
    <p style="margin:0 0 10px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Paid To — ${PAYEE_LABEL[e.origin] ?? 'Payee'}</p>
    <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#0f172a;">${payee}</p>
    ${e.projectId?.name ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">Project: ${e.projectId.name}${e.projectId.projectCode ? ` (#${e.projectId.projectCode})` : ''}</p>` : ''}
    ${e.venture && !e.projectId ? `<p style="margin:0;font-size:11px;color:#64748b;">Venture: ${e.venture}</p>` : ''}
  </div>

  <!-- ITEMS TABLE -->
  <table style="margin-bottom:0;">
    <thead>
      <tr>
        <th style="${TH}text-align:left;padding-left:0;white-space:nowrap;">ID</th>
        <th style="${TH}text-align:left;">Description</th>
        <th style="${TH}text-align:center;">Qty</th>
        <th style="${TH}text-align:right;white-space:nowrap;">Unit Price</th>
        <th style="${TH}text-align:right;padding-right:0;white-space:nowrap;">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="${TD}padding-left:0;font-size:12px;font-weight:600;color:#0f172a;white-space:nowrap;">${e.expenseId ?? '—'}</td>
        <td style="${TD}">
          ${e.category ? `<p style="margin:0 0 2px;font-size:10px;font-weight:500;color:#94a3b8;line-height:1.3;text-transform:uppercase;letter-spacing:0.06em;">${e.category}${e.subcategory ? ` / ${e.subcategory}` : ''}</p>` : ''}
          <p style="margin:0;font-size:13px;font-weight:600;color:#0f172a;line-height:1.4;">${e.title}</p>
          ${e.notes ? `<p style="margin:3px 0 0;font-size:10px;font-weight:400;color:#64748b;line-height:1.6;">${e.notes}</p>` : ''}
        </td>
        <td style="${TD}text-align:center;color:#64748b;">1</td>
        <td style="${TD}text-align:right;color:#64748b;white-space:nowrap;">${money(e.amount, cur)}</td>
        <td style="${TD}text-align:right;padding-right:0;font-weight:700;color:#0f172a;white-space:nowrap;">${money(e.amount, cur)}</td>
      </tr>
    </tbody>
  </table>

  <!-- TOTALS -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
    <div style="width:280px;">
      <div style="height:2px;background:#0f172a;"></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;">
        <span style="font-size:12px;color:#64748b;">Sub Total</span>
        <span style="font-size:12px;color:#334155;font-weight:500;">${money(e.amount, cur)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e2e8f0;">
        <span style="font-size:13px;font-weight:700;color:#0f172a;">Payable</span>
        <span style="font-size:13px;font-weight:700;color:#0f172a;">${money(e.amount, cur)}</span>
      </div>
      ${paid ? `
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;">
        <span style="font-size:12px;color:#16a34a;font-weight:500;">Paid</span>
        <span style="font-size:12px;color:#16a34a;font-weight:500;">−${money(e.amount, cur)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:9px 16px;margin-top:3px;margin-left:-16px;margin-right:-16px;border-radius:8px;background:#f0fdf4;">
        <span style="font-size:14px;font-weight:800;color:#16a34a;">Due</span>
        <span style="font-size:14px;font-weight:800;color:#16a34a;">${money(0, cur)}</span>
      </div>` : ''}
    </div>
  </div>

  ${hasTxn ? `
  <!-- TRANSACTION DETAILS -->
  <div style="margin-bottom:16px;">
    <p style="margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Transaction Details</p>
    <table>
      <thead>
        <tr>
          <th style="${TH}text-align:left;padding-left:0;">Date</th>
          <th style="${TH}text-align:left;">Gateway / Method</th>
          <th style="${TH}text-align:center;">Transaction ID</th>
          <th style="${TH}text-align:right;padding-right:0;">Paid Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${TD}padding-left:0;">${fmtDate(e.paidAt ?? e.reviewedAt)}</td>
          <td style="${TD}">${methodLabel ?? '—'}</td>
          <td style="${TD}text-align:center;font-family:monospace;font-size:11px;">${e.paymentTxnId ?? '—'}</td>
          <td style="${TD}text-align:right;padding-right:0;color:#16a34a;font-weight:600;">${money(e.amount, cur)}</td>
        </tr>
      </tbody>
    </table>
  </div>` : ''}

  <!-- SYSTEM NOTE -->
  <div style="border-top:1px solid #f1f5f9;padding-top:16px;margin-bottom:20px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#64748b;line-height:1.8;">This is a system generated payment voucher.</p>
  </div>

  <!-- FOOTER -->
  <div style="border-top:1px solid #e2e8f0;padding-top:12px;text-align:center;">
    <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;">Generated on ${fmtDate(new Date())}${company.name ? ` – ${company.name}` : ''}</p>
  </div>

</div>
<script>window.onload = () => window.print()</script>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="voucher-${e.expenseId ?? e.id}.html"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/expenses/[id]/voucher]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
