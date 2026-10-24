export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, AssetAudit, AssetEvent } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { createNotification } from '@/lib/createNotification'
import { CONDITIONS, AUDIT_RESULTS, AUDIT_RESULT_META, STATUS_META } from '@/lib/inventory/constants'
import { inventoryManagerUserIds } from '@/app/api/my-assets/_lib/shared'
import {
  auditGuard, oid, parseScan, tagMatch, tagsIn, noUnexpectedTag, serialQuery, SUMMARY_STAGE, lineMergeStage,
  locationMap, isWithin, locationPath, buildAuditDetail, summaryOf,
} from '../_lib/audit'
import { z } from 'zod'

const optionalId = z.preprocess(
  v => (v === '' || v === undefined ? null : v),
  z.string().refine(isValidObjectId, 'Invalid id').nullable(),
)
const optionalText = (max) => z.preprocess(
  v => (typeof v === 'string' ? (v.trim() || null) : v),
  z.string().max(max, `Keep it under ${max} characters`).nullable().optional(),
)
const optionalCondition = z.preprocess(v => (v === '' ? null : v), z.enum(CONDITIONS).nullable().optional())

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('scan'), tag: z.string().trim().min(1, 'Scan or type a tag').max(500), condition: optionalCondition, locationId: optionalId.optional(), note: optionalText(500) }),
  z.object({ action: z.literal('mark'), assetId: z.string().refine(isValidObjectId, 'Invalid asset'), result: z.enum(AUDIT_RESULTS), condition: optionalCondition, locationId: optionalId.optional(), note: optionalText(500) }),
  z.object({ action: z.literal('unexpected'), tag: optionalText(100), description: optionalText(500), note: optionalText(500) }),
  z.object({ action: z.literal('remove_unexpected'), index: z.number().int().min(0), tag: z.string().nullable().optional(), description: z.string().nullable().optional() }),
  z.object({ action: z.literal('update'), name: z.string().trim().min(1, 'Name is required').max(120).optional(), notes: optionalText(2000) }),
  z.object({ action: z.literal('complete'), notes: optionalText(2000) }),
  z.object({ action: z.literal('cancel'), reason: optionalText(500) }),
])

const NOT_RUNNING = 'This audit is no longer in progress'
const CHUNK = 500

const httpError = (status, message, extra = {}) => NextResponse.json({ error: message, ...extra }, { status })
const str = (v) => (v === null || v === undefined ? null : String(v))
/** 422 for a counting / found-at location id that is not in the register (the page clears its saved choice on this code). */
const unknownLocation = () => httpError(422, 'Location not found', { code: 'UNKNOWN_LOCATION' })

async function loadState(id) {
  return AssetAudit.findById(id).select('auditNo name status locationId categoryId summary').lean()
}

async function loadFull(id) {
  return AssetAudit.findById(id).populate({ path: 'categoryId', select: 'name code' }).lean()
}

function scanLineResult(line, { condition, locationId }, locs) {
  if (condition === 'BROKEN') return 'DAMAGED'
  if (locationId && line.expectedLocationId && !isWithin(locationId, line.expectedLocationId, locs)) return 'WRONG_LOCATION'
  return 'FOUND'
}

