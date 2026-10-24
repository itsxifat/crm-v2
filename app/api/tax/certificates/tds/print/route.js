export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { getFinanceSettings, getCompanyProfile } from '@/lib/finance/settings'
import { round2, isValidTin, PAYEE_TYPES } from '@/lib/tax/catalog'
import { tdsSectionResolver } from '@/lib/tax/engine'
import { addFiscalYears } from '@/lib/finance/fiscal'
import { amountToWords } from '@/lib/numberToWords'
import { parseIdList, num, errorResponse, depositAllocationsOf } from '../../../entries/_lib/common'
import { tdsSectionMeta } from '../../../entries/_lib/withholdingReturn'
import {
  loadCertificateSelection, certificateBlockers, printErrorTitle, issueSelection,
} from '../../_lib/selection'
import {
  esc, fmtDay, fmtTk, newNonce, renderDocument, printResponse, messageResponse, maskTin,
} from '../../../entries/_lib/print'

const EXTRA_CSS = `
  .hdr { position: relative; text-align: center; margin: 22px 0 14px; }
  .hdr .form-no { position: absolute; right: 0; top: -18px; font-weight: 700; font-size: 12px; border: 1px solid #334155; padding: 3px 8px; }
  .hdr h1 { font-size: 17px; }
  .hdr h2 { font-size: 13px; font-weight: 600; margin-top: 2px; }
  .hdr .rule { font-size: 10.5px; color: #475569; margin-top: 3px; }
  .part { margin-top: 14px; }
  .part-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #334155; margin-bottom: 5px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .panel { border: 1px solid #334155; padding: 8px 10px; }
  .panel .row { display: flex; gap: 6px; margin: 2px 0; }
  .panel .row .k { width: 92px; color: #475569; flex-shrink: 0; }
  .panel .row .v { font-weight: 600; }
  .cert-text { margin: 14px 0 0; line-height: 1.65; font-size: 12px; text-align: justify; }
  .sign { margin-top: 40px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 11.5px; }
  .sign .line { border-top: 1px solid #334155; padding-top: 4px; min-width: 260px; }
`

const payeeTypeLabel = (t) => PAYEE_TYPES.find(p => p.value === t)?.label ?? '—'

/** Section number / label from the stored TaxCode (custom sections included), else the catalog. */
function sectionText(code, date, resolve) {
  if (!code) return { no: '—', label: 'Section not recorded' }
  const meta = tdsSectionMeta(code, date, resolve)
  return { no: meta.section, label: meta.label }
}

