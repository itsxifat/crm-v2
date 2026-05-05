export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createTransporterFromAccount } from '@/lib/mailer'

// POST /api/settings/email/test
// Body: { account: {...}, sendTo: "email@example.com" }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { account, sendTo } = await request.json()
    if (!account?.host || !account?.user || !account?.password) {
      return NextResponse.json({ error: 'Incomplete account details' }, { status: 400 })
    }

    const to = sendTo || session.user.email
    const transporter = createTransporterFromAccount(account)

    await transporter.verify()
    await transporter.sendMail({
      from: `"${account.fromName || 'EN-Tech CRM'}" <${account.user}>`,
      to,
      subject: 'EN-Tech CRM — Email Test',
      html: `<p>This is a test email from <strong>${account.label || account.user}</strong>.<br>Your email configuration is working correctly.</p>`,
    })

    return NextResponse.json({ ok: true, message: `Test email sent to ${to}` })
  } catch (err) {
    console.error('[POST /api/settings/email/test]', err)
    const code = err.code ?? ''
    let message = err.message || 'Connection failed'
    if (code === 'ETIMEDOUT' || code === 'ESOCKET') {
      message = `Could not reach ${account?.host}:${account?.port ?? 587}. The host may be incorrect, behind a CDN (e.g. Cloudflare), or outbound port ${account?.port ?? 587} is blocked by your server's firewall. Use the direct SMTP hostname (e.g. smtp.gmail.com, mail.yourdomain.com).`
    } else if (code === 'ECONNREFUSED') {
      message = `Connection refused on ${account?.host}:${account?.port ?? 587}. Check that the port is correct and the SMTP service is running.`
    } else if (code === 'ENOTFOUND') {
      message = `Hostname "${account?.host}" could not be resolved. Check for typos in the SMTP host.`
    } else if (err.responseCode === 535 || /invalid credentials|authenticate/i.test(message)) {
      message = 'Authentication failed — check your username and password. For Gmail, use an App Password, not your Google account password.'
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