// ── scan ─────────────────────────────────────────────────────────────────────
async function handleScan(audit, data, session) {
  const { tag, assetId: idFromUrl, raw } = parseScan(data.tag)
  if (!tag && !idFromUrl) return httpError(422, 'Scan or type a tag')
  // Old labels (EN-LAP-00042) and new tags (ENLAP00042) are the same asset.
  const byTag = tag ? tagMatch(tag) : null

  const lineByTag = async (t) => (await AssetAudit.findOne({ _id: audit._id }, { lines: { $elemMatch: { assetTag: t } } }).lean())?.lines?.[0] ?? null
  const lineByAsset = async (aid) => (await AssetAudit.findOne({ _id: audit._id }, { lines: { $elemMatch: { assetId: oid(aid) } } }).lean())?.lines?.[0] ?? null
  const ASSET_FIELDS = 'assetTag name status locationId serialNumber'

  let line = byTag ? await lineByTag(byTag) : null
  let asset = null
  if (!line) {
    if (idFromUrl) asset = await Asset.findById(idFromUrl).select(ASSET_FIELDS).lean()
    if (!asset && byTag) asset = await Asset.findOne({ assetTag: byTag }).select(ASSET_FIELDS).lean()
    if (!asset && raw && raw.length <= 100) {
      const bySerial = await Asset.find(serialQuery(raw)).select(ASSET_FIELDS).limit(2).lean()
      if (bySerial.length === 1) asset = bySerial[0]
    }
    if (asset) line = await lineByAsset(asset._id)
  }

  const locs = await locationMap()
  // The counting location must exist (it may have been deleted while selected).
  if (data.locationId && !locs.has(String(data.locationId))) return unknownLocation()

  // Registered but not expected in this audit → record it as unexpected (once).
  if (!line && asset) {
    const statusText = STATUS_META[asset.status]?.label ?? asset.status
    const where = asset.locationId ? locationPath(asset.locationId, locs) : null
    const entry = {
      tag: asset.assetTag,
      description: `${asset.name} — registered asset (${statusText}${where ? ` at ${where}` : ''}), not expected in this audit`,
      note: data.note ?? null,
    }
    const updated = await AssetAudit.findOneAndUpdate(
      { _id: audit._id, status: 'IN_PROGRESS', ...noUnexpectedTag(asset.assetTag) },
      { $push: { unexpected: entry } },
      { new: true, projection: { unexpected: 1, summary: 1, status: 1 } },
    ).lean()
    if (!updated) {
      const now = await loadState(audit._id)
      if (now?.status !== 'IN_PROGRESS') return httpError(409, NOT_RUNNING)
      return NextResponse.json({ data: { outcome: 'ALREADY_UNEXPECTED', tag: asset.assetTag, message: `${asset.assetTag} is already recorded as unexpected` } })
    }
    return NextResponse.json({
      data: {
        outcome: 'OUT_OF_SCOPE',
        tag: asset.assetTag,
        assetName: asset.name,
        message: `${asset.assetTag} is registered but not expected here — recorded as unexpected`,
        unexpected: (updated.unexpected ?? []).map((u, index) => ({ index, tag: u.tag ?? null, description: u.description ?? null, note: u.note ?? null })),
        summary: updated.summary,
      },
    })
  }

  if (!line) {
    return httpError(404, `No asset with tag or serial "${tag ?? raw}"`, { code: 'UNKNOWN_TAG', tag: tag ?? raw })
  }

  if (line.result !== 'PENDING') {
    return NextResponse.json({
      data: {
        outcome: 'ALREADY',
        tag: line.assetTag,
        assetName: line.assetName,
        message: `${line.assetTag} was already counted (${AUDIT_RESULT_META[line.result]?.label ?? line.result})`,
        line: { assetId: str(line.assetId), result: line.result },
      },
    })
  }

  const result = scanLineResult(line, data, locs)
  const now = new Date()
  const patch = {
    result,
    condition:       data.condition ?? null,
    foundLocationId: data.locationId ? oid(data.locationId) : null,
    checkedAt:       now,
    checkedBy:       oid(session.user.id),
    note:            data.note ?? line.note ?? null,
  }
  const updated = await AssetAudit.findOneAndUpdate(
    { _id: audit._id, status: 'IN_PROGRESS', lines: { $elemMatch: { assetId: line.assetId, result: 'PENDING' } } },
    [lineMergeStage(line.assetId, patch), SUMMARY_STAGE],
    { new: true, projection: { summary: 1 } },
  ).lean()

  if (!updated) {
    const state = await loadState(audit._id)
    if (state?.status !== 'IN_PROGRESS') return httpError(409, NOT_RUNNING)
    const fresh = await lineByAsset(line.assetId)
    return NextResponse.json({
      data: {
        outcome: 'ALREADY',
        tag: line.assetTag,
        assetName: line.assetName,
        message: `${line.assetTag} was just counted by someone else`,
        line: fresh ? { assetId: str(fresh.assetId), result: fresh.result, condition: fresh.condition ?? null, note: fresh.note ?? null, checkedAt: fresh.checkedAt ?? null } : null,
        summary: state.summary,
      },
    })
  }

  const messages = {
    FOUND: `${line.assetTag} found`,
    DAMAGED: `${line.assetTag} recorded as damaged`,
    WRONG_LOCATION: `${line.assetTag} is in the wrong place — expected at ${locationPath(line.expectedLocationId, locs) ?? 'another location'}`,
  }
  return NextResponse.json({
    data: {
      outcome: result,
      tag: line.assetTag,
      assetName: line.assetName,
      message: messages[result],
      line: {
        assetId:       str(line.assetId),
        result,
        condition:     patch.condition,
        note:          patch.note,
        checkedAt:     now,
        checkedByName: session.user.name ?? null,
        foundLocation: data.locationId ? { id: data.locationId, name: locationPath(data.locationId, locs) } : null,
      },
      summary: updated.summary,
    },
  })
}

