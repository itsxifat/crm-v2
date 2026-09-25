export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'
import { sendWhatsAppTextWithKey } from '@/lib/whatsapp'

const MASK = '••••••••'

// POST /api/settings/whatsapp/test
// Body: { account: {...}, sendTo: "+1234567890" }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    let account = body?.account
    const sendTo = body?.sendTo

    // Editing a saved account seeds the form with the masked API key — swap it
    // for the stored secret (as PUT /api/settings/whatsapp does) before testing.
    if (account?.apiKey === MASK && account?.id) {
      await connectDB()
      const setting = await Setting.findOne({ key: 'whatsapp_accounts' }).lean()
      const stored = setting ? JSON.parse(setting.value) : []
      const prev = stored.find(e => e.id === account.id)
      account = { ...account, apiKey: prev?.apiKey ?? '' }
    }

    if (!account?.apiKey) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 })
    }
    if (!sendTo) {
      return NextResponse.json({ error: 'Phone number (sendTo) is required for WhatsApp test' }, { status: 400 })
    }

    await sendWhatsAppTextWithKey({
      to:      sendTo,
      message: `This is a test message from *${account.label || 'Enfinito CRM'}*.\nYour WhatsApp API configuration is working correctly. ✅`,
      apiKey:  account.apiKey,
    })

    return NextResponse.json({ ok: true, message: `Test message sent to ${sendTo}` })
  } catch (err) {
    console.error('[POST /api/settings/whatsapp/test]', err)
    return NextResponse.json({ error: err.message || 'Failed to send test message' }, { status: 400 })
  }
}
