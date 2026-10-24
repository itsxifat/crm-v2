/**
 * scripts/migrate-remove-id-hyphens.js
 *
 * Record numbers are letters and digits only now: ENTP-2610A01 → ENTP2610A01,
 * ENV-2610A001 → ENV2610A001, TXN-20261024-0001 → TXN202610240001, … Dropping
 * the hyphens turns an old number into its new one, and every lookup ignores
 * separators (lib/codes.js), so numbers already printed, emailed or stuck on
 * equipment keep resolving after this runs.
 *
 *   1. Record numbers (SERIES) — renames every value in the shape the CRM
 *      generated. Typed employee IDs and SKUs with hyphens are compacted too.
 *      A number whose compact form another document of the same field already
 *      holds is SKIPPED and reported, never overwritten. When two old numbers
 *      share one compact form, the older record is renamed and the other skipped.
 *   2. Copies (COPIES) — structured copies of those numbers in other records,
 *      rewritten through the exact old → new map. Left as written: taxfilings
 *      .snapshot (filed returns), auditlogs, notifications, integrationevents,
 *      lead activity, mail, gateway / bank / supplier references and free text.
 *      encloudlinks: only `target.reference` — `pushed` stays what encloud
 *      holds, so the next sync pushes the new number to open dues.
 *   3. Counters — each lib/sequence counter of a renamed series also gets its
 *      compact key (`invoice:ENV-2610A` → `invoice:ENV2610A`, $max of the seq),
 *      so a number freed by a delete is never reissued. Old documents are kept.
 *
 * Every change is recorded in `id_renames` { coll, field, docId, from, to, at }
 * (counters: field 'seq', docId = new key, plus `copiedFrom`), so it can be
 * audited or reversed. Re-running is a no-op; an interrupted run resumes, since
 * copies are also mapped through the renames recorded earlier.
 *
 * Writes go through the native driver: no Mongoose hooks (the Asset model
 * refuses tag changes) and no period locks — tax entries already in a filed
 * return are renamed too and counted in the report.
 *
 * After --apply, run a full encloud sweep (sweepEncloud({ full: true }),
 * lib/encloud/sync.js) so open dues carry the new invoice numbers.
 *
 * SAFETY: dry-run by default; pass --apply to write.
 *   npm run db:migrate-remove-id-hyphens [-- --apply]
 */

import 'dotenv/config'
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply') || process.env.npm_config_apply === 'true'
const RUN_AT = new Date()

// Hyphen and its look-alikes (non-breaking hyphen, en / em dash, minus), the dash
// set of lib/codes.js. Mongo's PCRE2 rejects \u escapes, so the regex source
// carries the characters themselves.
const DASH_CHARS = '-‐-―−'
const HAS_DASH = `[${DASH_CHARS}]`
const DASHES = new RegExp(HAS_DASH, 'g')
const compact = (v) => String(v).replace(DASHES, '')