// ── mark (manual result / correction) ────────────────────────────────────────
async function handleMark(audit, data, session, request) {
  const now = new Date()
  const reset = data.result === 'PENDING'
  const patch = reset
    ? { result: 'PENDING', condition: null, foundLocationId: null, checkedAt: null, checkedBy: null }
    : {
      result: data.result,
      checkedAt: now,
      checkedBy: oid(session.user.id),
      ...(data.condition !== undefined ? { condition: data.condition } : {}),
      ...(data.locationId !== undefined ? { foundLocationId: data.locationId ? oid(data.locationId) : null } : {}),
    }
  if (data.note !== undefined) patch.note = data.note

  // A reset ignores the location; otherwise it must be a real one.
  const locs = data.locationId ? await locationMap() : null
  if (!reset && data.locationId && !locs.has(String(data.locationId))) return unknownLocation()

  const before = (await AssetAudit.findOne({ _id: audit._id }, { lines: { $elemMatch: { assetId: oid(data.assetId) } } }).lean())?.lines?.[0]
  if (!before) return httpError(404, 'That asset is not part of this audit')

  const updated = await AssetAudit.findOneAndUpdate(
    { _id: audit._id, status: 'IN_PROGRESS', 'lines.assetId': oid(data.assetId) },
    [lineMergeStage(data.assetId, patch), SUMMARY_STAGE],
    { new: true, projection: { summary: 1 } },
  ).lean()
  if (!updated) return httpError(409, NOT_RUNNING)

  if (before.result !== data.result) {
    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'ASSET_AUDIT',
      entityId: str(audit._id),
      changes:  JSON.stringify({ auditNo: audit.auditNo, assetTag: before.assetTag, result: { from: before.result, to: data.result }, ...(data.note ? { note: data.note } : {}) }),
      request,
    })
  }

  return NextResponse.json({
    data: {
      outcome: data.result,
      line: {
        assetId:       data.assetId,
        result:        data.result,
        condition:     reset ? null : (patch.condition !== undefined ? patch.condition : before.condition ?? null),
        note:          patch.note !== undefined ? patch.note : before.note ?? null,
        checkedAt:     reset ? null : now,
        checkedByName: reset ? null : session.user.name ?? null,
        foundLocation: reset ? null : data.locationId
          ? { id: data.locationId, name: locationPath(data.locationId, locs) }
          : (data.locationId === undefined && before.foundLocationId ? { id: str(before.foundLocationId), name: null } : null),
      },
      summary: updated.summary,
    },
  })
}

