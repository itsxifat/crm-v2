/**
 * scripts/migrate-company-items-to-assets.js
 *
 * Employees used to carry a free-text "Company Items" list (Employee.companyItems,
 * shape { item, value, description }). The asset register replaces it. This
 * script turns every legacy entry into a proper Asset:
 *
 *   • category  — fuzzy match of the item name (keywords, then category names /
 *                 codes); falls back to "Office equipment" (OEQ)
 *   • cost      — `value` when it is a plain amount (e.g. "85,000", "Tk 85000/-"),
 *                 else 0; any other text in `value` is kept as specs, and a serial
 *                 number in it ("SN: ABC123") becomes the serial
 *   • not capitalised, no depreciation, opening.isExisting = true
 *   • assigned to that employee, acknowledgement NOT_REQUIRED
 *   • notes     — the legacy description plus a marker
 *                 `legacy:companyItems:{employeeId}:{index}`
 *   • history   — an OPENING event and an ASSIGNED event, like the opening import
 *
 * The legacy list itself is left untouched.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write:
 *     npm run db:migrate-company-items -- --apply
 *
 * Options:
 *     --skip-inactive        leave out resigned / deactivated employees
 *     --employee=<id|code>   only this employee (Mongo id or employee ID such as ENDEV2601001;
 *                            separators are ignored, so the old EN-DEV2601001 works too)
 *
 * Safe to re-run: entries whose marker already exists are skipped.
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { DEFAULT_CATEGORIES } from '../lib/inventory/constants.js'
import { TAX_DEPRECIATION_CLASSES } from '../lib/tax/catalog.js'
import { compactCode } from '../lib/codes.js'

const APPLY         = process.argv.includes('--apply')
const SKIP_INACTIVE = process.argv.includes('--skip-inactive')
const ONLY_EMPLOYEE = (process.argv.find(a => a.startsWith('--employee=')) ?? '').slice('--employee='.length).trim() || null

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('✗ MONGODB_URI is not set (check your .env)')
  process.exit(1)
}

const MARKER_PREFIX = 'legacy:companyItems:'
const FALLBACK_CODE = 'OEQ'
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000

const num    = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100
const money  = (v) => round2(v).toLocaleString('en-BD', { minimumFractionDigits: 2 })
const text   = (v) => (v === null || v === undefined ? '' : String(v).trim())
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ── category matching ────────────────────────────────────────────────────────

// Checked in order; accessories first so "laptop charger" or "monitor stand" is an accessory.
const KEYWORDS = [
  ['ACC', ['mouse', 'keyboard', 'headset', 'headphone', 'headphones', 'earphone', 'earphones', 'earbuds', 'charger', 'cable',
    'adapter', 'adaptor', 'hub', 'dock', 'docking', 'pendrive', 'pen drive', 'flash drive', 'usb', 'hdd', 'ssd', 'hard disk',
    'hard drive', 'mouse pad', 'mousepad', 'bag', 'backpack', 'laptop stand', 'monitor stand', 'cooling pad', 'converter',
    'cover', 'case', 'screen protector', 'protector']],
  ['LAP', ['laptop', 'notebook', 'macbook', 'thinkpad', 'ultrabook', 'chromebook', 'vivobook', 'ideapad', 'zenbook']],
  ['DSK', ['desktop', 'workstation', 'cpu', 'pc', 'imac', 'mac mini', 'all in one', 'all-in-one']],
  ['MON', ['monitor', 'display', 'screen', 'lcd', 'led monitor']],
  ['PRN', ['printer', 'scanner', 'photocopier', 'copier']],
  ['NET', ['router', 'switch', 'modem', 'wifi', 'wi-fi', 'access point', 'onu', 'firewall', 'pocket router']],
  ['SRV', ['server', 'nas']],
  ['PHN', ['phone', 'mobile', 'smartphone', 'iphone', 'android', 'tablet', 'ipad', 'sim', 'sim card']],
  ['CAM', ['camera', 'webcam', 'dslr', 'mirrorless', 'gopro', 'microphone', 'mic', 'tripod', 'gimbal', 'projector', 'ring light']],
  ['ACU', ['air conditioner', 'aircon', 'ac', 'a/c']],
  ['UPS', ['ups', 'ips', 'battery', 'power bank', 'powerbank', 'inverter']],
  ['FUR', ['chair', 'desk', 'table', 'furniture', 'cabinet', 'drawer', 'shelf', 'sofa', 'locker', 'almirah']],
  ['VEH', ['car', 'bike', 'motorcycle', 'motorbike', 'vehicle', 'scooter']],
  ['SFT', ['software', 'licence', 'license', 'subscription', 'microsoft 365', 'office 365', 'adobe', 'windows license']],
]

const GENERIC_WORDS = new Set(['and', 'the', 'other', 'misc', 'office', 'equipment', 'supplies', 'items', 'item', 'set'])

const hasWord = (haystack, phrase) => new RegExp(`(^|[^a-z0-9])${escapeRegex(phrase)}([^a-z0-9]|$)`, 'i').test(haystack)

function matchCategory(name, categories) {
  const lower = name.toLowerCase()
  const byCode = new Map(categories.map(c => [c.code, c]))

  const exactCode = byCode.get(name.trim().toUpperCase())
  if (exactCode) return { category: exactCode, how: 'code' }
  const exactName = categories.find(c => c.name.toLowerCase() === lower.trim())
  if (exactName) return { category: exactName, how: 'name' }

  for (const [code, words] of KEYWORDS) {
    const cat = byCode.get(code)
    if (cat && words.some(w => hasWord(lower, w))) return { category: cat, how: 'keyword' }
  }

  let best = null
  for (const c of categories) {
    const words = c.name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !GENERIC_WORDS.has(w))
    const score = words.filter(w => hasWord(lower, w) || hasWord(lower, w.replace(/s$/, ''))).length
    if (score > 0 && (!best || score > best.score)) best = { category: c, score }
  }
  if (best) return { category: best.category, how: 'name words' }

  const fallback = byCode.get(FALLBACK_CODE) ?? categories[0]
  return { category: fallback, how: 'fallback' }
}

// ── legacy value parsing ─────────────────────────────────────────────────────

/** Plain amount → number; anything else → null. */
function parseCost(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? round2(v) : null
  const s = text(v)
  if (!s) return null
  const cleaned = s.replace(/৳|\btk\.?|\btaka\b|\bbdt\b|\/-|,|\s/gi, '')
  return /^\d+(\.\d+)?$/.test(cleaned) ? round2(Number(cleaned)) : null
}

