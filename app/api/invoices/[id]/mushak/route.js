export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { invoiceTaxTotals, snapshotInvoiceParties } from '@/lib/tax/invoiceVat'
import { getCompanyProfile } from '@/lib/finance/settings'
import { VAT_TREATMENTS, VAT_SERVICE_CODES, BUYER_BIN_THRESHOLD, treatmentForRate } from '@/lib/tax/catalog'
import {
  esc, fmtNum, fmtQty, fmtRate, fmtDhakaDate, fmtDhakaTime, fxOfInvoice, moneyUnit,
  govHeader, fieldRow, signatureBlock, documentHtml, newNonce, htmlResponse, errorPage,
} from '@/app/api/credit-notes/_lib/mushakHtml'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v) => (v === null || v === undefined ? '' : String(v).trim())
const plain = (sub) => (sub && typeof sub.toObject === 'function' ? sub.toObject() : (sub ?? null))

const NO_VAT = ['ZERO_RATED', 'EXEMPT', 'NONE']

function itemsOf(invoice) {
  let items = invoice?.items
  if (typeof items === 'string') {
    try { items = JSON.parse(items) } catch { items = [] }
  }
  return Array.isArray(items) ? items.filter(i => i && typeof i === 'object') : []
}

/**
 * Split `total` over `weights` in whole paisa (remainder to the last line with
 * weight), so the parts always add up exactly.
 */
function allocate(total, weights) {
  const n = weights.length
  if (!n) return []
  const paisa = Math.round(num(total) * 100)
  const sumW = weights.reduce((s, w) => s + Math.max(0, num(w)), 0)
  if (sumW <= 0) return weights.map((_, i) => (i === 0 ? paisa / 100 : 0))
  const parts = weights.map(w => Math.floor((paisa * Math.max(0, num(w))) / sumW))
  let rest = paisa - parts.reduce((s, p) => s + p, 0)
  for (let i = n - 1; i >= 0 && rest !== 0; i--) {
    if (num(weights[i]) > 0) { parts[i] += rest; rest = 0 }
  }
  return parts.map(p => p / 100)
}

/**
 * Mushak-6.3 lines (invoice currency): column 6 is the taxable value of the
 * line (net of its share of the invoice discount), column 5 = 6 ÷ quantity,
 * 11 = 6 + 8 + 10. Line VAT / SD / taxable figures stored by the invoice
 * engine are used as is; legacy invoices are allocated pro-rata.
 */
function buildLines(invoice, totals) {
  const items = itemsOf(invoice)
  const treatment = totals.treatment
  const amounts = items.map(it => round2(it.amount != null && it.amount !== '' ? num(it.amount) : num(it.quantity) * num(it.rate)))

  const taxables = items.length && items.every(it => numOrNull(it.taxableValue) !== null)
    ? items.map(it => round2(num(it.taxableValue)))
    : allocate(totals.taxableValue, amounts)

  const sds = items.length && items.every(it => numOrNull(it.sdAmount) !== null)
    ? items.map(it => round2(num(it.sdAmount)))
    : allocate(totals.sdAmount, taxables)

  let vats
  if (NO_VAT.includes(treatment)) vats = items.map(() => 0)
  else if (items.length && items.every(it => numOrNull(it.vatAmount) !== null)) vats = items.map(it => round2(num(it.vatAmount)))
  else vats = allocate(totals.vatAmount, taxables.map((x, i) => x + sds[i]))

  return items.map((it, i) => {
    const qtyRaw = num(it.quantity)
    const qty = qtyRaw > 0 ? qtyRaw : 1
    const value = taxables[i] ?? 0
    const sd = sds[i] ?? 0
    const vat = vats[i] ?? 0
    const sdRate = numOrNull(it.sdRate) ?? (value > 0 && sd > 0 ? round2((sd * 100) / value) : 0)
    const vatRate = NO_VAT.includes(treatment) ? 0 : (numOrNull(it.vatRate) ?? totals.vatRate ?? 0)
    return {
      description: str(it.description) || '—',
      serviceCode: str(it.serviceCode) || null,
      unit: str(it.unit) || 'Service',
      quantity: qty,
      unitPrice: value / qty,
      value,
      sdRate,
      sdAmount: sd,
      vatRate,
      vatAmount: vat,
    }
  })
}

function vatRateCell(line, treatment) {
  if (treatment === 'ZERO_RATED') return '0% <span class="en">(zero-rated)</span>'
  if (treatment === 'EXEMPT') return '<span class="en">Exempt</span>'
  return esc(fmtRate(line.vatRate))
}

const multiline = (s) => esc(s).replace(/\r?\n/g, '<br />')

