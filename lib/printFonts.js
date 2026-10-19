// Anek Bangla (Bengali subset) for documents that don't load the app's CSS — print popups
// and server-rendered HTML (vouchers, slips, PDFs). Same file next/font serves to the app,
// self-hosted at a stable URL so the CSP's `font-src 'self'` allows it. Defines
// --font-bengali so the same font stacks work inside the app and in these documents.
export const BENGALI_FONT_CSS = `@font-face{font-family:'Anek Bangla';font-style:normal;font-weight:100 800;font-stretch:100%;font-display:swap;src:url('/fonts/anek-bangla-bengali.woff2') format('woff2');unicode-range:U+0951-0952,U+0964-0965,U+0980-09FE,U+1CD0,U+1CD2,U+1CD5-1CD6,U+1CD8,U+1CE1,U+1CEA,U+1CED,U+1CF2,U+1CF5-1CF7,U+200C-200D,U+20B9,U+25CC,U+A8F1,U+11DF0-11DF1}:root{--font-bengali:'Anek Bangla'}`

export const BENGALI_FONT_STYLE = `<style>${BENGALI_FONT_CSS}</style>`