/** "ThinkPad X1 / SN: PF2A1B3C" → 'PF2A1B3C' */
function parseSerial(v) {
  const m = text(v).match(/(?:\bs\/?n\b|\bserial(?:\s*(?:no|number))?\.?)\s*[:#.-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i)
  return m ? m[1].toUpperCase() : null
}

function normalizeTagPrefix(prefix) {
  return String(prefix ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

/** Day before go-live (Dhaka midnight) — the "as at" date of the opening register. */
function openingAsOf(goLiveDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(goLiveDate))
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1) - DHAKA_OFFSET_MS)
}

// ── tags ─────────────────────────────────────────────────────────────────────
// Same series as lib/inventory/assets.js: `${prefix}${CODE}${seq5}` (ENLAP00042),
// counter `asset:${prefix}${CODE}`. Tags issued before 2026-10 read EN-LAP-00042
// and kept their counter under asset:EN-LAP — both are floors.

const tagSeriesOf = (prefix, code) => ({ series: `${prefix}${code}`, prefix, code })

/**
 * Highest number used in a series: tags of either shape (exactly 5 digits — category
 * codes may end in digits, so LAP must not read LAP1's tags) and the old counter key.
 */
async function maxTagNumber(db, { prefix, code }) {
  const re = new RegExp(`^${prefix ? `${escapeRegex(prefix)}-?` : ''}${escapeRegex(code)}-?(\\d{5})$`)
  const rows = await db.collection('assets')
    .find({ assetTag: { $regex: re.source } }, { projection: { assetTag: 1 } })
    .toArray()
  const legacy = prefix ? await db.collection('counters').findOne({ _id: `asset:${prefix}-${code}` }) : null
  return Math.max(rows.reduce((m, r) => Math.max(m, parseInt(re.exec(r.assetTag)?.[1], 10) || 0), 0), num(legacy?.seq))
}

/** Same counter as lib/sequence.nextSequence (`asset:${series}`), floored at the highest tag in use. */
async function allocateTag(db, tagSet) {
  const floor = await maxTagNumber(db, tagSet)
  const res = await db.collection('counters').findOneAndUpdate(
    { _id: `asset:${tagSet.series}` },
    [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, floor] }, 1] } } }],
    { upsert: true, returnDocument: 'after' },
  )
  const doc = res?.seq !== undefined ? res : res?.value
  return `${tagSet.series}${String(doc.seq).padStart(5, '0')}`
}

