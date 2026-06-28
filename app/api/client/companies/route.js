export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { getMyCompanies } from '@/lib/clientAccess'

// GET /api/client/companies — the companies the signed-in person can access.
// Used by the post-login chooser and the in-panel company switcher.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const companies = await getMyCompanies(session.user.id)

    return NextResponse.json({
      companies: companies.map(c => ({
        id:         c._id.toString(),
        company:    c.company ?? null,
        clientCode: c.clientCode ?? null,
        clientType: c.clientType ?? 'INDIVIDUAL',
        logo:       c.logo ?? null,
        role:       c.membershipRole ?? 'MEMBER',
      })),
      activeClientId: session.user.activeClientId ?? null,
    })
  } catch (err) {
    console.error('[GET /api/client/companies]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
