/**
 * Mushak-9.1 working paper (server-rendered HTML body).
 * Pure string building — the route supplies the computed return / snapshot.
 */
import { INPUT_NON_CREDIT_REASONS, vatTreatmentMeta } from '@/lib/tax/catalog'
import {
  escapeHtml, fmtDay, fmtDateTime, fmtMoney, companyBlock,
} from '@/app/api/tax/registers/_lib/printShell'
import { VAT_RETURN_LAYOUT, SERVICE_NOTES, noteLabel, noteFormula, isTotalNote, noteValues, noteIsZero } from './layout'

const RETURN_TYPE_LABELS = {
  ORIGINAL:        'Original (s.64)',
  LATE:            'Late (s.65)',
  AMENDED:         'Amended (s.66)',
  FULL_ADDITIONAL: 'Full / additional / alternative (s.67)',
}

const REG_LABELS = { REGISTERED: 'VAT registered', TURNOVER: 'Turnover tax (enlisted)', UNREGISTERED: 'Not registered' }

const e = escapeHtml
const money = (v) => fmtMoney(v ?? 0)

function partTable(part, notes) {
  const cols = part.columns
  const head = `
    <tr>
      <th style="width:42px">Note</th>
      <th style="text-align:left">Description</th>
      ${cols.map(c => `<th class="r" style="width:118px">${e(c.label)}</th>`).join('')}
    </tr>`
  const rows = part.notes.map(n => {
    const vals = noteValues(notes, n, cols)
    const total = isTotalNote(n)
    const formula = noteFormula(n)
    const hl = Number(n) === 50 || Number(n) === 65
    const muted = !total && !SERVICE_NOTES.has(n) && noteIsZero(notes, n)
    const cls = hl ? 'hl' : (total ? 'total' : (muted ? 'muted' : ''))
    return `
      <tr class="${cls}">
        <td class="c">${e(n)}</td>
        <td>${e(noteLabel(n))}${formula ? ` <span style="color:#64748b;font-weight:400">[${e(formula)}]</span>` : ''}</td>
        ${cols.map(c => `<td class="r">${money(vals[c.key])}</td>`).join('')}
      </tr>`
  }).join('')
  return `<h2>${e(part.title)}</h2><table><thead>${head}</thead><tbody>${rows}</tbody></table>`
}

function emptyRow(colspan, text = 'No entries') {
  return `<tr><td colspan="${colspan}" class="empty">${e(text)}</td></tr>`
}

function treatmentShort(t) {
  return vatTreatmentMeta(t)?.label ?? t ?? ''
}

function outputSubform(lines) {
  const rows = lines.map((l, i) => `
    <tr>
      <td class="c">${i + 1}</td><td class="c">${e(l.note)}</td>
      <td class="mono">${e(l.documentNo ?? l.entryNo ?? '')}</td><td>${fmtDay(l.documentDate ?? l.date)}</td>
      <td>${e(l.partyName ?? '')}</td><td class="mono">${e(l.partyBin ?? '')}</td>
      <td>${e([l.serviceCode, treatmentShort(l.treatment)].filter(Boolean).join(' · '))}</td>
      <td class="r">${money(l.base)}</td><td class="r">${money(l.sd)}</td><td class="r">${money(l.amount)}</td>
    </tr>`).join('')
  return `
    <h3>Sub-form — Supply (notes 1–8)</h3>
    <table><thead><tr>
      <th>SL</th><th>Note</th><th>Invoice (6.3) no.</th><th>Date</th><th>Buyer</th><th>Buyer BIN</th><th>Code / rate type</th>
      <th class="r">Value (a)</th><th class="r">SD (b)</th><th class="r">VAT (c)</th>
    </tr></thead><tbody>${rows || emptyRow(10)}</tbody></table>`
}

