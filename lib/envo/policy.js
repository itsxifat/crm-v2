/**
 * lib/envo/policy.js — SERVER-ONLY. The tax rules Envo prices its invoices with.
 *
 * Tax is decided here, in the CRM (Configuration → Integrations → Envo, falling
 * back to Tax & VAT → Settings). Envo keeps a copy so that customers can still
 * check out while the CRM is away, stamps each invoice with the version it used,
 * and the CRM recalculates every invoice it receives.
 */
import crypto from 'node:crypto'
import { Client, Setting } from '@/models'
import { getFinanceSettings, getCompanyProfile } from '@/lib/finance/settings'
import { getEnvoSettings } from '@/lib/integrations/settings'
import { computeInvoiceTotals, INVOICE_VAT_TREATMENTS } from '@/lib/invoiceTotals'
import { getConfig, invalidateConfigCache } from '@/lib/getConfig'
import { productUnit } from '@/lib/units'

export const ENVO_PRODUCT_ID = 'ENVO'
export const ENVO_UNIT = productUnit(ENVO_PRODUCT_ID)

/** What finance sees trying to change an Envo invoice by hand. */
export const ENVO_OWNED_MESSAGE = 'This invoice belongs to Envo: the customer pays it there and the CRM follows. It cannot be edited, sent, cancelled or paid here.'

const HISTORY_MAX = 100
const NO_VAT_RATE = ['ZERO_RATED', 'EXEMPT', 'NONE']
const NO_SD = ['ZERO_RATED', 'NONE']

/** The figures that change what an invoice adds up to. */
function taxFigures(s, vat) {
  let vatTreatment
  let vatRate
  if (vat?.registrationType !== 'REGISTERED') {
    vatTreatment = 'NONE'
    vatRate = 0
  } else if (s.vatTreatment && INVOICE_VAT_TREATMENTS.includes(s.vatTreatment)) {
    vatTreatment = s.vatTreatment
    vatRate = NO_VAT_RATE.includes(vatTreatment) ? 0 : Number(s.vatRate) || 0
  } else {
    vatTreatment = INVOICE_VAT_TREATMENTS.includes(vat.defaultSalesTreatment) ? vat.defaultSalesTreatment : 'NONE'
    vatRate = NO_VAT_RATE.includes(vatTreatment) ? 0 : Number(vat.defaultSalesRate) || 0
  }
  return {
    vatTreatment,
    vatRate,
    sdRate: NO_SD.includes(vatTreatment) ? 0 : Number(s.sdRate) || 0,
    pricesIncludeVat: s.pricesIncludeVat !== false,
  }
}

export function policyVersion(f) {
  const text = JSON.stringify([f.vatTreatment, Number(f.vatRate), Number(f.sdRate), !!f.pricesIncludeVat])
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)
}

/** Remembers a version the first time it is handed out (see ENVO_DEFAULTS.policyHistory). */
async function rememberVersion(s, figures, version) {
  const history = Array.isArray(s.policyHistory) ? s.policyHistory : []
  if (history.some(h => h.version === version)) return
  const row = await Setting.findOne({ key: 'envo' }).lean()
  let stored = {}
  try { stored = row?.value ? JSON.parse(row.value) : {} } catch { stored = {} }
  const next = [...(Array.isArray(stored.policyHistory) ? stored.policyHistory : []), { version, ...figures, at: new Date().toISOString() }].slice(-HISTORY_MAX)
  // Conditional on the stored text: a settings save in between wins, and this
  // version is added on the next call.
  await Setting.updateOne(
    { key: 'envo', value: row?.value ?? null },
    { $set: { value: JSON.stringify({ ...stored, policyHistory: next }), group: 'integrations' } },
    { upsert: !row },
  ).catch(err => { if (err?.code !== 11000) throw err })
  s.policyHistory = next
}

/**
 * What Envo needs to bill: tax figures, the seller as printed on invoices, and
 * the customers billed at zero rate (clients marked FOREIGN in the CRM).
 */
