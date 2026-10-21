export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requireMailUser } from '@/lib/mail/access'
import { loadOlder } from '@/lib/mail/sync'
import { mailError } from '../../../_lib/http'
import { loadUsableFolder } from '../../../_lib/guards'

// POST /api/mail/folders/[id]/load-older — fetch the next 100 older messages from the server
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    await connectDB()
    const { folder, error } = await loadUsableFolder(session, params.id)
    if (error) return error

    const result = await loadOlder(String(folder.accountId), String(folder._id), 100)
    return NextResponse.json({ data: { loaded: Number(result?.loaded) || 0, hasMore: !!result?.hasMore } })
  } catch (err) {
    return mailError(err, '[POST /api/mail/folders/[id]/load-older]')
  }
}
