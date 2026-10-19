export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxFiling } from '@/models'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { computeVatReturn } from '@/lib/tax/vatReturn'
import { getFinanceSettings, getCompanyProfile } from '@/lib/finance/settings'
import { vatChallanCode, sdChallanCode } from '@/lib/tax/catalog'
import { printResponse } from '@/app/api/tax/registers/_lib/printShell'
import { resolveReturnPeriod, filingView, FILED_STATUSES } from '../_lib/server'
import { vatReturnPrintBody } from '../_lib/print'

// GET /api/tax/vat-return/print?start=YYYY-MM&end=YYYY-MM[&source=filed|live]
// Printable Mushak-9.1 working paper: every part with official note numbers, the
// sub-forms (supplies, purchases, notes 24/29, debit/credit notes, adjustments,
// treasury deposits), points to check and the declaration block.
// source defaults to 'filed' for a filed period (the frozen snapshot), else 'live'.
// Statutory print: counter-party data is not masked (same as other Mushak prints).
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    await connectDB()
    const settings = await getFinanceSettings()
    const { searchParams } = new URL(request.url)
    const period = await resolveReturnPeriod(searchParams, settings?.vat?.returnFrequency ?? 'MONTHLY')
    const requested = searchParams.get('source')
    if (requested && !['filed', 'live'].includes(requested)) {
      return NextResponse.json({ error: 'source must be filed or live' }, { status: 400 })
    }

    const [filingDoc, company] = await Promise.all([
      TaxFiling.findOne({ kind: 'VAT_RETURN', periodKey: period.key }).lean(),
      getCompanyProfile(),
    ])
    const filed = !!filingDoc && FILED_STATUSES.includes(filingDoc.status) && !!filingDoc.snapshot?.notes
    const source = requested ?? (filed ? 'filed' : 'live')
    if (source === 'filed' && !filed) {
      return NextResponse.json({ error: 'This return has not been filed yet — print the live figures instead' }, { status: 404 })
    }

    const result = source === 'filed' ? filingDoc.snapshot : await computeVatReturn({ start: period.start, end: period.end })
    const body = vatReturnPrintBody({
      result,
      filing: filingView(filingDoc),
      company,
      settings,
      source,
      challanCode: vatChallanCode(settings?.vat?.commissionerateCode),
      sdChallanCode: sdChallanCode(settings?.vat?.commissionerateCode),
    })

    return printResponse({
      request,
      title: `Mushak-9.1 ${period.label}`,
      body,
      landscape: false,
      filename: `mushak-9.1_${period.key.replace('..', '_to_')}`,
    })
  } catch (err) {
    if (err?.status && err.status < 500) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[GET /api/tax/vat-return/print]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
