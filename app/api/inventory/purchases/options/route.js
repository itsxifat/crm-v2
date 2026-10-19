export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { AssetCategory, InventoryLocation, StockItem } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { getFinanceSettings } from '@/lib/finance/settings'
import { ensureCategoriesSeeded } from '@/lib/inventory/assets'
import { errorResponse } from '../_lib/http'

const PERMS = ['inventory.view', 'inventory.purchase', 'inventory.manage', 'inventory.assign']

// GET /api/inventory/purchases/options
// Master data for the purchase-bill form and the consumables page in one call:
// active categories (seeded on first use), locations, stock items and the
// finance settings the forms need (capitalisation threshold, VAT status).
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    await ensureCategoriesSeeded()

    const [categories, locations, stockItems, settings] = await Promise.all([
      AssetCategory.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 })
        .select('name code type taxClass capitalize inputVatCreditable requiresAcknowledgement usefulLifeMonths').lean(),
      InventoryLocation.find({ isActive: { $ne: false } }).sort({ name: 1 }).select('name code type').lean(),
      StockItem.find({ isActive: { $ne: false } }).sort({ name: 1 }).limit(2000)
        .select('sku name unit categoryId qtyOnHand avgCost reorderLevel').lean(),
      getFinanceSettings(),
    ])

    return NextResponse.json({
      data: {
        categories: categories.map(c => ({
          id: String(c._id), name: c.name, code: c.code, type: c.type ?? 'ASSET', taxClass: c.taxClass ?? 'OTHER',
          capitalize: c.capitalize !== false, inputVatCreditable: Boolean(c.inputVatCreditable),
          requiresAcknowledgement: c.requiresAcknowledgement !== false, usefulLifeMonths: c.usefulLifeMonths ?? null,
        })),
        locations: locations.map(l => ({ id: String(l._id), name: l.name, code: l.code ?? null, type: l.type ?? null })),
        stockItems: stockItems.map(s => ({
          id: String(s._id), sku: s.sku, name: s.name, unit: s.unit || 'pcs', categoryId: s.categoryId ? String(s.categoryId) : null,
          qtyOnHand: Number(s.qtyOnHand) || 0, avgCost: Number(s.avgCost) || 0, reorderLevel: Number(s.reorderLevel) || 0,
        })),
        settings: {
          capitalizationThreshold: Number(settings.inventory?.capitalizationThreshold ?? 10000) || 0,
          vatRegistrationType: settings.vat?.registrationType ?? 'REGISTERED',
          defaultSalesTreatment: settings.vat?.defaultSalesTreatment ?? 'STANDARD',
          isVdsEntity: settings.vat?.isVdsEntity !== false,
          isWithholdingEntity: settings.incomeTax?.isWithholdingEntity !== false,
          goLiveDate: settings.goLiveDate ?? null,
          lockedUntil: settings.lockedUntil ?? null,
        },
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/purchases/options]')
  }
}
