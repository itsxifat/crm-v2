/**
 * lib/integrations/settings.js — SERVER-ONLY settings of the Enfinito Pay and
 * encloud integrations (Configuration → Integrations).
 *
 * Stored as JSON in Setting (`enfinito_pay`, `encloud`). Secret keys are sealed
 * with lib/encryption (a key per field, so ENCRYPTION_MASTER_KEY is required to
 * save them) and are only ever returned masked.
 *
 * The Enfinito Pay API address is not a setting: production always talks to
 * pay.enfinito.com; ENFINITO_PAY_API_URL points development at a local stand-in.
 */
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'
import { encrypt, decrypt } from '@/lib/encryption'

export const SECRET_MASK = '••••••••'

const PAY_KEY = 'enfinito_pay'
const ENCLOUD_KEY = 'encloud'
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

const SECRETS = {
  [PAY_KEY]:     ['secretKey', 'webhookSecret'],
  [ENCLOUD_KEY]: ['apiKey', 'webhookSecret'],
}

const DEFAULTS = { [PAY_KEY]: PAY_DEFAULTS, [ENCLOUD_KEY]: ENCLOUD_DEFAULTS }

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
  const prefix = s.match(/^(sk_test_|sk_live_|whsec_|enc_[0-9a-f]{12}_|enc_)/)?.[0] ?? ''
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
