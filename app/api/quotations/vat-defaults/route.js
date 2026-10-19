export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { BIN_REGEX } from '@/lib/tax/catalog'
import { loadVatSettings, vatDefaultsFor, clientBinFor } from '../_lib/server'

// GET /api/quotations/vat-defaults?clientId=…
// What the quotation form should pre-select: the company's VAT defaults (from
// finance settings) and the selected client's VAT profile. Lives under the
// quotation API so sales staff without finance / tax permissions still get it.
// → { data: { vatTreatment, vatRate, serviceCode, registrationType, settingsAvailable,
//             client: { vatRegistrationType, hasBin, bin } | null } }
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, ['sales.quotations.create', 'sales.quotations.update']))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const clientId = searchParams.get('clientId')
    if (clientId && !isValidObjectId(clientId))
      return NextResponse.json({ error: 'Invalid client' }, { status: 400 })

    await connectDB()

    let client = null
    if (clientId) {
      client = await Client.findById(clientId).select('vatRegistrationType bin vatNumber').lean()
      if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const vat = await loadVatSettings()
    const defaults = vatDefaultsFor(vat, client)

    let clientInfo = null
    if (client) {
      const legacy = client.vatNumber ? String(client.vatNumber).replace(/\s/g, '') : ''
      const legacyBin = !!legacy && BIN_REGEX.test(legacy)
      clientInfo = {
        vatRegistrationType: client.vatRegistrationType ?? null,
        hasBin: !!client.bin || legacyBin,
        bin:    clientBinFor(session, client),
      }
    }

    return NextResponse.json({
      data: {
        ...defaults,
        registrationType:  vat?.registrationType ?? null,
        settingsAvailable: !!vat,
        client:            clientInfo,
      },
    })
  } catch (err) {
    console.error('[GET /api/quotations/vat-defaults]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
