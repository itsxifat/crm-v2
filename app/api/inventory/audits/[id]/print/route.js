export const dynamic = 'force-dynamic'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { AssetAudit } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { escapeHtml } from '@/lib/html'
import { getCompanyProfile } from '@/lib/finance/settings'
import { AUDIT_RESULT_META, AUDIT_STATUS_META, CONDITION_META, STATUS_META } from '@/lib/inventory/constants'
import { auditGuard, buildAuditDetail } from '../../_lib/audit'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'
const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' }) : '—'

const TH = 'padding:6px 8px;font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;'
const TD = 'padding:6px 8px;font-size:11px;color:#334155;border-bottom:1px solid #f1f5f9;vertical-align:top;'

const RESULT_COLORS = { FOUND: '#15803d', MISSING: '#b91c1c', WRONG_LOCATION: '#c2410c', DAMAGED: '#b45309', PENDING: '#64748b' }

function linesTable(lines, { showFound = false } = {}) {
  if (!lines.length) return `<p style="font-size:11px;color:#94a3b8;font-style:italic;margin:4px 0 0;">None.</p>`
  return `
  <table>
    <thead><tr>
      <th style="${TH}">#</th><th style="${TH}">Tag</th><th style="${TH}">Asset</th><th style="${TH}">Serial</th>
      <th style="${TH}">Expected at</th><th style="${TH}">Custodian</th>
      ${showFound ? '' : `<th style="${TH}">Found at</th>`}
      <th style="${TH}">Result</th><th style="${TH}">Condition</th><th style="${TH}">Note</th>
    </tr></thead>
    <tbody>
      ${lines.map((l, i) => `
      <tr>
        <td style="${TD}color:#94a3b8;">${i + 1}</td>
        <td style="${TD}font-family:Consolas,monospace;font-weight:600;white-space:nowrap;">${escapeHtml(l.assetTag ?? '')}</td>
        <td style="${TD}">${escapeHtml(l.assetName ?? '')}${l.asset?.category?.name ? `<br><span style="color:#94a3b8;">${escapeHtml(l.asset.category.name)}</span>` : ''}${l.asset && l.asset.status !== 'ASSIGNED' && l.asset.status !== 'IN_STOCK' ? `<br><span style="color:#b45309;">${escapeHtml(STATUS_META[l.asset.status]?.label ?? l.asset.status)}</span>` : ''}</td>
        <td style="${TD}font-family:Consolas,monospace;font-size:10px;">${escapeHtml(l.asset?.serialNumber ?? '—')}</td>
        <td style="${TD}">${escapeHtml(l.expectedLocation?.name ?? '—')}</td>
        <td style="${TD}">${escapeHtml(l.expectedEmployee?.name ?? '—')}</td>
        ${showFound ? '' : `<td style="${TD}">${escapeHtml(l.foundLocation?.name ?? '—')}</td>`}
        <td style="${TD}font-weight:600;color:${RESULT_COLORS[l.result] ?? '#334155'};white-space:nowrap;">${escapeHtml(AUDIT_RESULT_META[l.result]?.label ?? l.result)}</td>
        <td style="${TD}">${escapeHtml(CONDITION_META[l.condition]?.label ?? l.condition ?? '—')}</td>
        <td style="${TD}">${escapeHtml(l.note ?? '')}</td>
      </tr>`).join('')}
    </tbody>
  </table>`
}

function section(title, count, body, color = '#0f172a') {
  return `
  <div style="margin-bottom:18px;">
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:${color};">${escapeHtml(title)} <span style="font-weight:500;color:#94a3b8;">(${count})</span></p>
    ${body}
  </div>`
}

