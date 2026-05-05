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

/**
 * Read the CRM config from the database on the server side.
 * Falls back to safe defaults if the config has not been saved yet.
 * connectDB() must be called before using this.
 */
export async function getConfig() {
  try {
    const s = await Setting.findOne({ key: CONFIG_KEY }).lean()
    if (!s?.value) return { verification: VERIFICATION_DEFAULTS, paymentMethods: DEFAULT_PAYMENT_METHODS }
    const saved = JSON.parse(s.value)
    return {
      ...saved,
      paymentMethods: saved.paymentMethods ?? DEFAULT_PAYMENT_METHODS,
      verification:   { ...VERIFICATION_DEFAULTS, ...(saved.verification ?? {}) },
    }
  } catch {
    return { verification: VERIFICATION_DEFAULTS, paymentMethods: DEFAULT_PAYMENT_METHODS }
  }
}