// Record-number series. `re` is the shape the CRM generated; values that do not
// match are left alone (typed / external), except where `typed` is set.
const SERIES = [
  { key: 'project',   label: 'Project codes',          coll: 'projects',         field: 'projectCode',     re: /^[A-Z0-9]{1,4}P-\d{4}[A-Z]+\d{2}$/ },
  { key: 'invoice',   label: 'Invoice numbers',        coll: 'invoices',         field: 'invoiceNumber',   re: /^ENV-\d{4}A\d{3,}$/ },
  { key: 'combined',  label: 'Combined invoices',      coll: 'combinedinvoices', field: 'combinedNumber',  re: /^ENV-\d{4}C\d{3,}$/ },
  { key: 'client',    label: 'Client codes',           coll: 'clients',          field: 'clientCode',      re: /^ENCL-\d{4}[A-Z]+\d{3}$/ },
  { key: 'txn',       label: 'Transaction ids',        coll: 'transactions',     field: 'txnId',           re: /^TXN-\d{8}-\d{4,}$/ },
  { key: 'quotation', label: 'Quotations',             coll: 'quotations',       field: 'quotationNumber', re: /^QT-\d+$/ },
  { key: 'taxEntry',  label: 'Tax entries',            coll: 'taxentries',       field: 'entryNo',         re: /^TAX-\d{4}-\d{5,}$/ },
  { key: 'note',      label: 'Credit / debit notes',   coll: 'creditnotes',      field: 'noteNo',          re: /^(?:CN|DN)-\d{4}-\d{3,}$/ },
  { key: 'slip',      label: 'Salary slips',           coll: 'salaryslips',      field: 'slipNo',          re: /^SLP-\d{4}-\d{4,}$/ },
  { key: 'bill',      label: 'Purchase bills',         coll: 'purchasebills',    field: 'billNo',          re: /^PB-\d{4}-\d{4,}$/ },
  { key: 'movement',  label: 'Stock movements',        coll: 'stockmovements',   field: 'movementNo',      re: /^SM-\d{4}-\d{5,}$/ },
  { key: 'audit',     label: 'Asset audits',           coll: 'assetaudits',      field: 'auditNo',         re: /^AUD-\d{4}-\d{3,}$/ },
  { key: 'sku',       label: 'SKUs',                   coll: 'stockitems',       field: 'sku',             re: /^[A-Z0-9]{2,6}-\d{4}$/, typed: true },
  { key: 'assetTag',  label: 'Asset tags',             coll: 'assets',           field: 'assetTag',        re: /^(?:[A-Z0-9]{1,8}-)?[A-Z0-9]{2,6}-\d{5}$/ },
  { key: 'expenseId', label: 'Expense ids',            coll: 'projectexpenses',  field: 'expenseId',       re: /^EXP-\d{4}-\d{4,}$/ },
  { key: 'voucher',   label: 'Paid vouchers',          coll: 'projectexpenses',  field: 'expenseInvoiceNo', re: /^EXV-\d{4}-\d{4,}$/ },
  { key: 'batch',     label: 'Expense batches',        coll: 'projectexpenses',  field: 'batchInvoiceNo',  re: /^EXB-(?:\d{8}|MULTI)-[A-Z0-9]{1,12}(?:-\d+)?$/ },
  { key: 'letter',    label: 'Increment letters',      coll: 'salaryrevisions',  field: 'letterNo',        re: /^INC-\d{4}-\d{4,}$/ },
  // Only the certificates we issue; received ones share the field.
  { key: 'cert',      label: 'VDS / TDS certificates', coll: 'taxentries',       field: 'certificate.number', re: /^(?:VDS|TDS)-\d{4}-\d{3,}$/,
    filter: { entryType: { $in: ['VDS_PAYABLE', 'TDS_PAYABLE'] }, 'certificate.status': 'ISSUED' } },
  { key: 'employee',  label: 'Employee ids',           coll: 'employees',        field: 'employeeId',      re: /^[A-Z0-9]{1,4}-[A-Z]{2,6}\d{7,}$/, typed: true },
  // lib/inventory/depreciation.js posts (and a reversal copies) reference DEP-YYYY-MM.
  { key: 'dep',       label: 'Depreciation refs',      coll: 'transactions',     field: 'reference',       re: /^DEP-\d{4}-\d{2}$/,
    filter: { category: 'Depreciation' } },
]

