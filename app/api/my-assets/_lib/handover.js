/**
 * Equipment handover & acknowledgement form (server-rendered, browser-print).
 * Used by:
 *   GET /api/my-assets/handover              — all equipment held by the signed-in employee
 *   GET /api/my-assets/[id]/handover         — one asset (assignee or inventory/HR staff)
 *   GET /api/employees/[id]/assets/handover  — all equipment held by an employee (HR / inventory)
 */

import { randomBytes } from 'crypto'
import { AssetEvent } from '@/models'
import { escapeHtml } from '@/lib/html'
import { qrSvg } from '@/lib/qr'
import { getCompanyProfile } from '@/lib/finance/settings'
import { STATUS_META, CONDITION_META, ACK_META } from '@/lib/inventory/constants'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'

const TH = 'padding:7px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;border-bottom:1px solid #e2e8f0;background:#f8fafc;text-align:left;'
const TD = 'padding:8px 10px;font-size:11.5px;color:#334155;border-bottom:1px solid #f1f5f9;vertical-align:top;'

/**
 * Load the hand-over (ASSIGNED) events for the given lean assets:
 * acknowledgement.eventId when set, otherwise the latest ASSIGNED event to the current holder.
 * @returns {Promise<Map<string, object>>} assetId → lean AssetEvent
 */
export async function loadAssignEvents(assets) {
  const out = new Map()
  if (!assets.length) return out
  const byEventId = assets.map(a => a.acknowledgement?.eventId).filter(Boolean)
  const events = byEventId.length
    ? await AssetEvent.find({ _id: { $in: byEventId } }).select('assetId date createdByName condition notes').lean()
    : []
  for (const ev of events) out.set(String(ev.assetId), ev)
  const missing = assets.filter(a => !out.has(String(a._id)))
  if (missing.length) {
    const latest = await AssetEvent.find({
      assetId: { $in: missing.map(a => a._id) },
      type: { $in: ['ASSIGNED', 'OPENING', 'CREATED', 'RECEIVED'] },
    }).sort({ date: -1, createdAt: -1 }).select('assetId type date createdByName condition notes toEmployeeId').lean()
    for (const a of missing) {
      const ev = latest.find(e => String(e.assetId) === String(a._id) &&
        (e.type !== 'ASSIGNED' || !a.assignedEmployeeId || String(e.toEmployeeId) === String(a.assignedEmployeeId?._id ?? a.assignedEmployeeId)))
      if (ev) out.set(String(a._id), ev)
    }
  }
  return out
}

/**
 * Build the printable HTML response.
 *
 * @param {object} p
 * @param {Request} p.request
 * @param {object}  p.employee  { name, employeeId, designation, department }
 * @param {object[]} p.assets   lean assets with categoryId / locationId populated
 * @param {Map}     p.assignEvents  from loadAssignEvents
 * @param {string}  [p.printedBy]
 * @returns {Promise<Response>}
 */
