/**
 * lib/qr.js — SERVER-ONLY QR code rendering (asset labels, printable forms).
 *
 *   const svg = await qrSvg(`${origin}/admin/inventory/assets/tag/${tag}`, { size: 96 })
 *   html += `<div class="qr">${svg}</div>`          // inline SVG, no external request
 *
 *   const src = await qrDataUrl(url, { size: 160 })  // 'data:image/png;base64,…' for <img src>
 *
 * Error-correction level M (~15% damage tolerance) suits small printed labels.
 * The SVG is vector, so it prints sharply at any label size; `size` only sets
 * its width/height attributes (CSS can override them).
 */

import QRCode from 'qrcode'

const EC_LEVELS = ['L', 'M', 'Q', 'H']

function qrOptions({ size = 96, margin = 0, errorCorrectionLevel = 'M', dark = '#000000', light = '#ffffff' } = {}) {
  const width = Math.max(16, Math.round(Number(size) || 96))
  const quiet = Math.max(0, Math.min(16, Math.trunc(Number(margin) || 0)))
  const level = EC_LEVELS.includes(String(errorCorrectionLevel).toUpperCase())
    ? String(errorCorrectionLevel).toUpperCase()
    : 'M'
  return { width, margin: quiet, errorCorrectionLevel: level, color: { dark, light } }
}

function assertText(text) {
  const value = text === null || text === undefined ? '' : String(text)
  if (!value) throw new Error('QR code text is required')
  return value
}

/**
 * QR code as an inline SVG string.
 * @param {string} text
 * @param {{ size?: number, margin?: number, errorCorrectionLevel?: 'L'|'M'|'Q'|'H', dark?: string, light?: string }} [opts]
 *        size = rendered width/height in px (default 96); margin = quiet-zone modules (default 0)
 * @returns {Promise<string>} '<svg …>…</svg>'
 */
export async function qrSvg(text, { size = 96, margin = 0, errorCorrectionLevel = 'M', dark, light } = {}) {
  const svg = await QRCode.toString(assertText(text), {
    type: 'svg',
    ...qrOptions({ size, margin, errorCorrectionLevel, dark, light }),
  })
  return String(svg).trim()
}

/**
 * QR code as a PNG data URL (for <img src> where inline SVG is not convenient).
 * @param {string} text
 * @param {{ size?: number, margin?: number, errorCorrectionLevel?: 'L'|'M'|'Q'|'H', dark?: string, light?: string }} [opts]
 * @returns {Promise<string>} 'data:image/png;base64,…'
 */
export async function qrDataUrl(text, { size = 96, margin = 0, errorCorrectionLevel = 'M', dark, light } = {}) {
  return QRCode.toDataURL(assertText(text), {
    type: 'image/png',
    ...qrOptions({ size, margin, errorCorrectionLevel, dark, light }),
  })
}
