export const dynamic = 'force-dynamic'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense } from '@/models'
import { requirePerm } from '@/lib/rbac'
import {
  computeBatchRef, allocateBatchRef, sharedBatchRef, expenseSettlement, moneyAccountText, tdsSectionText,
} from '@/lib/expensePayment'
import { getConfig } from '@/lib/getConfig'
import { getCompanyProfile } from '@/lib/finance/settings'
import { tdsSectionResolver } from '@/lib/tax/engine'
import { escapeHtml } from '@/lib/html'
import { isValidObjectId } from '@/lib/objectId'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// Currency amount, matching the client invoice's ৳-in-serif treatment for BDT.
function money(amount, currency = 'BDT') {
  const n = (Number(amount) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (!currency || currency === 'BDT') {
    return `<span style="font-size:13px;font-weight:400;letter-spacing:-0.5px;font-family:Georgia,serif">৳</span>&nbsp;${n}`
  }
  return `${escapeHtml(currency)}&nbsp;${n}`
}

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

const MAX_IDS = 200

const TH = 'padding:7px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:#64748b;border-bottom:1px solid #e2e8f0;background:#fff;border-top:2px solid #0f172a;'
const TD = 'padding:8px 16px;font-size:12.5px;color:#334155;border-bottom:1px solid #f1f5f9;vertical-align:top;'
const ROW = 'display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px solid #f1f5f9;'

// GET /api/expenses/combined-voucher?ids=a,b,c
// Printable, multi-page A4 combined expense invoice — visually identical to the
// client invoice (components/shared/InvoicePrintView.jsx): Inter font, logo
// header, #0f172a accents, the same table + totals styling. The header table
// repeats on every page and rows never split across a page break. Each row and
// the totals show the tax breakdown (gross, VAT in the bill, VDS / TDS deducted,
// net paid) and the summary names the money account(s) paid from.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    await connectDB()

    const idsParam = new URL(request.url).searchParams.get('ids') ?? ''
    const ids = [...new Set(idsParam.split(',').map(s => s.trim()).filter(Boolean))]
    if (ids.length === 0) return NextResponse.json({ error: 'No expenses selected' }, { status: 422 })
    if (ids.length > MAX_IDS) return NextResponse.json({ error: `Select at most ${MAX_IDS} expenses` }, { status: 422 })
    if (!ids.every(isValidObjectId)) return NextResponse.json({ error: 'Invalid expense id' }, { status: 400 })

    const [rows, company, appCfg] = await Promise.all([
      ProjectExpense.find({ _id: { $in: ids } })
        .sort({ date: 1, createdAt: 1 })
        .populate({ path: 'freelancerId',     select: 'userId', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'agencyId',         select: 'userId agencyInfo.agencyName', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'vendorId',         select: 'company' })
        .populate({ path: 'paidToEmployeeId', select: 'userId', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'projectId',        select: 'name projectCode' })
        .populate({ path: 'accountId',        select: 'name type bankName last4 mfsProvider currency' }),
      getCompanyProfile(),
      getConfig(),
    ])
    if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const co = {
      name:    company.name || 'Enfinito Bangladesh',
      address: company.address || '',
      phone:   company.phone || '',
      email:   company.email || '',
      website: company.website || '',
      bin:     company.bin || '',
      tin:     company.tin || '',
    }
    const taxIdLine = [co.bin && `BIN: ${co.bin}`, co.tin && `TIN: ${co.tin}`].filter(Boolean).join(' · ')

    const list = rows.map(r => ({ ...r.toJSON(), _fig: expenseSettlement(r) }))
    // Batch reference: the one these expenses already share, else — for a
    // fresh group of paid expenses — allocate a unique one and persist it so the
    // printed invoice number matches what batch-authorize records. Anything
    // else (mixed / unpaid selection) gets a non-persisted preview reference.
    let rawBatchRef = sharedBatchRef(list)
    if (!rawBatchRef) {
      if (list.every(e => e.status === 'PAID' && !e.batchInvoiceNo)) {
        rawBatchRef = await allocateBatchRef(list)
        await ProjectExpense.updateMany(
          { _id: { $in: list.map(e => e.id) }, status: 'PAID', batchInvoiceNo: null },
          { $set: { batchInvoiceNo: rawBatchRef } },
        )
      } else {
        rawBatchRef = computeBatchRef(list)
      }
    }
    const batchRef   = escapeHtml(rawBatchRef)
    const currencies = [...new Set(list.map(e => e._fig.currency))]
    const mixed      = currencies.length > 1

    // Totals in BDT (the tax side is always BDT).
    const totals = list.reduce((t, e) => {
      const f = e._fig
      t.gross += f.grossBDT
      t.vat   += f.vatBDT
      t.vds   += f.vdsBDT
      t.tds   += f.tdsBDT
      t.net   += f.netBDT
      return t
    }, { gross: 0, vat: 0, vds: 0, tds: 0, net: 0 })
    for (const k of Object.keys(totals)) totals[k] = round2(totals[k])
    const anyTax = totals.vat > 0 || totals.vds > 0 || totals.tds > 0

    const dayLabels  = [...new Set(list.map(e => fmtDate(e.date)))]
    const period     = dayLabels.length === 1 ? dayLabels[0] : `${dayLabels[0]} – ${dayLabels[dayLabels.length - 1]}`
    const categories = [...new Set(list.map(e => e.category || '—'))]
    const catLabel   = escapeHtml(categories.length === 1 ? categories[0] : 'Multiple categories')
    const title      = escapeHtml(categories.length === 1 ? categories[0] : 'Combined Expenses')
    const accent     = '#2563eb'

    // Payment method / transaction id / account (shown once the group is paid).
    const payMethods = appCfg.paymentMethods ?? []
    const gMethods   = [...new Set(list.map(e => e.paymentMethod).filter(Boolean))]
    const gTxns      = [...new Set(list.map(e => e.paymentTxnId).filter(Boolean))]
    const gAccounts  = [...new Set(list.map(e => moneyAccountText(e.accountId)).filter(Boolean))]
    const methodLabel = gMethods.length === 1 ? (payMethods.find(m => m.value === gMethods[0])?.label ?? gMethods[0]) : (gMethods.length > 1 ? 'Multiple' : null)
    const txnLabel    = gTxns.length === 1 ? gTxns[0] : (gTxns.length > 1 ? 'Multiple' : null)
    const accountLabel = gAccounts.length === 1 ? gAccounts[0] : (gAccounts.length > 1 ? 'Multiple accounts' : null)
    const hasPayment  = methodLabel || txnLabel || accountLabel

    const contactLine = [co.phone, co.email].filter(Boolean).join(' – ')
    // TDS section labels from Tax settings (custom sections included), one query for the batch.
    const resolveSection = await tdsSectionResolver(list.map(e => e.tax?.tdsSection))

    const rowTaxLine = (e) => {
      const f = e._fig
      if (!(f.vat > 0 || f.vds > 0 || f.tds > 0)) return ''
      const parts = []
      if (f.vat > 0) parts.push(`VAT ${money(f.vat, f.currency)}${e.tax?.mushakNo ? ` (6.3 No. ${escapeHtml(e.tax.mushakNo)})` : ''}`)
      if (f.vds > 0) parts.push(`VDS −${money(f.vds, f.currency)}`)
      if (f.tds > 0) {
        const sec = tdsSectionText(e.tax?.tdsSection, e.paidAt ?? new Date(), resolveSection)
        parts.push(`TDS −${money(f.tds, f.currency)}${sec ? ` (${escapeHtml(sec)})` : ''}`)
      }
      parts.push(`<strong style="color:#0f172a;">Net ${money(f.net, f.currency)}</strong>`)
      return `<div style="font-size:10px;font-weight:400;color:#64748b;margin-top:3px;line-height:1.5;">${parts.join(' · ')}</div>`
    }

    const cspNonce = randomBytes(16).toString('base64')
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
    ${hasPayment ? `<p style="margin:6px 0 0;font-size:11px;color:#475569;">${[
      accountLabel ? `Paid from <strong style="color:#0f172a;">${escapeHtml(accountLabel)}</strong>` : null,
      methodLabel ? `via <strong style="color:#0f172a;">${escapeHtml(methodLabel)}</strong>` : null,
      txnLabel ? `Txn ID: <strong style="color:#0f172a;">${escapeHtml(txnLabel)}</strong>` : null,
    ].filter(Boolean).join(' · ')}</p>` : ''}
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
        <td style="${TD}padding-left:0;font-size:12px;font-weight:600;color:#0f172a;white-space:nowrap;">${escapeHtml(e.expenseId ?? '—')}</td>
        <td style="${TD}font-size:12px;font-weight:500;color:#334155;white-space:nowrap;">${fmtDate(e.date)}</td>
        <td style="${TD}">
          ${e.category ? `<p style="margin:0 0 2px;font-size:10px;font-weight:500;color:#94a3b8;line-height:1.3;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(e.category)}${e.subcategory ? ` / ${escapeHtml(e.subcategory)}` : ''}</p>` : ''}
          <p style="margin:0;font-size:13px;font-weight:600;color:#0f172a;line-height:1.4;">${escapeHtml(e.title)}</p>
          ${e.projectId?.name ? `<p style="margin:3px 0 0;font-size:10px;font-weight:400;color:#64748b;line-height:1.6;">${escapeHtml(e.projectId.name)}${e.projectId.projectCode ? ` (#${escapeHtml(e.projectId.projectCode)})` : ''}</p>` : ''}
          ${e.notes ? `<p style="margin:3px 0 0;font-size:10px;font-weight:400;color:#94a3b8;line-height:1.5;">${escapeHtml(e.notes)}</p>` : ''}
          ${rowTaxLine(e)}
        </td>
        <td style="${TD}color:#64748b;">${escapeHtml(payeeOf(e))}</td>
        <td style="${TD}text-align:right;padding-right:0;font-weight:700;color:#0f172a;white-space:nowrap;">
          ${money(e._fig.gross, e._fig.currency)}
          ${e._fig.currency !== 'BDT' ? `<div style="font-size:10px;font-weight:400;color:#94a3b8;">≈ ${money(e._fig.grossBDT, 'BDT')}</div>` : ''}
        </td>
      </tr>`).join('')}
    </tbody>
  </table>

  <!-- TOTALS -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
    <div style="width:100%;max-width:340px;">
      <div style="height:2px;background:#0f172a;"></div>
      <div style="${ROW}">
        <span style="font-size:12px;color:#64748b;">Items</span>
        <span style="font-size:12px;color:#334155;font-weight:500;">${list.length}</span>
      </div>
      ${mixed ? `<div style="${ROW}">
        <span style="font-size:12px;color:#64748b;">Currencies</span>
        <span style="font-size:12px;color:#334155;font-weight:500;">${escapeHtml(currencies.join(', '))}</span>
      </div>` : ''}
      ${anyTax ? `
      <div style="${ROW}">
        <span style="font-size:12px;color:#64748b;">Gross amount (BDT)</span>
        <span style="font-size:12px;color:#334155;font-weight:500;white-space:nowrap;">${money(totals.gross, 'BDT')}</span>
      </div>
      ${totals.vat > 0 ? `<div style="${ROW}">
        <span style="font-size:11px;color:#94a3b8;font-style:italic;">of which VAT in bills</span>
        <span style="font-size:11px;color:#94a3b8;font-style:italic;white-space:nowrap;">${money(totals.vat, 'BDT')}</span>
      </div>` : ''}
      ${totals.vds > 0 ? `<div style="${ROW}">
        <span style="font-size:12px;color:#64748b;">Less: VDS deducted</span>
        <span style="font-size:12px;color:#b45309;font-weight:500;white-space:nowrap;">−${money(totals.vds, 'BDT')}</span>
      </div>` : ''}
      ${totals.tds > 0 ? `<div style="${ROW}">
        <span style="font-size:12px;color:#64748b;">Less: TDS deducted</span>
        <span style="font-size:12px;color:#b45309;font-weight:500;white-space:nowrap;">−${money(totals.tds, 'BDT')}</span>
      </div>` : ''}` : ''}
      <div style="display:flex;justify-content:space-between;padding:9px 16px;margin-top:3px;margin-left:-16px;margin-right:-16px;border-radius:8px;background:#f8fafc;">
        <span style="font-size:14px;font-weight:800;color:#0f172a;">${anyTax ? 'Net paid (BDT)' : 'Total (BDT)'}</span>
        <span style="font-size:14px;font-weight:800;color:#0f172a;white-space:nowrap;">${money(anyTax ? totals.net : totals.gross, 'BDT')}</span>
      </div>
    </div>
  </div>

  ${mixed ? `<div style="margin-bottom:16px;"><p style="margin:0 0 6px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Note</p><p style="margin:0;font-size:11px;color:#475569;line-height:1.7;">This combined invoice includes expenses in multiple currencies. The totals shown are the BDT-equivalent of the actual amounts spent.</p></div>` : ''}
  ${totals.vds > 0 || totals.tds > 0 ? `<div style="margin-bottom:16px;"><p style="margin:0;font-size:11px;color:#475569;line-height:1.7;">VAT and income tax deducted at source (${money(round2(totals.vds + totals.tds), 'BDT')}) are payable to the government: VDS via the VAT return with Mushak-6.6 certificates to suppliers; TDS by treasury challan with certificates to payees.</p></div>` : ''}

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
    ${co.name ? `<p style="margin:0;font-size:10px;color:#cbd5e1;letter-spacing:0.04em;">${escapeHtml(co.name)}</p>` : ''}
  </div>

</div>
<script nonce="${cspNonce}">window.onload = () => window.print()</script>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Only our own nonce'd print script may run in this document.
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${cspNonce}'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`,
        'Content-Disposition': `inline; filename="combined-expense-${String(rawBatchRef).replace(/[^A-Za-z0-9_-]/g, '')}.html"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/expenses/combined-voucher]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
