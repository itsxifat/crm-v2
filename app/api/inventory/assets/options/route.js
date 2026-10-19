export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { AssetCategory, Department, InventoryLocation, Vendor } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { getFinanceSettings } from '@/lib/finance/settings'
import { ensureCategoriesSeeded } from '@/lib/inventory/assets'
import { guardRead, errorResponse, todayKey } from '../_lib/service'

const VENDOR_PERMS = ['inventory.manage', 'inventory.assign', 'inventory.purchase', 'inventory.dispose']

// GET /api/inventory/assets/options — everything the asset forms need in one call:
// asset categories (seeded on first use), active locations, departments, vendor names
// and the inventory policy from finance settings.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const denied = guardRead(session)
    if (denied) return denied

    await connectDB()
    await ensureCategoriesSeeded()
    const showVendors = canDoAny(session, VENDOR_PERMS)

    const [categories, locations, departments, vendors, settings] = await Promise.all([
      AssetCategory.find({ isActive: { $ne: false } })
        .select('name code type taxClass depreciationMethod usefulLifeMonths residualPct decliningRatePct capitalize requiresAcknowledgement inputVatCreditable sortOrder')
        .sort({ sortOrder: 1, name: 1 })
        .lean(),
      InventoryLocation.find({ isActive: { $ne: false } }).select('name code type parentId').sort({ name: 1 }).lean(),
      Department.find({ isActive: true }).select('name shortCode').sort({ name: 1 }).lean(),
      showVendors ? Vendor.find({}).select('company').sort({ company: 1 }).limit(1000).lean() : Promise.resolve([]),
      getFinanceSettings(),
    ])

    const id = (d) => String(d._id)
    return NextResponse.json({
      data: {
        categories: categories.map(c => ({
          id: id(c), name: c.name, code: c.code, type: c.type ?? 'ASSET', taxClass: c.taxClass ?? 'OTHER',
          depreciationMethod: c.depreciationMethod ?? 'STRAIGHT_LINE', usefulLifeMonths: c.usefulLifeMonths ?? null,
          residualPct: c.residualPct ?? 0, decliningRatePct: c.decliningRatePct ?? null,
          capitalize: c.capitalize !== false, requiresAcknowledgement: c.requiresAcknowledgement !== false,
          inputVatCreditable: Boolean(c.inputVatCreditable),
        })),
        locations: locations.map(l => ({ id: id(l), name: l.name, code: l.code ?? null, type: l.type, parentId: l.parentId ? String(l.parentId) : null })),
        departments: departments.map(d => ({ id: id(d), name: d.name, shortCode: d.shortCode })),
        vendors: vendors.map(v => ({ id: id(v), name: v.company })),
        settings: {
          capitalizationThreshold: settings.inventory?.capitalizationThreshold ?? 10000,
          depreciationConvention: settings.inventory?.depreciationConvention ?? 'PRORATA_DAYS',
          tagPrefix: settings.inventory?.tagPrefix ?? 'EN',
          postDepreciationToLedger: settings.inventory?.postDepreciationToLedger !== false,
          fiscalYearStartMonth: settings.fiscalYearStartMonth ?? 7,
          goLiveDate: settings.goLiveDate ?? null,
          lockedUntil: settings.lockedUntil ?? null,
          openingLocked: Boolean(settings.openingLocked),
          vatRegistrationType: settings.vat?.registrationType ?? 'REGISTERED',
          defaultSalesRate: settings.vat?.defaultSalesRate ?? 15,
          today: todayKey(),
        },
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/assets/options]')
  }
}
