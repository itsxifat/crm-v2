export const dynamic = 'force-dynamic'
import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, Setting } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { escapeHtml } from '@/lib/html'
import { qrSvg } from '@/lib/qr'
import { compactCode, codeEquals } from '@/lib/codes'
import { guardRead, errorResponse, companyFromSettings, appOrigin, printHeaders, todayKey } from '../_lib/service'

const MAX_LABELS = 300

/**
 * Sheet layouts (A4 portrait, standard die-cut label stock):
 *  small — 3 × 8 = 24 labels of 63.5 × 33.9 mm (e.g. Avery L7159)
 *  large — 2 × 4 =  8 labels of 99.1 × 67.7 mm (e.g. Avery L7165)
 */
const LAYOUTS = {
  small: {
    cols: 3, rows: 8, w: 63.5, h: 33.9, gapX: 2.5, gapY: 0, top: 12.9, side: 7.25, qrMm: 27, qrPx: 110,
    stock: '3 × 8 labels, 63.5 × 33.9 mm (e.g. Avery L7159 / J8159)',
  },
  large: {
    cols: 2, rows: 4, w: 99.1, h: 67.7, gapX: 2.5, gapY: 0, top: 13.1, side: 4.65, qrMm: 46, qrPx: 180,
    stock: '2 × 4 labels, 99.1 × 67.7 mm (e.g. Avery L7165 / J8165)',
  },
}

/** Monospace tag font size (pt) that fits the text column: ~0.6em per character, 1pt = 0.3528mm. */
function tagFontPt(tag, size) {
  const L = LAYOUTS[size]
  const padding = size === 'small' ? 5 : 10
  const gap = size === 'small' ? 2.2 : 4
  const availMm = L.w - padding - gap - L.qrMm - 0.5
  const maxPt = size === 'small' ? 10.5 : 15
  const fit = availMm / (Math.max(1, String(tag).length) * 0.6 * 0.3528)
  return Math.max(5.5, Math.min(maxPt, Math.floor(fit * 10) / 10))
}

function labelHtml(a, svg, { size, company }) {
  const sub = [a.brand, a.model].filter(Boolean).join(' ')
  const tagStyle = `style="font-size:${tagFontPt(a.assetTag, size)}pt"`
  const serial = a.serialNumber ? `S/N ${a.serialNumber}` : ''
  if (size === 'large') {
    return `
    <div class="label">
      <div class="qr">${svg}</div>
      <div class="txt">
        <div class="co">${escapeHtml(company.name)}</div>
        <div class="tag" ${tagStyle}>${escapeHtml(a.assetTag)}</div>
        <div class="name">${escapeHtml(a.name)}</div>
        ${sub ? `<div class="meta">${escapeHtml(sub)}</div>` : ''}
        ${a.categoryId?.name ? `<div class="meta">${escapeHtml(a.categoryId.name)}</div>` : ''}
        ${serial ? `<div class="meta mono">${escapeHtml(serial)}</div>` : ''}
        <div class="foot">Property of ${escapeHtml(company.name)}. Scan the code to view or report this item.${company.phone ? ` If found, call ${escapeHtml(company.phone)}.` : ''}</div>
      </div>
    </div>`
  }
  return `
    <div class="label">
      <div class="qr">${svg}</div>
      <div class="txt">
        <div class="co">${escapeHtml(company.name)}</div>
        <div class="tag" ${tagStyle}>${escapeHtml(a.assetTag)}</div>
        <div class="name">${escapeHtml(a.name)}</div>
        ${serial ? `<div class="meta mono">${escapeHtml(serial)}</div>` : sub ? `<div class="meta">${escapeHtml(sub)}</div>` : ''}
      </div>
    </div>`
}