/** Dry-run preview of the next tag without consuming the counter. */
async function previewTag(db, tagSet, offset) {
  const floor = await maxTagNumber(db, tagSet)
  const counter = await db.collection('counters').findOne({ _id: `asset:${tagSet.series}` })
  return `${tagSet.series}${String(Math.max(num(counter?.seq), floor) + offset).padStart(5, '0')}`
}

// ── categories ───────────────────────────────────────────────────────────────

function seedCategoryDoc(c, index, now) {
  const cls = TAX_DEPRECIATION_CLASSES?.[c.taxClass] ?? null
  const consumable = c.type === 'CONSUMABLE'
  return {
    name: c.name,
    code: c.code,
    type: c.type ?? 'ASSET',
    taxClass: c.taxClass ?? 'OTHER',
    depreciationMethod: consumable ? 'NONE' : 'STRAIGHT_LINE',
    usefulLifeMonths: num(cls?.bookLifeMonths) > 0 ? num(cls.bookLifeMonths) : 60,
    residualPct: 0,
    decliningRatePct: null,
    capitalize: consumable ? false : c.capitalize !== false,
    requiresAcknowledgement: !consumable,
    inputVatCreditable: false,
    description: null,
    isActive: true,
    sortOrder: (index + 1) * 10,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  }
}