// GET /api/tax/certificates/tds/print?ids=a,b,c[&preview=1]
// Certificate of tax deducted at source (Tofsil-2 style) for TDS_PAYABLE entries
// of one payee. READ-ONLY: unnumbered entries render as a DRAFT; numbered ones
// reprint their certificate. The number is assigned by POST (below), never by a GET.
export async function GET(request) {
  const origin = new URL(request.url).origin
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    const sp = new URL(request.url).searchParams
    let ids
    try { ids = parseIdList(sp.get('ids'), { max: 200 }) } catch (err) {
      return messageResponse({ origin, title: 'Cannot print the TDS certificate', message: err.message, status: 400 })
    }
    if (!ids.length) return messageResponse({ origin, title: 'Cannot print the TDS certificate', message: 'Select the TDS deductions to include.', status: 400 })

    await connectDB()
    const sel = await loadCertificateSelection(ids, 'TDS')
    if (sel.error) return messageResponse({ origin, title: printErrorTitle('TDS', sel.error), message: sel.error.message, status: sel.error.status })
    const { entries, numbers, isSalary } = sel

    const [settings, company] = await Promise.all([getFinanceSettings(), getCompanyProfile()])

    const cert = { number: numbers[0] ?? null, date: entries.find(e => e.certificate?.date)?.certificate?.date ?? null }
    const reprint = !!cert.number
    let draft = false
    const notices = []

    if (!reprint) {
      // Never issue on a GET: any same-origin <img>/link could trigger it.
      const canIssue = canDo(session, 'tax.manage')
      const blockers = certificateBlockers(entries, settings)
      draft = true
      notices.push({ level: 'warn', text: canIssue ? 'Draft — use "Issue" to assign the certificate number.' : 'Draft preview — you need the "Manage tax" permission to issue the certificate.' })
      for (const x of blockers) notices.push({ level: 'danger', text: `${x.e.entryNo}: ${x.r.reason}` })
    } else {
      notices.push({ level: 'info', text: `Reprint of certificate ${cert.number} issued on ${fmtDay(cert.date)}.` })
      // A certificate recorded as issued before the deposit (no longer accepted) — flag it.
      for (const x of certificateBlockers(entries, settings)) notices.push({ level: 'danger', text: `${x.e.entryNo}: ${x.r.reason}` })
    }

    // Challans covering these deductions — one row per challan with the part of
    // each deduction it paid (a deduction may be paid by several challans).
    const allocs = entries.flatMap(e => depositAllocationsOf(e))
    const depositIds = [...new Set(allocs.map(a => a.depositEntryId).filter(Boolean).map(String))]
    const [deposits, resolveSection] = await Promise.all([
      depositIds.length
        ? TaxEntry.find({ _id: { $in: depositIds } }).select('entryNo documentNo date deposit challan status').lean()
        : [],
      tdsSectionResolver(entries.map(e => e.section)),
    ])
    const depositById = new Map(deposits.map(d => [String(d._id), d]))
    const challanRows = []
    const challanIndex = new Map()
    for (const a of allocs) {
      const dep = a.depositEntryId ? depositById.get(String(a.depositEntryId)) : null
      const no = dep?.deposit?.challanNo ?? a.challanNo ?? '—'
      if (!challanIndex.has(no)) {
        challanIndex.set(no, challanRows.length)
        challanRows.push({
          no,
          date: dep?.deposit?.date ?? a.date ?? dep?.date ?? null,
          bank: [dep?.challan?.bank, dep?.challan?.branch].filter(Boolean).join(', '),
          code: dep?.challan?.accountCode ?? dep?.deposit?.accountCode ?? a.accountCode ?? '',
          amount: 0,
        })
      }
      const row = challanRows[challanIndex.get(no)]
      row.amount = round2(row.amount + num(a.amount))
    }

    const canSeeTin = canDo(session, 'pii.identity.view')
    const payee = entries[0]
    const payeeTinRaw = entries.map(e => e.partyTin).find(Boolean) ?? ''
    const payeeTin = payeeTinRaw ? (canSeeTin ? payeeTinRaw : maskTin(payeeTinRaw)) : ''
    if (payeeTinRaw && !canSeeTin) notices.push({ level: 'warn', text: 'The payee TIN is masked because you cannot view TINs — ask someone with identity access to print the certificate.' })
    if (!payeeTinRaw) notices.push({ level: 'warn', text: 'The payee has no TIN on record — add it to the vendor / freelancer profile; a certificate should show the 12-digit TIN.' })
    if (!isValidTin(company.tin)) notices.push({ level: 'danger', text: 'Company TIN is missing — set it in Tax settings so it prints on the certificate.' })
    if (!company.signatoryName) notices.push({ level: 'warn', text: 'No authorised signatory is set in Tax settings.' })

    const total = round2(entries.reduce((s, e) => s + num(e.amount), 0))
    const totalBase = round2(entries.reduce((s, e) => s + num(e.baseAmount), 0))
    const fys = [...new Set(entries.map(e => e.fiscalYear).filter(Boolean))]
    const ays = fys.map(fy => addFiscalYears(fy, 1, settings?.fiscalYearStartMonth ?? 7)).filter(Boolean)
    const sectionNos = [...new Set(entries.map(e => sectionText(e.section, e.date, resolveSection).no))]

    const paymentRows = entries.map((e, i) => {
      const s = sectionText(e.section, e.date, resolveSection)
      return `
      <tr>
        <td class="center">${i + 1}</td>
        <td class="center">${esc(fmtDay(e.date))}</td>
        <td class="mono">${esc(e.documentNo || e.entryNo)}</td>
        <td>s.${esc(s.no)} — ${esc(s.label)}${e.higherRateApplied ? '<br/><span style="font-size:10px;color:#92400e;">Higher rate (s.142)</span>' : ''}</td>
        <td class="num">${fmtTk(e.baseAmount)}</td>
        <td class="num">${e.rate != null ? esc(String(round2(e.rate))) : '—'}</td>
        <td class="num">${fmtTk(e.amount)}</td>
      </tr>`
    }).join('')

    const challanHtml = challanRows.length
      ? challanRows.map((c, i) => `
      <tr>
        <td class="center">${i + 1}</td>
        <td class="mono">${esc(c.no)}</td>
        <td class="center">${esc(fmtDay(c.date))}</td>
        <td>${esc(c.bank || '—')}</td>
        <td class="mono">${esc(c.code || '—')}</td>
        <td class="num">${fmtTk(c.amount)}</td>
      </tr>`).join('')
      : `<tr><td colspan="6" class="center" style="color:#b91c1c;">Not yet deposited</td></tr>`

    const zone = [settings?.incomeTax?.taxCircle, settings?.incomeTax?.taxZone].filter(Boolean).join(', ')
    const body = `
<div class="page">
  ${draft ? '<span class="copy-tag">Draft</span>' : ''}
  <div class="hdr">
    <span class="form-no">${isSalary ? 'Tofsil-1 (salary)' : 'Tofsil-2'}</span>
    <h1>Certificate of Tax Deducted at Source${isSalary ? ' from Salary' : ''}</h1>
    <h2 class="bn">উৎসে কর কর্তনের সনদপত্র</h2>
    <p class="rule">[See section 145 of the Income Tax Act, 2023 and rule 10 of the Withholding Tax Rules, 2026]</p>
  </div>

  <table class="kv">
    <tr><td class="k">Certificate no.</td><td class="v mono">${esc(cert.number || 'DRAFT — not issued')}</td>
        <td class="k">Date of issue</td><td class="v">${esc(cert.date ? fmtDay(cert.date) : '—')}</td></tr>
    <tr><td class="k">Income year</td><td class="v">${esc(fys.join(', ') || '—')}</td>
        <td class="k">Assessment year</td><td class="v">${esc(ays.join(', ') || '—')}</td></tr>
  </table>

  <div class="part two">
    <div>
      <p class="part-title">Part 1 — Deductor (payer)</p>
      <div class="panel">
        <div class="row"><span class="k">Name</span><span class="v">${esc(company.name || '—')}</span></div>
        <div class="row"><span class="k">TIN</span><span class="v mono">${esc(company.tin || '—')}</span></div>
        <div class="row"><span class="k">Address</span><span class="v">${esc(company.address || '—')}</span></div>
        ${company.bin ? `<div class="row"><span class="k">BIN</span><span class="v mono">${esc(company.bin)}</span></div>` : ''}
        ${zone ? `<div class="row"><span class="k">Circle / zone</span><span class="v">${esc(zone)}</span></div>` : ''}
      </div>
    </div>
    <div>
      <p class="part-title">Part 2 — ${isSalary ? 'Employee' : 'Deductee (payee)'}</p>
      <div class="panel">
        <div class="row"><span class="k">Name</span><span class="v">${esc(payee.partyName || '—')}</span></div>
        <div class="row"><span class="k">TIN</span><span class="v mono">${esc(payeeTin || 'Not provided')}</span></div>
        <div class="row"><span class="k">Address</span><span class="v">${esc(payee.partyAddress || '—')}</span></div>
        ${isSalary ? '' : `<div class="row"><span class="k">Status</span><span class="v">${esc(payeeTypeLabel(payee.payeeType))}</span></div>`}
      </div>
    </div>
  </div>

  <div class="part">
    <p class="part-title">Part 3 — ${isSalary ? 'Particulars of salary paid and tax deducted' : 'Particulars of payments and tax deducted'}</p>
    <table class="grid">
      <thead>
        <tr>
          <th style="width:5%;">Sl.</th>
          <th style="width:11%;">Date of payment</th>
          <th style="width:14%;">${isSalary ? 'Salary period / reference' : 'Bill / reference'}</th>
          <th>Nature of payment (section)</th>
          <th style="width:14%;">${isSalary ? 'Salary paid (Tk)' : 'Amount paid (Tk)'}</th>
          <th style="width:7%;">${isSalary ? 'Avg. rate (%)' : 'Rate (%)'}</th>
          <th style="width:13%;">Tax deducted (Tk)</th>
        </tr>
      </thead>
      <tbody>
        ${paymentRows}
        <tr class="total">
          <td colspan="4" class="right">Total</td>
          <td class="num">${fmtTk(totalBase)}</td>
          <td></td>
          <td class="num">${fmtTk(total)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="part">
    <p class="part-title">Part 4 — Particulars of deposit to the Government treasury</p>
    <table class="grid">
      <thead>
        <tr>
          <th style="width:5%;">Sl.</th>
          <th>Challan / e-payment no.</th>
          <th style="width:12%;">Date</th>
          <th>Bank &amp; branch</th>
          <th style="width:14%;">Account code</th>
          <th style="width:14%;">Amount (Tk)</th>
        </tr>
      </thead>
      <tbody>${challanHtml}</tbody>
    </table>
  </div>

  <p class="cert-text">
    ${isSalary
      ? `Certified that a sum of <strong>Tk ${fmtTk(total)}</strong> (${esc(amountToWords(total, 'BDT'))}) has been deducted at source
    as income tax from the salary paid to the employee named above under section 86 of the Income Tax Act, 2023, and paid
    to the credit of the Government as per the challan(s) stated above.`
      : `Certified that a sum of <strong>Tk ${fmtTk(total)}</strong> (${esc(amountToWords(total, 'BDT'))}) has been deducted at source
    from the payment(s) described above under section${sectionNos.length > 1 ? 's' : ''} ${esc(sectionNos.join(', '))} of the
    Income Tax Act, 2023, and paid to the credit of the Government as per the challan(s) stated above.`}
  </p>

  <div class="sign">
    <div>
      <p>Place: ${esc(company.address ? company.address.split(',').slice(-1)[0].trim() : '')}</p>
      <p>Date: ${esc(cert.date ? fmtDay(cert.date) : '')}</p>
    </div>
    <div class="line">
      <p>Signature: ______________________</p>
      <p style="margin-top:6px;">Name: <strong>${esc(company.signatoryName || '')}</strong></p>
      <p>Designation: ${esc(company.signatoryDesignation || '')}</p>
      <p>Seal:</p>
    </div>
  </div>
</div>`

    const nonce = newNonce()
    const html = renderDocument({
      title: `TDS certificate ${cert.number ?? 'draft'} — ${payee.partyName ?? ''}`,
      origin, nonce, body, notices, draft, extraCss: EXTRA_CSS,
      autoPrint: !draft,
    })
    return printResponse(html, nonce, `tds-certificate-${cert.number ?? 'draft'}`)
  } catch (err) {
    if (err?.status && err.status < 500) {
      return messageResponse({ origin, title: 'Cannot print the TDS certificate', message: err.message, status: err.status })
    }
    return errorResponse(err, '[GET /api/tax/certificates/tds/print]')
  }
}

