export const dynamic = 'force-dynamic'
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Employee, SalaryRevision, User } from '@/models'
import { canDo, canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { ciContains, ciEquals } from '@/lib/searchMatch'
import { codeContains } from '@/lib/codes'
import { normalizeDeptCode } from '@/models/Employee'
import {
  REVISION_TYPES, RevisionError, applyDueRevisions, proposeRevision, revisionJson, usersOf,
  salaryForPeriod, isValidPeriod, round2,
} from '@/lib/hr/salaryRevisions'
import { z } from 'zod'

const VIEW_PERMS = ['hr.salary.revise', 'hr.salary.approve', 'pii.financial.view']
const fail = (error, status) => NextResponse.json({ error }, { status })

// GET /api/salary-revisions?status=PENDING|APPROVED|REJECTED|CANCELLED|all&employeeId=&batchId=&department=&search=&page=&limit=
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return fail('Unauthorised', 401)
    if (!canDoAny(session, VIEW_PERMS)) return fail('Forbidden', 403)
    await connectDB()
    await applyDueRevisions()

    const sp = new URL(request.url).searchParams
    const status = sp.get('status') || 'all'
    const page   = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const limit  = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50))

    const filter = {}
    if (status !== 'all') filter.status = status
    if (sp.get('employeeId')) {
      if (!isValidObjectId(sp.get('employeeId'))) return fail('Invalid employee', 400)
      filter.employeeId = sp.get('employeeId')
    }
    if (sp.get('batchId')) filter.batchId = String(sp.get('batchId')).slice(0, 40)
    const department = sp.get('department')
    const search = sp.get('search')
    if (department || search) {
      const empFilter = {}
      if (department) {
        const code = normalizeDeptCode(department)
        empFilter.department = code ? ciEquals(code) : ciContains(department)
      }
      if (search) {
        const users = await User.find({ name: ciContains(search) }).select('_id').lean()
        // Employee IDs match with separators ignored (EN-DEV2610001 = ENDEV2610001).
        const code = codeContains(search)
        empFilter.$or = [{ userId: { $in: users.map(u => u._id) } }, ...(code ? [{ employeeId: code }] : [])]
      }
      filter.employeeId = { $in: await Employee.find(empFilter).distinct('_id') }
    }

    const [rows, total] = await Promise.all([
      SalaryRevision.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      SalaryRevision.countDocuments(filter),
    ])
    const employees = await Employee.find({ _id: { $in: rows.map(r => r.employeeId) } })
      .select('employeeId department designation position userId resigned').populate('userId', 'name avatar').lean()
    const empById = new Map(employees.map(e => [String(e._id), {
      id: String(e._id), name: e.userId?.name ?? '—', avatar: e.userId?.avatar ?? null, userId: e.userId?._id ? String(e.userId._id) : null,
      employeeId: e.employeeId ?? null, department: e.department ?? null, designation: e.designation ?? e.position ?? null, resigned: !!e.resigned,
    }]))
    const users = await usersOf(rows)
    return NextResponse.json({
      data: rows.map(r => revisionJson(r, { employee: empById.get(String(r.employeeId)) ?? null, users })),
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      can: { revise: canDo(session, 'hr.salary.revise'), approve: canDo(session, 'hr.salary.approve'), userId: session.user.id, superAdmin: session.user.role === 'SUPER_ADMIN' },
    })
  } catch (err) {
    console.error('[GET /api/salary-revisions]', err)
    return fail('Internal server error', 500)
  }
}

const money = z.union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/)]).transform(Number)
const itemSchema = z.object({
  employeeId:     z.string().refine(isValidObjectId, 'Invalid employee'),
  type:           z.enum(REVISION_TYPES).optional(),
  newSalary:      money.optional().nullable(),
  percent:        money.optional().nullable(),
  amount:         money.optional().nullable(),
  newDesignation: z.string().trim().max(120).optional().nullable(),
})
const bodySchema = z.object({
  effectiveMonth: z.string().refine(isValidPeriod, 'Choose the month the new salary starts'),
  type:           z.enum(REVISION_TYPES).default('INCREMENT'),
  reason:         z.string().trim().max(1000).optional().nullable(),
  approveNow:     z.boolean().default(false),
  items:          z.array(itemSchema).min(1).max(200),
})

// POST /api/salary-revisions — propose a change for one employee or many at once.
// Body: { effectiveMonth:'YYYY-MM', type, reason?, approveNow?, items:[{ employeeId,
//   newSalary? | percent? | amount?, newDesignation?, type? }] }
// percent / amount are counted from the salary in effect the month before; a
// percent result is rounded to whole taka. Each employee succeeds or fails alone.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return fail('Unauthorised', 401)
    if (!canDoAny(session, ['hr.salary.revise', 'hr.salary.approve'])) return fail('Forbidden', 403)
    await connectDB()

    let raw
    try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json({ error: issue?.message ?? 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const d = parsed.data
    const batchId = d.items.length > 1 ? `B${crypto.randomBytes(6).toString('hex')}` : null
    const created = []
    const failed = []
    const warnings = []

    for (const item of d.items) {
      const type = item.type ?? d.type
      const employee = await Employee.findById(item.employeeId).populate('userId', 'name').lean()
      const name = employee?.userId?.name ?? 'Employee'
      try {
        if (!employee) throw new RevisionError('Employee not found', 404)
        let newSalary = item.newSalary
        if (newSalary == null) {
          const previous = Number(await salaryForPeriod(employee, d.effectiveMonth)) || 0
          if (item.percent != null) {
            const pct = type === 'DECREASE' ? -Math.abs(item.percent) : item.percent
            newSalary = Math.round(previous * (1 + pct / 100))
          } else if (item.amount != null) {
            newSalary = round2(previous + (type === 'DECREASE' ? -Math.abs(item.amount) : item.amount))
          } else {
            throw new RevisionError('Enter the new salary, a percentage or an amount')
          }
        }
        const r = await proposeRevision({
          employeeId: employee._id, type, newSalary, effectiveMonth: d.effectiveMonth,
          newDesignation: item.newDesignation, reason: d.reason, batchId, approveNow: d.approveNow, session,
        })
        created.push(r.revision)
        warnings.push(...r.warnings.map(w => `${name}: ${w}`))
      } catch (err) {
        if (!(err instanceof RevisionError)) throw err
        failed.push({ employeeId: item.employeeId, name, error: err.message })
      }
    }

    if (created.length) {
      logActivity({
        userId: session.user.id, userRole: session.user.role, action: 'CREATE', entity: 'SALARY_REVISION',
        entityId: batchId ?? String(created[0]._id),
        changes: JSON.stringify({
          effectiveMonth: d.effectiveMonth, type: d.type, approved: d.approveNow && canDo(session, 'hr.salary.approve'),
          revisions: created.map(r => ({ id: String(r._id), employeeId: String(r.employeeId), from: r.previousSalary, to: r.newSalary, status: r.status })),
        }),
        request,
      })
    }
    const users = await usersOf(created)
    return NextResponse.json({
      created: created.map(r => revisionJson(r, { users })),
      failed,
      warnings,
      batchId,
    }, { status: created.length ? 201 : 422 })
  } catch (err) {
    console.error('[POST /api/salary-revisions]', err)
    return fail('Internal server error', 500)
  }
}