// ── unexpected items ─────────────────────────────────────────────────────────
async function handleUnexpected(audit, data, session, request) {
  const typed = data.tag ? parseScan(data.tag).tag : null
  if (!typed && !data.description) return httpError(422, 'Enter the tag or a short description of the item')
  const byTag = typed ? tagMatch(typed) : null

  if (byTag) {
    const expected = (await AssetAudit.findOne({ _id: audit._id }, { lines: { $elemMatch: { assetTag: byTag } } }).lean())?.lines?.[0]
    if (expected) return httpError(422, `${expected.assetTag ?? typed} is on the expected list — scan it instead`)
  }
  // A registered asset is recorded under its own tag, however the label spells it.
  const asset = byTag ? await Asset.findOne({ assetTag: byTag }).select('assetTag name status').lean() : null
  const tag = asset?.assetTag ?? typed
  let description = data.description
  if (tag && !description) {
    description = asset ? `${asset.name} — registered asset (${STATUS_META[asset.status]?.label ?? asset.status}), not expected in this audit` : 'Item with an unregistered tag'
  }

  const updated = await AssetAudit.findOneAndUpdate(
    { _id: audit._id, status: 'IN_PROGRESS', ...(tag ? noUnexpectedTag(tag) : {}) },
    { $push: { unexpected: { tag, description, note: data.note ?? null } } },
    { new: true, projection: { unexpected: 1 } },
  ).lean()
  if (!updated) {
    const state = await loadState(audit._id)
    if (state?.status !== 'IN_PROGRESS') return httpError(409, NOT_RUNNING)
    return httpError(409, `${tag} is already recorded as unexpected`)
  }

  logActivity({
    userId:   session.user.id,
    userRole: session.user.role,
    action:   'UPDATE',
    entity:   'ASSET_AUDIT',
    entityId: str(audit._id),
    changes:  JSON.stringify({ auditNo: audit.auditNo, unexpected: { tag, description } }),
    request,
  })

  return NextResponse.json({
    data: {
      outcome: 'UNEXPECTED_ADDED',
      unexpected: (updated.unexpected ?? []).map((u, index) => ({ index, tag: u.tag ?? null, description: u.description ?? null, note: u.note ?? null })),
    },
  }, { status: 201 })
}

async function handleRemoveUnexpected(audit, data, session, request) {
  const i = data.index
  const updated = await AssetAudit.findOneAndUpdate(
    {
      _id: audit._id,
      status: 'IN_PROGRESS',
      [`unexpected.${i}`]: { $exists: true },
      [`unexpected.${i}.tag`]: data.tag ?? null,
      [`unexpected.${i}.description`]: data.description ?? null,
    },
    [{
      $set: {
        unexpected: {
          $map: {
            input: { $filter: { input: { $range: [0, { $size: '$unexpected' }] }, as: 'i', cond: { $ne: ['$$i', i] } } },
            as: 'i',
            in: { $arrayElemAt: ['$unexpected', '$$i'] },
          },
        },
        updatedAt: '$$NOW',
      },
    }],
    { new: true, projection: { unexpected: 1 } },
  ).lean()
  if (!updated) {
    const state = await loadState(audit._id)
    if (state?.status !== 'IN_PROGRESS') return httpError(409, NOT_RUNNING)
    return httpError(409, 'The list changed — refresh and try again')
  }

  logActivity({
    userId:   session.user.id,
    userRole: session.user.role,
    action:   'UPDATE',
    entity:   'ASSET_AUDIT',
    entityId: str(audit._id),
    changes:  JSON.stringify({ auditNo: audit.auditNo, unexpectedRemoved: { tag: data.tag ?? null, description: data.description ?? null } }),
    request,
  })

  return NextResponse.json({
    data: { unexpected: (updated.unexpected ?? []).map((u, index) => ({ index, tag: u.tag ?? null, description: u.description ?? null, note: u.note ?? null })) },
  })
}

