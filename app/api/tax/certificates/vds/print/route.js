export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry, TaxFiling } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { getFinanceSettings, getCompanyProfile } from '@/lib/finance/settings'
import { getVatServiceCode } from '@/lib/tax/engine'
import { round2, isValidBin } from '@/lib/tax/catalog'
import { periodLabel } from '@/lib/finance/fiscal'
import { parseIdList, num, returnPeriodOf, errorResponse, depositAllocationsOf } from '../../../entries/_lib/common'
import {
  loadCertificateSelection, certificateBlockers, printErrorTitle, issueSelection,
} from '../../_lib/selection'
import {
  esc, fmtDay, fmtTk, newNonce, renderDocument, printResponse, messageResponse,
} from '../../../entries/_lib/print'

const COPY_LABELS = ['Original — for the VAT circle office', 'Duplicate — for the supplier', 'Triplicate — office copy (keep 5 years)']

const EXTRA_CSS = `
  .hdr { position: relative; text-align: center; margin: 22px 0 12px; }
  .hdr .form-no { position: absolute; right: 0; top: -18px; font-weight: 700; font-size: 12px; border: 1px solid #334155; padding: 3px 8px; }
  .hdr .gov { font-size: 12px; font-weight: 600; }
  .hdr h1 { font-size: 17px; margin-top: 8px; }
  .hdr h2 { font-size: 13px; font-weight: 600; margin-top: 2px; }
  .hdr .rule { font-size: 10.5px; color: #475569; margin-top: 2px; }
  .cert-text { margin: 12px 0; line-height: 1.6; font-size: 12px; text-align: justify; }
  .method { display: inline-block; margin-right: 10px; }
  .box { display: inline-block; width: 11px; height: 11px; border: 1px solid #334155; vertical-align: -1px; margin-right: 4px; text-align: center; font-size: 9px; line-height: 10px; }
  .sign { margin-top: 42px; display: flex; justify-content: flex-end; }
  .sign .line { border-top: 1px solid #334155; padding-top: 4px; min-width: 260px; font-size: 11.5px; }
  .foot { margin-top: 18px; font-size: 10.5px; color: #475569; border-top: 1px dashed #cbd5e1; padding-top: 6px; }
`

