import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'

const WA_SETTINGS_KEY = 'whatsapp_accounts'
const WA_API_BASE     = 'https://api.enfinito.cloud/api/v1'

// ─── Load accounts from DB ────────────────────────────────────────────────────

async function getWhatsAppAccounts() {
  try {
    await connectDB()
    const setting = await Setting.findOne({ key: WA_SETTINGS_KEY }).lean()
    if (setting?.value) return JSON.parse(setting.value)
  } catch { /* fall through */ }
  return []
}

// ─── Get account for a given purpose ─────────────────────────────────────────

async function getWhatsAppAccount(purpose = 'general') {
  const accounts = await getWhatsAppAccounts()

  let account = accounts.find(a => a.purposes?.includes(purpose))
  if (!account && purpose !== 'general') {
    account = accounts.find(a => a.purposes?.includes('general'))
  }
  if (!account && accounts.length > 0) {
    account = accounts[0]
  }
  return account || null
}

// ─── Core send function ───────────────────────────────────────────────────────

export async function sendWhatsAppText({ to, message, purpose = 'general' }) {
  const account = await getWhatsAppAccount(purpose)
  if (!account) {
    console.warn('[WhatsApp] No account configured for purpose:', purpose)
    return null
  }
  return sendWhatsAppTextWithKey({ to, message, apiKey: account.apiKey })
}

// ─── Direct send (for testing — free-form text) ───────────────────────────────

export async function sendWhatsAppTextWithKey({ to, message, apiKey }) {
  const res = await fetch(`${WA_API_BASE}/send`, {
    method: 'POST',
    headers: {
      'X-API-Key':     apiKey,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      to,
      type: 'text',
      text: { body: message, preview_url: false },
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || data?.error || `WhatsApp API error ${res.status}`)
  return data
}

// ─── Template send helper ─────────────────────────────────────────────────────
// params: string[]  — ordered values for {{1}}, {{2}}, … in the template body

async function sendTemplate({ to, templateName, params = [], purpose = 'general' }) {
  const account = await getWhatsAppAccount(purpose)
  if (!account) {
    console.warn('[WhatsApp] No account configured for purpose:', purpose)
    return null
  }

  const res = await fetch(`${WA_API_BASE}/send`, {
    method: 'POST',
    headers: {
      'X-API-Key':    account.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to,
      type: 'template',
      template: {
        name:       templateName,
        language:   { code: 'en_US' },
        components: params.length > 0
          ? [{ type: 'body', parameters: params.map(text => ({ type: 'text', text: String(text) })) }]
          : [],
      },
    }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || data?.error || `WhatsApp API error ${res.status}`)
  return data
}

// ─── Notification senders ─────────────────────────────────────────────────────

// Template: enfinito_onboarding_invite
// Body: Hi {{1}} 👋 — invited to join Enfinito, complete form before {{2}}: {{3}}
export async function sendOnboardingWhatsApp({ to, name, link, expiresAt }) {
  if (!to) return
  const expiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : '7 days'

  try {
    await sendTemplate({
      to,
      templateName: 'enfinito_onboarding_invite',
      params:       [name || 'there', expiry, link],
      purpose:      'onboarding',
    })
  } catch (err) {
    console.error('[WhatsApp] sendOnboardingWhatsApp failed:', err.message)
  }
}

// Template: enfinito_employee_credentials
// Body: Hi {{1}} 👋 — account created, Email: {{2}}, Password: {{3}}, Login: {{4}}
export async function sendEmployeeLoginWhatsApp({ to, name, password }) {
  if (!to) return
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  try {
    await sendTemplate({
      to,
      templateName: 'enfinito_employee_credentials',
      params:       [name || 'there', to, password, `${appUrl}/login`],
      purpose:      'general',
    })
  } catch (err) {
    console.error('[WhatsApp] sendEmployeeLoginWhatsApp failed:', err.message)
  }
}

// Template: enfinito_profile_review
// Body: Enfinito HR — {{1}} ({{2}}) completed profile, awaiting review: {{3}}
export async function sendProfileCompleteToHRWhatsApp({ to, employeeName, employeeEmail, profileUrl }) {
  if (!to) return

  try {
    await sendTemplate({
      to,
      templateName: 'enfinito_profile_review',
      params:       [employeeName, employeeEmail, profileUrl],
      purpose:      'general',
    })
  } catch (err) {
    console.error('[WhatsApp] sendProfileCompleteToHRWhatsApp failed:', err.message)
  }
}

// Template: enfinito_profile_approved
// Body: Hi {{1}} 👋 — profile approved by HR ✅, dashboard: {{2}}
export async function sendEmployeeApprovedWhatsApp({ to, name }) {
  if (!to) return
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  try {
    await sendTemplate({
      to,
      templateName: 'enfinito_profile_approved',
      params:       [name || 'there', `${appUrl}/admin`],
      purpose:      'general',
    })
  } catch (err) {
    console.error('[WhatsApp] sendEmployeeApprovedWhatsApp failed:', err.message)
  }
}

// Template: enfinito_freelancer_invite
// Body: Hi {{1}} 👋 — added as {{2}}, Email: {{3}}, Password: {{4}}, Login: {{5}}, Setup: {{6}}
export async function sendFreelancerInviteWhatsApp({ to, name, link, type = 'FREELANCER', password }) {
  if (!to) return
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const typeLabel = type === 'AGENCY' ? 'Agency Partner' : 'Freelancer'

  try {
    await sendTemplate({
      to,
      templateName: 'enfinito_freelancer_invite',
      params:       [name || 'there', typeLabel, to, password, `${appUrl}/login`, link],
      purpose:      'freelancer',
    })
  } catch (err) {
    console.error('[WhatsApp] sendFreelancerInviteWhatsApp failed:', err.message)
  }
}

// Template: enfinito_client_welcome
// Body: Hi {{1}} 👋 — client account created, Client ID: {{2}}, Email: {{3}}, Password: {{4}}, Login: {{5}}
export async function sendClientWelcomeWhatsApp({ to, name, clientCode, password, phone }) {
  if (!to) return
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  try {
    await sendTemplate({
      to,
      templateName: 'enfinito_client_welcome',
      params:       [name, clientCode, to, password, `${appUrl}/login`],
      purpose:      'client',
    })
  } catch (err) {
    console.error('[WhatsApp] sendClientWelcomeWhatsApp failed:', err.message)
  }
}