// ── complete ─────────────────────────────────────────────────────────────────
async function handleComplete(audit, data, session, request) {
  const completedAt = new Date()
  const uid = oid(session.user.id)
  const notesStage = data.notes
    ? [{ $set: { notes: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$notes', ''] } }, 0] }, { $concat: ['$notes', '\n', { $literal: data.notes }] }, { $literal: data.notes }] } } }]
    : []

  // Claim atomically: unchecked lines become MISSING, status COMPLETED, summary recomputed.
  const done = await AssetAudit.findOneAndUpdate(
    { _id: audit._id, status: 'IN_PROGRESS' },
    [
      {
        $set: {
          lines: {
            $map: {
              input: '$lines',
              as: 'l',
              in: {
                $cond: [
                  { $eq: ['$$l.result', 'PENDING'] },
                  { $mergeObjects: ['$$l', { result: 'MISSING', note: { $ifNull: ['$$l.note', { $literal: 'Not found before the audit was completed' }] } }] },
                  '$$l',
                ],
              },
            },
          },
          status: 'COMPLETED',
          completedAt: { $literal: completedAt },
          completedBy: { $literal: uid },
        },
      },
      ...notesStage,
      SUMMARY_STAGE,
    ],
    { new: true },
  ).lean()
  if (!done) return httpError(409, NOT_RUNNING)

  const warnings = []
  const lines = done.lines ?? []
  const assetIds = lines.map(l => l.assetId)
  const assets = await Asset.find({ _id: { $in: assetIds } }).select('status locationId assignedEmployeeId assignedDepartmentId condition').lean()
  const assetById = new Map(assets.map(a => [str(a._id), a]))

  // Registered assets recorded as unexpected were also physically seen (tags
  // recorded in the old hyphenated form still match).
  const unexpectedTags = tagsIn((done.unexpected ?? []).map(u => u.tag))
  const lineIdSet = new Set(assetIds.map(str))
  const outsiders = unexpectedTags
    ? (await Asset.find({ assetTag: unexpectedTags }).select('assetTag status locationId assignedEmployeeId assignedDepartmentId condition').lean())
      .filter(a => !lineIdSet.has(str(a._id)))
    : []

  const actorName = session.user.name ?? session.user.email ?? null
  const eventDoc = (a, assetId, result, extra) => ({
    assetId,
    type: 'AUDIT_VERIFIED',
    date: completedAt,
    fromStatus: a?.status ?? null,
    toStatus: a?.status ?? null,
    fromLocationId: a?.locationId ?? null,
    toLocationId: extra.foundLocationId ?? a?.locationId ?? null,
    fromEmployeeId: a?.assignedEmployeeId ?? null,
    toEmployeeId: a?.assignedEmployeeId ?? null,
    departmentId: a?.assignedDepartmentId ?? null,
    condition: extra.condition ?? null,
    amount: null,
    vendorId: null,
    details: {
      auditId: str(done._id),
      auditNo: done.auditNo ?? null,
      result,
      expectedLocationId: str(extra.expectedLocationId),
      foundLocationId: str(extra.foundLocationId),
      conditionBefore: a?.condition ?? null,
      checkedAt: extra.checkedAt ?? null,
      checkedBy: str(extra.checkedBy),
      note: extra.note ?? null,
    },
    attachments: [],
    notes: `${done.auditNo ?? 'Audit'}: ${AUDIT_RESULT_META[result]?.label ?? result.replace(/_/g, ' ').toLowerCase()}${extra.note ? ` — ${extra.note}` : ''}`,
    transactionId: null,
    expenseId: null,
    createdBy: uid,
    createdByName: actorName,
  })

  const events = [
    ...lines.map(l => eventDoc(assetById.get(str(l.assetId)), l.assetId, l.result, l)),
    ...outsiders.map(a => eventDoc(a, a._id, 'FOUND_OUTSIDE_SCOPE', { note: 'Found during the audit outside its scope' })),
  ]
  const assetOps = [
    ...lines.filter(l => assetById.has(str(l.assetId))).map(l => {
      const set = { lastAuditAt: completedAt, lastAuditResult: l.result }
      if (l.result !== 'MISSING' && CONDITIONS.includes(l.condition)) set.condition = l.condition
      return { updateOne: { filter: { _id: l.assetId }, update: { $set: set } } }
    }),
    ...outsiders.map(a => ({ updateOne: { filter: { _id: a._id }, update: { $set: { lastAuditAt: completedAt, lastAuditResult: 'FOUND_OUTSIDE_SCOPE' } } } })),
  ]

  let eventsWritten = 0
  for (let i = 0; i < events.length; i += CHUNK) {
    try {
      const res = await AssetEvent.insertMany(events.slice(i, i + CHUNK), { ordered: false })
      eventsWritten += res.length
    } catch (err) {
      eventsWritten += Array.isArray(err?.insertedDocs) ? err.insertedDocs.length : 0
      console.error('[PUT /api/inventory/audits/[id]] audit events', err)
    }
  }
  if (eventsWritten < events.length) warnings.push(`${events.length - eventsWritten} audit history entr${events.length - eventsWritten === 1 ? 'y' : 'ies'} could not be written`)

  let assetsUpdated = 0
  for (let i = 0; i < assetOps.length; i += CHUNK) {
    try {
      const res = await Asset.bulkWrite(assetOps.slice(i, i + CHUNK), { ordered: false })
      assetsUpdated += res.modifiedCount ?? 0
    } catch (err) {
      console.error('[PUT /api/inventory/audits/[id]] asset updates', err)
      warnings.push('Some assets could not be stamped with the audit date')
    }
  }

  const s = done.summary ?? summaryOf(lines)
  logActivity({
    userId:   session.user.id,
    userRole: session.user.role,
    action:   'STATUS_CHANGE',
    entity:   'ASSET_AUDIT',
    entityId: str(done._id),
    changes:  JSON.stringify({ auditNo: done.auditNo, status: { from: 'IN_PROGRESS', to: 'COMPLETED' }, summary: s, unexpected: (done.unexpected ?? []).length }),
    request,
  })

  const issues = (s.missing ?? 0) + (s.damaged ?? 0) + (s.wrongLocation ?? 0) + (done.unexpected ?? []).length
  if (issues > 0) {
    const recipients = await inventoryManagerUserIds({ perms: ['inventory.manage', 'inventory.dispose'], excludeUserId: session.user.id })
    if (recipients.length) {
      const parts = [
        s.missing ? `${s.missing} missing` : null,
        s.damaged ? `${s.damaged} damaged` : null,
        s.wrongLocation ? `${s.wrongLocation} in the wrong place` : null,
        (done.unexpected ?? []).length ? `${done.unexpected.length} unexpected` : null,
      ].filter(Boolean)
      createNotification({
        userId:  recipients,
        type:    'ASSET',
        title:   `Audit ${done.auditNo ?? ''} completed`.trim(),
        message: `${done.name}: ${parts.join(', ')}. Review and decide — nothing is written off automatically.`,
        link:    `/admin/inventory/audits/${done._id}`,
      }).catch(() => {})
    }
  }

  const detail = await buildAuditDetail(await loadFull(done._id) ?? done)
  return NextResponse.json({ data: detail, meta: { eventsWritten, assetsUpdated, warnings } })
}

// ── cancel / update ──────────────────────────────────────────────────────────
async function handleCancel(audit, data, session, request) {
  const now = new Date()
  const note = data.reason ? `Cancelled: ${data.reason}` : 'Cancelled'
  const updated = await AssetAudit.findOneAndUpdate(
    { _id: audit._id, status: 'IN_PROGRESS' },
    [{
      $set: {
        status: 'CANCELLED',
        completedAt: { $literal: now },
        completedBy: { $literal: oid(session.user.id) },
        notes: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$notes', ''] } }, 0] }, { $concat: ['$notes', '\n', { $literal: note }] }, { $literal: note }] },
        updatedAt: '$$NOW',
      },
    }],
    { new: true },
  ).lean()
  if (!updated) return httpError(409, NOT_RUNNING)

  logActivity({
    userId:   session.user.id,
    userRole: session.user.role,
    action:   'STATUS_CHANGE',
    entity:   'ASSET_AUDIT',
    entityId: str(audit._id),
    changes:  JSON.stringify({ auditNo: audit.auditNo, status: { from: 'IN_PROGRESS', to: 'CANCELLED' }, ...(data.reason ? { reason: data.reason } : {}) }),
    request,
  })

  return NextResponse.json({ data: await buildAuditDetail(await loadFull(updated._id) ?? updated) })
}

async function handleUpdate(audit, data, session, request) {
  const set = {}
  if (data.name !== undefined) set.name = data.name
  if (data.notes !== undefined) set.notes = data.notes
  if (!Object.keys(set).length) return httpError(422, 'Nothing to update')

  const updated = await AssetAudit.findOneAndUpdate({ _id: audit._id }, { $set: set }, { new: true }).lean()
  if (!updated) return httpError(404, 'Not found')

  logActivity({
    userId:   session.user.id,
    userRole: session.user.role,
    action:   'UPDATE',
    entity:   'ASSET_AUDIT',
    entityId: str(audit._id),
    changes:  JSON.stringify({
      auditNo: audit.auditNo,
      ...(set.name !== undefined && set.name !== audit.name ? { name: { from: audit.name, to: set.name } } : {}),
      ...(set.notes !== undefined ? { notes: 'updated' } : {}),
    }),
    request,
  })

  return NextResponse.json({ data: { id: str(updated._id), name: updated.name, notes: updated.notes ?? null } })
}

// GET /api/inventory/audits/[id] → { data: audit with enriched lines & unexpected items }
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = auditGuard(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return httpError(404, 'Not found')

    await connectDB()
    const audit = await loadFull(params.id)
    if (!audit) return httpError(404, 'Not found')

    return NextResponse.json({ data: await buildAuditDetail(audit) })
  } catch (err) {
    console.error('[GET /api/inventory/audits/[id]]', err)
    return httpError(500, 'Internal server error')
  }
}

// PUT /api/inventory/audits/[id]
//   { action:'scan', tag, condition?, locationId?, note? }
//   { action:'mark', assetId, result, condition?, locationId?, note? }
//   { action:'unexpected', tag?, description?, note? }
//   { action:'remove_unexpected', index, tag, description }
//   { action:'update', name?, notes? }
//   { action:'complete', notes? }   — unchecked ⇒ MISSING; AUDIT_VERIFIED events; nothing is written off
//   { action:'cancel', reason? }
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = auditGuard(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return httpError(404, 'Not found')

    let body
    try { body = await request.json() } catch { body = {} }
    const parsed = schema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const data = parsed.data

    await connectDB()
    const audit = await loadState(params.id)
    if (!audit) return httpError(404, 'Not found')
    if (data.action !== 'update' && audit.status !== 'IN_PROGRESS') return httpError(409, NOT_RUNNING)

    switch (data.action) {
      case 'scan':              return await handleScan(audit, data, session)
      case 'mark':              return await handleMark(audit, data, session, request)
      case 'unexpected':        return await handleUnexpected(audit, data, session, request)
      case 'remove_unexpected': return await handleRemoveUnexpected(audit, data, session, request)
      case 'update':            return await handleUpdate(audit, data, session, request)
      case 'complete':          return await handleComplete(audit, data, session, request)
      case 'cancel':            return await handleCancel(audit, data, session, request)
      default:                  return httpError(400, 'Unknown action')
    }
  } catch (err) {
    console.error('[PUT /api/inventory/audits/[id]]', err)
    return httpError(err.status ?? 500, err.status ? err.message : 'Internal server error')
  }
}
