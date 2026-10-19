export const dynamic = 'force-dynamic'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense } from '@/models'
import { canDo } from '@/lib/rbac'
import { getConfig } from '@/lib/getConfig'
import { getCompanyProfile } from '@/lib/finance/settings'
import { expenseSettlement, moneyAccountText, channelText, tdsSectionText, inputVatOutcomesFor } from '@/lib/expensePayment'
import { tdsSectionResolver } from '@/lib/tax/engine'
import { escapeHtml } from '@/lib/html'
import { BENGALI_FONT_CSS } from '@/lib/printFonts'
import { isValidObjectId } from '@/lib/objectId'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'

// Currency amount, matching the client invoice's ৳-in-serif treatment for BDT.
function money(amount, currency = 'BDT') {
  const n = (Number(amount) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (!currency || currency === 'BDT') {
    return `<span style="font-family:var(--font-bengali),serif;font-size:1.05em">৳</span>&nbsp;${n}`
  }
  return `${escapeHtml(currency)}&nbsp;${n}`
}

const fmtRate = (r) => (r === null || r === undefined || r === '' ? '' : `${Number(r).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`)

function payeeOf(e) {
  return (
    e.freelancerId?.userId?.name ??
    e.agencyId?.agencyInfo?.agencyName ??
    e.agencyId?.userId?.name ??
    e.vendorId?.company ??
    e.paidToEmployeeId?.userId?.name ??
    e.paidToName ?? '—'
  )
}

const PAYEE_LABEL = {
  FREELANCER: 'Freelancer', AGENCY: 'Agency', VENDOR: 'Vendor',
  SALARY: 'Salary', REIMBURSEMENT: 'Reimbursement', PROJECT: 'Project', OTHER: 'Expense',
}
const STATUS_LABEL = { PAID: 'Paid', AUTHORIZED: 'Authorized', APPROVED: 'Approved', REJECTED: 'Rejected', PENDING: 'Pending' }
const STATUS_ACCENT = { AUTHORIZED: '#16a34a', PAID: '#2563eb', APPROVED: '#2563eb', REJECTED: '#dc2626', PENDING: '#d97706' }

const TH = 'padding:7px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#64748b;border-bottom:1px solid #e2e8f0;background:#fff;border-top:2px solid #0f172a;'
const TD = 'padding:8px 16px;font-size:12.5px;color:#334155;border-bottom:1px solid #f1f5f9;vertical-align:top;'
const ROW = 'display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #f1f5f9;'

// GET /api/expenses/[id]/voucher — printable A4 payment voucher, visually
// identical to the client invoice (components/shared/InvoicePrintView.jsx):
// Inter font, logo header, #0f172a accents, same table + totals + transaction
// details styling. Shows the tax breakdown (gross, VAT in the bill, VDS & TDS
// deducted, net paid) and the money account it was paid from. Available once
// the expense is paid (or rejected).
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const [expense, company, appCfg] = await Promise.all([
      ProjectExpense.findById(params.id)
        .populate({ path: 'freelancerId',     select: 'userId', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'agencyId',         select: 'userId agencyInfo.agencyName bin', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'vendorId',         select: 'company bin' })
        .populate({ path: 'paidToEmployeeId', select: 'userId', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'projectId',        select: 'name projectCode venture' })
        .populate({ path: 'accountId',        select: 'name type bankName last4 mfsProvider currency' })
        .populate({ path: 'accountsTransactionId', select: 'txnId' })
        .populate('submittedBy', 'name'),
      getCompanyProfile(),
      getConfig(),
    ])
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Non-confirmers may only print their own submissions.
    const canConfirm = canDo(session, 'finance.payments.confirm')
    if (!canConfirm && String(expense.submittedBy?._id ?? expense.submittedBy) !== session.user.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (expense.status === 'PENDING')
      return NextResponse.json({ error: 'Voucher is available only after the expense is paid' }, { status: 422 })

    const co = {
      name:    company.name || 'Enfinito Bangladesh',
      address: company.address || '',
      phone:   company.phone || '',
      email:   company.email || '',
      website: company.website || '',
      bin:     company.bin || '',
      tin:     company.tin || '',
    }
    const contactLine = [co.phone, co.email].filter(Boolean).join(' – ')
    const taxIdLine   = [co.bin && `BIN: ${co.bin}`, co.tin && `TIN: ${co.tin}`].filter(Boolean).join(' · ')

    const e   = expense.toJSON()
    const fig = expenseSettlement(expense)
    const tax = fig.tax ?? {}
    const cur = fig.currency
    const paid = e.status === 'PAID' || e.status === 'AUTHORIZED'
    // Input-VAT credit as the payment recorded it (INPUT_VAT entry / ledger row) — not
    // the credit requested on the bill, which the payment may have refused. Nothing
    // is claimed before payment, nor for older payments that recorded neither.
    const itc = paid && fig.vat > 0 ? (await inputVatOutcomesFor([expense])).get(String(expense._id)) ?? null : null
    const itcNote = itc?.creditable === true ? ' — input credit claimed'
      : itc?.creditable === false ? ' — no input credit (charged to cost)'
      : ''
    const isForeign = cur !== 'BDT'
    const hasWithholding = fig.vds > 0 || fig.tds > 0
    const hasTaxBreakdown = fig.vat > 0 || hasWithholding
    const methodLabel = appCfg.paymentMethods?.find(m => m.value === e.paymentMethod)?.label ?? e.paymentMethod ?? null
    const accountLabel = moneyAccountText(e.accountId)
    const chLabel = channelText(e.channel)
    const ledgerTxnId = e.accountsTransactionId?.txnId ?? null
    const hasTxn = paid && (methodLabel || e.paymentTxnId || accountLabel)
    const statusLabel  = escapeHtml(STATUS_LABEL[e.status] ?? e.status)
    const accent       = STATUS_ACCENT[e.status] ?? '#2563eb'
    const payee        = escapeHtml(payeeOf(e))
    const payeeBin     = tax.supplierBin || e.vendorId?.bin || e.agencyId?.bin || null
    // Printed voucher number = the paid-voucher number (EXV-…) shown in Accounts;
    // the expense id (EXP-…) is shown separately as the expense reference.
    const voucherNo    = e.expenseInvoiceNo ?? e.expenseId ?? null
    const paidOn       = e.paidAt ?? e.reviewedAt
    const tdsText      = fig.tds > 0
      ? tdsSectionText(tax.tdsSection, paidOn ?? new Date(), await tdsSectionResolver([tax.tdsSection]))
      : null

    // Totals block (gross → VAT inside → VDS / TDS deducted → net paid).
    const vatNote = [
      fmtRate(tax.vatRate) && `@ ${fmtRate(tax.vatRate)}`,
      tax.mushakNo && `Mushak-6.3 No. ${escapeHtml(tax.mushakNo)}${tax.mushakDate ? `, ${fmtDate(tax.mushakDate)}` : ''}`,
    ].filter(Boolean).join(' · ')
    const totalsHtml = hasTaxBreakdown ? `
      <div style="${ROW}">
        <span style="font-size:12px;color:#64748b;">Gross amount${fig.vat > 0 ? ' (incl. VAT)' : ''}</span>
        <span style="font-size:12px;color:#334155;font-weight:500;white-space:nowrap;">${money(fig.gross, cur)}</span>
      </div>
      ${fig.vat > 0 ? `
      <div style="${ROW}">
        <span style="font-size:11px;color:#94a3b8;font-style:italic;">of which VAT${vatNote ? ` ${vatNote}` : ''}${itcNote}</span>
        <span style="font-size:11px;color:#94a3b8;font-style:italic;white-space:nowrap;">${money(fig.vat, cur)}</span>
      </div>` : ''}
      ${fig.vds > 0 ? `
      <div style="${ROW}">
        <span style="font-size:12px;color:#64748b;">Less: VAT deducted at source (VDS${fmtRate(tax.vdsRate) ? ` @ ${fmtRate(tax.vdsRate)}` : ''}, Mushak-6.6)</span>
        <span style="font-size:12px;color:#b45309;font-weight:500;white-space:nowrap;">−${money(fig.vds, cur)}</span>
      </div>` : ''}
      ${fig.tds > 0 ? `
      <div style="${ROW}">
        <span style="font-size:12px;color:#64748b;">Less: Income tax deducted at source (TDS${fmtRate(tax.tdsRate) ? ` @ ${fmtRate(tax.tdsRate)}` : ''}${tdsText ? `, ${escapeHtml(tdsText)}` : ''}${tax.higherRateApplied ? ', higher rate s.142' : ''})</span>
        <span style="font-size:12px;color:#b45309;font-weight:500;white-space:nowrap;">−${money(fig.tds, cur)}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e2e8f0;">
        <span style="font-size:13px;font-weight:700;color:#0f172a;">Net payable</span>
        <span style="font-size:13px;font-weight:700;color:#0f172a;white-space:nowrap;">${money(fig.net, cur)}</span>
      </div>` : `
      <div style="${ROW}">
        <span style="font-size:12px;color:#64748b;">Sub Total</span>
        <span style="font-size:12px;color:#334155;font-weight:500;">${money(fig.gross, cur)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e2e8f0;">
        <span style="font-size:13px;font-weight:700;color:#0f172a;">Payable</span>
        <span style="font-size:13px;font-weight:700;color:#0f172a;">${money(fig.net, cur)}</span>
      </div>`

    // Compliance notes printed under the totals.
    const notes = []
    if (hasWithholding) {
      const parts = []
      if (fig.vds > 0) parts.push(`VDS ${money(fig.vdsBDT, 'BDT')} (Mushak-6.6 certificate to be issued to the supplier)`)
      if (fig.tds > 0) parts.push(`TDS ${money(fig.tdsBDT, 'BDT')} (to be deposited by challan; certificate to be issued)`)
      notes.push(`Tax withheld and payable to the government: ${parts.join('; ')}.`)
    }
    if (itc?.creditable === false) {
      notes.push(`Input VAT ${money(fig.vatBDT, 'BDT')} is not claimed as input tax credit${itc.reasonLabel ? ` (${escapeHtml(itc.reasonLabel)})` : ''} — it is part of the cost of this bill.`)
    }
    if (fig.capitalizedBDT > 0) notes.push(`${money(fig.capitalizedBDT, 'BDT')} of this bill is capitalised as fixed assets.`)
    if (tax.taxDeductible === false) notes.push('Not an allowable expense for income tax (paid outside a banking channel — ITA 2023 s.55).')

    const cspNonce = randomBytes(16).toString('base64')
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<base href="${new URL(request.url).origin}/" />
<title>Payment Voucher ${escapeHtml(voucherNo ?? '')}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ${BENGALI_FONT_CSS}
  body { font-family: 'Inter','Segoe UI', var(--font-bengali),sans-serif; background: #fff; color: #0f172a; }
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
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;gap:16px;">
    <div>
      <img src="/en-logo.png" alt="${escapeHtml(co.name)}" width="120" height="38" style="object-fit:contain;display:block;margin-bottom:7px;" />
      ${co.name    ? `<p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#0f172a;">${escapeHtml(co.name)}</p>` : ''}
      ${co.address ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">${escapeHtml(co.address)}</p>` : ''}
      ${contactLine ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">${escapeHtml(contactLine)}</p>` : ''}
      ${co.website ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">${escapeHtml(co.website)}</p>` : ''}
      ${taxIdLine  ? `<p style="margin:0;font-size:11px;color:#475569;font-weight:600;">${escapeHtml(taxIdLine)}</p>` : ''}
    </div>
    <div style="text-align:right;">
      <p style="margin:0;font-size:26px;font-weight:700;color:#0f172a;letter-spacing:-0.5px;">Payment Voucher</p>
      <p style="margin:4px 0 0;font-size:13px;font-weight:700;color:#94a3b8;">Voucher No: <strong style="color:${accent};font-weight:700;">${escapeHtml(voucherNo ?? '—')}</strong></p>
      ${e.expenseInvoiceNo && e.expenseId ? `<p style="margin:2px 0 0;font-size:11px;color:#94a3b8;">Expense Ref: ${escapeHtml(e.expenseId)}</p>` : ''}
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:3px;align-items:flex-end;">
        <div style="display:flex;gap:6px;align-items:baseline;">
          <span style="font-size:11px;color:#94a3b8;min-width:44px;text-align:right;">Issued</span>
          <strong style="font-size:11px;color:#475569;min-width:100px;text-align:left;">${fmtDate(e.reviewedAt ?? e.createdAt)}</strong>
        </div>
        <div style="display:flex;gap:6px;align-items:baseline;">
          <span style="font-size:11px;color:#94a3b8;min-width:44px;text-align:right;">Date</span>
          <strong style="font-size:11px;color:#475569;min-width:100px;text-align:left;">${fmtDate(e.date)}</strong>
        </div>
        ${paid ? `
        <div style="display:flex;gap:6px;align-items:baseline;">
          <span style="font-size:11px;color:#94a3b8;min-width:44px;text-align:right;">Paid</span>
          <strong style="font-size:11px;color:#475569;min-width:100px;text-align:left;">${fmtDate(paidOn)}</strong>
        </div>` : ''}
      </div>
      <p style="margin:10px 0 0;font-size:13px;font-weight:700;color:#94a3b8;">Status: <strong style="color:${accent};font-weight:700;">${statusLabel}</strong></p>
    </div>
  </div>

  <!-- DIVIDER -->
  <div style="height:1px;background:#e2e8f0;margin-bottom:20px;"></div>

  <!-- PAID TO -->
  <div style="margin-bottom:20px;">
    <p style="margin:0 0 10px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Paid To — ${escapeHtml(PAYEE_LABEL[e.origin] ?? 'Payee')}</p>
    <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#0f172a;">${payee}</p>
    ${payeeBin ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">BIN: ${escapeHtml(payeeBin)}</p>` : ''}
    ${e.projectId?.name ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">Project: ${escapeHtml(e.projectId.name)}${e.projectId.projectCode ? ` (#${escapeHtml(e.projectId.projectCode)})` : ''}</p>` : ''}
    ${e.venture && !e.projectId ? `<p style="margin:0;font-size:11px;color:#64748b;">Venture: ${escapeHtml(e.venture)}</p>` : ''}
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
        <td style="${TD}padding-left:0;font-size:12px;font-weight:600;color:#0f172a;white-space:nowrap;">${escapeHtml(e.expenseId ?? '—')}</td>
        <td style="${TD}">
          ${e.category ? `<p style="margin:0 0 2px;font-size:10px;font-weight:500;color:#94a3b8;line-height:1.3;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(e.category)}${e.subcategory ? ` / ${escapeHtml(e.subcategory)}` : ''}</p>` : ''}
          <p style="margin:0;font-size:13px;font-weight:600;color:#0f172a;line-height:1.4;">${escapeHtml(e.title)}</p>
          ${e.notes ? `<p style="margin:3px 0 0;font-size:10px;font-weight:400;color:#64748b;line-height:1.6;">${escapeHtml(e.notes)}</p>` : ''}
        </td>
        <td style="${TD}text-align:center;color:#64748b;">1</td>
        <td style="${TD}text-align:right;color:#64748b;white-space:nowrap;">${money(fig.gross, cur)}</td>
        <td style="${TD}text-align:right;padding-right:0;font-weight:700;color:#0f172a;white-space:nowrap;">${money(fig.gross, cur)}</td>
      </tr>
    </tbody>
  </table>

  <!-- TOTALS -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
    <div style="width:100%;max-width:400px;">
      <div style="height:2px;background:#0f172a;"></div>
      ${totalsHtml}
      ${isForeign ? `
      <div style="${ROW}">
        <span style="font-size:12px;color:#64748b;">Equivalent in BDT${hasWithholding ? ' (net)' : ''}</span>
        <span style="font-size:12px;color:#334155;font-weight:600;">${money(fig.netBDT, 'BDT')}</span>
      </div>` : ''}
      ${paid ? `
      <div style="${ROW}">
        <span style="font-size:12px;color:#16a34a;font-weight:500;">Paid</span>
        <span style="font-size:12px;color:#16a34a;font-weight:500;">−${money(fig.net, cur)}</span>
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
          <th style="${TH}text-align:left;">Paid From</th>
          <th style="${TH}text-align:left;">Method</th>
          <th style="${TH}text-align:center;">Transaction ID</th>
          <th style="${TH}text-align:right;padding-right:0;">Paid Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${TD}padding-left:0;white-space:nowrap;">${fmtDate(paidOn)}</td>
          <td style="${TD}">${escapeHtml(accountLabel ?? '—')}</td>
          <td style="${TD}">${escapeHtml([methodLabel, chLabel && chLabel !== methodLabel ? chLabel : null].filter(Boolean).join(' · ') || '—')}</td>
          <td style="${TD}text-align:center;font-family:monospace;font-size:11px;">${escapeHtml(e.paymentTxnId ?? ledgerTxnId ?? '—')}</td>
          <td style="${TD}text-align:right;padding-right:0;color:#16a34a;font-weight:600;white-space:nowrap;">${money(fig.net, cur)}</td>
        </tr>
      </tbody>
    </table>
  </div>` : ''}

  ${notes.length ? `
  <!-- TAX NOTES -->
  <div style="margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;background:#f8fafc;">
    <p style="margin:0 0 6px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Tax notes</p>
    ${notes.map(n => `<p style="margin:0 0 3px;font-size:11px;color:#475569;line-height:1.6;">${n}</p>`).join('')}
  </div>` : ''}

  <!-- SYSTEM NOTE -->
  <div style="border-top:1px solid #f1f5f9;padding-top:16px;margin-bottom:20px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#64748b;line-height:1.8;">This is a system generated payment voucher.</p>
  </div>

  <!-- FOOTER -->
  <div style="border-top:1px solid #e2e8f0;padding-top:12px;text-align:center;">
    <p style="margin:0 0 3px;font-size:11px;color:#94a3b8;">Generated on ${fmtDate(new Date())}${co.name ? ` – ${escapeHtml(co.name)}` : ''}</p>
  </div>

</div>
<script nonce="${cspNonce}">window.onload = () => window.print()</script>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Only our own nonce'd print script may run in this document.
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'nonce-${cspNonce}'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`,
        'Content-Disposition': `inline; filename="voucher-${String(voucherNo ?? e.id).replace(/[^A-Za-z0-9_-]/g, '')}.html"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/expenses/[id]/voucher]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
