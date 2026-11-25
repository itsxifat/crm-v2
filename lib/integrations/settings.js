/**
 * lib/integrations/settings.js — SERVER-ONLY settings of the Enfinito Pay, encloud,
 * Envo and NCOM integrations (Configuration → Integrations), and of calling through
 * Envo (Configuration → Calling).
 *
 * Stored as JSON in Setting (`enfinito_pay`, `encloud`, `envo`, `ncom`, `envo_phone`). Secret keys are sealed
 * with lib/encryption (a key per field, so ENCRYPTION_MASTER_KEY is required to
 * save them) and are only ever returned masked.
 *
 * The Enfinito Pay API address is not a setting: production always talks to
 * pay.enfinito.com; ENFINITO_PAY_API_URL points development at a local stand-in.
 */
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'
import { encrypt, decrypt } from '@/lib/encryption'
import { PRODUCTS } from '@/lib/products/catalog'

export const SECRET_MASK = '••••••••'

const PAY_KEY = 'enfinito_pay'
const ENCLOUD_KEY = 'encloud'
const ENVO_KEY = PRODUCTS.envo.settingsKey
const NCOM_KEY = PRODUCTS.ncom.settingsKey
const PHONE_KEY = 'envo_phone'
const GROUP = 'integrations'

export const PAY_DEFAULTS = {
  enabled:       false,
  secretKey:     '',      // sk_test_… / sk_live_…
  webhookSecret: '',      // whsec_…
  accountId:     null,    // money account online payments are booked to
}

export const ENCLOUD_DEFAULTS = {
  enabled:       false,
  baseUrl:       'https://enfinito.cloud',
  apiKey:        '',      // enc_…
  webhookSecret: '',      // whsec_… ("Events to the CRM" in encloud)
  autoFolders:   true,    // every client and project gets a folder
  lockDues:      true,    // unpaid invoices lock the client's files
  lockWhen:      'ISSUED', // ISSUED: as soon as the invoice is sent · OVERDUE: after its due date
  // Payments customers make on encloud links are booked automatically. Off: they
  // wait in Payment Confirmations (e.g. while encloud uses a test key).
  bookPayments:  true,
}

export const ENVO_DEFAULTS = {
  enabled:       false,
  webhookSecret: '',      // whsec_… shared with Envo (CRM_API_SECRET there)
  // Money accounts Envo's receipts are booked to. Online = paid on Enfinito Pay
  // (falls back to the account chosen for the CRM's own Enfinito Pay payments);
  // the others are money an Envo admin marked as received.
  onlineAccountId: null,
  manualAccounts:  { bkash: null, nagad: null, rocket: null, bank: null, cash: null, other: null },
  // Tax: null treatment ⇒ the company default (Tax & VAT → Settings).
  vatTreatment:     null,  // STANDARD | REDUCED | ZERO_RATED | EXEMPT | NONE
  vatRate:          null,
  sdRate:           0,
  serviceCode:      null,
  pricesIncludeVat: true,  // true: customers pay the package price, VAT is inside it
  // Recharges and top-ups go on a balance as they stand: no VAT, or VAT inside the amount.
  topupVat:         'NONE',  // NONE | INCLUDED
  // Paid with an Enfinito Pay test key: no money moved, so never in real books. Demo CRM only.
  bookTestPayments: false,
  // Costs: what the gateway keeps from each payment, booked as an Envo expense.
  gatewayFeeMode:     'ACTUAL',  // ACTUAL: what the gateway reports, else the percentage · PERCENT · NONE
  gatewayFeePercent:  0,
  gatewayFeeCategory: 'Payment Gateway Charges',
  incomeCategory:     'Envo Subscriptions',
  // Tax settings Envo has been given, so an invoice priced under an older one is
  // told apart from one priced wrongly: [{ version, vatTreatment, vatRate, sdRate, pricesIncludeVat, at }]
  policyHistory: [],
}

