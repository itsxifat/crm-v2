export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense, Setting } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { computeBatchRef } from '@/lib/expensePayment'
import { getConfig } from '@/lib/getConfig'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Currency amount, matching the client invoice's ৳-in-serif treatment for BDT.
function money(amount, currency = 'BDT') {
  const n = (amount ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })
  if (!currency || currency === 'BDT') {
    return `<span style="font-size:13px;font-weight:400;letter-spacing:-0.5px;font-family:Georgia,serif">৳</span>&nbsp;${n}`
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

const TH = 'padding:7px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#64748b;border-bottom:1px solid #e2e8f0;background:#fff;border-top:2px solid #0f172a;'
const TD = 'padding:8px 16px;font-size:12.5px;color:#334155;border-bottom:1px solid #f1f5f9;vertical-align:top;'

// GET /api/expenses/combined-voucher?ids=a,b,c
// Printable, multi-page A4 combined expense invoice — visually identical to the
// client invoice (components/shared/InvoicePrintView.jsx): Inter font, logo
// header, #0f172a accents, the same table + totals styling. The header table
// repeats on every page and rows never split across a page break.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    await connectDB()

    const idsParam = new URL(request.url).searchParams.get('ids') ?? ''
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length === 0) return NextResponse.json({ error: 'No expenses selected' }, { status: 422 })

    const [rows, settingsDocs] = await Promise.all([
      ProjectExpense.find({ _id: { $in: ids } })
        .sort({ date: 1, createdAt: 1 })
        .populate({ path: 'freelancerId',     populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'agencyId',         populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'vendorId',         select: 'name companyName' })
        .populate({ path: 'paidToEmployeeId', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'projectId',        select: 'name projectCode' }),
      Setting.find({ group: 'company' }).lean(),
    ])
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const cfg = {}
    settingsDocs.forEach(d => { cfg[d.key] = d.value })
    const company = {
      name:    cfg.company_name    ?? 'En-Tech Agency',
      address: cfg.company_address ?? '',
      phone:   cfg.company_phone   ?? '',
      email:   cfg.company_email   ?? '',
      website: cfg.company_website ?? '',
    }

    const list       = rows.map(r => r.toJSON())
    const batchRef   = computeBatchRef(list)
    const currencies = [...new Set(list.map(e => e.currency ?? 'BDT'))]
    const mixed      = currencies.length > 1
    const totalBDT   = list.reduce((s, e) => s + (e.amountBDT ?? e.amount ?? 0), 0)
    const dayLabels  = [...new Set(list.map(e => fmtDate(e.date)))]
    const period     = dayLabels.length === 1 ? dayLabels[0] : `${dayLabels[0]} – ${dayLabels[dayLabels.length - 1]}`
    const categories = [...new Set(list.map(e => e.category || '—'))]
    const catLabel   = categories.length === 1 ? categories[0] : 'Multiple categories'
    const title      = categories.length === 1 ? categories[0] : 'Combined Expenses'
    const accent     = '#2563eb'

    // Payment method / transaction id (shown once the group is paid).
    const appCfg     = await getConfig()
    const payMethods = appCfg.paymentMethods ?? []
    // Payment is recorded at approval, so show it once expenses are approved/paid.
    const gMethods   = [...new Set(list.map(e => e.paymentMethod).filter(Boolean))]
    const gTxns      = [...new Set(list.map(e => e.paymentTxnId).filter(Boolean))]
    const methodLabel = gMethods.length === 1 ? (payMethods.find(m => m.value === gMethods[0])?.label ?? gMethods[0]) : (gMethods.length > 1 ? 'Multiple' : null)
    const txnLabel    = gTxns.length === 1 ? gTxns[0] : (gTxns.length > 1 ? 'Multiple' : null)
    const hasPayment  = methodLabel || txnLabel

    const contactLine = [company.phone, company.email].filter(Boolean).join(' – ')

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<base href="${new URL(request.url).origin}/" />
<title>Expense Invoice ${batchRef}</title>
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
      <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;">Expense Invoice</p>
      <p style="margin:2px 0 0;font-size:24px;font-weight:700;color:#0f172a;letter-spacing:-0.5px;">${title}</p>
      <p style="margin:4px 0 0;font-size:13px;font-weight:700;color:#94a3b8;">Invoice No: <strong style="color:${accent};font-weight:700;">${batchRef}</strong></p>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:3px;align-items:flex-end;">
        <div style="display:flex;gap:6px;align-items:baseline;">
          <span style="font-size:11px;color:#94a3b8;min-width:44px;text-align:right;">Issued</span>
          <strong style="font-size:11px;color:#475569;min-width:100px;text-align:left;">${fmtDate(new Date())}</strong>
        </div>
        <div style="display:flex;gap:6px;align-items:baseline;">
          <span style="font-size:11px;color:#94a3b8;min-width:44px;text-align:right;">Period</span>
          <strong style="font-size:11px;color:#475569;min-width:100px;text-align:left;">${period}</strong>
        </div>
      </div>
      <p style="margin:10px 0 0;font-size:13px;font-weight:700;color:#94a3b8;">Type: <strong style="color:${accent};font-weight:700;">Combined · ${list.length} item${list.length > 1 ? 's' : ''}</strong></p>
    </div>
  </div>

  <!-- DIVIDER -->
  <div style="height:1px;background:#e2e8f0;margin-bottom:20px;"></div>

  <!-- SUMMARY -->
  <div style="margin-bottom:20px;">
    <p style="margin:0 0 10px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Expense Summary</p>
    <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#0f172a;">${catLabel}
      <span style="font-size:11px;font-weight:400;color:#94a3b8;margin-left:6px;">(Ref: ${batchRef})</span>
    </p>
    <p style="margin:0;font-size:11px;color:#64748b;">${list.length} expense${list.length > 1 ? 's' : ''} · ${period}</p>
    ${hasPayment ? `<p style="margin:6px 0 0;font-size:11px;color:#475569;">Paid via <strong style="color:#0f172a;">${methodLabel ?? '—'}</strong>${txnLabel ? ` · Txn ID: <strong style="color:#0f172a;">${txnLabel}</strong>` : ''}</p>` : ''}
  </div>

  <!-- ITEMS TABLE -->
  <table style="margin-bottom:0;">
    <thead>
      <tr>
        <th style="${TH}text-align:left;padding-left:0;white-space:nowrap;">Expense ID</th>
        <th style="${TH}text-align:left;white-space:nowrap;">Date</th>
        <th style="${TH}text-align:left;">Description</th>
        <th style="${TH}text-align:left;">Paid To</th>
        <th style="${TH}text-align:right;padding-right:0;white-space:nowrap;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${list.map(e => `
      <tr>
        <td style="${TD}padding-left:0;font-size:12px;font-weight:600;color:#0f172a;white-space:nowrap;">${e.expenseId ?? '—'}</td>
        <td style="${TD}font-size:12px;font-weight:500;color:#334155;white-space:nowrap;">${fmtDate(e.date)}</td>
        <td style="${TD}">
          ${e.category ? `<p style="margin:0 0 2px;font-size:10px;font-weight:500;color:#94a3b8;line-height:1.3;text-transform:uppercase;letter-spacing:0.06em;">${e.category}${e.subcategory ? ` / ${e.subcategory}` : ''}</p>` : ''}
          <p style="margin:0;font-size:13px;font-weight:600;color:#0f172a;line-height:1.4;">${e.title}</p>
          ${e.projectId?.name ? `<p style="margin:3px 0 0;font-size:10px;font-weight:400;color:#64748b;line-height:1.6;">${e.projectId.name}${e.projectId.projectCode ? ` (#${e.projectId.projectCode})` : ''}</p>` : ''}
          ${e.notes ? `<p style="margin:3px 0 0;font-size:10px;font-weight:400;color:#94a3b8;line-height:1.5;">${e.notes}</p>` : ''}
        </td>
        <td style="${TD}color:#64748b;">${payeeOf(e)}</td>
        <td style="${TD}text-align:right;padding-right:0;font-weight:700;color:#0f172a;white-space:nowrap;">
          ${money(e.amount, e.currency)}
          ${(e.currency && e.currency !== 'BDT') ? `<div style="font-size:10px;font-weight:400;color:#94a3b8;">≈ ${money(e.amountBDT ?? 0, 'BDT')}</div>` : ''}
        </td>
      </tr>`).join('')}
    </tbody>
  </table>

  <!-- TOTALS -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
    <div style="width:280px;">
      <div style="height:2px;background:#0f172a;"></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;">
        <span style="font-size:12px;color:#64748b;">Items</span>
        <span style="font-size:12px;color:#334155;font-weight:500;">${list.length}</span>
      </div>
      ${mixed ? `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f1f5f9;">
        <span style="font-size:12px;color:#64748b;">Currencies</span>
        <span style="font-size:12px;color:#334155;font-weight:500;">${currencies.join(', ')}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:9px 16px;margin-top:3px;margin-left:-16px;margin-right:-16px;border-radius:8px;background:#f8fafc;">
        <span style="font-size:14px;font-weight:800;color:#0f172a;">Total (BDT)</span>
        <span style="font-size:14px;font-weight:800;color:#0f172a;">${money(totalBDT, 'BDT')}</span>
      </div>
    </div>
  </div>

  ${mixed ? `<div style="margin-bottom:16px;"><p style="margin:0 0 6px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Note</p><p style="margin:0;font-size:11px;color:#475569;line-height:1.7;">This combined invoice includes expenses in multiple currencies. The total shown is the BDT-equivalent of the actual amounts spent.</p></div>` : ''}

  <!-- SIGNATURES -->
  <div style="display:flex;justify-content:space-between;gap:28px;margin-top:56px;page-break-inside:avoid;">
    <div style="flex:1;text-align:center;">
      <div style="border-top:1px solid #334155;margin:0 8px 6px;padding-top:6px;"></div>
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Prepared By</div>
    </div>
    <div style="flex:1;text-align:center;">
      <div style="border-top:1px solid #334155;margin:0 8px 6px;padding-top:6px;"></div>
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Approved By / Account Manager</div>
    </div>
    <div style="flex:1;text-align:center;">
      <div style="border-top:1px solid #334155;margin:0 8px 6px;padding-top:6px;"></div>
      <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Authorised Signatory</div>
    </div>
  </div>
  <div style="margin-top:32px;border:1px dashed #cbd5e1;border-radius:8px;height:92px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;page-break-inside:avoid;">Company Seal</div>

  <!-- FOOTER -->
  <div style="border-top:1px solid #e2e8f0;padding-top:12px;margin-top:20px;text-align:center;">
    <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;">Official combined expense record · Ref ${batchRef} · Generated ${fmtDate(new Date())}</p>
    ${company.name ? `<p style="margin:0;font-size:10px;color:#cbd5e1;letter-spacing:0.04em;">${company.name}</p>` : ''}
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
