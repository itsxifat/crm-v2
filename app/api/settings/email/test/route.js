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
    return NextResponse.json({ error: err.message || 'Connection failed' }, { status: 400 })
  }
}