// POST /api/tax/certificates/tds/print  { ids: string[] }
// Issue the TDS certificate: assigns TDSYYMM### (status ISSUED, dated today)
// to a ready (deposited), unnumbered selection. Idempotent: an already numbered
// selection returns its number. GET ?ids=... then prints it.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.manage')
    if (denied) return denied

    const body = await request.json().catch(() => null)
    let ids
    try { ids = parseIdList(body?.ids, { max: 200 }) } catch (err) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }

    await connectDB()
    const sel = await loadCertificateSelection(ids, 'TDS')
    if (sel.error) return NextResponse.json({ error: sel.error.message }, { status: sel.error.status })
    const { entries, numbers, isSalary } = sel
    if (numbers.length) {
      const date = entries.find(e => e.certificate?.date)?.certificate?.date ?? null
      return NextResponse.json({ data: { number: numbers[0], date, alreadyIssued: true } })
    }

    const settings = await getFinanceSettings()
    const blockers = certificateBlockers(entries, settings)
    if (blockers.length) {
      return NextResponse.json({
        error: 'The TDS certificate cannot be issued yet — every deduction on it must already be deposited by challan',
        details: blockers.map(x => `${x.e.entryNo}: ${x.r.reason}`),
      }, { status: 409 })
    }

    const issued = await issueSelection({ entries, kind: 'TDS', isSalary, session, request })
    return NextResponse.json({ data: { number: issued.number, date: issued.date, alreadyIssued: false } }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/tax/certificates/tds/print]')
  }
}