function inputSubform(lines, title) {
  const rows = lines.map((l, i) => `
    <tr>
      <td class="c">${i + 1}</td><td class="c">${e(l.note)}</td>
      <td class="mono">${e(l.documentNo ?? l.entryNo ?? '')}</td><td>${fmtDay(l.documentDate ?? l.date)}</td>
      <td>${e(l.partyName ?? '')}</td><td class="mono">${e(l.partyBin ?? '')}</td>
      <td>${e(l.serviceCode ?? '')}</td>
      <td class="r">${money(l.base)}</td><td class="r">${money(l.amount)}</td>
      <td>${e(l.creditable === false ? (INPUT_NON_CREDIT_REASONS[l.nonCreditReason] ?? 'Not creditable') : (l.claimPeriod ? `Claimed ${l.claimPeriod}` : (l.claimDeadline ? `Claim by ${l.claimDeadline}` : '')))}</td>
    </tr>`).join('')
  return `
    <h3>${e(title)}</h3>
    <table><thead><tr>
      <th>SL</th><th>Note</th><th>Challan / B/E no.</th><th>Date</th><th>Supplier</th><th>Supplier BIN</th><th>Code</th>
      <th class="r">Value (a)</th><th class="r">VAT (b)</th><th>Remarks</th>
    </tr></thead><tbody>${rows || emptyRow(10)}</tbody></table>`
}

/** Notes 24 / 29 sub-form (13 columns per the eVAT return). */
function vdsSubform(lines, note) {
  const who = note === 24 ? 'Supplier' : 'Buyer'
  const rows = lines.map((l) => `
    <tr>
      <td class="mono">${e(l.partyBin ?? '')}</td><td>${e(l.partyName ?? '')}</td><td>${e(l.partyAddress ?? '')}</td>
      <td class="r">${money(l.base)}</td><td class="r">${money(l.amount)}</td>
      <td class="mono">${e(l.documentNo ?? '')}</td><td>${fmtDay(l.documentDate)}</td>
      <td class="mono">${e(l.certificate?.number ?? '')}</td><td>${fmtDay(l.certificate?.date)}</td>
      <td class="mono">${e(l.deposit?.accountCode ?? l.challan?.accountCode ?? '')}</td>
      <td class="mono">${e(l.deposit?.challanNo ?? '')}</td><td>${fmtDay(l.deposit?.date)}</td>
      <td>${e(note === 24 ? (l.deposit?.status === 'VIA_RETURN' ? 'Paid via this return' : (l.deposit?.status ?? '')) : (l.claimPeriod ? `Claimed ${l.claimPeriod}` : ''))}</td>
    </tr>`).join('')
  return `
    <h3>Sub-form — Note ${note}: ${e(noteLabel(note))}</h3>
    <table><thead>
      <tr class="colno">${Array.from({ length: 13 }, (_, i) => `<th>${i + 1}</th>`).join('')}</tr>
      <tr>
        <th>${who} BIN</th><th>${who} name</th><th>${who} address</th><th class="r">Value</th><th class="r">Deducted VAT</th>
        <th>Invoice / challan no.</th><th>Invoice / challan date</th><th>6.6 certificate no.</th><th>Certificate date</th>
        <th>Deposit account code</th><th>Deposit serial (challan / DV)</th><th>Deposit date</th><th>Note</th>
      </tr>
    </thead><tbody>${rows || emptyRow(13)}</tbody></table>`
}

function notesSubform(lines) {
  const rows = lines.map((l, i) => `
    <tr>
      <td class="c">${i + 1}</td><td class="c">${e(l.note)}</td><td class="mono">${e(l.documentNo ?? l.entryNo ?? '')}</td>
      <td>${fmtDay(l.documentDate ?? l.date)}</td><td>${e(l.partyName ?? '')}</td><td class="mono">${e(l.partyBin ?? '')}</td>
      <td class="r">${money(l.base)}</td><td class="r">${money(l.sd)}</td><td class="r">${money(l.amount)}</td>
    </tr>`).join('')
  return `
    <h3>Sub-form — Debit notes (26) and credit notes (31)</h3>
    <table><thead><tr>
      <th>SL</th><th>Note</th><th>Note no.</th><th>Date</th><th>Party</th><th>BIN</th>
      <th class="r">Value</th><th class="r">SD</th><th class="r">VAT</th>
    </tr></thead><tbody>${rows || emptyRow(9)}</tbody></table>`
}

function adjustmentsSubform(lines) {
  const rows = lines.map((l, i) => `
    <tr>
      <td class="c">${i + 1}</td><td class="c">${e(l.note)}</td><td>${fmtDay(l.date)}</td>
      <td>${e(noteLabel(l.note))}${l.notes ? ` — ${e(l.notes)}` : ''}</td>
      <td class="mono">${e(l.documentNo ?? l.entryNo ?? '')}</td><td class="r">${money(l.amount)}</td>
    </tr>`).join('')
  return `
    <h3>Sub-form — Other adjustments (notes 25, 27, 32, 41, 43, 44)</h3>
    <table><thead><tr>
      <th>SL</th><th>Note</th><th>Date</th><th>Description</th><th>Reference</th><th class="r">Amount</th>
    </tr></thead><tbody>${rows || emptyRow(6)}</tbody></table>`
}

