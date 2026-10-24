export const dynamic = 'force-dynamic'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { SalaryRevision } from '@/models'
import { getCompanyProfile } from '@/lib/finance/settings'
import { amountToWords } from '@/lib/numberToWords'
import { escapeHtml } from '@/lib/html'
import { BENGALI_FONT_CSS } from '@/lib/printFonts'
import { isValidObjectId } from '@/lib/objectId'
import { canSeeSalaries, periodLabel, round2 } from '@/lib/hr/salaryRevisions'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'
const money = (n) => `<span style="font-family:var(--font-bengali),serif;font-size:1.05em">৳</span>&nbsp;${Number(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SUBJECT = {
  INCREMENT:  'Salary increment',
  PROMOTION:  'Promotion and salary revision',
  ADJUSTMENT: 'Salary revision',
  DECREASE:   'Salary revision',
}

// GET /api/salary-revisions/:id/letter — printable letter for an approved salary
// change. HR (anyone who may see salaries) or the employee themselves.
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const [rev, profile] = await Promise.all([
      SalaryRevision.findById(params.id)
        .populate({ path: 'employeeId', select: 'employeeId designation position department userId', populate: { path: 'userId', select: 'name' } })
        .lean(),
      getCompanyProfile(),
    ])
    if (!rev || rev.status !== 'APPROVED' || !rev.letterNo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const emp = rev.employeeId ?? {}
    const own = String(emp.userId?._id ?? emp.userId ?? '') === String(session.user.id)
    if (!own && !canSeeSalaries(session)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const company = {
      name:    profile.name || 'Enfinito',
      address: profile.address || '',
      contact: [profile.phone, profile.email].filter(Boolean).join(' – '),
      website: profile.website || '',
      signatory: profile.signatoryName || '',
      signatoryTitle: profile.signatoryDesignation || 'Authorised signatory',
    }
    const name = emp.userId?.name ?? 'Employee'
    const firstName = String(name).split(/\s+/)[0]
    const change = round2(rev.newSalary - rev.previousSalary)
    const pct = rev.previousSalary > 0 ? round2((change / rev.previousSalary) * 100) : null
    const designation = rev.newDesignation || emp.designation || emp.position || ''
    const from = periodLabel(rev.effectiveMonth)

    let body
    if (rev.type === 'PROMOTION') {
      body = `<p>We are pleased to inform you that you have been promoted to the position of <strong>${escapeHtml(rev.newDesignation ?? designation)}</strong>${rev.previousDesignation ? ` from ${escapeHtml(rev.previousDesignation)}` : ''}, effective from <strong>${escapeHtml(from)}</strong>.</p>
      <p>${change !== 0 ? `With this promotion, your monthly gross salary has been revised from ${money(rev.previousSalary)} to <strong>${money(rev.newSalary)}</strong>${change > 0 ? `, an increase of ${money(change)}${pct !== null ? ` (${pct}%)` : ''}` : ''}.` : `Your monthly gross salary remains ${money(rev.newSalary)}.`}</p>`
    } else if (rev.type === 'INCREMENT') {
      body = `<p>In recognition of your performance and contribution, we are pleased to inform you that your monthly gross salary has been increased from ${money(rev.previousSalary)} to <strong>${money(rev.newSalary)}</strong>, an increase of ${money(change)}${pct !== null ? ` (${pct}%)` : ''}, effective from <strong>${escapeHtml(from)}</strong>.</p>`
    } else {
      body = `<p>This is to inform you that your monthly gross salary has been revised from ${money(rev.previousSalary)} to <strong>${money(rev.newSalary)}</strong>, effective from <strong>${escapeHtml(from)}</strong>.</p>`
    }
    const closing = ['INCREMENT', 'PROMOTION'].includes(rev.type)
      ? '<p>Congratulations, and thank you for your contribution. We look forward to your continued success with us.</p>'
      : ''

    const cspNonce = randomBytes(16).toString('base64')
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<base href="${new URL(request.url).origin}/" />
<title>${escapeHtml(SUBJECT[rev.type])} — ${escapeHtml(name)} — ${escapeHtml(rev.letterNo)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  ${BENGALI_FONT_CSS}
  body { font-family: 'Inter','Segoe UI', var(--font-bengali), sans-serif; background: #fff; color: #0f172a; }
  .letter p { font-size: 13.5px; line-height: 1.75; color: #1e293b; margin: 0 0 14px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @page { size: A4; margin: 18mm 16mm; }
</style>
</head>
<body>
<div style="max-width:720px;margin:0 auto;padding:8px 0;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:26px;">
    <div>
      <img src="/en-logo.png" alt="${escapeHtml(company.name)}" width="120" height="38" style="object-fit:contain;display:block;margin-bottom:7px;" />
      <p style="margin:0 0 2px;font-size:13px;font-weight:700;">${escapeHtml(company.name)}</p>
      ${company.address ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">${escapeHtml(company.address)}</p>` : ''}
      ${company.contact ? `<p style="margin:0 0 2px;font-size:11px;color:#64748b;">${escapeHtml(company.contact)}</p>` : ''}
      ${company.website ? `<p style="margin:0;font-size:11px;color:#64748b;">${escapeHtml(company.website)}</p>` : ''}
    </div>
    <div style="text-align:right;font-size:12px;color:#64748b;line-height:1.7;">
      <p>Ref: <strong style="color:#0f172a;">${escapeHtml(rev.letterNo)}</strong></p>
      <p>Date: <strong style="color:#0f172a;">${fmtDate(rev.approvedAt)}</strong></p>
    </div>
  </div>

  <div style="margin-bottom:22px;font-size:13px;line-height:1.7;">
    <p style="font-weight:700;">${escapeHtml(name)}</p>
    ${designation ? `<p style="color:#475569;">${escapeHtml(designation)}${emp.department ? `, ${escapeHtml(emp.department)}` : ''}</p>` : ''}
    ${emp.employeeId ? `<p style="color:#475569;">Employee ID: ${escapeHtml(emp.employeeId)}</p>` : ''}
  </div>

  <p style="margin-bottom:20px;font-size:13.5px;font-weight:700;">Subject: ${escapeHtml(SUBJECT[rev.type])}</p>

  <div class="letter">
    <p>Dear ${escapeHtml(firstName)},</p>
    ${body}
    <div style="margin:4px 0 18px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;padding:14px 18px;">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
        <tr><td style="padding:4px 0;color:#64748b;">Previous monthly gross salary</td><td style="padding:4px 0;text-align:right;">${money(rev.previousSalary)}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Monthly gross salary from ${escapeHtml(from)}</td><td style="padding:4px 0;text-align:right;font-weight:700;">${money(rev.newSalary)}</td></tr>
        <tr><td colspan="2" style="padding:8px 0 0;color:#64748b;font-size:11px;font-style:italic;border-top:1px solid #e2e8f0;">In words: ${escapeHtml(amountToWords(rev.newSalary, 'BDT'))} per month</td></tr>
      </table>
    </div>
    <p>All other terms and conditions of your employment remain unchanged.</p>
    ${closing}
  </div>

  <div style="margin-top:46px;font-size:13px;line-height:1.7;">
    <p>Sincerely,</p>
    <div style="height:46px;"></div>
    <div style="width:220px;border-top:1px solid #94a3b8;padding-top:6px;">
      ${company.signatory ? `<p style="font-weight:700;">${escapeHtml(company.signatory)}</p>` : ''}
      <p style="color:#475569;">${escapeHtml(company.signatoryTitle)}</p>
      <p style="color:#475569;">${escapeHtml(company.name)}</p>
    </div>
  </div>

  <div style="margin-top:40px;border-top:1px solid #f1f5f9;padding-top:10px;text-align:center;">
    <p style="font-size:10.5px;color:#94a3b8;">${escapeHtml(rev.letterNo)} · issued ${fmtDate(rev.approvedAt)} · ${escapeHtml(company.name)}</p>
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
        'Content-Disposition': `inline; filename="salary-letter-${String(rev.letterNo).replace(/[^\w.-]/g, '_')}.html"`,
      },
    })
  } catch (err) {
    console.error('[GET /api/salary-revisions/:id/letter]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
