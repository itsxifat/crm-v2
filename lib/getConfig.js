import { Setting } from '@/models'

const CONFIG_KEY = 'crm_config'

const VERIFICATION_DEFAULTS = {
  freelancer:         true,
  clientKyc:          true,
  employeeOnboarding: true,
}

export const DEFAULT_PAYMENT_METHODS = [
  { value: 'CASH',          label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CARD',          label: 'Card' },
  { value: 'CHEQUE',        label: 'Cheque' },
  { value: 'BKASH',         label: 'bKash' },
  { value: 'NAGAD',         label: 'Nagad' },
  { value: 'ROCKET',        label: 'Rocket' },
  { value: 'ONLINE',        label: 'Online Transfer' },
  { value: 'OTHER',         label: 'Other' },
]

// Tiny in-process cache. The onboarding gate recomputes config on every session
// refresh (see lib/auth.js), so without this each employee poll would hit the DB.
// A short TTL keeps reads cheap while bounding staleness; config writes call
// invalidateConfigCache() so admin toggles apply instantly. Per-instance cache is
// fine for the single-server / PM2 deployments this app targets.
const CONFIG_CACHE_TTL = 10 * 1000  // 10s
let _cache   = null
let _cacheAt = 0

/** Drop the cached config so the next getConfig() re-reads from the DB. */
export function invalidateConfigCache() {
  _cache   = null
  _cacheAt = 0
}

/**
 * Read the CRM config from the database on the server side.
 * Falls back to safe defaults if the config has not been saved yet.
 * connectDB() must be called before using this.
 */
export async function getConfig() {
  if (_cache && Date.now() - _cacheAt < CONFIG_CACHE_TTL) return _cache
  try {
    const s = await Setting.findOne({ key: CONFIG_KEY }).lean()
    const cfg = !s?.value
      ? { verification: VERIFICATION_DEFAULTS, paymentMethods: DEFAULT_PAYMENT_METHODS }
      : (() => {
          const saved = JSON.parse(s.value)
          return {
            ...saved,
            paymentMethods: saved.paymentMethods ?? DEFAULT_PAYMENT_METHODS,
            verification:   { ...VERIFICATION_DEFAULTS, ...(saved.verification ?? {}) },
          }
        })()
    _cache   = cfg
    _cacheAt = Date.now()
    return cfg
  } catch {
    return { verification: VERIFICATION_DEFAULTS, paymentMethods: DEFAULT_PAYMENT_METHODS }
  }
}