// Structured copies, rewritten only where the value is an old number of a
// renamed record (`from` = the SERIES whose map applies). `array` = each element
// of that array; `prefix` = only a leading "[CODE] " of the text.
const COPIES = [
  { label: 'Credit notes: invoice no.',      coll: 'creditnotes',    field: 'invoiceNumber',     from: ['invoice'] },
  { label: 'Tax entries: document no.',      coll: 'taxentries',     field: 'documentNo',        from: ['invoice', 'note', 'assetTag', 'voucher', 'expenseId', 'txn'] },
  { label: 'Transactions: reference',        coll: 'transactions',   field: 'reference',         from: ['project', 'invoice', 'note', 'assetTag', 'bill'] },
  { label: 'Stock movements: reference',     coll: 'stockmovements', field: 'reference',         from: ['bill'] },
  // Supplier invoice numbers share the field: only the linked bill's own number.
  { label: 'Assets: purchase invoice ref',   coll: 'assets',         field: 'purchase.invoiceRef', from: ['bill'], linkedBill: true },
  { label: 'encloud dues: target reference', coll: 'encloudlinks',   field: 'target.reference',  from: ['invoice'], filter: { kind: 'DUE' } },
  { label: 'Asset audits: line tags',        coll: 'assetaudits',    array: 'lines',      field: 'assetTag', from: ['assetTag'] },
  { label: 'Asset audits: unexpected tags',  coll: 'assetaudits',    array: 'unexpected', field: 'tag',      from: ['assetTag'], distinct: true },
  { label: 'Invoice items: [CODE] prefix',   coll: 'invoices',       array: 'items',      field: 'description', from: ['project'], prefix: true },
  { label: 'Transactions: [CODE] prefix',    coll: 'transactions',   field: 'description',       from: ['project'], prefix: true },
]

// lib/sequence counter keys of the renamed series (namespace, then the prefix).
const COUNTER_KEYS = [
  /^invoice:ENV-\d{4}A$/, /^combinedInvoice:ENV-\d{4}C$/, /^project:[A-Z0-9]{1,4}P-\d{4}$/,
  /^txn:TXN-\d{8}-$/, /^creditnote:(?:CN|DN)-\d{4}-$/, /^taxentry:TAX-\d{4}-$/,
  /^taxcert:(?:VDS|TDS)-\d{4}-$/, /^purchasebill:PB-\d{4}-$/, /^stockmove:SM-\d{4}-$/,
  /^projectExpense:expenseId:EXP-\d{4}-$/, /^projectExpense:expenseInvoiceNo:EXV-\d{4}-$/,
  /^assetaudit:AUD-\d{4}-$/, /^salarySlip:SLP-\d{4}-$/, /^salaryRevision:INC-\d{4}-$/,
  /^asset:(?:[A-Z0-9]{1,8}-)?[A-Z0-9]{2,6}$/,
]

const PREFIX_RE = /^\[([^\]]+)\]/
const SAMPLES = 3

let db
let logged = 0

const get = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc)
const idKey = (coll, field, id) => `${coll}|${field}|${String(id)}`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
function* chunks(arr, size = 500) { for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size) }

async function log(coll, field, docId, from, to, extra = {}) {
  await db.collection('id_renames').insertOne({ coll, field, docId, from, to, at: RUN_AT, ...extra })
  logged++
}

// ── 1. Record numbers ────────────────────────────────────────────────────────

/** Groups of documents sharing one old number, minus the ones that would collide. */
async function planSeries(s, history) {
  const col = db.collection(s.coll)
  const rows = await col.find(
    { ...s.filter, [s.field]: { $type: 'string', $regex: HAS_DASH } },
    { projection: { [s.field]: 1 } },
  ).sort({ _id: 1 }).toArray()

  const groups = new Map()   // old number → { from, to, ids, typed }
  const foreign = []         // hyphenated, but not a number the CRM generated
  for (const r of rows) {
    const from = get(r, s.field)
    const generated = s.re.test(from)
    if (!generated && !s.typed) { foreign.push(from); continue }
    const to = compact(from)
    if (!to || to === from) continue
    if (!groups.has(from)) groups.set(from, { from, to, ids: [], typed: !generated })
    groups.get(from).ids.push(r._id)
  }

  // Rows are sorted by _id, so each target's groups are listed oldest first.
  const byTarget = new Map()
  for (const g of groups.values()) {
    if (!byTarget.has(g.to)) byTarget.set(g.to, [])
    byTarget.get(g.to).push(g)
  }
  const holders = new Map()  // compact number → ids of documents already holding it
  for (const part of chunks([...byTarget.keys()])) {
    const docs = await col.find({ [s.field]: { $in: part } }, { projection: { [s.field]: 1 } }).toArray()
    for (const d of docs) {
      const v = get(d, s.field)
      if (!holders.has(v)) holders.set(v, [])
      holders.get(v).push(d._id)
    }
  }

  const renames = []
  const skipped = []
  for (const [to, [first, ...rest]] of byTarget) {
    // A holder renamed from this same number by an earlier run is a resume, not a collision.
    const taken = (holders.get(to) ?? []).filter(id => history.get(idKey(s.coll, s.field, id))?.from !== first.from)
    if (taken.length) {
      const why = `${to} is already used by ${taken.slice(0, 3).join(', ')}${taken.length > 3 ? ` (+${taken.length - 3})` : ''}`
      for (const g of [first, ...rest]) skipped.push({ ...g, why })
      continue
    }
    renames.push(first)
    for (const g of rest) skipped.push({ ...g, why: `same compact form as ${first.from}, which is renamed instead` })
  }
  return { renames, skipped, foreign }
}

