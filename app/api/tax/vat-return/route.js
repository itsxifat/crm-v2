export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxFiling } from '@/models'
import { canDo } from '@/lib/rbac'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { computeVatReturn } from '@/lib/tax/vatReturn'
import { getFinanceSettings } from '@/lib/finance/settings'
import { vatChallanCode, sdChallanCode, CHALLAN_CODES } from '@/lib/tax/catalog'
import { resolveReturnPeriod, periodOptions, maskReturnPii, filingView, FILED_STATUSES } from './_lib/server'

// GET /api/tax/vat-return?start=YYYY-MM&end=YYYY-MM | ?period=YYYY-MM
//   → { data: computeVatReturn(...), filing, period, periods, settings }
//   Without a period: the latest ended return period not yet filed, else the current one.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    await connectDB()
    const settings = await getFinanceSettings()
    const frequency = settings?.vat?.returnFrequency ?? 'MONTHLY'

    const { searchParams } = new URL(request.url)
    const period = await resolveReturnPeriod(searchParams, frequency)

    const [data, filingDoc, periods] = await Promise.all([
      computeVatReturn({ start: period.start, end: period.end }),
      TaxFiling.findOne({ kind: 'VAT_RETURN', periodKey: period.key })
        .populate({ path: 'filedBy', select: 'name' })
        .lean(),
      periodOptions(frequency),
    ])

    const filed = !!filingDoc && FILED_STATUSES.includes(filingDoc.status)
    const filing = filingView(filingDoc, { withSnapshot: filed })
    if (filing?.snapshot) maskReturnPii(session, filing.snapshot)

    return NextResponse.json({
      data: maskReturnPii(session, data),
      filing,
      period,
      periods,
      settings: {
        returnFrequency:     frequency,
        registrationType:    settings?.vat?.registrationType ?? null,
        commissionerateCode: settings?.vat?.commissionerateCode ?? null,
        challanCode:         vatChallanCode(settings?.vat?.commissionerateCode),
        challanCodeNew:      CHALLAN_CODES.VAT_NEW,
        sdChallanCode:       sdChallanCode(settings?.vat?.commissionerateCode),
        sdChallanCodeNew:    CHALLAN_CODES.SD_NEW,
        taxLockedUntil:      settings?.taxLockedUntil ?? null,
      },
      permissions: {
        canFile:   canDo(session, 'tax.returns.file'),
        canManage: canDo(session, 'tax.manage'),
      },
    })
  } catch (err) {
    if (err?.status && err.status < 500) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[GET /api/tax/vat-return]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