// NCOM (plans, add-ons and AI credit packs): the same settings as Envo's, without the
// one for recharges (it sells none). Manual = an order an NCOM admin marked as paid.
export const NCOM_DEFAULTS = {
  enabled:          false,
  webhookSecret:    '',      // whsec_… shared with NCOM (CRM_API_SECRET there)
  onlineAccountId:  null,
  manualAccounts:   { bkash: null, nagad: null, rocket: null, bank: null, cash: null, other: null },
  vatTreatment:     null,
  vatRate:          null,
  sdRate:           0,
  serviceCode:      null,
  pricesIncludeVat: true,
  bookTestPayments: false,
  gatewayFeeMode:     'ACTUAL',
  gatewayFeePercent:  0,
  gatewayFeeCategory: 'Payment Gateway Charges',
  incomeCategory:     PRODUCTS.ncom.incomeCategory,
  policyHistory: [],
}

// Calling clients through Envo's PBX (lib/telephony). Separate from `envo` above, which is
// Envo's billing pushed to the CRM: here the CRM is a customer of Envo, with an API key
// of the SIP server the office's extensions are on.
export const PHONE_DEFAULTS = {
  enabled:    false,
  baseUrl:    'https://envo.enfinito.cloud',
  apiKey:     '',      // envo_live_… (Envo → Integrations → API keys: read, calls, webphone)
  // Staff and the Envo extension each one calls from: { [userId]: '101' }
  extensions: {},
}

const SECRETS = {
  [PAY_KEY]:     ['secretKey', 'webhookSecret'],
  [ENCLOUD_KEY]: ['apiKey', 'webhookSecret'],
  [ENVO_KEY]:    ['webhookSecret'],
  [NCOM_KEY]:    ['webhookSecret'],
  [PHONE_KEY]:   ['apiKey'],
}

const DEFAULTS = {
  [PAY_KEY]: PAY_DEFAULTS, [ENCLOUD_KEY]: ENCLOUD_DEFAULTS, [ENVO_KEY]: ENVO_DEFAULTS, [NCOM_KEY]: NCOM_DEFAULTS,
  [PHONE_KEY]: PHONE_DEFAULTS,
}

/** A product's defaults (lib/products/catalog.js). */
export const productDefaults = (product) => DEFAULTS[product.settingsKey]

export function enfinitoPayApiBase() {
  return (process.env.ENFINITO_PAY_API_URL || 'https://pay.enfinito.com/api/v1').trim().replace(/\/+$/, '')
}

/** 'test' for sk_test_ keys, 'live' for sk_live_ keys, else null. */
export function keyMode(key) {
  const k = String(key ?? '')
  return k.startsWith('sk_test_') ? 'test' : k.startsWith('sk_live_') ? 'live' : null
}

// Short in-process cache: webhooks and the worker read these often; saves call
// invalidateIntegrationSettings() so changes apply at once.
const TTL_MS = 10_000
const cache = new Map()

export function invalidateIntegrationSettings() {
  cache.clear()
}

async function load(key) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  await connectDB()
  const row = await Setting.findOne({ key }).lean()
  let saved = {}
  try { saved = row?.value ? JSON.parse(row.value) : {} } catch { saved = {} }
  const value = { ...DEFAULTS[key], ...saved }
  for (const f of SECRETS[key]) value[f] = value[f] ? decrypt(value[f], 'settings', `${key}.${f}`) : ''
  cache.set(key, { value, at: Date.now() })
  return value
}

async function save(key, patch) {
  await connectDB()
  const row = await Setting.findOne({ key }).lean()
  let stored = {}
  try { stored = row?.value ? JSON.parse(row.value) : {} } catch { stored = {} }
  const next = { ...DEFAULTS[key], ...stored }
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!(k in DEFAULTS[key]) || v === undefined) continue
    if (SECRETS[key].includes(k)) {
      if (v === SECRET_MASK) continue                 // unchanged
      next[k] = v ? encrypt(String(v).trim(), 'settings', `${key}.${k}`) : ''
    } else {
      next[k] = v
    }
  }
  await Setting.findOneAndUpdate(
    { key },
    { key, value: JSON.stringify(next), group: GROUP },
    { upsert: true, new: true },
  )
  invalidateIntegrationSettings()
  return load(key)
}

export const getPaySettings      = () => load(PAY_KEY)
export const getEncloudSettings  = () => load(ENCLOUD_KEY)
export const savePaySettings     = (patch) => save(PAY_KEY, patch)
export const saveEncloudSettings = (patch) => save(ENCLOUD_KEY, patch)
export const getProductSettings  = (product) => load(product.settingsKey)
export const saveProductSettings = (product, patch) => save(product.settingsKey, patch)
export const getEnvoSettings     = () => getProductSettings(PRODUCTS.envo)
export const saveEnvoSettings    = (patch) => saveProductSettings(PRODUCTS.envo, patch)
export const getNcomSettings     = () => getProductSettings(PRODUCTS.ncom)
export const getPhoneSettings    = () => load(PHONE_KEY)
export const savePhoneSettings   = (patch) => save(PHONE_KEY, patch)