async function applySeries(s, renames, skipped) {
  const col = db.collection(s.coll)
  const done = []
  for (const g of renames) {
    let n = 0
    for (const _id of g.ids) {
      try {
        const res = await col.updateOne({ _id, [s.field]: g.from }, { $set: { [s.field]: g.to } })
        if (res.modifiedCount) { await log(s.coll, s.field, _id, g.from, g.to); n++ }
      } catch (err) {
        if (err?.code !== 11000) throw err
        skipped.push({ ...g, why: `the unique index refused ${g.to} (taken meanwhile)` })
        break
      }
    }
    if (n) done.push({ ...g, n })
  }
  return done
}

// ── 2. Copies ────────────────────────────────────────────────────────────────

/** The changes one copy definition needs: [{ _id, path, from, to }]. */
async function planCopy(c, map, billOld) {
  const path = c.array ? `${c.array}.${c.field}` : c.field
  const changes = []
  let left = 0
  if (!map.size) return { changes, left }

  const valueRe = c.prefix ? `^\\[[^\\]]*${HAS_DASH}` : HAS_DASH
  const projection = { [c.array ?? c.field]: 1, ...(c.linkedBill ? { 'purchase.billId': 1 } : {}) }
  const query = c.array && c.prefix
    // invoices.items may still be a JSON string on old rows
    ? { $or: [{ [path]: { $regex: valueRe } }, { [c.array]: { $type: 'string', $regex: `"\\[[^\\]]*${HAS_DASH}` } }] }
    : { [path]: { $type: 'string', $regex: valueRe } }
  const rows = await db.collection(c.coll).find({ ...c.filter, ...query }, { projection }).toArray()

  const mapped = (v) => {
    if (typeof v !== 'string') return null
    if (!c.prefix) return map.get(v) ?? null
    const m = PREFIX_RE.exec(v)
    const to = m && map.get(m[1])
    return to ? `[${to}]${v.slice(m[0].length)}` : null
  }

  for (const r of rows) {
    if (!c.array) {
      const from = get(r, c.field)
      const to = mapped(from)
      if (!to) continue
      if (c.linkedBill && r.purchase?.billId && billOld.get(String(r.purchase.billId)) !== from) { left++; continue }
      changes.push({ _id: r._id, path: c.field, from, to })
      continue
    }
    const raw = r[c.array]
    if (typeof raw === 'string') {
      let items
      try { items = JSON.parse(raw) } catch { continue }
      if (!Array.isArray(items)) continue
      let hit = false
      for (const it of items) {
        const to = mapped(it?.[c.field])
        if (to) { it[c.field] = to; hit = true }
      }
      if (hit) changes.push({ _id: r._id, path: c.array, from: raw, to: JSON.stringify(items) })
      continue
    }
    if (!Array.isArray(raw)) continue
    raw.forEach((it, i) => {
      const from = it?.[c.field]
      const to = mapped(from)
      if (!to) return
      // AssetAudit keeps one unexpected row per tag.
      if (c.distinct && raw.some(o => o?.[c.field] === to)) { left++; return }
      changes.push({ _id: r._id, path: `${c.array}.${i}.${c.field}`, from, to })
    })
  }
  return { changes, left }
}