// GET /api/invoices/[id]/mushak?copy=original|duplicate
// Mushak-6.3 tax invoice (কর চালানপত্র), Rule 40(1)(c) & (f), SRO 142/2020 form.
export async function GET(request, { params }) {
  const origin = new URL(request.url).origin
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, ['sales.invoices.view', 'tax.view']))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return errorPage(404, 'Invoice not found.', origin)

    const { searchParams } = new URL(request.url)
    const copy = searchParams.get('copy') === 'duplicate' ? 'duplicate' : 'original'

    await connectDB()
    const invoice = await Invoice.findById(params.id)
      .populate({ path: 'clientId', select: 'company contactPerson address city country bin vatNumber userId', populate: { path: 'userId', select: 'name' } })
      .lean()
    if (!invoice) return errorPage(404, 'Invoice not found.', origin)
    if (invoice.status === 'DRAFT')
      return errorPage(409, 'This invoice is still a draft. Mark it as sent (issue it) before printing the Mushak-6.3.', origin)
    if (!invoice.vatTreatment || invoice.vatTreatment === 'NONE')
      return errorPage(409, 'This invoice carries no VAT treatment, so it is not a tax invoice (Mushak-6.3). Use the normal invoice print instead.', origin)

    const [company, liveParties] = await Promise.all([
      getCompanyProfile(),
      snapshotInvoiceParties(invoice),
    ])

    const totals = invoiceTaxTotals(invoice)
    const fx = fxOfInvoice(invoice)
    const unit = moneyUnit(fx)
    const conv = (v) => round2(num(v) * fx.rate)

    // Parties — the issue-time snapshots win (BINs as they were at the tax point).
    const sellerSnap = plain(invoice.seller) ?? {}
    const buyerSnap = plain(invoice.buyer) ?? {}
    const seller = {
      name:    str(sellerSnap.name) || str(company.name) || str(liveParties.seller?.name),
      bin:     str(sellerSnap.bin) || str(company.bin) || str(liveParties.seller?.bin),
      address: str(company.issueAddress) || str(sellerSnap.address) || str(company.address),
    }
    const buyer = {
      name:    str(buyerSnap.name) || str(liveParties.buyer?.name),
      bin:     str(buyerSnap.bin) || str(liveParties.buyer?.bin),
      address: str(buyerSnap.address) || str(liveParties.buyer?.address),
    }
    const issuedAt = invoice.issuedAt ?? invoice.sentAt ?? invoice.issueDate ?? invoice.createdAt

    // Lines in Taka (or the invoice currency when no BDT value is recorded).
    const raw = buildLines(invoice, totals)
    const lines = raw.map(l => {
      const value = conv(l.value)
      const sdAmount = conv(l.sdAmount)
      const vatAmount = conv(l.vatAmount)
      return {
        ...l,
        unitPrice: round2(l.unitPrice * fx.rate),
        value,
        sdAmount,
        vatAmount,
        total: round2(value + sdAmount + vatAmount),
      }
    })
    const sum = (k) => round2(lines.reduce((s, l) => s + num(l[k]), 0))
    const tValue = sum('value')
    const tSd = sum('sdAmount')
    const tVat = sum('vatAmount')
    const tTotal = sum('total')
    const mfs = conv(totals.mfsCharge)
    const payable = round2(tTotal + mfs)

    // The 9.1 note follows the rate (a legacy STANDARD invoice at 5% is reported in note 7).
    const noteTreatment = ['STANDARD', 'REDUCED'].includes(totals.treatment) && totals.vatRate > 0 ? treatmentForRate(totals.vatRate) : totals.treatment
    const treatmentMeta = VAT_TREATMENTS.find(t => t.value === noteTreatment)
    const serviceCode = str(invoice.serviceCode) || str(raw.find(l => l.serviceCode)?.serviceCode)
    const serviceMeta = serviceCode ? VAT_SERVICE_CODES.find(c => c.code === serviceCode) : null

    const rowsHtml = lines.length
      ? lines.map((l, i) => `
        <tr>
          <td class="c">${i + 1}</td>
          <td class="desc">${multiline(l.description)}${l.serviceCode && l.serviceCode !== serviceCode ? `<div class="en">Code: ${esc(l.serviceCode)}</div>` : ''}</td>
          <td class="c">${esc(l.unit)}</td>
          <td class="n">${esc(fmtQty(l.quantity))}</td>
          <td class="n">${fmtNum(l.unitPrice)}</td>
          <td class="n">${fmtNum(l.value)}</td>
          <td class="n">${l.sdRate > 0 ? esc(fmtRate(l.sdRate)) : '—'}</td>
          <td class="n">${fmtNum(l.sdAmount)}</td>
          <td class="n">${vatRateCell(l, totals.treatment)}</td>
          <td class="n">${fmtNum(l.vatAmount)}</td>
          <td class="n">${fmtNum(l.total)}</td>
        </tr>`).join('')
      : `<tr><td class="c" colspan="11">No line items</td></tr>`

    const head = (bn, en, sup = '', cls = '') => `<th${cls ? ` class="${cls}"` : ''}><div class="bn">${esc(bn)}${sup}</div><div class="en">${esc(en)}</div></th>`
    const tableHtml = `
    <table class="form">
      <thead>
        <tr>
          ${head('ক্রমিক', 'Serial')}
          ${head('পণ্য বা সেবার বর্ণনা (প্রযোজ্য ক্ষেত্রে ব্র্যান্ড নাম সহ)', 'Description of goods or service (with brand name, if applicable)', '', 'desc')}
          ${head('সরবরাহের একক', 'Unit of supply')}
          ${head('পরিমাণ', 'Quantity')}
          ${head(`একক মূল্য (${unit.bn})`, `Unit price (${unit.en})`, '<sup>১</sup>')}
          ${head(`মোট মূল্য (${unit.bn})`, `Total price (${unit.en})`, '<sup>১</sup>')}
          ${head('সম্পূরক শুল্কের হার', 'SD rate')}
          ${head(`সম্পূরক শুল্কের পরিমাণ (${unit.bn})`, `SD amount (${unit.en})`)}
          ${head('মূল্য সংযোজন করের হার/ সুনির্দিষ্ট কর', 'VAT rate / specific tax')}
          ${head(`মূল্য সংযোজন কর/ সুনির্দিষ্ট কর এর পরিমাণ (${unit.bn})`, `VAT / specific tax amount (${unit.en})`)}
          ${head('সকল প্রকার শুল্ক ও করসহ মূল্য', 'Price including all duties and taxes')}
        </tr>
        <tr class="colno"><td>(১)</td><td>(২)</td><td>(৩)</td><td>(৪)</td><td>(৫)</td><td>(৬)</td><td>(৭)</td><td>(৮)</td><td>(৯)</td><td>(১০)</td><td>(১১)</td></tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr class="total">
          <td colspan="5" style="text-align:right;"><span class="bn">সর্বমোট</span> <span class="en">/ Grand total</span> =</td>
          <td class="n">${fmtNum(tValue)}</td>
          <td class="grey"></td>
          <td class="n">${fmtNum(tSd)}</td>
          <td class="grey"></td>
          <td class="n">${fmtNum(tVat)}</td>
          <td class="n">${fmtNum(tTotal)}</td>
        </tr>
      </tbody>
    </table>`

    // Outside the 11 columns: MFS charge (a payment surcharge, not part of the supply) and the amount payable.
    const unitLabel = fx.converted || fx.currency === 'BDT' ? 'Tk' : fx.currency
    const notesRows = []
    notesRows.push(`<tr><td>Price including all duties and taxes (col. 11)</td><td class="n">${unitLabel} ${fmtNum(tTotal)}</td></tr>`)
    if (mfs > 0) notesRows.push(`<tr><td>MFS charge (${esc(fmtRate(invoice.taxRate))}) — payment surcharge, outside the taxable supply</td><td class="n">${unitLabel} ${fmtNum(mfs)}</td></tr>`)
    notesRows.push(`<tr class="strong"><td>Amount payable</td><td class="n">${unitLabel} ${fmtNum(payable)}</td></tr>`)

    const remarks = []
    if (treatmentMeta) remarks.push(`VAT treatment: ${esc(treatmentMeta.label)}${treatmentMeta.note ? ` (Mushak-9.1 note ${treatmentMeta.note})` : ''}.`)
    if (serviceCode) remarks.push(`Service code: ${esc(serviceCode)}${serviceMeta ? ` — ${esc(serviceMeta.label)}` : ''}.`)
    if (num(totals.discount) > 0) remarks.push(`Prices in columns 5–6 are net of the invoice discount of ${unitLabel} ${fmtNum(conv(totals.discount))}, shared across the lines in proportion to their value.`)
    if (fx.converted) remarks.push(`Invoice currency ${esc(fx.currency)}; Taka values at ${esc(fx.currency)} 1 = Tk ${esc((Math.round(fx.rate * 10000) / 10000).toLocaleString('en-BD', { maximumFractionDigits: 4 }))} (invoice total ${esc(fx.currency)} ${fmtNum(invoice.total)}).`)
    else if (!fx.known) remarks.push(`Amounts are in ${esc(fx.currency)}: no Taka equivalent is recorded on this invoice.`)
    if (invoice.status === 'CANCELLED') remarks.push('This invoice has been cancelled.')

    const alerts = []
    const valueBDT = totals.taxableValue * fx.rate
    if (!buyer.bin && ['STANDARD', 'REDUCED'].includes(totals.treatment) && valueBDT > BUYER_BIN_THRESHOLD) alerts.push(`Buyer BIN is missing. Rule 40(1)(c)(iv) requires the buyer's name, address and BIN on a Mushak-6.3 for supplies over Tk ${BUYER_BIN_THRESHOLD.toLocaleString('en-BD')}. Add the BIN on the client profile and reprint.`)
    if (!seller.bin) alerts.push('The company BIN is not set (Tax & VAT → Tax Settings). A Mushak-6.3 is not valid without the seller BIN.')
    if (!company.signatoryName) alerts.push('No authorised signatory is set (Tax & VAT → Tax Settings) — the name and designation lines print blank.')

    const isDup = copy === 'duplicate'
    const copyBadge = isDup
      ? '<span class="copy dup"><span class="bn">অনুলিপি</span> · Duplicate</span>'
      : '<span class="copy"><span class="bn">মূল কপি</span> · Original</span>'

    const body = `
    ${govHeader({ formBn: 'মূসক-৬.৩', formEn: 'Mushak-6.3' })}
    <div class="title">
      <h1><span class="bn">কর চালানপত্র</span> <span class="en" style="font-size:0.8em;">/ Tax Invoice</span></h1>
      <div class="rule"><span class="bn">[বিধি ৪০ এর উপ-বিধি (১) এর দফা (গ) ও (চ) দ্রষ্টব্য]</span></div>
      <div class="en">[See clauses (c) and (f) of sub-rule (1) of rule 40]</div>
      ${copyBadge}
    </div>

    <div style="max-width:560px;margin:0 auto 12px;">
      <table class="fields">
        ${fieldRow('নিবন্ধিত ব্যক্তির নাম', 'Name of registered person', seller.name)}
        ${fieldRow('নিবন্ধিত ব্যক্তির বিআইএন', 'BIN of registered person', seller.bin)}
        ${fieldRow('চালানপত্র ইস্যুর ঠিকানা', 'Address of issue', seller.address)}
      </table>
    </div>

    <div class="grid2">
      <table class="fields">
        ${fieldRow('ক্রেতার নাম', "Buyer's name", buyer.name)}
        ${fieldRow('ক্রেতার বিআইএন', "Buyer's BIN", buyer.bin)}
        ${fieldRow('ক্রেতার ঠিকানা', "Buyer's address", buyer.address)}
        ${fieldRow('সরবরাহের গন্তব্যস্থল', 'Destination of supply', str(invoice.deliveryDestination) || buyer.address)}
        ${fieldRow('যানবাহনের প্রকৃতি ও নম্বর', 'Nature and number of vehicle', 'Not applicable (service)')}
      </table>
      <table class="fields">
        ${fieldRow('চালানপত্র নম্বর', 'Invoice no.', invoice.invoiceNumber)}
        ${fieldRow('ইস্যুর তারিখ', 'Date of issue', fmtDhakaDate(issuedAt))}
        ${fieldRow('ইস্যুর সময়', 'Time of issue', fmtDhakaTime(issuedAt))}
      </table>
    </div>

    ${tableHtml}

    <div class="notes">
      <table>${notesRows.join('')}</table>
    </div>

    ${remarks.length ? `<ul class="remarks">${remarks.map(r => `<li>${r}</li>`).join('')}</ul>` : ''}

    ${signatureBlock(company)}

    <div class="foot">
      <div><sup>১</sup> <span class="bn">সকল প্রকার কর ব্যতীত মূল্য</span> <span class="en">/ Value excluding all taxes.</span></div>
      ${isDup ? '<div><strong>DUPLICATE</strong> — reprint of the tax invoice (VAT &amp; SD Rules 2016, rule 44).</div>' : ''}
      <div class="muted">Issued from ${esc(company.name || seller.name || 'the company')} ERP · printed ${esc(fmtDhakaDate(new Date()))} ${esc(fmtDhakaTime(new Date()))}</div>
    </div>`

    const otherCopy = isDup ? 'original' : 'duplicate'
    const toolbar = `
      <button type="button" id="btn-print" class="primary">Print / Save PDF</button>
      <a href="/api/invoices/${esc(String(invoice._id))}/mushak?copy=${otherCopy}">${isDup ? 'Open original copy' : 'Open duplicate copy'}</a>
      <span style="font-size:11px;color:#4b5563;">Give the original to the buyer; every reprint must be marked “Duplicate”.</span>`

    const nonce = newNonce()
    const html = documentHtml({
      title: `Mushak-6.3 ${invoice.invoiceNumber ?? ''}${isDup ? ' (Duplicate)' : ''}`,
      origin,
      body,
      nonce,
      toolbar,
      alerts,
      watermarks: [isDup ? 'DUPLICATE' : null, invoice.status === 'CANCELLED' ? 'CANCELLED' : null],
    })
    return htmlResponse(html, nonce, `mushak-6.3-${invoice.invoiceNumber ?? invoice._id}${isDup ? '-duplicate' : ''}`)
  } catch (err) {
    console.error('[GET /api/invoices/[id]/mushak]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
