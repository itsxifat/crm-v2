export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { canDo } from '@/lib/rbac'
import { requireAnyPerm } from '../_lib/auth'
import { getCompanyProfile } from '@/lib/finance/settings'
import { buildRegister, parseRegisterRange } from '../_lib/registers'
import { registerPrintBody, registerFilename } from '../_lib/export'
import { printResponse } from '../_lib/printShell'

// GET /api/tax/registers/print?type=sales|purchases|disclosure|vds|tds&start=YYYY-MM-DD&end=YYYY-MM-DD[&stock=1]
// Printable register in the Mushak column layout (6.2 / 6.1 landscape with numbered columns,
// 6.10 Part A / Part B), with the company header, totals and the responsible person's block.
// Stock columns (blank for services) are left out unless stock=1.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'sales'
    const range = parseRegisterRange(searchParams.get('start'), searchParams.get('end'))
    const showStock = searchParams.get('stock') === '1'

    await connectDB()
    const [reg, company] = await Promise.all([
      buildRegister({ type, range, maskTin: !canDo(session, 'pii.identity.view') }),
      getCompanyProfile(),
    ])

    return printResponse({
      request,
      title: `${reg.form ?? 'Register'} ${reg.title} — ${reg.label}`,
      body: registerPrintBody(reg, company, { showStock }),
      landscape: reg.landscape,
      filename: registerFilename(reg, 'print').replace(/\.print$/, ''),
    })
  } catch (err) {
    if (err?.status && err.status < 500) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[GET /api/tax/registers/print]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