/** Notes 58 (VAT) and 59 (SD) treasury deposits; rows without a note (older snapshots) are VAT. */
function depositsSubform(lines, challanCode, sdChallanCode) {
  const isSd = (l) => Number(l.note) === 59
  const anySd = lines.some(isSd)
  const rows = lines.map((l) => `
    <tr>
      <td class="mono">${e(l.challanNo ?? l.documentNo ?? '')}</td>${anySd ? `<td class="c">${isSd(l) ? 'SD (59)' : 'VAT (58)'}</td>` : ''}<td>${e(l.bank ?? '')}</td><td>${e(l.branch ?? '')}</td>
      <td>${fmtDay(l.date)}</td><td class="mono">${e(l.accountCode ?? (isSd(l) ? sdChallanCode : challanCode) ?? '')}</td>
      <td class="r">${money(l.amount)}</td><td>${e(l.source === 'CHALLAN' ? 'Entered with the return' : (l.entryNo ? `Ledger ${l.entryNo}` : ''))}</td>
    </tr>`).join('')
  const cols = anySd ? 8 : 7
  return `
    <h3>Sub-form — ${anySd ? 'Notes 58 / 59: treasury deposits (VAT / SD)' : 'Note 58: treasury deposits (VAT)'}</h3>
    <table><thead><tr>
      <th>Treasury challan / token no.</th>${anySd ? '<th>Head</th>' : ''}<th>Bank / CGA</th><th>Branch / CAFO / DCO</th><th>Date</th><th>Account code</th>
      <th class="r">Amount</th><th>Notes</th>
    </tr></thead><tbody>${rows || emptyRow(cols)}</tbody></table>`
}

function openingSubform(lines) {
  if (!lines?.length) return ''
  const rows = lines.map((l, i) => `
    <tr><td class="c">${i + 1}</td><td>${fmtDay(l.date)}</td><td>${e(l.balanceSide === 'PAYABLE' ? 'Payable brought forward' : 'Credit brought forward')}</td>
    <td>${e(l.notes ?? l.documentNo ?? '')}</td><td class="r">${money(l.amount)}</td></tr>`).join('')
  return `
    <h3>Note 52 — closing balance brought forward (opening balance)</h3>
    <table><thead><tr><th>SL</th><th>Date</th><th>Side</th><th>Reference</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}</tbody></table>`
}

/**
 * @param {object} o
 * @param {object} o.result     computeVatReturn result or a filed snapshot
 * @param {object|null} o.filing   TaxFiling view (status, returnType, filedAt, acknowledgementNo)
 * @param {object} o.company    getCompanyProfile()
 * @param {object} o.settings   finance settings
 * @param {'filed'|'live'} o.source
 * @param {string} o.challanCode  VAT account code for deposits
 * @param {string} [o.sdChallanCode]  supplementary duty account code (note 59)
 */
