export const dynamic = 'force-dynamic'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, AssetEvent, Setting } from '@/models'
import { canDoAny, requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { escapeHtml } from '@/lib/html'
import { qrSvg } from '@/lib/qr'
import { CONDITION_META } from '@/lib/inventory/constants'
import { compactCode } from '@/lib/codes'
import {
  READ_PERMS, errorResponse, employeeOfSession, companyFromSettings, appOrigin, printHeaders, fmtDay, fmtTk, dayKeyOf,
} from '../../_lib/service'

const EMP_POP = (path) => ({
  path,
  select: 'employeeId userId designation position department',
  populate: { path: 'userId', select: 'name email' },
})

const row = (label, value) => `
  <div class="kv"><span>${escapeHtml(label)}</span><strong>${value ? escapeHtml(value) : '—'}</strong></div>`

// GET /api/inventory/assets/[id]/handover?eventId= — printable equipment hand-over &
// acknowledgement form for an ASSIGNED event (default: the current assignment).
// Inventory staff, or the employee the asset was handed to.
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const eventId = new URL(request.url).searchParams.get('eventId')
    if (eventId && !isValidObjectId(eventId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const asset = await Asset.findById(params.id)
      .populate('categoryId', 'name')
      .populate('locationId', 'name')
      .lean()
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Which hand-over: the requested event, else the current assignment, else the latest one.
    let event = null
    if (eventId) {
      event = await AssetEvent.findOne({ _id: eventId, assetId: asset._id, type: 'ASSIGNED' })
        .populate(EMP_POP('toEmployeeId')).populate('departmentId', 'name').populate('toLocationId', 'name').lean()
    } else {
      if (asset.status === 'ASSIGNED' && asset.acknowledgement?.eventId) {
        event = await AssetEvent.findOne({ _id: asset.acknowledgement.eventId, assetId: asset._id, type: 'ASSIGNED' })
          .populate(EMP_POP('toEmployeeId')).populate('departmentId', 'name').populate('toLocationId', 'name').lean()
      }
      if (!event) {
        event = await AssetEvent.findOne({ assetId: asset._id, type: 'ASSIGNED' })
          .sort({ date: -1, createdAt: -1 })
          .populate(EMP_POP('toEmployeeId')).populate('departmentId', 'name').populate('toLocationId', 'name').lean()
      }
    }
    if (!event) return NextResponse.json({ error: 'This asset has not been handed over to anyone yet' }, { status: 404 })

    // Access: inventory staff, or the employee on this hand-over.
    if (!canDoAny(session, READ_PERMS)) {
      const me = await employeeOfSession(session)
      const recipientId = event.toEmployeeId?._id ? String(event.toEmployeeId._id) : null
      if (!me || !recipientId || String(me._id) !== recipientId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // Acknowledgement of THIS hand-over (asset record, else the next ACK event before custody changed).
    let ack = null
    if (asset.acknowledgement?.eventId && String(asset.acknowledgement.eventId) === String(event._id)) {
      ack = { status: asset.acknowledgement.status, at: asset.acknowledgement.at, note: asset.acknowledgement.note }
    } else {
      const next = await AssetEvent.find({
        assetId: asset._id,
        date: { $gte: event.date },
        type: { $in: ['ACKNOWLEDGED', 'ACK_DECLINED', 'ASSIGNED', 'RETURNED'] },
        _id: { $ne: event._id },
      }).sort({ date: 1, createdAt: 1 }).limit(5).lean()
      const first = next[0]
      if (first && (first.type === 'ACKNOWLEDGED' || first.type === 'ACK_DECLINED')) {
        ack = { status: first.type === 'ACKNOWLEDGED' ? 'ACCEPTED' : 'DECLINED', at: first.date, note: first.notes ?? null }
      }
    }
    const returned = await AssetEvent.findOne({
      assetId: asset._id, type: 'RETURNED', date: { $gte: event.date }, _id: { $ne: event._id },
    }).sort({ date: 1 }).lean()

    const company = companyFromSettings(await Setting.find({ group: 'company' }).lean())
    const emp = event.toEmployeeId && typeof event.toEmployeeId === 'object' ? event.toEmployeeId : null
    const empName = emp?.userId?.name ?? null
    const deptName = event.departmentId?.name ?? emp?.department ?? null
    const condition = event.condition ?? asset.condition
    const conditionLabel = CONDITION_META[condition]?.label ?? condition ?? '—'
    // HO + tag + YYMMDD of the hand-over, letters and digits only: HOENLAP00042261024
    // (a tag not yet migrated, EN-LAP-00042, gives the same form number).
    const formNo = compactCode(`HO${asset.assetTag}${String(dayKeyOf(event.date) ?? '').slice(2)}`)
    const expected = event.details?.expectedReturnDate ?? null
    const origin = appOrigin(request)
    const qr = await qrSvg(`${origin}/admin/inventory/assets/tag/${encodeURIComponent(asset.assetTag)}`, { size: 88, margin: 0 })
    const contactLine = [company.phone, company.email].filter(Boolean).join(' · ')
    const spec = [asset.brand, asset.model].filter(Boolean).join(' ')

    const ackBlock = ack && ack.status === 'ACCEPTED'
      ? `<div class="note ok">Receipt acknowledged electronically by ${escapeHtml(empName ?? 'the employee')} on ${escapeHtml(fmtDay(ack.at))}${ack.note ? ` — “${escapeHtml(ack.note)}”` : ''}.</div>`
      : ack && ack.status === 'DECLINED'
        ? `<div class="note bad">The employee declined this hand-over on ${escapeHtml(fmtDay(ack.at))}${ack.note ? ` — “${escapeHtml(ack.note)}”` : ''}.</div>`
        : event.details?.acknowledgement === 'PENDING'
          ? '<div class="note">Awaiting the employee’s acknowledgement in My Assets. A signed copy of this form is also accepted.</div>'
          : ''

    const nonce = randomBytes(16).toString('base64')
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<base href="${escapeHtml(new URL(request.url).origin)}/" />
<title>Equipment hand-over ${escapeHtml(asset.assetTag)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; background: #fff; font-size: 12px; }
  .page { max-width: 780px; margin: 0 auto; padding: 8px 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
  .head h1 { font-size: 21px; font-weight: 700; letter-spacing: -0.3px; text-align: right; }
  .head .sub { text-align: right; color: #64748b; font-size: 11.5px; margin-top: 3px; }
  .co p { color: #64748b; font-size: 11px; margin-top: 2px; }
  .co .name { color: #0f172a; font-weight: 700; font-size: 13px; }
  .rule { height: 1px; background: #e2e8f0; margin: 0 0 16px; }
  .box { border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; }
  .box h2 { font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #94a3b8; margin-bottom: 10px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 18px; }
  .kv span { display: block; font-size: 10px; color: #94a3b8; margin-bottom: 1px; }
  .kv strong { font-size: 12.5px; font-weight: 600; color: #0f172a; word-break: break-word; }
  .asset { display: flex; gap: 16px; align-items: flex-start; }
  .asset .qr { width: 88px; height: 88px; flex: 0 0 auto; }
  .asset .qr svg { width: 100%; height: 100%; }
  .tag { font-family: Consolas, 'Courier New', monospace; font-weight: 800; font-size: 15px; }
  ol { padding-left: 18px; }
  ol li { margin: 0 0 6px; line-height: 1.5; color: #334155; font-size: 11.5px; }
  .note { margin: 0 0 14px; padding: 9px 12px; border-radius: 8px; background: #fffbeb; color: #92400e; font-size: 11.5px; }
  .note.ok { background: #f0fdf4; color: #166534; }
  .note.bad { background: #fef2f2; color: #991b1b; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 22px; margin-top: 28px; }
  .sig { border-top: 1px solid #94a3b8; padding-top: 6px; font-size: 11px; color: #475569; }
  .sig b { display: block; color: #0f172a; font-size: 12px; margin-bottom: 2px; }
  .ret { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 18px; }
  .line { border-bottom: 1px solid #cbd5e1; height: 22px; }
  .foot { border-top: 1px solid #e2e8f0; margin-top: 18px; padding-top: 10px; text-align: center; color: #94a3b8; font-size: 10.5px; }
  @page { size: A4; margin: 14mm 12mm; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .box, .sigs { break-inside: avoid; } }
</style>
</head>
<body>
<div class="page">
  <div class="head">
    <div class="co">
      <img src="/en-logo.png" alt="" width="120" height="38" style="object-fit:contain;display:block;margin-bottom:6px;" />
      <p class="name">${escapeHtml(company.name)}</p>
      ${company.address ? `<p>${escapeHtml(company.address)}</p>` : ''}
      ${contactLine ? `<p>${escapeHtml(contactLine)}</p>` : ''}
    </div>
    <div>
      <h1>Equipment Hand-over &amp;<br/>Acknowledgement Form</h1>
      <p class="sub">Form no: <b>${escapeHtml(formNo)}</b></p>
      <p class="sub">Hand-over date: <b>${escapeHtml(fmtDay(event.date))}</b></p>
    </div>
  </div>
  <div class="rule"></div>

  <div class="box">
    <h2>Received by</h2>
    <div class="grid">
      ${row('Employee name', empName ?? (emp ? emp.employeeId : null) ?? (deptName ? `${deptName} (department)` : null))}
      ${row('Employee ID', emp?.employeeId)}
      ${row('Designation', emp?.designation ?? emp?.position)}
      ${row('Department', deptName)}
      ${row('Location', event.toLocationId?.name ?? asset.locationId?.name)}
      ${row('Expected return', expected ? fmtDay(expected) : 'On request / on separation')}
    </div>
  </div>

  <div class="box">
    <h2>Equipment</h2>
    <div class="asset">
      <div class="qr">${qr}</div>
      <div style="flex:1;min-width:0;">
        <div class="tag">${escapeHtml(asset.assetTag)}</div>
        <div style="font-size:14px;font-weight:700;margin:2px 0 10px;">${escapeHtml(asset.name)}</div>
        <div class="grid">
          ${row('Category', asset.categoryId?.name)}
          ${row('Brand / model', spec)}
          ${row('Serial number', asset.serialNumber)}
          ${row('Condition at hand-over', conditionLabel)}
          ${row('Asset value (cost)', Number(asset.cost) > 0 ? fmtTk(asset.cost) : null)}
          ${row('Warranty until', asset.warrantyExpiry ? fmtDay(asset.warrantyExpiry) : null)}
        </div>
        ${asset.specs ? `<p style="margin-top:10px;font-size:11px;color:#475569;white-space:pre-wrap;"><b style="color:#0f172a;">Specifications / accessories:</b> ${escapeHtml(asset.specs)}</p>` : ''}
        ${event.notes ? `<p style="margin-top:6px;font-size:11px;color:#475569;white-space:pre-wrap;"><b style="color:#0f172a;">Notes:</b> ${escapeHtml(event.notes)}</p>` : ''}
      </div>
    </div>
  </div>

  ${ackBlock}

  <div class="box">
    <h2>Terms of use</h2>
    <ol>
      <li>The equipment remains the property of ${escapeHtml(company.name)} and is issued for official work only.</li>
      <li>I will take reasonable care of it, keep it secure, and not lend it to anyone, install unlicensed software or open / modify it without approval from the company.</li>
      <li>I will report any loss, theft or damage to my manager and the admin team immediately (within 24 hours). A theft will also be reported to the police and the General Diary (GD) number given to the company.</li>
      <li>I will return the equipment with all accessories in good working order when asked, when I change role or location, and before my final settlement on leaving the company. Normal wear and tear is accepted.</li>
      <li>Loss or damage caused by my negligence or default may be recovered from me only after a proper enquiry, limited to the actual loss, as permitted by sections 125 and 127 of the Bangladesh Labour Act 2006 and company policy.</li>
      <li>Company data on the equipment is confidential. The company may inspect or audit the equipment at any time.</li>
    </ol>
  </div>

  <div class="sigs">
    <div class="sig"><b>Received by (employee)</b>${escapeHtml(empName ?? '')}<br/>Signature &amp; date</div>
    <div class="sig"><b>Issued by</b>${escapeHtml(event.createdByName ?? '')}<br/>Signature &amp; date</div>
    <div class="sig"><b>Approved by</b>Admin / HR<br/>Signature &amp; date</div>
  </div>

  <div class="box" style="margin-top:22px;">
    <h2>Return (to be completed when the equipment comes back)</h2>
    ${returned ? `<p style="margin-bottom:8px;font-size:11.5px;color:#334155;">Returned on <b>${escapeHtml(fmtDay(returned.date))}</b> in <b>${escapeHtml(CONDITION_META[returned.condition]?.label ?? returned.condition ?? '—')}</b> condition${returned.createdByName ? `, received by <b>${escapeHtml(returned.createdByName)}</b>` : ''}.</p>` : ''}
    <div class="ret">
      <div class="kv"><span>Date returned</span><div class="line"></div></div>
      <div class="kv"><span>Condition on return</span><div class="line"></div></div>
      <div class="kv"><span>Received by (name &amp; signature)</span><div class="line"></div></div>
    </div>
  </div>

  <div class="foot">Generated on ${escapeHtml(fmtDay(new Date()))} — ${escapeHtml(company.name)} · Scan the code to open this asset</div>
</div>
<script nonce="${nonce}">window.addEventListener('load', function () { window.print() })</script>
</body>
</html>`

    return new Response(html, { headers: printHeaders(nonce, `handover-${asset.assetTag}.html`) })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/assets/[id]/handover]')
  }
}
