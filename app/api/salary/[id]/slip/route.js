export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { SalarySlip, Setting } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { getConfig } from '@/lib/getConfig'
import { amountToWords } from '@/lib/numberToWords'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

function fmtPeriod(period) {
  const [y, m] = String(period ?? '').split('-')
  if (!y || !m) return period ?? '—'
  return new Date(+y, +m - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}

function money(amount, currency = 'BDT') {
  const n = (amount ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })
  if (!currency || currency === 'BDT') {
    return `<span style="font-family:Georgia,serif;font-weight:400;font-size:1.05em;letter-spacing:-0.5px">৳</span>&nbsp;${n}`
  }
  return `${currency}&nbsp;${n}`
}

const STATUS_LABEL  = { PAID: 'Paid', AUTHORIZED: 'Authorized', REJECTED: 'Rejected', PENDING: 'Awaiting Payment' }
const STATUS_ACCENT = { AUTHORIZED: '#16a34a', PAID: '#2563eb', REJECTED: '#dc2626', PENDING: '#d97706' }
const STATUS_BG     = { AUTHORIZED: '#f0fdf4', PAID: '#eff6ff', REJECTED: '#fef2f2', PENDING: '#fffbeb' }

const TH = 'padding:7px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#64748b;border-bottom:1px solid #e2e8f0;background:#fff;'
const TD = 'padding:7px 16px;font-size:12.5px;color:#334155;border-bottom:1px solid #f1f5f9;vertical-align:top;'

// GET /api/salary/[id]/slip — printable A4 salary slip (browser-print, no PDF
// lib) styled to match the rest of the app's invoice/voucher documents.
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.salary.view')
    if (denied) return denied
    await connectDB()

    const [slip, settingsDocs, appCfg] = await Promise.all([
      SalarySlip.findById(params.id)
        .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name email' } })
        .populate('expenseId'),
      Setting.find({ group: 'company' }).lean(),
      getConfig(),
    ])
    if (!slip) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

    const s   = slip.toJSON()
    const emp = s.employeeId ?? {}
    const exp = s.expenseId ?? null
    const cur = s.currency ?? 'BDT'
    const isForeign = cur !== 'BDT'

    const status       = exp?.status ?? 'PENDING'
    const statusLabel  = STATUS_LABEL[status]  ?? status
    const accent       = STATUS_ACCENT[status] ?? '#d97706'
    const statusBg     = STATUS_BG[status]     ?? '#fffbeb'
    const isPaid       = status === 'PAID' || status === 'AUTHORIZED'
    const methodLabel  = appCfg.paymentMethods?.find(m => m.value === exp?.paymentMethod)?.label ?? exp?.paymentMethod ?? null

    const earningsRows = [
      { label: 'Basic Salary', amount: s.baseSalary },
      ...(s.items ?? []).filter(i => i.type === 'EARNING'),
    ]
    const deductionRows = (s.items ?? []).filter(i => i.type === 'DEDUCTION')

    const earningsHtml = earningsRows.map(i => `
      <tr>
        <td style="${TD}padding-left:0;">${i.label}</td>
        <td style="${TD}text-align:right;padding-right:0;font-weight:500;">${money(i.amount, cur)}</td>
      </tr>`).join('')

    const deductionsHtml = deductionRows.length ? deductionRows.map(i => `
      <tr>
        <td style="${TD}padding-left:0;">${i.label}</td>
        <td style="${TD}text-align:right;padding-right:0;font-weight:500;">${money(i.amount, cur)}</td>
      </tr>`).join('') : `
      <tr><td style="${TD}padding-left:0;color:#94a3b8;font-style:italic;" colspan="2">No deductions</td></tr>`

    const netWords = amountToWords(s.amountBDT ?? s.netPay, isForeign ? cur : 'BDT')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<base href="${new URL(request.url).origin}/" />