async function main() {
  await mongoose.connect(MONGODB_URI)
  const db = mongoose.connection.db
  console.log(`✓ connected to ${db.databaseName}`)
  console.log(APPLY ? '⚠  APPLY MODE — changes will be written\n' : 'ℹ  DRY RUN — pass --apply to write\n')

  // ── settings ──
  let settings = {}
  const settingDoc = await db.collection('settings').findOne({ key: 'finance_settings' })
  if (settingDoc?.value) {
    try { settings = JSON.parse(settingDoc.value) ?? {} } catch { console.warn('! finance_settings is not valid JSON — using defaults') }
  }
  const prefix = normalizeTagPrefix(settings?.inventory?.tagPrefix ?? 'EN')
  const asOfDate = openingAsOf(settings?.goLiveDate)
  console.log(`· tag prefix ${prefix || '(none)'} · go-live ${settings?.goLiveDate ?? 'not set'}${asOfDate ? ` (opening as at ${new Date(asOfDate.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10)})` : ''}`)

  // ── categories ──
  const now = new Date()
  let categories = await db.collection('assetcategories')
    .find({ type: { $ne: 'CONSUMABLE' }, isActive: { $ne: false } })
    .sort({ sortOrder: 1, name: 1 })
    .toArray()
  if (!categories.length) {
    const total = await db.collection('assetcategories').countDocuments()
    if (total === 0) {
      console.log('· no asset categories yet — the default list will be seeded')
      const docs = DEFAULT_CATEGORIES.map((c, i) => seedCategoryDoc(c, i, now))
      if (APPLY) {
        await db.collection('assetcategories').insertMany(docs, { ordered: false })
        categories = await db.collection('assetcategories').find({ type: { $ne: 'CONSUMABLE' }, isActive: { $ne: false } }).sort({ sortOrder: 1 }).toArray()
      } else {
        categories = docs.filter(d => d.type !== 'CONSUMABLE').map(d => ({ ...d, _id: null }))
      }
    } else {
      console.error('✗ every asset category is inactive or a consumable — activate one before migrating')
      await mongoose.disconnect()
      process.exit(1)
    }
  }
  console.log(`· ${categories.length} asset categor${categories.length === 1 ? 'y' : 'ies'} available`)

  // ── employees with legacy items ──
  const empFilter = { companyItems: { $exists: true, $type: 'array', $ne: [] } }
  if (ONLY_EMPLOYEE) {
    empFilter.$or = mongoose.Types.ObjectId.isValid(ONLY_EMPLOYEE) && /^[a-f0-9]{24}$/i.test(ONLY_EMPLOYEE)
      ? [{ _id: new mongoose.Types.ObjectId(ONLY_EMPLOYEE) }]
      : [{ employeeId: { $regex: `^${compactCode(ONLY_EMPLOYEE).split('').map(escapeRegex).join('-?')}$`, $options: 'i' } }]
  }
  const employees = await db.collection('employees')
    .find(empFilter, { projection: { userId: 1, employeeId: 1, companyItems: 1, hireDate: 1, createdAt: 1, isActive: 1, resigned: 1 } })
    .toArray()
  const users = await db.collection('users')
    .find({ _id: { $in: employees.map(e => e.userId).filter(Boolean) } }, { projection: { name: 1, isActive: 1 } })
    .toArray()
  const userById = new Map(users.map(u => [String(u._id), u]))
  const totalItems = employees.reduce((s, e) => s + (Array.isArray(e.companyItems) ? e.companyItems.length : 0), 0)
  console.log(`· ${employees.length} employee(s) with ${totalItems} company item(s)${ONLY_EMPLOYEE ? ` (only ${ONLY_EMPLOYEE})` : ''}\n`)

  // ── what is already migrated ──
  const migrated = await db.collection('assets')
    .find({ notes: { $regex: escapeRegex(MARKER_PREFIX) } }, { projection: { assetTag: 1, name: 1, specs: 1, notes: 1, assignedEmployeeId: 1 } })
    .toArray()
  const markerToTag = new Map()
  for (const a of migrated) {
    for (const m of String(a.notes).matchAll(/legacy:companyItems:([a-f0-9]{24}):(\d+)/gi)) markerToTag.set(`${m[1]}:${m[2]}`, a.assetTag)
  }

  const counts = { create: 0, already: 0, skipped: 0, inactive: 0, created: 0, failed: 0 }
  const previewOffsets = new Map()

  for (const emp of employees) {
    const user = userById.get(String(emp.userId))
    const inactive = emp.resigned === true || emp.isActive === false || user?.isActive === false
    const label = `${emp.employeeId ?? emp._id} ${user?.name ?? '(no user)'}${inactive ? ' — resigned/inactive' : ''}`
    console.log(`── ${label} ──`)
    if (inactive && SKIP_INACTIVE) {
      console.log('  (skipped: --skip-inactive)')
      counts.inactive += emp.companyItems.length
      continue
    }

    const assignedAt = emp.hireDate ? new Date(emp.hireDate) : emp.createdAt ? new Date(emp.createdAt) : now
    const sameEmployee = migrated.filter(a => String(a.assignedEmployeeId) === String(emp._id))

    for (const [index, raw] of emp.companyItems.entries()) {
      const entry = raw && typeof raw === 'object' ? raw : { item: raw }
      const name = text(entry.item ?? entry.name)
      const markerKey = `${emp._id}:${index}`
      if (!name) {
        console.log(`  #${index} (skipped: no item name)`)
        counts.skipped++
        continue
      }
      if (markerToTag.has(markerKey)) {
        console.log(`  #${index} ${name} — already migrated as ${markerToTag.get(markerKey)}`)
        counts.already++
        continue
      }

      const value = entry.value
      const cost = parseCost(value) ?? 0
      const details = parseCost(value) === null ? text(value) : ''
      const serial = parseSerial(value)
      const description = text(entry.description)

      // Guard against duplicates when the legacy list was re-ordered after an earlier run.
      const twin = sameEmployee.find(a => a.name === name && text(a.specs) === details)
      if (twin) {
        console.log(`  #${index} ${name} — matches already migrated ${twin.assetTag}, skipped`)
        counts.already++
        continue
      }

      const { category, how } = matchCategory(name, categories)
      const tagSet = tagSeriesOf(prefix, category.code)
      const series = tagSet.series
      const descr =`${name} → ${category.code} ${category.name} (${how})${cost ? ` · cost ${money(cost)}` : ''}${serial ? ` · S/N ${serial}` : ''}${details ? ` · "${details}"` : ''}`

      if (!APPLY) {
        const offset = (previewOffsets.get(series) ?? 0) + 1
        previewOffsets.set(series, offset)
        console.log(`  #${index} ${descr} → ≈${await previewTag(db, tagSet, offset)}`)
        counts.create++
        continue
      }

      const assetId = new mongoose.Types.ObjectId()
      const assignEventId = new mongoose.Types.ObjectId()
      const cls = TAX_DEPRECIATION_CLASSES?.[category.taxClass] ?? null
      const marker = `${MARKER_PREFIX}${emp._id}:${index}`
      try {
        const assetTag = await allocateTag(db, tagSet)
        const asset = {
          _id: assetId,
          assetTag,
          name,
          categoryId: category._id,
          brand: null,
          model: null,
          serialNumber: serial,
          specs: details || null,
          description: null,
          imageUrl: null,
          documents: [],
          status: 'ASSIGNED',
          condition: 'GOOD',
          locationId: null,
          assignedEmployeeId: emp._id,
          assignedUserId: emp.userId ?? null,
          assignedDepartmentId: null,
          assignedAt,
          expectedReturnDate: null,
          acknowledgement: { status: 'NOT_REQUIRED', at: null, note: null, eventId: assignEventId },
          purchase: {
            billId: null, vendorId: null, vendorName: null, invoiceRef: null, mushakNo: null, date: null,
            currency: 'BDT', unitCost: cost, vatAmount: 0, vatCapitalized: true, otherCosts: 0, expenseId: null, transactionId: null,
          },
          cost,
          isCapitalized: false,
          availableForUseDate: null,
          depreciation: {
            method: 'NONE',
            usefulLifeMonths: num(category.usefulLifeMonths) > 0 ? num(category.usefulLifeMonths) : (num(cls?.bookLifeMonths) || 60),
            residualValue: 0, decliningRatePct: null, accumulated: 0, lastPostedPeriod: null, fullyDepreciated: false,
          },
          taxClass: category.taxClass || 'OTHER',
          taxRatePct: Number.isFinite(Number(cls?.rate)) ? Number(cls.rate) : null,
          opening: { isExisting: true, asOfDate, accumulatedDepreciation: 0, taxWdv: null, taxWdvFiscalYear: null },
          warrantyExpiry: null,
          warrantyNotes: null,
          lastAuditAt: null,
          lastAuditResult: null,
          notes: [description, `[${marker}]`].filter(Boolean).join('\n'),
          createdBy: null,
          updatedBy: null,
          isArchived: false,
          createdAt: now,
          updatedAt: now,
        }
        const legacy = { employeeId: String(emp._id), index, item: name, value: value ?? null, description: description || null }
        const events = [
          {
            assetId, type: 'OPENING', date: assignedAt,
            fromStatus: null, toStatus: 'IN_STOCK', fromLocationId: null, toLocationId: null,
            fromEmployeeId: null, toEmployeeId: null, departmentId: null, condition: 'GOOD',
            amount: cost > 0 ? cost : null, vendorId: null,
            details: {
              batchSize: 1, position: 1, serialNumber: serial, isCapitalized: false, billId: null, invoiceRef: null,
              opening: { asOfDate, accumulatedDepreciation: 0, taxWdv: null, taxWdvFiscalYear: null },
              source: 'legacy:companyItems', legacy,
            },
            attachments: [], notes: 'Migrated from the employee’s Company Items list',
            transactionId: null, expenseId: null, createdBy: null, createdByName: 'Migration script', createdAt: now,
          },
          {
            _id: assignEventId, assetId, type: 'ASSIGNED', date: assignedAt,
            fromStatus: 'IN_STOCK', toStatus: 'ASSIGNED', fromLocationId: null, toLocationId: null,
            fromEmployeeId: null, toEmployeeId: emp._id, departmentId: null, condition: 'GOOD',
            amount: null, vendorId: null,
            details: { expectedReturnDate: null, acknowledgement: 'NOT_REQUIRED', atCreation: true, source: 'legacy:companyItems' },
            attachments: [], notes: null,
            transactionId: null, expenseId: null, createdBy: null, createdByName: 'Migration script', createdAt: now,
          },
        ]

        await db.collection('assets').insertOne(asset)
        try {
          await db.collection('assetevents').insertMany(events, { ordered: true })
        } catch (err) {
          // All-or-nothing per item, so a re-run starts clean.
          await db.collection('assetevents').deleteMany({ assetId })
          await db.collection('assets').deleteOne({ _id: assetId })
          throw err
        }
        markerToTag.set(markerKey, assetTag)
        console.log(`  #${index} ${descr} → ${assetTag}`)
        counts.created++
      } catch (err) {
        console.log(`  #${index} ✗ ${name} — ${err.message}`)
        counts.failed++
      }
    }
  }

  console.log('\n── Summary ──')
  if (APPLY) console.log(`  created ${counts.created}, failed ${counts.failed}`)
  else console.log(`  to create ${counts.create}`)
  console.log(`  already migrated ${counts.already}, skipped (no name) ${counts.skipped}${SKIP_INACTIVE ? `, skipped (inactive) ${counts.inactive}` : ''}`)

  if (!APPLY) {
    console.log('\nℹ  Dry run complete — nothing written. Re-run with --apply.')
  } else {
    console.log('\nℹ  The legacy Company Items lists were left as they are. Review the new assets in Inventory → Assets.')
  }
  await mongoose.disconnect()
  console.log('✓ done')
  if (APPLY && counts.failed) process.exitCode = 1
}

main().catch(async (err) => {
  console.error('✗ migration failed:', err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