// GET /api/inventory/assets/labels?ids=a,b,c&size=small|large&skip=0
// Printable sticker sheet: company, big asset tag, name and a QR code that opens
// /admin/inventory/assets/tag/{tag} (works from any phone camera).
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = guardRead(session)
    if (denied) return denied

    const sp = new URL(request.url).searchParams
    const size = sp.get('size') === 'large' ? 'large' : 'small'
    const L = LAYOUTS[size]
    const perSheet = L.cols * L.rows
    const skip = Math.min(perSheet - 1, Math.max(0, parseInt(sp.get('skip') ?? '0', 10) || 0))

    const ids = [...new Set(String(sp.get('ids') ?? '').split(',').map(s => s.trim()).filter(Boolean))]
    // Tags compare with separators ignored: EN-LAP-00042 (old label) = ENLAP00042.
    const tags = [...new Set(String(sp.get('tags') ?? '').split(',').map(compactCode).filter(Boolean))]
    if (!ids.length && !tags.length) return NextResponse.json({ error: 'Choose at least one asset' }, { status: 400 })
    if (ids.some(id => !isValidObjectId(id))) return NextResponse.json({ error: 'Invalid asset id' }, { status: 400 })
    if (ids.length + tags.length > MAX_LABELS) {
      return NextResponse.json({ error: `At most ${MAX_LABELS} labels can be printed at once` }, { status: 422 })
    }

    await connectDB()
    const or = []
    if (ids.length) or.push({ _id: { $in: ids } })
    for (const t of tags) or.push({ assetTag: codeEquals(t) })
    const [found, settingRows] = await Promise.all([
      Asset.find({ $or: or }).select('assetTag name brand model serialNumber categoryId').populate('categoryId', 'name code').lean(),
      Setting.find({ group: 'company' }).lean(),
    ])
    if (!found.length) return NextResponse.json({ error: 'No matching assets' }, { status: 404 })

    // Keep the order the user selected.
    const order = new Map([...ids.map((id, i) => [id, i]), ...tags.map((t, i) => [t, ids.length + i])])
    const rank = (a) => order.get(String(a._id)) ?? order.get(compactCode(a.assetTag)) ?? 0
    const assets = found.sort((x, y) => rank(x) - rank(y))

    const company = companyFromSettings(settingRows)
    const origin = appOrigin(request)
    const cells = []
    for (let i = 0; i < skip; i++) cells.push('<div class="label empty"></div>')
    for (const a of assets) {
      const url = `${origin}/admin/inventory/assets/tag/${encodeURIComponent(a.assetTag)}`
      const svg = await qrSvg(url, { size: L.qrPx, margin: 0, errorCorrectionLevel: 'M' })
      cells.push(labelHtml(a, svg, { size, company }))
    }
    const sheets = []
    for (let i = 0; i < cells.length; i += perSheet) sheets.push(cells.slice(i, i + perSheet).join(''))

    const nonce = randomBytes(16).toString('base64')
    const small = size === 'small'
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base href="${escapeHtml(new URL(request.url).origin)}/" />
<title>Asset labels (${assets.length})</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; background: #e5e7eb; }
  .bar { position: sticky; top: 0; z-index: 2; background: #111827; color: #f9fafb; padding: 10px 16px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; font-size: 13px; }
  .bar b { font-weight: 600; }
  .bar .hint { color: #cbd5e1; font-size: 12px; flex: 1 1 320px; }
  .bar button { background: #fff; color: #111827; border: 0; border-radius: 8px; padding: 7px 14px; font-weight: 600; font-size: 13px; cursor: pointer; }
  .sheet {
    width: 210mm; height: 296.5mm; margin: 12px auto; background: #fff; overflow: hidden;
    padding: ${L.top}mm ${L.side}mm 0 ${L.side}mm;
    display: grid; grid-template-columns: repeat(${L.cols}, ${L.w}mm); grid-auto-rows: ${L.h}mm;
    column-gap: ${L.gapX}mm; row-gap: ${L.gapY}mm; align-content: start;
    box-shadow: 0 1px 4px rgba(0,0,0,.15);
  }
  .label { width: ${L.w}mm; height: ${L.h}mm; overflow: hidden; display: flex; align-items: center; gap: ${small ? 2.2 : 4}mm; padding: ${small ? '2mm 2.5mm' : '4mm 5mm'}; outline: 1px dashed #cbd5e1; outline-offset: -1px; }
  .label.empty { outline-color: #f1f5f9; }
  .qr { width: ${L.qrMm}mm; height: ${L.qrMm}mm; flex: 0 0 auto; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .txt { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; ${small ? '' : 'height: 100%;'} }
  .co { font-size: ${small ? 5.5 : 7.5}pt; text-transform: uppercase; letter-spacing: .06em; color: #475569; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tag { font-family: 'Consolas', 'Courier New', monospace; font-weight: 800; font-size: ${small ? 10.5 : 15}pt; letter-spacing: .02em; margin: ${small ? '0.6mm 0' : '1.5mm 0'}; white-space: nowrap; }
  .name { font-size: ${small ? 6.8 : 9.5}pt; font-weight: 600; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .meta { font-size: ${small ? 5.8 : 7.5}pt; color: #334155; margin-top: 0.6mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mono { font-family: 'Consolas', 'Courier New', monospace; }
  .foot { margin-top: auto; font-size: 6pt; color: #64748b; line-height: 1.25; }
  @page { size: A4 portrait; margin: 0; }
  @media print {
    body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .bar { display: none; }
    .sheet { margin: 0; box-shadow: none; page-break-after: always; break-after: page; }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    .label, .label.empty { outline: none; }
  }
</style>
</head>
<body>
  <div class="bar">
    <b>${assets.length} label${assets.length === 1 ? '' : 's'} · ${sheets.length} sheet${sheets.length === 1 ? '' : 's'}</b>
    <span class="hint">Label stock: ${escapeHtml(L.stock)}. Print at 100% / "Actual size" with no scaling.${skip ? ` The first ${skip} position${skip === 1 ? ' is' : 's are'} left blank.` : ''} Dashed lines show the cut edges on screen only.</span>
    <button type="button" id="print-btn">Print</button>
  </div>
  ${sheets.map(s => `<div class="sheet">${s}</div>`).join('\n  ')}
<script nonce="${nonce}">
  document.getElementById('print-btn').addEventListener('click', function () { window.print() });
  window.addEventListener('load', function () { setTimeout(function () { window.print() }, 300) });
</script>
</body>
</html>`

    return new Response(html, { headers: printHeaders(nonce, `asset-labels-${todayKey()}.html`) })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/assets/labels]')
  }
}