/** Calling is on and has an address and a key. */
export function phoneReady(s) {
  return !!(s?.enabled && s.baseUrl && s.apiKey)
}

/** Online payment is on and has a key. */
export function payReady(s) {
  return !!(s?.enabled && keyMode(s.secretKey))
}

/** encloud is on and has an address and a key. */
export function encloudReady(s) {
  return !!(s?.enabled && s.baseUrl && s.apiKey)
}

function hint(secret) {
  if (!secret) return null
  const s = String(secret)
  const prefix = s.match(/^(sk_test_|sk_live_|whsec_|enc_[0-9a-f]{12}_|enc_|envo_live_)/)?.[0] ?? ''
  return `${prefix}…${s.slice(-4)}`
}

/** Settings for the admin screen: secrets replaced by SECRET_MASK plus a short hint. */
export function maskPaySettings(s) {
  return {
    enabled:       !!s.enabled,
    secretKey:     s.secretKey ? SECRET_MASK : '',
    secretKeyHint: hint(s.secretKey),
    mode:          keyMode(s.secretKey),
    webhookSecret: s.webhookSecret ? SECRET_MASK : '',
    webhookSecretHint: hint(s.webhookSecret),
    accountId:     s.accountId ? String(s.accountId) : null,
  }
}

/** A product's settings for the admin screen (Envo, NCOM). */
export function maskProductSettings(product, s) {
  const defaults = productDefaults(product)
  const accounts = { ...defaults.manualAccounts, ...(s.manualAccounts ?? {}) }
  return {
    enabled:            !!s.enabled,
    webhookSecret:      s.webhookSecret ? SECRET_MASK : '',
    webhookSecretHint:  hint(s.webhookSecret),
    onlineAccountId:    s.onlineAccountId ? String(s.onlineAccountId) : null,
    manualAccounts:     Object.fromEntries(Object.entries(accounts).map(([k, v]) => [k, v ? String(v) : null])),
    vatTreatment:       s.vatTreatment ?? null,
    vatRate:            s.vatRate ?? null,
    sdRate:             Number(s.sdRate) || 0,
    serviceCode:        s.serviceCode ?? null,
    pricesIncludeVat:   s.pricesIncludeVat !== false,
    ...(product.hasTopups ? { topupVat: s.topupVat === 'INCLUDED' ? 'INCLUDED' : 'NONE' } : {}),
    bookTestPayments:   !!s.bookTestPayments,
    gatewayFeeMode:     s.gatewayFeeMode ?? 'ACTUAL',
    gatewayFeePercent:  Number(s.gatewayFeePercent) || 0,
    gatewayFeeCategory: s.gatewayFeeCategory ?? defaults.gatewayFeeCategory,
    incomeCategory:     s.incomeCategory ?? defaults.incomeCategory,
  }
}

export const maskEnvoSettings = (s) => maskProductSettings(PRODUCTS.envo, s)

export function maskEncloudSettings(s) {
  return {
    enabled:       !!s.enabled,
    baseUrl:       s.baseUrl ?? '',
    apiKey:        s.apiKey ? SECRET_MASK : '',
    apiKeyHint:    hint(s.apiKey),
    webhookSecret: s.webhookSecret ? SECRET_MASK : '',
    webhookSecretHint: hint(s.webhookSecret),
    autoFolders:   s.autoFolders !== false,
    lockDues:      s.lockDues !== false,
    lockWhen:      s.lockWhen === 'OVERDUE' ? 'OVERDUE' : 'ISSUED',
    bookPayments:  s.bookPayments !== false,
  }
}

/** Calling settings for the admin screen: the API key masked. */
export function maskPhoneSettings(s) {
  return {
    enabled:    !!s.enabled,
    baseUrl:    s.baseUrl ?? PHONE_DEFAULTS.baseUrl,
    apiKey:     s.apiKey ? SECRET_MASK : '',
    apiKeyHint: hint(s.apiKey),
    extensions: { ...(s.extensions ?? {}) },
  }
}
