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

// ─── Direct send (for testing) ────────────────────────────────────────────────

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

// ─── Notification senders ─────────────────────────────────────────────────────

export async function sendOnboardingWhatsApp({ to, name, link, expiresAt }) {
  if (!to) return
  const expiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : '7 days'

  const message =
    `Hi ${name || 'there'} 👋\n\n` +
    `You've been invited to join *Enfinito* as a new team member.\n\n` +
    `Please complete your onboarding form before *${expiry}*:\n${link}\n\n` +
    `_You will need: NID, a formal photo, personal details, and any documents._`

  try {
    await sendWhatsAppText({ to, message, purpose: 'onboarding' })
  } catch (err) {
    console.error('[WhatsApp] sendOnboardingWhatsApp failed:', err.message)
  }
}

export async function sendFreelancerInviteWhatsApp({ to, name, link, type = 'FREELANCER', password }) {
  if (!to) return
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const typeLabel = type === 'AGENCY' ? 'Agency Partner' : 'Freelancer'

  const message =
    `Hi ${name || 'there'} 👋\n\n` +
    `You've been added as a *${typeLabel}* on the *Enfinito Panel*.\n\n` +
    `*Login Credentials:*\n` +
    `• Email: ${to}\n` +
    `• Password: ${password}\n` +
    `• Login: ${appUrl}/login\n\n` +
    `Complete your account setup (expires in 48 hours):\n${link}\n\n` +
    `_Please save your credentials and change your password after logging in._`

  try {
    await sendWhatsAppText({ to, message, purpose: 'freelancer' })
  } catch (err) {
    console.error('[WhatsApp] sendFreelancerInviteWhatsApp failed:', err.message)
  }
}

export async function sendClientWelcomeWhatsApp({ to, name, clientCode, password, phone }) {
  if (!to) return
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const message =
    `Hi ${name} 👋\n\n` +
    `Your client account has been created on the *Enfinito* panel.\n\n` +
    `*Login Credentials:*\n` +
    `• Client ID: ${clientCode}\n` +
    `• Email: ${to}\n` +
    (phone ? `• Phone: ${phone}\n` : '') +
    `• Password: ${password}\n` +
    `• Login: ${appUrl}/login\n\n` +
    `_Please save this password. You can change it after logging in._`

  try {
    await sendWhatsAppText({ to, message, purpose: 'client' })
  } catch (err) {
    console.error('[WhatsApp] sendClientWelcomeWhatsApp failed:', err.message)
  }
}

export async function sendEmployeeLoginWhatsApp({ to, name, password }) {
  if (!to) return
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const message =
    `Hi ${name} 👋\n\n` +
    `Your employee account has been created on the *Enfinito* panel.\n\n` +
    `*Login Credentials:*\n` +
    `• Email: ${to}\n` +
    `• Password: ${password}\n` +
    `• Login: ${appUrl}/login\n\n` +
    `_After logging in, complete your profile to get full panel access._`

  try {
    await sendWhatsAppText({ to, message, purpose: 'general' })
  } catch (err) {
    console.error('[WhatsApp] sendEmployeeLoginWhatsApp failed:', err.message)
  }
}

export async function sendProfileCompleteToHRWhatsApp({ to, employeeName, employeeEmail, profileUrl }) {
  if (!to) return

  const message =
    `*Enfinito HR* — Profile Review Required\n\n` +
    `Employee *${employeeName}* (${employeeEmail}) has completed their profile (100%) and is awaiting your review.\n\n` +
    `Review profile: ${profileUrl}`

  try {
    await sendWhatsAppText({ to, message, purpose: 'general' })
  } catch (err) {
    console.error('[WhatsApp] sendProfileCompleteToHRWhatsApp failed:', err.message)
  }
}

export async function sendEmployeeApprovedWhatsApp({ to, name }) {
  if (!to) return
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const message =
    `Hi ${name} 👋\n\n` +
    `Great news! Your profile has been *approved by HR*. ✅\n\n` +
    `You now have full access to the Enfinito panel.\n` +
    `Go to dashboard: ${appUrl}/admin`

  try {
    await sendWhatsAppText({ to, message, purpose: 'general' })
  } catch (err) {
    console.error('[WhatsApp] sendEmployeeApprovedWhatsApp failed:', err.message)
  }
}