export async function handoverResponse({ request, employee, assets, assignEvents, printedBy = null }) {
  const origin  = new URL(request.url).origin
  const company = await getCompanyProfile()
  const companyName = company.name || 'Enfinito Bangladesh'
  const contactLine = [company.phone, company.email].filter(Boolean).join(' – ')

  const qrs = await Promise.all(assets.map(a =>
    qrSvg(`${origin}/admin/inventory/assets/tag/${encodeURIComponent(a.assetTag)}`, { size: 54 }).catch(() => '')))

  const rowsHtml = assets.map((a, i) => {
    const ev = assignEvents.get(String(a._id))
    const details = [a.brand, a.model].filter(Boolean).join(' ')
    const ack = a.acknowledgement?.status ?? 'NOT_REQUIRED'
    const ackText = ack === 'ACCEPTED'
      ? `Acknowledged ${fmtDate(a.acknowledgement?.at)}`
      : ACK_META[ack]?.label ?? ack
    return `
      <tr>
        <td style="${TD}width:24px;color:#94a3b8;">${i + 1}</td>
        <td style="${TD}">
          <p style="margin:0;font-family:Consolas,monospace;font-size:12px;font-weight:700;color:#0f172a;">${escapeHtml(a.assetTag)}</p>
          <p style="margin:2px 0 0;font-weight:600;color:#0f172a;">${escapeHtml(a.name)}</p>
          ${details ? `<p style="margin:2px 0 0;color:#64748b;">${escapeHtml(details)}</p>` : ''}
          ${a.specs ? `<p style="margin:2px 0 0;color:#64748b;white-space:pre-wrap;">${escapeHtml(a.specs)}</p>` : ''}
        </td>
        <td style="${TD}">${escapeHtml(a.categoryId?.name ?? '—')}</td>
        <td style="${TD}font-family:Consolas,monospace;font-size:11px;">${escapeHtml(a.serialNumber ?? '—')}</td>
        <td style="${TD}">${escapeHtml(CONDITION_META[ev?.condition ?? a.condition]?.label ?? a.condition ?? '—')}
          ${a.status !== 'ASSIGNED' ? `<p style="margin:2px 0 0;color:#b45309;font-size:10.5px;">${escapeHtml(STATUS_META[a.status]?.label ?? a.status)}</p>` : ''}</td>
        <td style="${TD}">${fmtDate(a.assignedAt ?? ev?.date)}
          ${ev?.createdByName ? `<p style="margin:2px 0 0;color:#64748b;font-size:10.5px;">by ${escapeHtml(ev.createdByName)}</p>` : ''}
          ${a.expectedReturnDate ? `<p style="margin:2px 0 0;color:#64748b;font-size:10.5px;">Return by ${fmtDate(a.expectedReturnDate)}</p>` : ''}</td>
        <td style="${TD}font-size:10.5px;color:${ack === 'ACCEPTED' ? '#15803d' : ack === 'DECLINED' ? '#b91c1c' : '#64748b'};">${escapeHtml(ackText)}</td>
        <td style="${TD}width:62px;text-align:center;">${qrs[i] || ''}</td>
      </tr>`
  }).join('')

  const issuers = [...new Set(assets.map(a => assignEvents.get(String(a._id))?.createdByName).filter(Boolean))]
  const terms = [
    `The equipment listed above remains the property of ${companyName}. It is issued to me for official work only.`,
    'I will take reasonable care of it, keep it secure, and will not lend, sell, pledge or alter it, or install unlicensed software on it.',
    'I will report any damage, fault, loss or theft immediately through My Assets or to my manager. For theft I will help obtain a police General Diary (GD) number.',
    'I will return the equipment with its accessories when asked, when I change role, and before my last working day. My exit clearance depends on it.',
    'Any deduction for damage or loss will be made only where it is directly caused by my neglect or default, after an enquiry in which I can explain, and will never exceed the actual loss — as allowed by sections 125 and 127 of the Bangladesh Labour Act, 2006 and company policy. Normal wear and tear is not my liability.',
  ]

  const cspNonce = randomBytes(16).toString('base64')
  const title = assets.length === 1 ? `Handover ${assets[0].assetTag}` : `Equipment handover — ${employee.name ?? ''}`
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<base href="${origin}/" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter','Segoe UI',sans-serif; background: #fff; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  svg { display: block; margin: 0 auto; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @page { size: A4; margin: 14mm 12mm; }
</style>
</head>
<body>
<div style="max-width:780px;margin:0 auto;padding:8px 0;">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;">
    <div>
      <img src="/en-logo.png" alt="${escapeHtml(companyName)}" width="120" height="38" style="object-fit:contain;display:block;margin-bottom:7px;" />
      <p style="margin:0 0 2px;font-size:13px;font-weight:700;">${escapeHtml(companyName)}</p>
      ${company.address ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">${escapeHtml(company.address)}</p>` : ''}
      ${contactLine ? `<p style="margin:0;font-size:11px;color:#64748b;">${escapeHtml(contactLine)}</p>` : ''}
    </div>
    <div style="text-align:right;">
      <p style="margin:0;font-size:22px;font-weight:700;letter-spacing:-0.4px;">Equipment Handover</p>
      <p style="margin:2px 0 0;font-size:12px;font-weight:600;color:#64748b;">&amp; Acknowledgement of Receipt</p>
      <p style="margin:8px 0 0;font-size:11px;color:#94a3b8;">Printed ${fmtDate(new Date())}</p>
    </div>
  </div>

  <div style="height:1px;background:#e2e8f0;margin-bottom:16px;"></div>

  <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;margin-bottom:18px;background:#f8fafc;">
    <p style="margin:0 0 10px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Issued to</p>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px 18px;">
      <div><p style="margin:0 0 2px;font-size:10px;color:#94a3b8;">Name</p><p style="margin:0;font-size:13px;font-weight:700;">${escapeHtml(employee.name ?? '—')}</p></div>
      <div><p style="margin:0 0 2px;font-size:10px;color:#94a3b8;">Employee ID</p><p style="margin:0;font-size:12.5px;font-weight:600;color:#334155;">${escapeHtml(employee.employeeId ?? '—')}</p></div>
      <div><p style="margin:0 0 2px;font-size:10px;color:#94a3b8;">Designation</p><p style="margin:0;font-size:12.5px;font-weight:600;color:#334155;">${escapeHtml(employee.designation ?? '—')}</p></div>
      <div><p style="margin:0 0 2px;font-size:10px;color:#94a3b8;">Department</p><p style="margin:0;font-size:12.5px;font-weight:600;color:#334155;">${escapeHtml(employee.department ?? '—')}</p></div>
    </div>
  </div>

  <table style="margin-bottom:18px;">
    <thead>
      <tr>
        <th style="${TH}">#</th>
        <th style="${TH}">Asset</th>
        <th style="${TH}">Category</th>
        <th style="${TH}">Serial no.</th>
        <th style="${TH}">Condition</th>
        <th style="${TH}">Issued</th>
        <th style="${TH}">Status</th>
        <th style="${TH}text-align:center;">Tag</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || `<tr><td colspan="8" style="${TD}text-align:center;color:#94a3b8;font-style:italic;">No equipment is currently issued.</td></tr>`}</tbody>
  </table>

  <div style="margin-bottom:22px;">
    <p style="margin:0 0 8px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;">Terms of issue</p>
    <ol style="padding-left:18px;">
      ${terms.map(t => `<li style="font-size:11px;color:#334155;line-height:1.6;margin-bottom:4px;">${escapeHtml(t)}</li>`).join('')}
    </ol>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:36px;">
    <div>
      <div style="border-top:1px solid #94a3b8;padding-top:6px;">
        <p style="margin:0;font-size:11px;font-weight:600;color:#0f172a;">Received by (employee)</p>
        <p style="margin:2px 0 0;font-size:11px;color:#64748b;">${escapeHtml(employee.name ?? '')}</p>
        <p style="margin:10px 0 0;font-size:10.5px;color:#94a3b8;">Date: ____________________</p>
      </div>
    </div>
    <div>
      <div style="border-top:1px solid #94a3b8;padding-top:6px;">
        <p style="margin:0;font-size:11px;font-weight:600;color:#0f172a;">Issued by (for ${escapeHtml(companyName)})</p>
        <p style="margin:2px 0 0;font-size:11px;color:#64748b;">${escapeHtml(issuers.join(', '))}</p>
        <p style="margin:10px 0 0;font-size:10.5px;color:#94a3b8;">Date: ____________________</p>
      </div>
    </div>
  </div>

  <div style="border-top:1px solid #e2e8f0;padding-top:10px;margin-top:28px;text-align:center;">
    <p style="margin:0;font-size:10.5px;color:#94a3b8;">Generated from the asset register${printedBy ? ` by ${escapeHtml(printedBy)}` : ''} – ${escapeHtml(companyName)}. Scan a tag to open the asset record.</p>
  </div>
</div>
<script nonce="${cspNonce}">window.onload = () => window.print()</script>
</body>
</html>`

  const fileStem = (assets.length === 1 ? assets[0].assetTag : `handover-${employee.employeeId ?? employee.name ?? 'employee'}`)
    .replace(/[^\w.-]/g, '_')
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${cspNonce}'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`,
      'Content-Disposition': `inline; filename="${fileStem}.html"`,
    },
  })
}