export async function envoPolicy(settings = null) {
  const s = settings ?? await getEnvoSettings()
  const [finance, company, foreign] = await Promise.all([
    getFinanceSettings(),
    getCompanyProfile(),
    Client.find({ envoId: { $gt: 0 }, vatRegistrationType: 'FOREIGN' }).select('envoId').lean(),
  ])
  const figures = taxFigures(s, finance.vat)
  const version = policyVersion(figures)
  await rememberVersion(s, figures, version)
  return {
    version,
    ...figures,
    serviceCode: figures.vatTreatment === 'NONE' ? null : (s.serviceCode || finance.vat?.defaultServiceCode || null),
    zeroRatedAccounts: foreign.map(c => c.envoId).sort((a, b) => a - b),
    topupVat: s.topupVat === 'INCLUDED' ? 'INCLUDED' : 'NONE',
    seller: {
      name: company.name || null, address: company.address || null, phone: company.phone || null,
      email: company.email || null, website: company.website || null, bin: company.bin || null, tin: company.tin || null,
    },
  }
}

/** A tax setup for the settings screen: null when it can be billed, else why not. */
export function taxSetupProblem({ vatTreatment, vatRate, sdRate }) {
  if (vatTreatment === null || vatTreatment === undefined) return null
  const calc = computeInvoiceTotals({
    items: [{ description: 'Check', quantity: 1, rate: 100, vatRate: Number(vatRate) || 0, sdRate: Number(sdRate) || 0 }],
    vatTreatment,
    defaultVatRate: Number(vatRate) || 0,
  })
  return calc.error ? calc.error.replace(/^Item 1: /, '') : null
}

/**
 * Was this invoice priced under tax settings the CRM has actually given out?
 * Invoices made before the integration carry no version and no VAT.
 * @returns {string|null} what is wrong, or null
 */
export function invoicePolicyProblem(doc, settings, client) {
  if (doc.vatTreatment === 'NONE' && !doc.policyVersion) return null
  const rate = Number(doc.items[0]?.vatRate) || 0
  const sd = Number(doc.items[0]?.sdRate) || 0
  // A customer the CRM bills at zero rate, under any version.
  if (doc.vatTreatment === 'ZERO_RATED' && client?.vatRegistrationType === 'FOREIGN' && rate === 0) return null
  const given = (Array.isArray(settings.policyHistory) ? settings.policyHistory : []).find(h => h.version === doc.policyVersion)
  if (!given) return `Tax version ${doc.policyVersion ?? '(none)'} was never given out by this CRM`
  if (given.vatTreatment !== doc.vatTreatment || Number(given.vatRate) !== rate || Number(given.sdRate) !== sd) {
    return `The invoice says ${doc.vatTreatment} ${rate}% VAT, ${sd}% SD, but tax version ${doc.policyVersion} was ${given.vatTreatment} ${given.vatRate}% VAT, ${given.sdRate}% SD`
  }
  return null
}

/** Envo is a product in Configuration → Products; added once if it is not there yet. */
export async function ensureEnvoProduct() {
  const config = await getConfig()
  if ((config.products ?? []).some(p => p?.id === ENVO_PRODUCT_ID)) return false
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await Setting.findOne({ key: 'crm_config' }).lean()
    let saved = {}
    try { saved = row?.value ? JSON.parse(row.value) : {} } catch { return false }
    const products = Array.isArray(saved.products) ? saved.products : []
    if (products.some(p => p?.id === ENVO_PRODUCT_ID)) return false
    const value = JSON.stringify({
      ...saved,
      products: [...products, { id: ENVO_PRODUCT_ID, label: 'Envo', description: 'Cloud PBX', active: true }],
    })
    const res = await Setting.updateOne(
      { key: 'crm_config', value: row?.value ?? null },
      { $set: { value, group: 'config' } },
      { upsert: !row },
    ).catch(err => { if (err?.code === 11000) return { modifiedCount: 0, upsertedCount: 0 }; throw err })
    if (res.modifiedCount || res.upsertedCount) {
      invalidateConfigCache()
      return true
    }
  }
  return false
}