export function vatReturnPrintBody({ result, filing, company, settings, source, challanCode, sdChallanCode = '' }) {
  const notes = result.notes ?? {}
  const lines = result.lines ?? {}
  const filed = filing && ['FILED', 'AMENDED'].includes(filing.status)
  const showingFiled = source === 'filed' && filed
  const returnType = showingFiled ? (result.returnType ?? filing.returnType) : (filing?.returnType && filed ? filing.returnType : null)

  const anyActivity = [9, 23, 28, 33].some(n => !noteIsZero(notes, n)) || !noteIsZero(notes, 58)
  const badge = showingFiled
    ? `<span class="badge b-green">${e(filing.status === 'AMENDED' ? 'Amended — as filed' : 'Filed — as filed')}</span>`
    : (filed
      ? '<span class="badge b-amber">Live figures — differ from the filed return if the ledger changed</span>'
      : '<span class="badge b-gray">Draft — not filed</span>')

  const increasing = (lines.increasing ?? [])
  const decreasing = (lines.decreasing ?? [])
  const n24 = increasing.filter(l => l.note === 24)
  const n29 = decreasing.filter(l => l.note === 29)
  const debitCredit = [...increasing.filter(l => l.note === 26), ...decreasing.filter(l => l.note === 31)]
  const otherAdj = [...increasing.filter(l => [25, 27, 41, 43, 44].includes(l.note)), ...decreasing.filter(l => l.note === 32)]
  const opening = result.noteEntries?.[52] ?? result.noteEntries?.['52'] ?? []

  const warnings = (result.warnings ?? []).map(w => `<li>${e(w.message)}</li>`).join('')

  const kv = (k, v) => `<div class="kv"><span>${e(k)}</span><span>${v}</span></div>`

  return `
  <div class="head">
    ${companyBlock(company)}
    <div class="form-id">
      <p class="form-no">মূসক-৯.১ · Mushak-9.1</p>
      <p class="form-title">VAT return — working paper</p>
      <p class="form-sub">Value Added Tax and Supplementary Duty Rules 2016, rule 47 · ${e(result.label ?? '')}</p>
      ${badge}
    </div>
  </div>

  <h2>Part 1 — Taxpayer information</h2>
  <div class="grid2">
    ${kv('BIN', e(result.taxpayer?.bin || company?.bin || '—'))}
    ${kv('Name of taxpayer', e(result.taxpayer?.name || company?.name || '—'))}
    ${kv('Address', e(result.taxpayer?.address || company?.address || '—'))}
    ${kv('e-TIN', e(result.taxpayer?.tin || company?.tin || '—'))}
    ${kv('VAT circle / division', e(result.taxpayer?.vatCircle || company?.vatCircle || '—'))}
    ${kv('Registration type', e(REG_LABELS[result.registrationType ?? settings?.vat?.registrationType] ?? '—'))}
  </div>

  <h2>Part 2 — Return submission data</h2>
  <div class="grid2">
    ${kv('Tax period', `${e(result.label ?? '')} (${e(result.start)}${result.end !== result.start ? ` to ${e(result.end)}` : ''})`)}
    ${kv('Due date', e(fmtDay(result.dueDate)))}
    ${kv('Type of return', e(returnType ? (RETURN_TYPE_LABELS[returnType] ?? returnType) : 'Not filed yet'))}
    ${kv('Any activity in this tax period?', anyActivity ? 'Yes' : 'No')}
    ${kv('Date of submission', e(filed ? fmtDay(filing.filedAt) : '—'))}
    ${kv('Acknowledgement no.', e(filing?.acknowledgementNo || '—'))}
  </div>

  ${VAT_RETURN_LAYOUT.map(p => partTable(p, notes)).join('')}

  <h2>Sub-forms (supporting details)</h2>
  ${outputSubform(lines.output ?? [])}
  ${inputSubform(lines.input ?? [], 'Sub-form — Purchases with input tax credit (notes 10–18a)')}
  ${(lines.inputNonCreditable ?? []).length ? inputSubform(lines.inputNonCreditable, 'Sub-form — Purchases not admissible for credit (notes 19–22)') : ''}
  ${vdsSubform(n24, 24)}
  ${vdsSubform(n29, 29)}
  ${debitCredit.length ? notesSubform(debitCredit) : ''}
  ${otherAdj.length ? adjustmentsSubform(otherAdj) : ''}
  ${openingSubform(opening)}
  ${depositsSubform(lines.deposits ?? [], challanCode, sdChallanCode)}
  <p class="note">Deposit VAT by A-challan / e-payment to account code ${e(challanCode || '')} (new economic code 1141101) before submitting the return${Number(notes[51] ?? 0) > 0 || Number(notes[59] ?? 0) > 0 ? `; supplementary duty separately to ${e(sdChallanCode || '')} (1141103)` : ''}. VDS deducted by a registered withholding entity is paid through note 50 of its own return.</p>

  ${warnings ? `<h2>Points to check before filing</h2><ul class="alerts">${warnings}</ul>` : ''}

  <h2>Part 12 — Declaration</h2>
  <p style="font-size:10.5px;line-height:1.6">I declare that the information given in this return and the attached sub-forms is complete, true and accurate.
  If any untrue or incomplete statement is found, I shall be liable for punitive measures under the law.</p>
  <div class="sign">
    <div>Name: <strong>${e(company?.signatoryName || '')}</strong></div>
    <div>Designation: <strong>${e(company?.signatoryDesignation || '')}</strong></div>
    <div>Signature &amp; date</div>
  </div>

  <div class="foot">
    Working paper generated from the CRM tax ledger on ${e(fmtDateTime(new Date()))}${showingFiled ? ` · figures as filed on ${e(fmtDay(filing.filedAt))}` : ''}.
    Submit the return on the NBR eVAT portal (vat.gov.bd); this paper supports the e-return and does not replace it.
  </div>`
}
