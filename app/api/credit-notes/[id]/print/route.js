export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { CreditNote, Invoice } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { invoiceTaxTotals } from '@/lib/tax/invoiceVat'
import { getCompanyProfile } from '@/lib/finance/settings'
import { CREDIT_NOTE_REASONS } from '@/lib/tax/catalog'
import {
  esc, fmtNum, fmtQty, fmtDhakaDate, fmtDhakaTime, fxOfInvoice, moneyUnit,
  govHeader, fieldRow, signatureBlock, documentHtml, newNonce, htmlResponse, errorPage,
} from '../../_lib/mushakHtml'
import { NOTE_BUYER_VAT_THRESHOLD, NOTE_VIEW_PERMS } from '../../_lib/creditNotes'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v) => (v === null || v === undefined ? '' : String(v).trim())

function itemsOf(invoice) {
  let items = invoice?.items
  if (typeof items === 'string') {
    try { items = JSON.parse(items) } catch { items = [] }
  }
  return Array.isArray(items) ? items.filter(i => i && typeof i === 'object') : []
}

const multiline = (s) => esc(s).replace(/\r?\n/g, '<br />')

// GET /api/credit-notes/[id]/print?copy=original|duplicate
// Mushak-6.7 credit note / Mushak-6.8 debit note — Rule 40(1)(chha), SRO 142/2020 forms.
export async function GET(request, { params }) {
  const origin = new URL(request.url).origin
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, NOTE_VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return errorPage(404, 'Note not found.', origin)

    const { searchParams } = new URL(request.url)
    const copy = searchParams.get('copy') === 'duplicate' ? 'duplicate' : 'original'

    await connectDB()
    const note = await CreditNote.findById(params.id)
      .populate('refundAccountId', 'name type last4')
      .lean()
    if (!note) return errorPage(404, 'Note not found.', origin)

    const [invoice, company] = await Promise.all([
      Invoice.findById(note.invoiceId).lean(),
      getCompanyProfile(),
    ])
    if (!invoice) return errorPage(404, 'The invoice of this note no longer exists.', origin)

    const isCredit = note.kind !== 'DEBIT'
    const isVat = !!invoice.vatTreatment && invoice.vatTreatment !== 'NONE'
    const fx = fxOfInvoice(invoice)
    const unit = moneyUnit(fx)
    const unitLabel = fx.converted || fx.currency === 'BDT' ? 'Tk' : fx.currency
    const conv = (v) => round2(num(v) * fx.rate)

    // Supply as stated on the tax invoice (value incl. VAT & SD, excl. the MFS surcharge).
    const t = invoiceTaxTotals(invoice)
    const invQty = itemsOf(invoice).reduce((s, it) => s + (num(it.quantity) || 0), 0)
    const invValue = conv(t.taxableValue + t.sdAmount + t.vatAmount)
    const invVat = conv(t.vatAmount)
    const invSd = conv(t.sdAmount)
    const invoiceIssued = note.invoiceDate ?? invoice.issuedAt ?? invoice.sentAt ?? invoice.issueDate

    const reasonLabel = CREDIT_NOTE_REASONS.find(r => r.value === note.reason)?.label ?? note.reason
    const items = (note.items ?? []).length ? note.items : [{ description: reasonLabel, quantity: 1, value: note.valueAmount, vatAmount: note.vatAmount, sdAmount: note.sdAmount }]
    const rows = items.map(it => {
      const value = conv(it.value)
      const vat = conv(it.vatAmount)
      const sd = conv(it.sdAmount)
      return { description: str(it.description), quantity: num(it.quantity) || 1, gross: round2(value + vat + sd), vat, sd }
    })
    const span = rows.length
    const sumG = round2(rows.reduce((s, r) => s + r.gross, 0))
    const sumV = round2(rows.reduce((s, r) => s + r.vat, 0))
    const sumS = round2(rows.reduce((s, r) => s + r.sd, 0))
    const sumQ = rows.reduce((s, r) => s + r.quantity, 0)

    const invoiceCell = `${esc(note.invoiceNumber ?? invoice.invoiceNumber ?? '—')}<div class="en">${esc(fmtDhakaDate(invoiceIssued))}${invoiceIssued ? `, ${esc(fmtDhakaTime(invoiceIssued))}` : ''}</div>`
    const rowsHtml = rows.map((r, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        ${i === 0 ? `<td rowspan="${span}">${invoiceCell}</td>` : ''}
        <td>${esc(reasonLabel)}${r.description && r.description !== reasonLabel ? `<div class="en">${multiline(r.description)}</div>` : ''}</td>
        ${i === 0 ? `
        <td class="n" rowspan="${span}">${fmtNum(invValue)}</td>
        <td class="n" rowspan="${span}">${esc(fmtQty(invQty || 1))}</td>
        <td class="n" rowspan="${span}">${fmtNum(invVat)}</td>
        <td class="n" rowspan="${span}">${fmtNum(invSd)}</td>` : ''}
        <td class="n">${fmtNum(r.gross)}</td>
        <td class="n">${esc(fmtQty(r.quantity))}</td>
        <td class="n">${fmtNum(r.vat)}</td>
        <td class="n">${fmtNum(r.sd)}</td>
      </tr>`).join('')
    const totalRow = rows.length > 1 ? `
      <tr class="total">
        <td colspan="7" style="text-align:right;"><span class="bn">সর্বমোট</span> <span class="en">/ Total adjustment</span> =</td>
        <td class="n">${fmtNum(sumG)}</td>
        <td class="n">${esc(fmtQty(sumQ))}</td>
        <td class="n">${fmtNum(sumV)}</td>
        <td class="n">${fmtNum(sumS)}</td>
      </tr>` : ''

    const head = (bn, en, extra = '') => `<th${extra}><div class="bn">${esc(bn)}</div><div class="en">${esc(en)}</div></th>`
    const adjBn = isCredit ? 'হ্রাসকারী সমন্বয়ের সহিত সংশ্লিষ্ট' : 'বৃদ্ধিকারী সমন্বয়ের সহিত সংশ্লিষ্ট'
    const adjEn = isCredit ? 'Related to the decreasing adjustment' : 'Related to the increasing adjustment'
    const tableHtml = `
    <table class="form">
      <thead>
        <tr>
          ${head('ক্রমিক নং', 'Serial', ' rowspan="2"')}
          ${head('কর চালানপত্রের নম্বর ও তারিখ', 'Tax invoice no. and date', ' rowspan="2"')}
          ${head(isCredit ? 'ক্রেডিট নোট ইস্যুর কারণ' : 'ডেবিট নোট ইস্যুর কারণ', isCredit ? 'Reason for issuing the credit note' : 'Reason for issuing the debit note', ' rowspan="2"')}
          ${head('চালানপত্রে উল্লিখিত সরবরাহের', 'Supply as stated in the tax invoice', ' colspan="4"')}
          ${head(adjBn, adjEn, ' colspan="4"')}
        </tr>
        <tr>
          ${head(`মূল্য¹ (${unit.bn})`, `Value¹ (${unit.en})`)}
          ${head('পরিমাণ', 'Quantity')}
          ${head('মূল্য সংযোজন করের পরিমাণ', 'VAT amount')}
          ${head('সম্পূরক শুল্কের পরিমাণ', 'SD amount')}
          ${head(`মূল্য¹ (${unit.bn})`, `Value¹ (${unit.en})`)}
          ${head('পরিমাণ', 'Quantity')}
          ${head('মূল্য সংযোজন করের পরিমাণ', 'VAT amount')}
          ${head(isCredit ? 'সমন্বয়যোগ্য সম্পূরক শুল্কের পরিমাণ' : 'সম্পূরক শুল্কের পরিমাণ', isCredit ? 'Adjustable SD amount' : 'SD amount')}
        </tr>
        <tr class="colno"><td>(১)</td><td>(২)</td><td>(৩)</td><td>(৪)</td><td>(৫)</td><td>(৬)</td><td>(৭)</td><td>(৮)</td><td>(৯)</td><td>(১০)</td><td>(১১)</td></tr>
      </thead>
      <tbody>${rowsHtml}${totalRow}</tbody>
    </table>`

    // Settlement & remarks (outside the form table)
    const remarks = []
    if (note.reasonText) remarks.push(`Details: ${esc(note.reasonText)}`)
    if (!isCredit) remarks.push(`Added to invoice ${esc(note.invoiceNumber ?? invoice.invoiceNumber ?? '')} — amount payable increased by ${unitLabel} ${fmtNum(sumG)}.`)
    else if (note.settlement === 'REFUND') remarks.push(`Refunded to the buyer${note.refundAccountId?.name ? ` from ${esc(note.refundAccountId.name)}${note.refundAccountId.last4 ? ` ••${esc(note.refundAccountId.last4)}` : ''}` : ''}: ${unitLabel} ${fmtNum(sumG)}.`)
    else remarks.push(`Adjusted against the amount due on invoice ${esc(note.invoiceNumber ?? invoice.invoiceNumber ?? '')}: ${unitLabel} ${fmtNum(sumG)}.`)
    if (fx.converted) remarks.push(`Invoice currency ${esc(fx.currency)}; Taka values at ${esc(fx.currency)} 1 = Tk ${esc((Math.round(fx.rate * 10000) / 10000).toLocaleString('en-BD', { maximumFractionDigits: 4 }))}.`)
    else if (!fx.known) remarks.push(`Amounts are in ${esc(fx.currency)}: no Taka equivalent is recorded on the invoice.`)
    if (!isVat) remarks.push('The invoice carries no VAT, so this note has no VAT effect and is not reported in the VAT return.')
    if (note.status === 'CANCELLED') remarks.push(`This note was cancelled${note.cancelledAt ? ` on ${esc(fmtDhakaDate(note.cancelledAt))}` : ''}${note.cancelReason ? `: ${esc(note.cancelReason)}` : ''}.`)

    const seller = {
      name: str(note.seller?.name) || str(company.name),
      bin: str(note.seller?.bin) || str(company.bin),
      address: str(company.issueAddress) || str(note.seller?.address) || str(company.address),
    }
    const buyer = { name: str(note.buyer?.name), bin: str(note.buyer?.bin), address: str(note.buyer?.address) }

    const alerts = []
    if (isVat && !buyer.bin && conv(note.vatAmount) > NOTE_BUYER_VAT_THRESHOLD) {
      alerts.push(`Buyer BIN is missing. When the VAT effect is above Tk ${NOTE_BUYER_VAT_THRESHOLD.toLocaleString('en-BD')}, the note must show the buyer's name, address and BIN.`)
    }
    if (isVat && !seller.bin) alerts.push('The company BIN is not set (Tax & VAT → Tax Settings).')

    const isDup = copy === 'duplicate'
    const formBn = isCredit ? 'মূসক-৬.৭' : 'মূসক-৬.৮'
    const formEn = isCredit ? 'Mushak-6.7' : 'Mushak-6.8'
    const titleBn = isCredit ? 'ক্রেডিট নোট' : 'ডেবিট নোট'
    const titleEn = isCredit ? 'Credit Note' : 'Debit Note'
    const copyBadge = isDup
      ? '<span class="copy dup"><span class="bn">অনুলিপি</span> · Duplicate</span>'
      : '<span class="copy"><span class="bn">মূল কপি</span> · Original</span>'

    const body = `
    ${isVat ? govHeader({ formBn, formEn }) : ''}
    <div class="title">
      <h1><span class="bn">${titleBn}</span> <span class="en" style="font-size:0.8em;">/ ${titleEn}</span></h1>
      ${isVat ? `<div class="rule"><span class="bn">[বিধি ৪০ এর উপ-বিধি (১) এর দফা (ছ)]</span></div><div class="en">[See clause (chha) of sub-rule (1) of rule 40]</div>` : '<div class="en">Commercial note — not a VAT document</div>'}
      ${copyBadge}
    </div>

    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <table class="fields" style="width:auto;min-width:300px;">
        ${fieldRow(isCredit ? 'ক্রেডিট নোট নম্বর' : 'ডেবিট নোট নম্বর', isCredit ? 'Credit note no.' : 'Debit note no.', note.noteNo)}
        ${fieldRow('ইস্যুর তারিখ', 'Date of issue', fmtDhakaDate(note.issuedAt))}
        ${fieldRow('ইস্যুর সময়', 'Time of issue', fmtDhakaTime(note.issuedAt))}
      </table>
    </div>

    <table class="fields" style="max-width:640px;">
      ${fieldRow('নিবন্ধিত ব্যক্তির নাম', 'Name of registered person', seller.name)}
      ${fieldRow('নিবন্ধিত ব্যক্তির বিআইএন', 'BIN of registered person', seller.bin)}
      ${fieldRow('নিবন্ধিত ব্যক্তির ঠিকানা', 'Address of registered person', seller.address)}
      ${fieldRow('ক্রেতা/গ্রহীতার নাম', 'Name of buyer / recipient', buyer.name)}
      ${fieldRow('ক্রেতা/গ্রহীতার বিআইএন', 'BIN of buyer / recipient', buyer.bin)}
      ${fieldRow('ঠিকানা', 'Address', buyer.address)}
      ${fieldRow('যানবাহনের প্রকৃতি ও নম্বর', 'Nature and number of vehicle', 'Not applicable (service)')}
    </table>

    ${tableHtml}

    <ul class="remarks">${remarks.map(r => `<li>${r}</li>`).join('')}</ul>

    ${signatureBlock(company, { bnTitle: 'দায়িত্বপ্রাপ্ত ব্যক্তির নাম', enTitle: 'Name of the responsible person' })}

    <div class="foot">
      <div>¹ <span class="bn">পণ্য/সেবার মূসক ও সম্পূরক শুল্কসহ মূল্য</span> <span class="en">/ Value of the goods or service including VAT and SD.</span></div>
      ${isDup ? '<div><strong>DUPLICATE</strong> — reprint of the note (VAT &amp; SD Rules 2016, rule 44).</div>' : ''}
      <div class="muted">Printed ${esc(fmtDhakaDate(new Date()))} ${esc(fmtDhakaTime(new Date()))}</div>
    </div>`

    const otherCopy = isDup ? 'original' : 'duplicate'
    const toolbar = `
      <button type="button" id="btn-print" class="primary">Print / Save PDF</button>
      <a href="/api/credit-notes/${esc(String(note._id))}/print?copy=${otherCopy}">${isDup ? 'Open original copy' : 'Open duplicate copy'}</a>
      <a href="/api/invoices/${esc(String(invoice._id))}/mushak">Invoice Mushak-6.3</a>`

    const nonce = newNonce()
    const html = documentHtml({
      title: `${isVat ? `${formEn} ` : ''}${titleEn} ${note.noteNo ?? ''}${isDup ? ' (Duplicate)' : ''}`,
      origin,
      body,
      nonce,
      toolbar: isVat ? toolbar : toolbar.replace(/<a href="\/api\/invoices\/[^"]+\/mushak">Invoice Mushak-6.3<\/a>/, ''),
      alerts,
      watermarks: [isDup ? 'DUPLICATE' : null, note.status === 'CANCELLED' ? 'CANCELLED' : null],
    })
    return htmlResponse(html, nonce, `${isCredit ? 'credit' : 'debit'}-note-${note.noteNo ?? note._id}${isDup ? '-duplicate' : ''}`)
  } catch (err) {
    console.error('[GET /api/credit-notes/[id]/print]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
