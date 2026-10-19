export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxCode, TaxEntry } from '@/models'
import { requirePerm, requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { normalizeTaxCode } from '@/lib/tax/engine'
import { VAT_TREATMENT_VALUES, taxCodeProblems } from '@/lib/tax/catalog'
import { z } from 'zod'

const empty = (v) => v === undefined || v === null || v === ''
const rate = z.preprocess(v => (empty(v) ? null : v), z.coerce.number().finite().min(0).max(100).nullable())
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optText = (max) => z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(max).nullable())

const updateSchema = z.object({
  code:           z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dot, dash or underscore').optional(),
  label:          z.string().trim().min(1).max(200).optional(),
  description:    optText(2000).optional(),
  vatRate:        rate.optional(),
  vdsRate:        rate.optional(),
  treatment:      z.preprocess(v => (empty(v) ? null : v), z.enum(VAT_TREATMENT_VALUES).nullable()).optional(),
  section:        optText(10).optional(),
  rateCompany:    rate.optional(),
  rateIndividual: rate.optional(),
  basis:          z.enum(['GROSS', 'COMMISSION_OR_GROSS']).optional(),
  commissionRate: rate.optional(),
  grossRate:      rate.optional(),
  effectiveFrom:  dayStr.optional(),
  effectiveTo:    z.preprocess(v => (empty(v) ? null : v), dayStr.nullable()).optional(),
  isActive:       z.boolean().optional(),
  sortOrder:      z.coerce.number().int().min(0).max(100000).optional(),
  notes:          optText(2000).optional(),
})

// Fields that identify a system (catalog) code — immutable; a rate change is a new version.
const SYSTEM_IDENTITY = ['code', 'effectiveFrom']

const dayOf = (d) => (d ? dhakaDayKey(d) : null)

// GET /api/tax/codes/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const code = await TaxCode.findById(params.id).lean()
    if (!code) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: normalizeTaxCode(code) })
  } catch (err) {
    console.error('[GET /api/tax/codes/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/tax/codes/[id] — edit rates/labels, (de)activate, close a version (effectiveTo)
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    const parsed = updateSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const patch = parsed.data

    await connectDB()
    const code = await TaxCode.findById(params.id)
    if (!code) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const before = code.toObject()

    if (code.isSystem) {
      const changedIdentity = SYSTEM_IDENTITY.filter(f => {
        if (patch[f] === undefined) return false
        if (f === 'code') return patch.code.toUpperCase() !== code.code
        return patch.effectiveFrom !== dayOf(code.effectiveFrom)
      })
      if (changedIdentity.length) {
        return NextResponse.json({
          error: 'System codes keep their code and effective-from date — add a new version with the new rates instead',
        }, { status: 409 })
      }
    }

    const set = {}
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      if (k === 'code') set.code = v.toUpperCase()
      else if (k === 'effectiveFrom') {
        const start = parseDhakaDay(v)?.start
        if (!start) return NextResponse.json({ error: 'Invalid effective-from date' }, { status: 422 })
        set.effectiveFrom = start
      } else if (k === 'effectiveTo') {
        if (v === null) set.effectiveTo = null
        else {
          const start = parseDhakaDay(v)?.start
          if (!start) return NextResponse.json({ error: 'Invalid effective-to date' }, { status: 422 })
          set.effectiveTo = start
        }
      } else set[k] = v
    }

    // Keep kind-specific fields coherent.
    if (code.kind === 'VAT_SERVICE') {
      for (const f of ['section', 'rateCompany', 'rateIndividual', 'commissionRate', 'grossRate', 'basis']) delete set[f]
    } else {
      for (const f of ['vatRate', 'vdsRate', 'treatment']) delete set[f]
      // Switching back to a plain gross-rate section drops the commission/gross pair.
      if (set.basis === 'GROSS') { set.commissionRate = null; set.grossRate = null }
    }

    const merged = { ...before, ...set }
    const problems = taxCodeProblems(merged)
    if (Object.keys(problems).length) {
      return NextResponse.json({
        error: Object.values(problems)[0],
        details: { formErrors: [], fieldErrors: Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, [v]])) },
      }, { status: 422 })
    }

    code.set(set)
    try {
      await code.save()
    } catch (err) {
      if (err?.code === 11000) {
        return NextResponse.json({ error: 'A version of this code with the same effective-from date already exists' }, { status: 409 })
      }
      if (err?.name === 'ValidationError') {
        return NextResponse.json({ error: Object.values(err.errors ?? {}).map(e => e.message).join('; ') || 'Validation failed' }, { status: 422 })
      }
      throw err
    }

    const after = code.toObject()
    const diff = {}
    for (const k of Object.keys(set)) {
      const from = before[k] instanceof Date ? dayOf(before[k]) : before[k] ?? null
      const to = after[k] instanceof Date ? dayOf(after[k]) : after[k] ?? null
      if (JSON.stringify(from) !== JSON.stringify(to)) diff[k] = { from, to }
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'TAX_CODE',
      entityId: params.id,
      changes:  JSON.stringify({ kind: code.kind, code: code.code, ...diff }),
      request,
    })

    return NextResponse.json({ data: normalizeTaxCode(after) })
  } catch (err) {
    console.error('[PUT /api/tax/codes/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/tax/codes/[id]
//   System codes and codes already used on tax entries are deactivated, not deleted.
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const code = await TaxCode.findById(params.id)
    if (!code) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let inUse = false
    if (!code.isSystem) {
      const otherVersions = await TaxCode.countDocuments({ _id: { $ne: code._id }, kind: code.kind, code: code.code })
      if (otherVersions === 0) {
        const refFilter = code.kind === 'VAT_SERVICE' ? { serviceCode: code.code } : { section: code.code }
        inUse = Boolean(await TaxEntry.exists(refFilter))
      }
    }

    if (code.isSystem || inUse) {
      const wasActive = code.isActive
      code.isActive = false
      await code.save()
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'UPDATE',
        entity:   'TAX_CODE',
        entityId: params.id,
        changes:  JSON.stringify({ kind: code.kind, code: code.code, isActive: { from: wasActive, to: false }, reason: code.isSystem ? 'system code' : 'used on tax entries' }),
        request,
      })
      return NextResponse.json({
        success: true,
        deleted: false,
        deactivated: true,
        message: code.isSystem
          ? 'System codes cannot be deleted — the code was deactivated'
          : 'The code is used on tax entries — it was deactivated instead of deleted',
        data: normalizeTaxCode(code.toObject()),
      })
    }

    await TaxCode.deleteOne({ _id: code._id })
    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'TAX_CODE',
      entityId: params.id,
      changes:  JSON.stringify({ kind: code.kind, code: code.code, label: code.label, effectiveFrom: dayOf(code.effectiveFrom) }),
      request,
    })
    return NextResponse.json({ success: true, deleted: true, deactivated: false })
  } catch (err) {
    console.error('[DELETE /api/tax/codes/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
