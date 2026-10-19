export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { canDoAny } from '@/lib/rbac'
import { getFinanceSettings } from '@/lib/finance/settings'
import { errorResponse } from './_lib/common'
import { buildReport, REPORT_TYPES } from './_lib/reports'
import { reportToCsv, reportFileName } from './_lib/csv'

const VIEW_PERMS = ['inventory.view', 'inventory.manage']

// GET /api/inventory/reports?type=register|custodian|location|warranty|book-depreciation|
//   tax-depreciation|disposals|damage|maintenance|stock-valuation|low-stock|consumption|ppe-movement
//   &fy=2026-27 | &start=YYYY-MM-DD&end=YYYY-MM-DD  &format=json|csv  (+ per-report filters)
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    if (!type || !REPORT_TYPES.includes(type)) {
      return NextResponse.json({ error: `Choose a report type: ${REPORT_TYPES.join(', ')}` }, { status: 422 })
    }
    const format = (searchParams.get('format') || 'json').toLowerCase()
    if (!['json', 'csv'].includes(format)) return NextResponse.json({ error: 'format must be json or csv' }, { status: 422 })

    await connectDB()
    const settings = await getFinanceSettings()
    const report = await buildReport(type, searchParams, { settings, startMonth: settings.fiscalYearStartMonth || 7 })

    if (format === 'csv') {
      return new Response(reportToCsv(report), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${reportFileName(report)}"`,
          'Cache-Control': 'no-store',
        },
      })
    }
    return NextResponse.json({ data: report })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/reports]')
  }
}