// GET /api/inventory/audits/[id]/print — physical verification report (variance
// list + signatures), server-rendered for browser print.
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = auditGuard(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const audit = await AssetAudit.findById(params.id).populate({ path: 'categoryId', select: 'name code' }).lean()
    if (!audit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [a, company] = await Promise.all([buildAuditDetail(audit), getCompanyProfile()])
    const companyName = company.name || 'Enfinito Bangladesh'
    const by = (r) => a.lines.filter(l => l.result === r)
    const s = a.summary
    const checked = s.total - s.pending
    const pct = s.total ? Math.round((checked / s.total) * 100) : 0
    const statusMeta = AUDIT_STATUS_META[a.status]
    const scope = [a.location?.name ?? 'All locations', a.category?.name ?? 'All categories'].join(' · ')

    const box = (label, value, color) => `
      <div style="flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;">
        <p style="margin:0;font-size:9.5px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;">${label}</p>
        <p style="margin:2px 0 0;font-size:18px;font-weight:700;color:${color};">${value}</p>
      </div>`

    const unexpectedHtml = a.unexpected.length ? `
      <table>
        <thead><tr><th style="${TH}">#</th><th style="${TH}">Tag</th><th style="${TH}">Description</th><th style="${TH}">Note</th></tr></thead>
        <tbody>${a.unexpected.map((u, i) => `
          <tr>
            <td style="${TD}color:#94a3b8;">${i + 1}</td>
            <td style="${TD}font-family:Consolas,monospace;font-weight:600;">${escapeHtml(u.tag ?? '—')}</td>
            <td style="${TD}">${escapeHtml(u.description ?? '')}</td>
            <td style="${TD}">${escapeHtml(u.note ?? '')}</td>
          </tr>`).join('')}</tbody>
      </table>` : `<p style="font-size:11px;color:#94a3b8;font-style:italic;margin:4px 0 0;">None.</p>`

    const cspNonce = randomBytes(16).toString('base64')
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<base href="${new URL(request.url).origin}/" />
<title>${escapeHtml(`Audit ${a.auditNo ?? ''} — ${a.name}`)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter','Segoe UI',sans-serif; background: #fff; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @page { size: A4 landscape; margin: 12mm 10mm; }
</style>
</head>
<body>
<div style="max-width:1060px;margin:0 auto;padding:8px 0;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
    <div>
      <img src="/en-logo.png" alt="${escapeHtml(companyName)}" width="110" height="34" style="object-fit:contain;display:block;margin-bottom:6px;" />
      <p style="margin:0;font-size:12.5px;font-weight:700;">${escapeHtml(companyName)}</p>
      ${company.address ? `<p style="margin:2px 0 0;font-size:10.5px;color:#64748b;">${escapeHtml(company.address)}</p>` : ''}
    </div>
    <div style="text-align:right;">
      <p style="margin:0;font-size:21px;font-weight:700;letter-spacing:-0.4px;">Physical Verification Report</p>
      <p style="margin:3px 0 0;font-size:12px;color:#64748b;">${escapeHtml(a.auditNo ?? '')} · ${escapeHtml(a.name)}</p>
      <p style="margin:3px 0 0;font-size:11px;font-weight:600;color:${statusMeta?.color === 'green' ? '#15803d' : statusMeta?.color === 'yellow' ? '#b45309' : '#64748b'};">${escapeHtml(statusMeta?.label ?? a.status)}</p>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px 18px;border:1px solid #e2e8f0;border-radius:10px;padding:10px 14px;background:#f8fafc;margin-bottom:12px;">
    <div><p style="margin:0;font-size:9.5px;color:#94a3b8;">Scope</p><p style="margin:1px 0 0;font-size:11.5px;font-weight:600;">${escapeHtml(scope)}</p></div>
    <div><p style="margin:0;font-size:9.5px;color:#94a3b8;">Started</p><p style="margin:1px 0 0;font-size:11.5px;font-weight:600;">${fmtDateTime(a.startedAt)}${a.createdBy?.name ? ` · ${escapeHtml(a.createdBy.name)}` : ''}</p></div>
    <div><p style="margin:0;font-size:9.5px;color:#94a3b8;">${a.status === 'CANCELLED' ? 'Cancelled' : 'Completed'}</p><p style="margin:1px 0 0;font-size:11.5px;font-weight:600;">${fmtDateTime(a.completedAt)}${a.completedBy?.name ? ` · ${escapeHtml(a.completedBy.name)}` : ''}</p></div>
    <div><p style="margin:0;font-size:9.5px;color:#94a3b8;">Progress</p><p style="margin:1px 0 0;font-size:11.5px;font-weight:600;">${checked} of ${s.total} checked (${pct}%)</p></div>
  </div>

  <div style="display:flex;gap:8px;margin-bottom:16px;">
    ${box('Expected', s.total, '#0f172a')}
    ${box('Found', s.found, '#15803d')}
    ${box('Missing', s.missing, '#b91c1c')}
    ${box('Wrong location', s.wrongLocation, '#c2410c')}
    ${box('Damaged', s.damaged, '#b45309')}
    ${box('Not checked', s.pending, '#64748b')}
    ${box('Unexpected', a.unexpected.length, '#4338ca')}
  </div>

  ${section('Missing', s.missing, linesTable(by('MISSING')), '#b91c1c')}
  ${section('Found in the wrong location', s.wrongLocation, linesTable(by('WRONG_LOCATION')), '#c2410c')}
  ${section('Damaged', s.damaged, linesTable(by('DAMAGED')), '#b45309')}
  ${s.pending ? section('Not checked', s.pending, linesTable(by('PENDING')), '#64748b') : ''}
  ${section('Unexpected items (not on the expected list)', a.unexpected.length, unexpectedHtml, '#4338ca')}
  ${section('Found as expected', s.found, linesTable(by('FOUND'), { showFound: true }), '#15803d')}

  ${a.notes ? `<div style="margin-bottom:16px;"><p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Notes</p><p style="margin:0;font-size:11px;color:#475569;white-space:pre-wrap;">${escapeHtml(a.notes)}</p></div>` : ''}

  <p style="margin:6px 0 0;font-size:10.5px;color:#64748b;">Missing assets are not written off by this report. Each one needs an investigation and an approved write-off (or a police GD for theft) before it leaves the register.</p>

  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:34px;margin-top:40px;">
    ${['Counted by', 'Verified by', 'Approved by'].map(t => `
    <div style="border-top:1px solid #94a3b8;padding-top:6px;">
      <p style="margin:0;font-size:11px;font-weight:600;">${t}</p>
      <p style="margin:10px 0 0;font-size:10px;color:#94a3b8;">Name & date: ______________________</p>
    </div>`).join('')}
  </div>

  <div style="border-top:1px solid #e2e8f0;padding-top:8px;margin-top:24px;text-align:center;">
    <p style="margin:0;font-size:10px;color:#94a3b8;">Printed ${fmtDate(new Date())}${session.user?.name ? ` by ${escapeHtml(session.user.name)}` : ''} – ${escapeHtml(companyName)}</p>
  </div>
</div>
<script nonce="${cspNonce}">window.onload = () => window.print()</script>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${cspNonce}'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`,
        'Content-Disposition': `inline; filename="audit-${String(a.auditNo ?? a.id).replace(/[^\w.-]/g, '_')}.html"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/inventory/audits/[id]/print]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
