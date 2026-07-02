import nodemailer from 'nodemailer'
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'

const EMAIL_SETTINGS_KEY = 'email_accounts'

// ─── Load accounts from DB ────────────────────────────────────────────────────

async function getEmailAccounts() {
  try {
    await connectDB()
    const setting = await Setting.findOne({ key: EMAIL_SETTINGS_KEY }).lean()
    if (setting?.value) return JSON.parse(setting.value)
  } catch { /* fall through */ }
  return []
}

// ─── Get transporter for a given purpose ─────────────────────────────────────
// Falls back to env-based config if no matching DB account exists.

async function getTransporter(purpose = 'general') {
  const accounts = await getEmailAccounts()

  // Find an account that lists this purpose
  let account = accounts.find(a => a.purposes?.includes(purpose))

  // If none, try 'general'
  if (!account && purpose !== 'general') {
    account = accounts.find(a => a.purposes?.includes('general'))
  }

  // If still none, fall back to first account
  if (!account && accounts.length > 0) {
    account = accounts[0]
  }

  // Last resort: env variables (legacy / dev)
  if (!account) {
    return {
      transporter: nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      }),
      from: `"${process.env.SMTP_FROM_NAME || BRAND.name}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    }
  }

  return {
    transporter: nodemailer.createTransport({
      host:   account.host,
      port:   Number(account.port) || 587,
      secure: account.secure ?? (Number(account.port) === 465),
      auth: {
        user: account.user,
        pass: account.password,
      },
    }),
    from: `"${account.fromName || BRAND.name}" <${account.user}>`,
  }
}

// ─── Create transporter directly from account object (for testing) ────────────

export function createTransporterFromAccount(account) {
  return nodemailer.createTransport({
    host:             account.host,
    port:             Number(account.port) || 587,
    secure:           account.secure ?? (Number(account.port) === 465),
    connectionTimeout: 8000,
    greetingTimeout:   8000,
    socketTimeout:     8000,
    auth: {
      user: account.user,
      pass: account.password,
    },
  })
}

/* ════════════════════════════════════════════════════════════════════════════
   EMAIL DESIGN SYSTEM
   Premium · clean · minimal. One shared shell + helpers so every email is
   visually consistent. The company logo is referenced via an absolute URL
   (never attached), and every CTA link is forced to an absolute scheme so
   buttons are always clickable in email clients.
   ════════════════════════════════════════════════════════════════════════════ */

const BRAND = {
  // Customer-facing company name. Kept in sync with the logo image (en-logo.png)
  // rather than NEXT_PUBLIC_APP_NAME (which is the internal product name, "EN-CRM").
  name:   'Enfinito',
  // Single accent used for CTAs and links — change here to re-theme every email.
  accent: '#4f46e5',
}

const FONT    = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const CANVAS  = '#f4f5f7'
const CARD_BD = '#e7e9f0'
const DIVIDER = '#eef0f4'
const HEADING = '#111827'
const BODY    = '#4b5563'
const MUTED   = '#9aa1ae'
const SOFT_BG = '#f8fafc'
const SOFT_BD = '#eceef4'

// Normalised, absolute base URL of the app (always carries a scheme).
function appBaseUrl() {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000').trim()
  return withScheme(raw).replace(/\/+$/, '')
}

// Guarantee a URL is absolute & clickable. A scheme-less value like
// "localhost:3001/login" is treated as a relative link by email clients
// (i.e. dead) — this prepends https:// (http:// for localhost) so it works.
function withScheme(url) {
  if (!url) return appBaseUrl()
  const u = String(url).trim()
  if (/^https?:\/\//i.test(u)) return u
  if (/^mailto:|^tel:/i.test(u)) return u
  const proto = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/i.test(u) ? 'http://' : 'https://'
  return proto + u.replace(/^\/+/, '')
}

const logoUrl = () => `${appBaseUrl()}/en-logo.png`

// ── Building blocks ─────────────────────────────────────────────────────────

const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function eyebrow(text) {
  return `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;font-weight:600;letter-spacing:.7px;text-transform:uppercase;color:${BRAND.accent};">${text}</p>`
}

function heading(text) {
  return `<h1 style="margin:0 0 18px;font-family:${FONT};font-size:21px;line-height:1.3;font-weight:700;color:${HEADING};letter-spacing:-.2px;">${text}</h1>`
}

