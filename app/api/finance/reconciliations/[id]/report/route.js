export const dynamic = 'force-dynamic'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MoneyAccount, Reconciliation } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { escapeHtml } from '@/lib/html'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { getCompanyProfile } from '@/lib/finance/settings'
import { getAccountBalances, accountTypeLabel, MFS_PROVIDER_LABELS } from '@/lib/finance/ledger'
import {
  liveSummary, storedSummary, sessionRows, outstandingRows, userNames, round2, EPS,
} from '../../_lib/reconcile'

const VIEW_PERMS = ['finance.accounts.reconcile', 'finance.accounts.view', 'finance.accounts.manage']

const STATUS_LABEL = { IN_PROGRESS: 'Draft — in progress', COMPLETED: 'Completed', UNDONE: 'Undone' }
const STATUS_COLOR = { IN_PROGRESS: '#d97706', COMPLETED: '#16a34a', UNDONE: '#dc2626' }
const STATUS_BG    = { IN_PROGRESS: '#fffbeb', COMPLETED: '#f0fdf4', UNDONE: '#fef2f2' }
const SYMBOLS = { BDT: '৳', USD: '$', EUR: '€', GBP: '£', INR: '₹' }

function money(amount, currency = 'BDT') {
  const n = Number(amount) || 0
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const sym = SYMBOLS[currency] ?? currency
  const symHtml = currency === 'BDT'
    ? '<span style="font-family:Georgia,serif;font-weight:400;font-size:1.05em;letter-spacing:-0.5px">৳</span>'
    : escapeHtml(sym)
  return `${n < -EPS ? '−' : ''}${symHtml}&nbsp;${abs}`
}

const TH = 'padding:6px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:left;'
const TD = 'padding:6px 10px;font-size:11.5px;color:#334155;border-bottom:1px solid #f1f5f9;vertical-align:top;'

function rowsTable(rows, currency, emptyText) {
  if (!rows.length) return `<p style="margin:6px 0 0;font-size:11.5px;color:#94a3b8;font-style:italic;">${escapeHtml(emptyText)}</p>`
  const body = rows.map(r => `
    <tr>
      <td style="${TD}white-space:nowrap;">${escapeHtml(dayKeyLabel(r.date))}</td>
      <td style="${TD}font-family:monospace;font-size:10.5px;white-space:nowrap;">${escapeHtml(r.txnId ?? '—')}</td>
      <td style="${TD}">${escapeHtml(r.description ?? r.category ?? '')}${r.cheque?.no ? `<br><span style="color:#64748b;font-size:10.5px;">Cheque ${escapeHtml(r.cheque.no)}</span>` : ''}${r.reference ? `<br><span style="color:#64748b;font-size:10.5px;">Ref ${escapeHtml(r.reference)}</span>` : ''}</td>
      <td style="${TD}text-align:right;white-space:nowrap;font-weight:600;">${money(r.amount, currency)}</td>
    </tr>`).join('')
  const total = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0))
  return `
    <table style="width:100%;border-collapse:collapse;margin-top:6px;">
      <thead><tr>
        <th style="${TH}">Date</th><th style="${TH}">Txn ID</th><th style="${TH}">Description</th><th style="${TH}text-align:right;">Amount</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td colspan="3" style="padding:7px 10px;font-size:11.5px;font-weight:700;color:#0f172a;">Total (${rows.length})</td>
        <td style="padding:7px 10px;font-size:11.5px;font-weight:700;color:#0f172a;text-align:right;white-space:nowrap;">${money(total, currency)}</td>
      </tr></tfoot>
    </table>`
}