<title>Salary Slip ${s.slipNo ?? ''}</title>
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
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;">
    <div>
      <img src="/en-logo.png" alt="${company.name}" width="120" height="38" style="object-fit:contain;display:block;margin-bottom:7px;" />
      ${company.name    ? `<p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#0f172a;">${company.name}</p>` : ''}
      ${company.address ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">${company.address}</p>` : ''}
      ${contactLine     ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">${contactLine}</p>` : ''}
      ${company.website ? `<p style="margin:0;font-size:11px;color:#64748b;">${company.website}</p>` : ''}
    </div>
    <div style="text-align:right;">
      <p style="margin:0;font-size:26px;font-weight:700;color:#0f172a;letter-spacing:-0.5px;">Salary Slip</p>
      <p style="margin:4px 0 0;font-size:13px;font-weight:700;color:#94a3b8;">Slip No: <strong style="color:#0f172a;font-weight:700;">${s.slipNo ?? '—'}</strong></p>
      <p style="margin:2px 0 0;font-size:13px;font-weight:700;color:#94a3b8;">Period: <strong style="color:#0f172a;font-weight:700;">${fmtPeriod(s.period)}</strong></p>
      <span style="display:inline-block;margin-top:10px;padding:4px 12px;border-radius:999px;background:${statusBg};color:${accent};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">${statusLabel}</span>
    </div>
  </div>

  <!-- DIVIDER -->
  <div style="height:1px;background:#e2e8f0;margin-bottom:20px;"></div>

  <!-- EMPLOYEE INFO -->
  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:18px 22px;margin-bottom:22px;background:#f8fafc;">
    <p style="margin:0 0 12px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Employee</p>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px 20px;">
      <div>
        <p style="margin:0 0 2px;font-size:10px;color:#94a3b8;">Name</p>
        <p style="margin:0;font-size:13px;font-weight:700;color:#0f172a;">${emp.userId?.name ?? '—'}</p>
      </div>
      <div>
        <p style="margin:0 0 2px;font-size:10px;color:#94a3b8;">Employee ID</p>
        <p style="margin:0;font-size:13px;font-weight:600;color:#334155;">${emp.employeeId ?? '—'}</p>
      </div>
      <div>
        <p style="margin:0 0 2px;font-size:10px;color:#94a3b8;">Designation</p>
        <p style="margin:0;font-size:13px;font-weight:600;color:#334155;">${emp.designation ?? emp.position ?? '—'}</p>
      </div>
      <div>
        <p style="margin:0 0 2px;font-size:10px;color:#94a3b8;">Department</p>
        <p style="margin:0;font-size:13px;font-weight:600;color:#334155;">${emp.department ?? '—'}</p>
      </div>
      <div>
        <p style="margin:0 0 2px;font-size:10px;color:#94a3b8;">Venture</p>
        <p style="margin:0;font-size:13px;font-weight:600;color:#334155;">${emp.venture ?? '—'}</p>
      </div>
      <div>
        <p style="margin:0 0 2px;font-size:10px;color:#94a3b8;">Date of Joining</p>
        <p style="margin:0;font-size:13px;font-weight:600;color:#334155;">${fmtDate(emp.hireDate)}</p>
      </div>
    </div>
  </div>

  <!-- EARNINGS / DEDUCTIONS -->
  <div style="display:flex;gap:18px;margin-bottom:0;">
    <div style="flex:1;">
      <table>
        <thead>
          <tr>
            <th style="${TH}text-align:left;padding-left:0;border-top:2px solid #16a34a;">Earnings</th>
            <th style="${TH}text-align:right;padding-right:0;border-top:2px solid #16a34a;">Amount</th>
          </tr>
        </thead>
        <tbody>${earningsHtml}</tbody>
        <tfoot>
          <tr>
            <td style="padding:9px 0 0 0;font-size:12.5px;font-weight:700;color:#0f172a;">Gross Earnings</td>
            <td style="padding:9px 0 0 0;text-align:right;font-size:12.5px;font-weight:700;color:#0f172a;">${money(s.grossEarnings, cur)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div style="width:1px;background:#e2e8f0;"></div>
    <div style="flex:1;">
      <table>
        <thead>
          <tr>
            <th style="${TH}text-align:left;padding-left:0;border-top:2px solid #dc2626;">Deductions</th>
            <th style="${TH}text-align:right;padding-right:0;border-top:2px solid #dc2626;">Amount</th>
          </tr>
        </thead>
        <tbody>${deductionsHtml}</tbody>
        <tfoot>
          <tr>
            <td style="padding:9px 0 0 0;font-size:12.5px;font-weight:700;color:#0f172a;">Total Deductions</td>
            <td style="padding:9px 0 0 0;text-align:right;font-size:12.5px;font-weight:700;color:#0f172a;">${money(s.totalDeductions, cur)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>

  <!-- NET PAY -->
  <div style="margin-top:22px;margin-bottom:22px;border-radius:12px;background:#f0fdf4;padding:18px 22px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;">
      <span style="font-size:13px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:0.06em;">Net Payable</span>
      <span style="font-size:22px;font-weight:800;color:#16a34a;">${money(s.netPay, cur)}</span>
    </div>
    ${isForeign ? `
    <div style="display:flex;justify-content:flex-end;margin-top:2px;">
      <span style="font-size:11px;color:#15803d;">Equivalent in BDT: ${money(s.amountBDT ?? 0, 'BDT')}</span>
    </div>` : ''}
    <p style="margin:10px 0 0;font-size:11px;color:#15803d;font-style:italic;border-top:1px solid #dcfce7;padding-top:8px;">
      In Words: ${netWords}
    </p>
  </div>

  ${isPaid ? `
  <!-- PAYMENT DETAILS -->
  <div style="margin-bottom:16px;">
    <p style="margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Payment Details</p>
    <table>
      <thead>
        <tr>
          <th style="${TH}text-align:left;padding-left:0;">Payment Date</th>
          <th style="${TH}text-align:left;">Method</th>
          <th style="${TH}text-align:right;padding-right:0;">Reference</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${TD}padding-left:0;">${fmtDate(exp?.paidAt)}</td>
          <td style="${TD}">${methodLabel ?? '—'}</td>
          <td style="${TD}text-align:right;padding-right:0;font-family:monospace;font-size:11px;">${exp?.paymentTxnId ?? exp?.expenseInvoiceNo ?? '—'}</td>
        </tr>
      </tbody>
    </table>
  </div>` : ''}

  ${s.note ? `
  <div style="margin-bottom:16px;">
    <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Note</p>
    <p style="margin:0;font-size:12px;color:#475569;white-space:pre-wrap;">${s.note}</p>
  </div>` : ''}

  <!-- SYSTEM NOTE -->
  <div style="border-top:1px solid #f1f5f9;padding-top:16px;margin-bottom:20px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#64748b;line-height:1.8;">This is a system generated salary slip and does not require a signature.</p>
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
        'Content-Disposition': `inline; filename="salary-slip-${s.slipNo ?? s.id}.html"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/salary/[id]/slip]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