function paragraph(html, { muted = false, mb = 18 } = {}) {
  return `<p style="margin:0 0 ${mb}px;font-family:${FONT};font-size:15px;line-height:1.65;color:${muted ? MUTED : BODY};">${html}</p>`
}

// Bulletproof, always-clickable CTA button.
function button(href, label) {
  const safe = withScheme(href)
  return `
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:6px auto 22px;">
    <tr>
      <td align="center" bgcolor="${BRAND.accent}" style="border-radius:10px;">
        <a href="${safe}" target="_blank" rel="noopener"
           style="display:inline-block;padding:14px 34px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

// "Or paste this link" fallback — shown when we hand the user a unique link.
function fallbackLink(url) {
  const safe = withScheme(url)
  return `
    <p style="margin:0 0 4px;font-family:${FONT};font-size:12px;color:${MUTED};">Or paste this link into your browser:</p>
    <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safe}" target="_blank" rel="noopener" style="color:${BRAND.accent};text-decoration:none;">${safe}</a></p>`
}

// Key/value box (login credentials, etc.)
function detailBox(rows) {
  const body = rows.map(r => `
    <tr>
      <td style="padding:7px 0;font-family:${FONT};font-size:13px;color:${MUTED};white-space:nowrap;width:120px;vertical-align:top;">${r.label}</td>
      <td style="padding:7px 0;font-family:${FONT};font-size:14px;font-weight:600;color:${r.accent ? BRAND.accent : '#111827'};${r.mono ? "font-family:'SFMono-Regular',Consolas,monospace;letter-spacing:.5px;" : ''}word-break:break-word;">${r.value}</td>
    </tr>`).join('')
  return `
  <table width="100%" role="presentation" border="0" cellpadding="0" cellspacing="0" style="background:${SOFT_BG};border:1px solid ${SOFT_BD};border-radius:12px;margin:0 0 22px;">
    <tr><td style="padding:18px 20px;">
      <table width="100%" role="presentation" border="0" cellpadding="0" cellspacing="0">${body}</table>
    </td></tr>
  </table>`
}

// Soft status/info callout.
function noteBox({ tone = 'info', text }) {
  const tones = {
    info:    { bg: '#eef2ff', bd: '#e0e4ff', fg: '#3730a3' },
    success: { bg: '#f0fdf4', bd: '#dcfce7', fg: '#166534' },
    warn:    { bg: '#fffbeb', bd: '#fef3c7', fg: '#92400e' },
  }
  const t = tones[tone] || tones.info
  return `
  <table width="100%" role="presentation" border="0" cellpadding="0" cellspacing="0" style="background:${t.bg};border:1px solid ${t.bd};border-radius:10px;margin:0 0 22px;">
    <tr><td style="padding:13px 18px;font-family:${FONT};font-size:13px;line-height:1.55;color:${t.fg};">${text}</td></tr>
  </table>`
}

// Full document shell — logo header, white card, footer.
function shell({ preheader = '', content, footerNote }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <title>${esc(BRAND.name)}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}</div>
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${CANVAS};">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="480" border="0" cellpadding="0" cellspacing="0" style="width:100%;max-width:480px;background:#ffffff;border:1px solid ${CARD_BD};border-radius:16px;overflow:hidden;">
        <tr>
          <td style="padding:34px 40px 0;text-align:center;">
            <img src="${logoUrl()}" alt="${esc(BRAND.name)}" width="148" style="display:inline-block;border:0;outline:none;text-decoration:none;height:auto;width:148px;max-width:60%;">
          </td>
        </tr>
        <tr>
          <td style="padding:26px 40px 30px;">
            ${content}
          </td>
        </tr>
        <tr><td style="padding:0 40px;"><div style="border-top:1px solid ${DIVIDER};font-size:0;line-height:0;">&nbsp;</div></td></tr>
        <tr>
          <td style="padding:22px 40px 30px;text-align:center;">
            <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
              ${footerNote || `This is an automated message from ${esc(BRAND.name)}. Please do not reply.`}
            </p>
            <p style="margin:8px 0 0;font-family:${FONT};font-size:12px;color:#c4c9d2;">© ${new Date().getFullYear()} ${esc(BRAND.name)}. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ─── Email senders ────────────────────────────────────────────────────────────

