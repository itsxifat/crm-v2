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
      from: `"${process.env.SMTP_FROM_NAME || 'Enfinito'}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
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
    from: `"${account.fromName || 'Enfinito'}" <${account.user}>`,
  }
}

// ─── Create transporter directly from account object (for testing) ────────────

export function createTransporterFromAccount(account) {
  return nodemailer.createTransport({
    host:   account.host,
    port:   Number(account.port) || 587,
    secure: account.secure ?? (Number(account.port) === 465),
    auth: {
      user: account.user,
      pass: account.password,
    },
  })
}

// ─── Email senders ────────────────────────────────────────────────────────────

export async function sendOnboardingEmail({ to, name, link, expiresAt }) {
  const { transporter, from } = await getTransporter('onboarding')

  const expiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : '7 days'

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">
        <tr>
          <td style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:36px 40px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Enfinito</p>
            <p style="margin:8px 0 0;font-size:13px;color:#bfdbfe;">Employee Onboarding Invitation</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 16px;font-size:15px;color:#374151;">Hi${name ? ` <strong>${name}</strong>` : ''},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
              You have been invited to join <strong>Enfinito</strong> as a new team member.
              Please complete your onboarding by filling in your personal details and uploading the required documents.
            </p>
            <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.6;">
              This link will expire on <strong>${expiry}</strong>. Please complete the form before then.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td style="background:#2563eb;border-radius:10px;">
                  <a href="${link}" target="_blank"
                    style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
                    Complete Onboarding Form →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">Or copy this link into your browser:</p>
            <p style="margin:0;font-size:12px;color:#3b82f6;word-break:break-all;">${link}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;">
              <tr><td>
                <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#374151;">What you will need:</p>
                <ul style="margin:0;padding-left:18px;font-size:13px;color:#6b7280;line-height:2;">
                  <li>Your National ID (NID) — number &amp; a scan/photo</li>
                  <li>A formal photo (plain background, clear face)</li>
                  <li>Personal details: address, date of birth, emergency contact</li>
                  <li>Any other documents (CV, birth certificate, passport, etc.)</li>
                </ul>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              This is an automated message from Enfinito CRM. Do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  await transporter.sendMail({ from, to, subject: 'Complete Your Onboarding — Enfinito', html })
}

export async function sendFreelancerInviteEmail({ to, name, link, type = 'FREELANCER' }) {
  const { transporter, from } = await getTransporter('freelancer')
  const typeLabel = type === 'AGENCY' ? 'Agency Partner' : 'Freelancer'

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">
        <tr>
          <td style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:36px 40px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Enfinito</p>
            <p style="margin:8px 0 0;font-size:13px;color:#bfdbfe;">Panel Invitation — ${typeLabel}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 16px;font-size:15px;color:#374151;">Hi${name ? ` <strong>${name}</strong>` : ''},</p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">
              You have been added as a <strong>${typeLabel}</strong> on the <strong>Enfinito Panel</strong>.
              To get started, please set up your account by clicking the button below.
            </p>
            <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.6;">
              This invitation link will expire in <strong>48 hours</strong>. Please complete your setup before then.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td style="background:#2563eb;border-radius:10px;">
                  <a href="${link}" target="_blank"
                    style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.2px;">
                    Set Up Your Account →
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">Or copy this link into your browser:</p>
            <p style="margin:0 0 28px;font-size:12px;color:#3b82f6;word-break:break-all;">${link}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 40px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;">
              <tr><td>
                <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#374151;">Getting started:</p>
                <ol style="margin:0;padding-left:18px;font-size:13px;color:#6b7280;line-height:2.2;">
                  <li>Click the link above to open your setup page</li>
                  <li>Set your own secure password</li>
                  <li>Set up your preferred payment method</li>
                  <li>Access your panel and start collaborating</li>
                </ol>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              This is an automated message from Enfinito CRM. Do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  await transporter.sendMail({ from, to, subject: "You're invited to join Enfinito Panel", html })
}

export async function sendClientWelcomeEmail({ to, name, clientCode, password, phone }) {
  const { transporter, from } = await getTransporter('client')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.07);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f766e,#0891b2);padding:36px 40px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;">Enfinito</p>
            <p style="margin:8px 0 0;font-size:13px;color:#99f6e4;">Client Panel Access</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <p style="margin:0 0 16px;font-size:15px;color:#374151;">Hi <strong>${name}</strong>,</p>
            <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
              Your client account has been created on the <strong>Enfinito</strong> panel.
              Use the credentials below to log in and track your projects and invoices.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0"
              style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px;">
              <tr><td>
                <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">Your Login Credentials</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#6b7280;width:140px;">Client ID</td>
                    <td style="padding:6px 0;font-size:14px;font-weight:600;color:#111827;font-family:monospace;">${clientCode}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#6b7280;">Email</td>
                    <td style="padding:6px 0;font-size:14px;font-weight:600;color:#111827;">${to}</td>
                  </tr>
                  ${phone ? `<tr>
                    <td style="padding:6px 0;font-size:13px;color:#6b7280;">Phone</td>
                    <td style="padding:6px 0;font-size:14px;font-weight:600;color:#111827;">${phone}</td>
                  </tr>` : ''}
                  <tr>
                    <td style="padding:6px 0;font-size:13px;color:#6b7280;">Password</td>
                    <td style="padding:6px 0;font-size:16px;font-weight:700;color:#0f766e;font-family:monospace;letter-spacing:2px;">${password}</td>
                  </tr>
                </table>
                <p style="margin:12px 0 0;font-size:12px;color:#f59e0b;">Save this password. You can change it after logging in.</p>
              </td></tr>
            </table>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
              <tr>
                <td style="background:#0f766e;border-radius:10px;">
                  <a href="${appUrl}/login" target="_blank"
                    style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                    Log In to Panel →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">This is an automated message from Enfinito CRM. Do not reply.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  await transporter.sendMail({ from, to, subject: 'Your Enfinito Client Panel Access', html })
}