// GET /api/finance/reconciliations/[id]/report — printable bank reconciliation statement (HTML)
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const recon = await Reconciliation.findById(params.id).lean()
    if (!recon) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const account = await MoneyAccount.findById(recon.accountId).lean()
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const currency = account.currency || 'BDT'
    const dayKey = dhakaDayKey(recon.statementDate)
    const [company, summary, cleared, outstanding, balances, users] = await Promise.all([
      getCompanyProfile(),
      recon.status === 'IN_PROGRESS' ? liveSummary(recon, account) : Promise.resolve(storedSummary(recon)),
      sessionRows(recon, account),
      outstandingRows(recon, account),
      getAccountBalances({ accountIds: [account._id], asOf: dayKey }),
      userNames([recon]),
    ])

    const clearedRows = cleared.rows.filter(r => r.cleared)
    const clearedIn  = round2(clearedRows.filter(r => r.type === 'INCOME').reduce((s, r) => s + r.amount, 0))
    const clearedOut = round2(clearedRows.filter(r => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0))
    const inTransit  = outstanding.filter(r => r.type === 'INCOME')
    const unpresented = outstanding.filter(r => r.type === 'EXPENSE')
    const inTransitTotal = round2(inTransit.reduce((s, r) => s + r.amount, 0))
    const unpresentedTotal = round2(unpresented.reduce((s, r) => s + r.amount, 0))
    const bookBalance = balances.get(String(account._id))?.balance ?? round2(Number(account.openingBalance) || 0)
    const adjusted = round2(summary.statementBalance + inTransitTotal - unpresentedTotal)
    const gap = round2(bookBalance - adjusted)

    const provider = account.type === 'MFS'
      ? (MFS_PROVIDER_LABELS[account.mfsProvider] ?? account.mfsProvider ?? 'Mobile wallet')
      : (account.bankName ?? accountTypeLabel(account.type))
    const accountLine = [provider, account.branchName, account.last4 ? `A/C ••${account.last4}` : null, currency]
      .filter(Boolean).join(' · ')
    const preparedBy = users.get(String(recon.completedBy ?? recon.createdBy ?? '')) ?? ''
    const statusLabel = STATUS_LABEL[recon.status] ?? recon.status
    const contact = [company.phone, company.email].filter(Boolean).join(' – ')

    const lineRow = (label, value, { strong = false, color = '#0f172a', note = '' } = {}) => `
      <tr>
        <td style="padding:8px 0;font-size:12.5px;color:${strong ? '#0f172a' : '#334155'};font-weight:${strong ? 700 : 500};border-bottom:1px solid #f1f5f9;">${label}${note ? `<br><span style="font-size:10.5px;color:#94a3b8;font-weight:400;">${note}</span>` : ''}</td>
        <td style="padding:8px 0;font-size:${strong ? '14px' : '12.5px'};color:${color};font-weight:${strong ? 800 : 600};text-align:right;white-space:nowrap;border-bottom:1px solid #f1f5f9;">${value}</td>
      </tr>`

    const cspNonce = randomBytes(16).toString('base64')
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<base href="${new URL(request.url).origin}/" />
<title>Bank reconciliation — ${escapeHtml(account.name)} — ${escapeHtml(dayKeyLabel(dayKey))}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter','Segoe UI',Roboto,sans-serif; background: #fff; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  h2 { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94a3b8; margin: 22px 0 4px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @page { size: A4; margin: 14mm 12mm; }
</style>
</head>
<body>
<div style="max-width:780px;margin:0 auto;padding:8px 0;">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px;">
    <div>
      <img src="/en-logo.png" alt="${escapeHtml(company.name || 'Company')}" width="120" height="38" style="object-fit:contain;display:block;margin-bottom:7px;" />
      ${company.name ? `<p style="font-size:13px;font-weight:700;">${escapeHtml(company.name)}</p>` : ''}
      ${company.address ? `<p style="font-size:11px;color:#64748b;">${escapeHtml(company.address)}</p>` : ''}
      ${contact ? `<p style="font-size:11px;color:#64748b;">${escapeHtml(contact)}</p>` : ''}
      ${company.bin ? `<p style="font-size:11px;color:#64748b;">BIN: ${escapeHtml(company.bin)}</p>` : ''}
    </div>
    <div style="text-align:right;">
      <p style="font-size:22px;font-weight:700;letter-spacing:-0.4px;">Bank Reconciliation Statement</p>
      <p style="margin-top:4px;font-size:12.5px;font-weight:700;">${escapeHtml(account.name)}</p>
      <p style="font-size:11px;color:#64748b;">${escapeHtml(accountLine)}</p>
      <p style="margin-top:4px;font-size:12px;color:#334155;">Statement date: <strong>${escapeHtml(dayKeyLabel(dayKey))}</strong></p>
      <span style="display:inline-block;margin-top:8px;padding:3px 12px;border-radius:999px;background:${STATUS_BG[recon.status] ?? '#f8fafc'};color:${STATUS_COLOR[recon.status] ?? '#334155'};font-size:10.5px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(statusLabel)}</span>
    </div>
  </div>
  <div style="height:1px;background:#e2e8f0;margin-bottom:6px;"></div>

  ${recon.status === 'UNDONE' ? `<p style="margin:10px 0;padding:10px 12px;border-radius:10px;background:#fef2f2;color:#b91c1c;font-size:11.5px;">This reconciliation was undone${recon.undoneAt ? ` on ${escapeHtml(dayKeyLabel(recon.undoneAt))}` : ''}${recon.undoReason ? ` — ${escapeHtml(recon.undoReason)}` : ''}. Figures are shown for reference only.</p>` : ''}

  <h2>Reconciliation</h2>
  <table>
    <tbody>
      ${lineRow(`Balance as per ${account.type === 'MFS' ? 'wallet' : 'bank'} statement on ${escapeHtml(dayKeyLabel(dayKey))}`, money(summary.statementBalance, currency), { strong: true })}
      ${lineRow(`Add: receipts recorded in books, not yet on the statement (${inTransit.length})`, money(inTransitTotal, currency), { note: 'Deposits in transit' })}
      ${lineRow(`Less: payments recorded in books, not yet on the statement (${unpresented.length})`, money(-unpresentedTotal, currency), { note: 'Unpresented cheques / pending debits' })}
      ${lineRow('Adjusted statement balance', money(adjusted, currency), { strong: true })}
      ${lineRow(`Balance as per books on ${escapeHtml(dayKeyLabel(dayKey))}`, money(bookBalance, currency), { strong: true })}
      ${lineRow('Unexplained difference', money(gap, currency), { strong: true, color: Math.abs(gap) > EPS ? '#dc2626' : '#16a34a', note: Math.abs(gap) > EPS ? 'Items dated after the statement, or edited after reconciling, can cause this.' : 'Books agree with the statement.' })}
    </tbody>
  </table>

  <h2>Cleared in this reconciliation</h2>
  <table>
    <tbody>
      ${lineRow('Opening balance (previous reconciliation / account opening)', money(summary.openingBalance, currency))}
      ${lineRow(`Money in cleared (${clearedRows.filter(r => r.type === 'INCOME').length})`, money(clearedIn, currency))}
      ${lineRow(`Money out cleared (${clearedRows.filter(r => r.type === 'EXPENSE').length})`, money(-clearedOut, currency))}
      ${lineRow('Cleared balance', money(summary.clearedBalance, currency), { strong: true })}
      ${lineRow('Difference to statement', money(summary.difference, currency), { color: Math.abs(summary.difference) > EPS ? '#dc2626' : '#16a34a' })}
    </tbody>
  </table>

  <h2>Receipts not yet on the statement</h2>
  ${rowsTable(inTransit, currency, 'None — every receipt up to the statement date is on the statement.')}

  <h2>Payments not yet on the statement</h2>
  ${rowsTable(unpresented, currency, 'None — every payment up to the statement date is on the statement.')}

  ${recon.notes ? `<h2>Notes</h2><p style="font-size:12px;color:#475569;white-space:pre-wrap;">${escapeHtml(recon.notes)}</p>` : ''}

  <div style="display:flex;justify-content:space-between;gap:24px;margin-top:48px;">
    ${['Prepared by', 'Checked by', 'Approved by'].map((label, i) => `
      <div style="flex:1;text-align:center;">
        <div style="height:28px;font-size:11.5px;color:#334155;">${i === 0 ? escapeHtml(preparedBy) : ''}</div>
        <div style="border-top:1px solid #94a3b8;padding-top:5px;font-size:10.5px;color:#64748b;">${label}</div>
      </div>`).join('')}
  </div>

  <div style="border-top:1px solid #e2e8f0;margin-top:28px;padding-top:10px;text-align:center;">
    <p style="font-size:10.5px;color:#94a3b8;">Generated on ${escapeHtml(dayKeyLabel(new Date()))}${recon.completedAt ? ` · Completed ${escapeHtml(dayKeyLabel(recon.completedAt))}` : ''}${company.name ? ` · ${escapeHtml(company.name)}` : ''}</p>
  </div>
</div>
<script nonce="${cspNonce}">window.onload = () => window.print()</script>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${cspNonce}'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`,
        'Content-Disposition': `inline; filename="reconciliation-${String(account.name).replace(/[^\w.-]+/g, '_')}-${dayKey}.html"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/finance/reconciliations/[id]/report]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