export async function sendOnboardingEmail({ to, name, link, expiresAt }) {
  const { transporter, from } = await getTransporter('onboarding')

  const expiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : '7 days'

  const content = `
    ${eyebrow('Onboarding Invitation')}
    ${heading(`Welcome${name ? `, ${esc(name)}` : ''}`)}
    ${paragraph(`You've been invited to join <strong>${esc(BRAND.name)}</strong>. To get started, please complete your onboarding — fill in your personal details and upload the required documents.`)}
    ${noteBox({ tone: 'warn', text: `This invitation expires on <strong>${expiry}</strong>. Please complete the form before then.` })}
    ${button(link, 'Complete Onboarding')}
    ${fallbackLink(link)}
    <table width="100%" role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border-top:1px solid ${DIVIDER};">
      <tr><td style="padding:18px 0 0;">
        <p style="margin:0 0 10px;font-family:${FONT};font-size:13px;font-weight:600;color:${HEADING};">What you'll need</p>
        <ul style="margin:0;padding-left:18px;font-family:${FONT};font-size:13px;color:${BODY};line-height:1.9;">
          <li>Your National ID (NID) — number &amp; a scan/photo</li>
          <li>A formal photo (plain background, clear face)</li>
          <li>Personal details: address, date of birth, emergency contact</li>
          <li>Any other documents (CV, birth certificate, passport)</li>
        </ul>
      </td></tr>
    </table>`

  const html = shell({ preheader: `Complete your ${BRAND.name} onboarding`, content })
  await transporter.sendMail({ from, to, subject: `Complete your onboarding — ${BRAND.name}`, html })
}

export async function sendFreelancerInviteEmail({ to, name, link, type = 'FREELANCER', password }) {
  const { transporter, from } = await getTransporter('freelancer')
  const typeLabel = type === 'AGENCY' ? 'Agency Partner' : 'Freelancer'
  const loginUrl  = `${appBaseUrl()}/login`

  const content = `
    ${eyebrow(`Panel Invitation · ${typeLabel}`)}
    ${heading(`You're invited${name ? `, ${esc(name)}` : ''}`)}
    ${paragraph(`You've been added as a <strong>${typeLabel}</strong> on the <strong>${esc(BRAND.name)} Panel</strong>. Use the credentials below to sign in, then set your own password from your account page.`)}
    ${detailBox([
      { label: 'Email',     value: esc(to) },
      { label: 'Password',  value: esc(password), mono: true, accent: true },
      { label: 'Login URL', value: `<a href="${loginUrl}" target="_blank" rel="noopener" style="color:${BRAND.accent};text-decoration:none;font-weight:600;">${loginUrl}</a>` },
    ])}
    ${paragraph(`You can also finish your full account setup (payment method, profile) with the button below. This invite link expires in <strong>48 hours</strong>.`, { muted: true })}
    ${button(link, 'Complete Account Setup')}
    ${fallbackLink(link)}`

  const html = shell({ preheader: `Your ${BRAND.name} Panel invitation`, content })
  await transporter.sendMail({ from, to, subject: `You're invited to join the ${BRAND.name} Panel`, html })
}

export async function sendClientWelcomeEmail({ to, name, clientCode, password, phone }) {
  const { transporter, from } = await getTransporter('client')
  const loginUrl = `${appBaseUrl()}/login`

  const rows = [
    { label: 'Client ID', value: esc(clientCode), mono: true },
    { label: 'Email',     value: esc(to) },
    ...(phone ? [{ label: 'Phone', value: esc(phone) }] : []),
    { label: 'Password',  value: esc(password), mono: true, accent: true },
  ]

  const content = `
    ${eyebrow('Client Panel Access')}
    ${heading(`Welcome, ${esc(name)}`)}
    ${paragraph(`Your client account on the <strong>${esc(BRAND.name)}</strong> panel is ready. Sign in to track your projects, invoices and payments in one place.`)}
    ${detailBox(rows)}
    ${noteBox({ tone: 'info', text: 'Keep this password safe. You can change it any time after signing in.' })}
    ${button(loginUrl, 'Sign In to Your Panel')}`

  const html = shell({ preheader: `Your ${BRAND.name} client panel is ready`, content })
  await transporter.sendMail({ from, to, subject: `Your ${BRAND.name} client panel access`, html })
}