function renderPage({ copyLabel, company, cert, rows, totals, methods, depositLines }) {
  const tableRows = rows.map((r, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${esc(r.supplierName)}</td>
      <td class="mono">${esc(r.supplierBin || '—')}</td>
      <td class="mono">${esc(r.invoiceNo || '—')}</td>
      <td class="center">${esc(fmtDay(r.invoiceDate))}</td>
      <td class="num">${fmtTk(r.totalValue)}${r.estimated ? '*' : ''}</td>
      <td class="num">${fmtTk(r.vat)}${r.estimated ? '*' : ''}</td>
      <td class="num">${fmtTk(r.vds)}</td>
    </tr>`).join('')

  const tick = (on) => `<span class="box">${on ? '✓' : ''}</span>`
  return `
<div class="page">
  ${copyLabel ? `<span class="copy-tag">${esc(copyLabel)}</span>` : ''}
  <div class="hdr">
    <span class="form-no"><span class="bn">মূসক-৬.৬</span> · Mushak-6.6</span>
    <p class="gov bn">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার, জাতীয় রাজস্ব বোর্ড</p>
    <p class="gov">Government of the People's Republic of Bangladesh, National Board of Revenue</p>
    <h1 class="bn">উৎসে কর কর্তন সনদপত্র</h1>
    <h2>Certificate of VAT Deducted at Source</h2>
    <p class="rule">[See clause (f) of sub-rule (1) of rule 40 of the Value Added Tax and Supplementary Duty Rules, 2016]</p>
  </div>

  <table class="kv" style="margin-bottom:6px;">
    <tr><td class="k">Name of the withholding entity</td><td class="v">${esc(company.name || '—')}</td>
        <td class="k" style="width:18%;">Certificate no.</td><td class="v mono">${esc(cert.number || 'DRAFT — not issued')}</td></tr>
    <tr><td class="k">Address of the withholding entity</td><td class="v">${esc(company.address || '—')}</td>
        <td class="k">Date of issue</td><td class="v">${esc(cert.date ? fmtDay(cert.date) : '—')}</td></tr>
    <tr><td class="k">BIN of the withholding entity (where applicable)</td><td class="v mono">${esc(company.bin || 'Not registered')}</td><td></td><td></td></tr>
  </table>

  <p class="cert-text">
    This is to certify that VAT has been deducted at source by this entity, as a withholding entity under section 49 of the
    Value Added Tax and Supplementary Duty Act, 2012, from the supplies described below. The VAT so deducted has been deposited
    to the Government treasury by
    <span class="method">${tick(methods.book)} book transfer</span>
    <span class="method">${tick(methods.challan)} treasury challan</span>
    <span class="method">${tick(methods.return)} increasing adjustment in the return</span>
    and a copy of the deposit document is attached (where applicable).
  </p>
  ${depositLines.length ? `<p style="font-size:11px;margin:-4px 0 10px;color:#334155;"><strong>Deposit details:</strong> ${depositLines.map(esc).join('; ')}</p>` : ''}

  <table class="grid">
    <thead>
      <tr>
        <th style="width:5%;">Serial no.</th>
        <th>Name of the supplier</th>
        <th style="width:13%;">BIN of the supplier</th>
        <th style="width:12%;">Related tax invoice no.</th>
        <th style="width:10%;">Issue date of the tax invoice</th>
        <th style="width:13%;">Total value of supply¹ (Tk)</th>
        <th style="width:11%;">Amount of VAT (Tk)</th>
        <th style="width:12%;">VAT deducted at source (Tk)</th>
      </tr>
      <tr class="colno"><th>(1)</th><th>(2)</th><th>(3)</th><th>(4)</th><th>(5)</th><th>(6)</th><th>(7)</th><th>(8)</th></tr>
    </thead>
    <tbody>
      ${tableRows}
      <tr class="total">
        <td colspan="5" class="right">Total</td>
        <td class="num">${fmtTk(totals.totalValue)}</td>
        <td class="num">${fmtTk(totals.vat)}</td>
        <td class="num">${fmtTk(totals.vds)}</td>
      </tr>
    </tbody>
  </table>

  <div class="sign">
    <div class="line">
      <p>Signature of the authorised officer: ______________________</p>
      <p style="margin-top:6px;">Name: <strong>${esc(company.signatoryName || '')}</strong></p>
      <p>Designation: ${esc(company.signatoryDesignation || '')}</p>
      <p>Seal:</p>
    </div>
  </div>

  <div class="foot">
    <p>¹ Value including VAT and supplementary duty (SD), if any.</p>
    ${rows.some(r => r.estimated) ? '<p>* VAT on the supplier\'s invoice is not recorded; it is shown at the rate of the VAT service code.</p>' : ''}
  </div>
</div>`
}

// GET /api/tax/certificates/vds/print?ids=a,b,c[&preview=1][&copies=1|3]
// Mushak-6.6 for VDS_PAYABLE entries of one supplier. READ-ONLY: entries without
// a certificate number render as a DRAFT; numbered entries reprint their
// certificate. The number is assigned by POST (below), never by a GET.
export async function GET(request) {
  const origin = new URL(request.url).origin
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    const sp = new URL(request.url).searchParams
    let ids
    try { ids = parseIdList(sp.get('ids'), { max: 200 }) } catch (err) {
      return messageResponse({ origin, title: 'Cannot print Mushak-6.6', message: err.message, status: 400 })
    }
    if (!ids.length) return messageResponse({ origin, title: 'Cannot print Mushak-6.6', message: 'Select the VDS deductions to include.', status: 400 })

    await connectDB()
    const sel = await loadCertificateSelection(ids, 'VDS')
    if (sel.error) return messageResponse({ origin, title: printErrorTitle('VDS', sel.error), message: sel.error.message, status: sel.error.status })
    const { entries, numbers } = sel

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
      // A Mushak-6.6 recorded as issued without a supplier BIN / deposit (no longer accepted) — flag it.
      for (const x of certificateBlockers(entries, settings)) notices.push({ level: 'danger', text: `${x.e.entryNo}: ${x.r.reason}` })
    }

    // VAT on the supplier's invoice: the INPUT_VAT recorded with the same bill.
    const expenseIds = entries.map(e => e.expenseId).filter(Boolean)
    const billIds = entries.map(e => e.purchaseBillId).filter(Boolean)
    const inputs = expenseIds.length || billIds.length
      ? await TaxEntry.find({
          status: 'ACTIVE', entryType: 'INPUT_VAT',
          $or: [
            ...(expenseIds.length ? [{ expenseId: { $in: expenseIds } }] : []),
            ...(billIds.length ? [{ purchaseBillId: { $in: billIds } }] : []),
          ],
        }).select('expenseId purchaseBillId amount sdAmount baseAmount').lean()
      : []
    const inputByExpense = new Map(inputs.filter(i => i.expenseId).map(i => [String(i.expenseId), i]))
    const inputByBill = new Map(inputs.filter(i => i.purchaseBillId).map(i => [String(i.purchaseBillId), i]))

    const rows = []
    for (const e of entries) {
      const input = (e.expenseId && inputByExpense.get(String(e.expenseId))) || (e.purchaseBillId && inputByBill.get(String(e.purchaseBillId))) || null
      let vat
      let sd = 0
      let estimated = false
      if (input) {
        vat = num(input.amount)
        sd = num(input.sdAmount)
      } else {
        const code = e.serviceCode ? await getVatServiceCode(e.serviceCode, e.date) : null
        const rate = Number(code?.vatRate)
        vat = Number.isFinite(rate) && rate > 0 ? round2((num(e.baseAmount) * rate) / 100) : num(e.amount)
        estimated = true
      }
      const base = num(e.baseAmount)
      rows.push({
        supplierName: e.partyName || '—',
        supplierBin:  e.partyBin || '',
        invoiceNo:    e.documentNo || '',
        invoiceDate:  e.documentDate || e.date,
        totalValue:   round2(base + sd + vat),
        vat:          round2(vat),
        vds:          round2(num(e.amount)),
        estimated,
      })
    }
    const totals = {
      totalValue: round2(rows.reduce((s, r) => s + r.totalValue, 0)),
      vat:        round2(rows.reduce((s, r) => s + r.vat, 0)),
      vds:        round2(rows.reduce((s, r) => s + r.vds, 0)),
    }

    // How the VDS reached the treasury
    const methods = { book: false, challan: false, return: false }
    const depositLines = []
    const viaReturn = entries.filter(e => e.deposit?.status === 'VIA_RETURN')
    // Every challan that paid these deductions, in full or in part.
    const byChallan = entries.flatMap(e => depositAllocationsOf(e))
    if (byChallan.length) {
      methods.challan = true
      const challans = new Map()
      for (const a of byChallan) {
        const k = a.challanNo || '—'
        if (!challans.has(k)) challans.set(k, a.date ?? null)
      }
      for (const [no, date] of challans) depositLines.push(`Treasury challan ${no}${date ? ` dated ${fmtDay(date)}` : ''}`)
    }
    if (viaReturn.length) {
      methods.return = true
      const filingIds = [...new Set(viaReturn.map(e => e.filingId).filter(Boolean).map(String))]
      const filings = filingIds.length ? await TaxFiling.find({ _id: { $in: filingIds } }).select('periodKey status filedAt acknowledgementNo').lean() : []
      const filed = filings.filter(f => ['FILED', 'AMENDED'].includes(f.status))
      const periods = [...new Set(viaReturn.map(e => returnPeriodOf(e.period, settings?.vat?.returnFrequency)?.label ?? periodLabel(e.period)))]
      depositLines.push(`Increasing adjustment (note 24) in the Mushak-9.1 return for ${periods.join(', ')}${filed.length ? ` — filed ${filed.map(f => `${fmtDay(f.filedAt)}${f.acknowledgementNo ? ` (ack. ${f.acknowledgementNo})` : ''}`).join(', ')}` : ''}`)
      if (filed.length < filingIds.length || filingIds.length === 0) {
        notices.push({ level: 'warn', text: 'The VAT return for this period is not filed yet. A registered withholding entity issues Mushak-6.6 within 3 working days after filing the return.' })
      }
    }
    if (!isValidBin(company.bin) && (settings?.vat?.registrationType ?? 'REGISTERED') === 'REGISTERED') {
      notices.push({ level: 'danger', text: 'Company BIN is missing — set it in Tax settings so it prints on the certificate.' })
    }
    if (!company.signatoryName) notices.push({ level: 'warn', text: 'No authorised signatory is set in Tax settings.' })
    if (rows.some(r => r.estimated)) notices.push({ level: 'info', text: 'Some rows have no recorded input VAT; their VAT is estimated from the VAT service code rate (marked *).' })

    const copiesParam = parseInt(sp.get('copies') ?? '', 10)
    const copies = [1, 3].includes(copiesParam) ? copiesParam : (draft ? 1 : 3)
    const labels = copies === 3 ? COPY_LABELS : [draft ? 'Draft' : null]
    const body = labels.map(label => renderPage({ copyLabel: label, company, cert, rows, totals, methods, depositLines })).join('')

    const base = new URL(request.url)
    const link = (n) => { const u = new URL(base); u.searchParams.set('copies', String(n)); return `${u.pathname}${u.search}` }
    const toolbar = `<span style="margin-left:6px;color:#475569;">Copies:</span>
      <a class="${copies === 1 ? 'active' : ''}" href="${esc(link(1))}">1</a>
      <a class="${copies === 3 ? 'active' : ''}" href="${esc(link(3))}">3 (original, supplier, office)</a>`

    const nonce = newNonce()
    const html = renderDocument({
      title: `Mushak-6.6 ${cert.number ?? 'draft'} — ${entries[0].partyName ?? ''}`,
      origin, nonce, body, toolbar, notices, draft, extraCss: EXTRA_CSS,
      autoPrint: !draft,
    })
    return printResponse(html, nonce, `mushak-6.6-${cert.number ?? 'draft'}`)
  } catch (err) {
    if (err?.status && err.status < 500) {
      return messageResponse({ origin, title: 'Cannot print Mushak-6.6', message: err.message, status: err.status })
    }
    return errorResponse(err, '[GET /api/tax/certificates/vds/print]')
  }
}

// POST /api/tax/certificates/vds/print  { ids: string[] }
// Issue the Mushak-6.6: assigns VDS-YYMM-### (status ISSUED, dated today) to a
// ready, unnumbered selection. Idempotent: an already numbered selection
// returns its number. GET ?ids=... then prints it.
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
    const sel = await loadCertificateSelection(ids, 'VDS')
    if (sel.error) return NextResponse.json({ error: sel.error.message }, { status: sel.error.status })
    const { entries, numbers } = sel
    if (numbers.length) {
      const date = entries.find(e => e.certificate?.date)?.certificate?.date ?? null
      return NextResponse.json({ data: { number: numbers[0], date, alreadyIssued: true } })
    }

    const settings = await getFinanceSettings()
    const blockers = certificateBlockers(entries, settings)
    if (blockers.length) {
      return NextResponse.json({
        error: 'Mushak-6.6 cannot be issued yet',
        details: blockers.map(x => `${x.e.entryNo}: ${x.r.reason}`),
      }, { status: 409 })
    }

    const issued = await issueSelection({ entries, kind: 'VDS', session, request })
    return NextResponse.json({ data: { number: issued.number, date: issued.date, alreadyIssued: false } }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/tax/certificates/vds/print]')
  }
}
