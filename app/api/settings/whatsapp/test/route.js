export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { sendWhatsAppTextWithKey } from '@/lib/whatsapp'

// POST /api/settings/whatsapp/test
// Body: { account: {...}, sendTo: "+1234567890" }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { account, sendTo } = await request.json()
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