// Magic-link activation — sent on client creation. No password is included; the
// user activates, receives a one-time code, then sets their own password.
export async function sendClientActivationEmail({ to, name, link }) {
  const { transporter, from } = await getTransporter('client')
  const content = `
    ${eyebrow('Client Panel Access')}
    ${heading(`Welcome${name ? `, ${esc(name)}` : ''}`)}
    ${paragraph(`Your client account on the <strong>${esc(BRAND.name)}</strong> panel has been created. Click below to activate it — we'll email you a one-time login code, then you'll set your own password.`)}
    ${button(link, 'Activate Your Account')}
    ${fallbackLink(link)}
    ${noteBox({ tone: 'info', text: 'This activation link is valid for 7 days. No password is needed — you choose your own after signing in.' })}`
  const html = shell({ preheader: `Activate your ${BRAND.name} client panel`, content })
  await transporter.sendMail({ from, to, subject: `Activate your ${BRAND.name} client panel`, html })
}

// One-time 6-digit login code for first-time client activation.
export async function sendClientOtpEmail({ to, name, code }) {
  const { transporter, from } = await getTransporter('client')
  const content = `
    ${eyebrow('Your Login Code')}
    ${heading(`Hi${name ? `, ${esc(name)}` : ''}`)}
    ${paragraph('Use this one-time code to sign in to your client panel:')}
    ${detailBox([{ label: 'Login code', value: esc(code), mono: true, accent: true }])}
    ${noteBox({ tone: 'warn', text: 'This code expires in 10 minutes. If you didn’t request it, you can ignore this email.' })}`
  const html = shell({ preheader: `Your ${BRAND.name} login code`, content })
  await transporter.sendMail({ from, to, subject: `Your ${BRAND.name} login code: ${code}`, html })
}

// Approved-reset link — sent only after a staff member approves the request.
export async function sendPasswordResetEmail({ to, name, link }) {
  const { transporter, from } = await getTransporter('client')
  const content = `
    ${eyebrow('Password Reset')}
    ${heading(`Hi${name ? `, ${esc(name)}` : ''}`)}
    ${paragraph(`Your password reset request has been approved. Click below to set a new password for your <strong>${esc(BRAND.name)}</strong> account.`)}
    ${button(link, 'Set a New Password')}
    ${fallbackLink(link)}
    ${noteBox({ tone: 'warn', text: 'This link is valid for 24 hours and can be used once. If you didn’t request a reset, please contact us.' })}`
  const html = shell({ preheader: `Reset your ${BRAND.name} password`, content })
  await transporter.sendMail({ from, to, subject: `Reset your ${BRAND.name} password`, html })
}

export async function sendEmployeeLoginEmail({ to, name, password }) {
  const { transporter, from } = await getTransporter('general')
  const loginUrl = `${appBaseUrl()}/login`

  const content = `
    ${eyebrow('Your Account is Ready')}
    ${heading(`Welcome aboard, ${esc(name)}`)}
    ${paragraph(`Your employee account on the <strong>${esc(BRAND.name)}</strong> panel has been created. Sign in with the credentials below, then complete your profile to unlock full access.`)}
    ${detailBox([
      { label: 'Email',     value: esc(to) },
      { label: 'Password',  value: esc(password), mono: true, accent: true },
      { label: 'Login URL', value: `<a href="${loginUrl}" target="_blank" rel="noopener" style="color:${BRAND.accent};text-decoration:none;font-weight:600;">${loginUrl}</a>` },
    ])}
    ${noteBox({ tone: 'info', text: "After signing in you'll complete your profile (Personal, Contact &amp; KYC). HR reviews and approves it before granting full panel access." })}
    ${button(loginUrl, 'Sign In & Complete Profile')}`

  const html = shell({ preheader: `Your ${BRAND.name} employee login`, content })
  await transporter.sendMail({ from, to, subject: `Your ${BRAND.name} employee account — login details`, html })
}