async function applyCopy(c, changes) {
  const col = db.collection(c.coll)
  let n = 0
  for (const ch of changes) {
    const res = await col.updateOne({ _id: ch._id, [ch.path]: ch.from }, { $set: { [ch.path]: ch.to } })
    if (res.modifiedCount) { await log(c.coll, ch.path, ch._id, ch.from, ch.to); n++ }
  }
  return n
}

// ── 3. Counters ──────────────────────────────────────────────────────────────

async function planCounters() {
  const counters = db.collection('counters')
  const rows = await counters.find({ _id: { $type: 'string', $regex: '-' } }).toArray()
  const plan = []
  const foreign = []
  for (const r of rows) {
    if (!COUNTER_KEYS.some(re => re.test(r._id))) { foreign.push(r._id); continue }
    const cut = r._id.lastIndexOf(':') + 1
    const key = `${r._id.slice(0, cut)}${compact(r._id.slice(cut))}`
    const seq = Number(r.seq) || 0
    const cur = await counters.findOne({ _id: key })
    const had = cur ? Number(cur.seq) || 0 : null
    if (had !== null && had >= seq) continue
    plan.push({ from: r._id, key, seq, had })
  }
  return { plan, foreign }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  await mongoose.connect(uri)
  db = mongoose.connection.db
  console.log(`Remove hyphens from record numbers: ${APPLY ? 'APPLY' : 'DRY RUN'} on database "${db.databaseName}"\n`)

  // Rows still holding ciphertext cannot be matched; decrypt them first.
  const fields = [
    ...SERIES.map(s => [s.coll, s.field]),
    ...COPIES.map(c => [c.coll, c.array ? `${c.array}.${c.field}` : c.field]),
    ['invoices', 'items'],
  ]
  for (const [coll, path] of fields) {
    const n = await db.collection(coll).countDocuments({ [path]: { $regex: '^enc:v1:' } })
    if (n) console.log(`⚠ ${coll}.${path}: ${plural(n, 'row')} still encrypted (enc:v1:) cannot be checked; run npm run db:decrypt first`)
  }

  const history = new Map()
  for (const h of await db.collection('id_renames').find({}, { projection: { coll: 1, field: 1, docId: 1, from: 1, to: 1 } }).toArray()) {
    history.set(idKey(h.coll, h.field, h.docId), h)
  }

  // ── 1. Record numbers
  console.log('Record numbers')
  const maps = {}            // series key → Map(old → new)
  const billOld = new Map()  // purchase bill id → its old billNo
  const skippedAll = []
  const foreignAll = []
  const taxIds = []
  let renamedDocs = 0
  for (const s of SERIES) {
    const { renames, skipped, foreign } = await planSeries(s, history)
    const done = APPLY ? await applySeries(s, renames, skipped) : renames.map(g => ({ ...g, n: g.ids.length }))
    const docs = done.reduce((t, g) => t + g.n, 0)
    const typed = done.filter(g => g.typed).length
    renamedDocs += docs
    const where = `${s.coll}.${s.field}`
    console.log(`  ${s.label.padEnd(24)} ${where.padEnd(36)} ${String(docs).padStart(5)} ${APPLY ? 'renamed' : 'to rename'}` +
      `${done.length !== docs ? ` (${plural(done.length, 'number')})` : ''}` +
      `${typed ? `, ${typed} typed` : ''}${skipped.length ? `, ${skipped.length} skipped` : ''}`)
    if (!APPLY) for (const g of done.slice(0, SAMPLES)) console.log(`      ${g.from} → ${g.to}`)

    const map = new Map(done.map(g => [g.from, g.to]))
    for (const h of history.values()) {
      if (h.coll === s.coll && h.field === s.field && typeof h.from === 'string' && (s.typed || s.re.test(h.from))) map.set(h.from, h.to)
    }
    maps[s.key] = map
    if (s.key === 'bill') {
      for (const g of done) for (const id of g.ids) billOld.set(String(id), g.from)
      for (const h of history.values()) if (h.coll === 'purchasebills' && h.field === 'billNo') billOld.set(String(h.docId), h.from)
    }
    if (s.coll === 'taxentries') for (const g of done) taxIds.push(...g.ids)
    for (const g of skipped) skippedAll.push({ where, ...g })
    if (foreign.length) foreignAll.push({ where, values: foreign })
  }

  // ── 2. Copies
  console.log('\nCopies')
  let copied = 0
  for (const c of COPIES) {
    const map = new Map(c.from.flatMap(k => [...maps[k]]))
    const { changes, left } = await planCopy(c, map, billOld)
    const n = APPLY ? await applyCopy(c, changes) : changes.length
    copied += n
    const where = `${c.coll}.${c.array ? `${c.array}[].` : ''}${c.field}`
    console.log(`  ${c.label.padEnd(32)} ${where.padEnd(32)} ${String(n).padStart(5)} ${APPLY ? 'rewritten' : 'to rewrite'}` +
      `${left ? `, ${left} left (${c.linkedBill ? 'not the linked bill\'s number' : 'already listed under the new tag'})` : ''}`)
    if (!APPLY) for (const ch of changes.slice(0, SAMPLES)) console.log(`      ${String(ch.from).slice(0, 70)} → ${String(ch.to).slice(0, 70)}`)
    if (c.coll === 'taxentries') taxIds.push(...changes.map(ch => ch._id))
  }

  if (taxIds.length) {
    const filed = await db.collection('taxentries').countDocuments({
      _id: { $in: taxIds }, $or: [{ filingId: { $ne: null } }, { claimPeriod: { $ne: null } }],
    })
    if (filed) console.log(`\n  ${plural(filed, 'tax entry', 'tax entries')} of a filed return ${filed === 1 ? 'is' : 'are'} included; taxfilings.snapshot keeps the numbers as filed.`)
  }

  // ── 3. Counters
  console.log('\nCounters')
  const { plan: counterPlan, foreign: counterForeign } = await planCounters()
  for (const p of counterPlan) {
    if (APPLY) {
      await db.collection('counters').updateOne({ _id: p.key }, { $max: { seq: p.seq } }, { upsert: true })
      await log('counters', 'seq', p.key, p.had, p.seq, { copiedFrom: p.from })
    }
    console.log(`  ${p.from} → ${p.key}  seq ${p.seq}${p.had === null ? ' (new key)' : ` (was ${p.had})`}`)
  }
  if (!counterPlan.length) console.log('  nothing to carry over')
  if (counterForeign.length) console.log(`  left as is (not a renamed series): ${counterForeign.join(', ')}`)

  // ── Report
  if (skippedAll.length) {
    console.log(`\n⚠ ${plural(skippedAll.length, 'number')} skipped (collision), left unchanged; resolve by hand:`)
    for (const g of skippedAll) console.log(`  ${g.where}  ${g.from} → ${g.to}  (${plural(g.ids.length, 'document')}): ${g.why}`)
  }
  if (foreignAll.length) {
    console.log('\nHyphenated values left as is (not a number the CRM generated):')
    for (const f of foreignAll) {
      console.log(`  ${f.where}: ${f.values.length}  e.g. ${f.values.slice(0, 5).map(v => JSON.stringify(v)).join(', ')}`)
    }
  }

  console.log(`\nTotal: ${plural(renamedDocs, 'record')} ${APPLY ? 'renamed' : 'to rename'}, ${plural(copied, 'copy', 'copies')}` +
    ` ${APPLY ? 'rewritten' : 'to rewrite'}, ${plural(counterPlan.length, 'counter')}, ${skippedAll.length} skipped.`)
  if (APPLY) {
    await db.collection('id_renames').createIndex({ coll: 1, field: 1, docId: 1 }, { name: 'coll_field_doc' })
    console.log(`Recorded ${plural(logged, 'change')} in id_renames (at ${RUN_AT.toISOString()}).`)
    if (logged) console.log('Next: run a full encloud sweep so open dues carry the new invoice numbers.')
  } else {
    console.log('Dry run only — re-run with --apply to write.')
  }

  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
