export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { canDo } from '@/lib/rbac'
import { requireAnyPerm } from './_lib/auth'
import { logActivity } from '@/lib/logActivity'
import { buildRegister, parseRegisterRange } from './_lib/registers'
import { registerCsv, registerFilename } from './_lib/export'

// GET /api/tax/registers?type=sales|purchases|disclosure|vds|tds&start=YYYY-MM-DD&end=YYYY-MM-DD&format=json|csv
//   sales      Mushak-6.2 (columns 1–21) — output VAT invoices (+ credit notes negative, debit notes)
//   purchases  Mushak-6.1 (columns 1–21) — received purchase bills (per line) + other input-VAT purchases
//              + paid supplier expenses without input VAT (no-VAT / unregistered sellers)
//   disclosure Mushak-6.10 — Part A purchases / Part B sales above Tk 2,00,000
//   vds        VAT deducted at source (by us: note 24; by customers: note 29)
//   tds        income tax withheld (by us / by customers)
// JSON → { data: { type, form, title, columns, rows, totals, summary, ... }, meta: { count, truncated } }
// CSV  → text/csv (UTF-8 BOM) in official column order with a totals row.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'sales'
    const format = (searchParams.get('format') || 'json').toLowerCase()
    if (!['json', 'csv'].includes(format)) return NextResponse.json({ error: 'format must be json or csv' }, { status: 400 })

    const range = parseRegisterRange(searchParams.get('start'), searchParams.get('end'))

    await connectDB()
    const reg = await buildRegister({ type, range, maskTin: !canDo(session, 'pii.identity.view') })

    if (format === 'csv') {
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'EXPORT',
        entity:   'TAX_ENTRY',
        entityId: null,
        changes:  JSON.stringify({ register: type, start: range.start, end: range.end, rows: reg.rows.length }),
        request,
      })
      return new Response(registerCsv(reg), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${registerFilename(reg, 'csv')}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json({ data: reg, meta: { count: reg.rows.length, truncated: reg.truncated } })
  } catch (err) {
    if (err?.status && err.status < 500) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[GET /api/tax/registers]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