export async function sendProfileCompleteToHR({ to, employeeName, employeeEmail, profileUrl }) {
  const { transporter, from } = await getTransporter('general')

  const content = `
    ${eyebrow('Profile Review Required')}
    ${heading('A profile is ready for review')}
    ${paragraph(`<strong>${esc(employeeName)}</strong> (<a href="mailto:${esc(employeeEmail)}" style="color:${BRAND.accent};text-decoration:none;">${esc(employeeEmail)}</a>) has completed their profile (100%) and is awaiting your review and approval.`)}
    ${noteBox({ tone: 'success', text: '<strong>Status: Ready for review.</strong> All required fields are filled. Please review the details and approve or reject.' })}
    ${button(profileUrl, 'Review Employee Profile')}`

  const html = shell({ preheader: `${employeeName} is ready for HR review`, content, footerNote: `${BRAND.name} CRM — HR Management` })
  await transporter.sendMail({ from, to, subject: `Profile review required — ${employeeName}`, html })
}

// Sent to admins when a freelancer/agency submits their KYC (reaches 100%).
export async function sendFreelancerKycSubmittedToAdmin({ to, freelancerName, freelancerEmail, isAgency, reviewUrl }) {
  const { transporter, from } = await getTransporter('general')
  const kind = isAgency ? 'Agency' : 'Freelancer'

  const content = `
    ${eyebrow('Verification Required')}
    ${heading(`A ${kind.toLowerCase()} is ready for review`)}
    ${paragraph(`<strong>${esc(freelancerName)}</strong> (<a href="mailto:${esc(freelancerEmail)}" style="color:${BRAND.accent};text-decoration:none;">${esc(freelancerEmail)}</a>) has submitted their KYC (100%) and is awaiting your verification.`)}
    ${noteBox({ tone: 'success', text: '<strong>Status: Ready for review.</strong> Please review the submitted details and documents, then approve or reject.' })}
    ${button(reviewUrl, `Review ${kind}`)}`

  const html = shell({ preheader: `${freelancerName} is ready for verification`, content, footerNote: `${BRAND.name} CRM — Verification` })
  await transporter.sendMail({ from, to, subject: `Verification required — ${freelancerName}`, html })
}

// Sent to a freelancer/agency once an admin approves their KYC.
export async function sendFreelancerApprovedEmail({ to, name }) {
  const { transporter, from } = await getTransporter('general')
  const dashUrl = `${appBaseUrl()}/freelancer`

  const content = `
    ${eyebrow('Verification Approved')}
    ${heading(`You're verified, ${esc(name)}`)}
    ${paragraph(`Great news — your submitted details have been reviewed and <strong>approved</strong>. You now have full access to the ${esc(BRAND.name)} portal.`)}
    ${noteBox({ tone: 'success', text: '<strong>✓ Access granted.</strong> Your account is fully active. Sign in to view your projects and payments.' })}
    ${button(dashUrl, 'Go to Portal')}`

  const html = shell({ preheader: `Your ${BRAND.name} account is verified`, content })
  await transporter.sendMail({ from, to, subject: `Your ${BRAND.name} account has been verified`, html })
}

export async function sendEmployeeApprovedEmail({ to, name }) {
  const { transporter, from } = await getTransporter('general')
  const dashUrl = `${appBaseUrl()}/admin`

  const content = `
    ${eyebrow('Account Approved')}
    ${heading(`You're all set, ${esc(name)}`)}
    ${paragraph(`Great news — your profile has been reviewed and <strong>approved by HR</strong>. You now have full access to the ${esc(BRAND.name)} panel.`)}
    ${noteBox({ tone: 'success', text: '<strong>✓ Access granted.</strong> Your account is fully active. Sign in to use every feature available to your role.' })}
    ${button(dashUrl, 'Go to Dashboard')}`

  const html = shell({ preheader: `Your ${BRAND.name} account is approved`, content })
  await transporter.sendMail({ from, to, subject: `Your ${BRAND.name} account has been approved`, html })
}

// Branded HTML for the "send test email" feature in Settings → Email.
export function buildTestEmailHtml({ label } = {}) {
  const content = `
    ${eyebrow('Configuration Test')}
    ${heading('Your email is working')}
    ${paragraph(`This is a test message sent from <strong>${esc(label || BRAND.name)}</strong>. If you're reading this, your SMTP account is configured correctly and ready to send transactional emails.`)}
    ${noteBox({ tone: 'success', text: '✓ Connection verified and message delivered successfully.' })}`
  return shell({ preheader: `${BRAND.name} email configuration test`, content })
}
