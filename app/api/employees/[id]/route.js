export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm, canDo, ALL_PERMISSIONS } from '@/lib/rbac'
import { maskDoc, EMPLOYEE_PII, restoreMaskedValues, stripMaskedValues } from '@/lib/pii'
import { isValidObjectId } from '@/lib/objectId'
import connectDB from '@/lib/mongodb'
import { User, Employee, Task, Leave, Attendance } from '@/models'
import { generateEmployeeId } from '@/models/Employee'
import { logActivity } from '@/lib/logActivity'
import { TIN_REGEX } from '@/lib/tax/catalog'
import { codeEquals, compactCode } from '@/lib/codes'
import {
  RevisionError, applyDueRevisions, assertSalaryEditable, recordSalaryEdit, salaryForPeriod, currentPeriod,
} from '@/lib/hr/salaryRevisions'
import { z } from 'zod'

// Employee e-TIN (12 digits) — needed for salary TDS (s.86) certificates.
// Spaces/hyphens are ignored; blank ⇒ null.
const tinField = z.preprocess(
  v => (typeof v === 'string' ? (v.replace(/[\s-]+/g, '') || null) : v),
  z.string().regex(TIN_REGEX, 'TIN must be the 12-digit e-TIN').nullable().optional(),
)

const updateEmployeeSchema = z.object({
  name:                 z.string().min(1).optional(),
  email:                z.string().email().optional(),
  phone:                z.string().optional().nullable(),
  venture:              z.string().optional().nullable(),
  department:           z.string().optional().nullable(),
  position:             z.string().optional().nullable(),
  designation:          z.string().optional().nullable(),
  salary:               z.number().min(0).optional().nullable(),
  hireDate:             z.string().optional().nullable(),
  employeeId:           z.string().optional().nullable(),
  isActive:             z.boolean().optional(),
  role:                 z.enum(['SUPER_ADMIN','MANAGER','EMPLOYEE','FREELANCER','CLIENT','VENDOR']).optional(),
  bloodGroup:           z.string().optional().nullable(),
  emergencyContacts:    z.array(z.object({
    name:     z.string().min(1),
    relation: z.string().min(1),
    phone:    z.string().min(1),
  })).optional(),
  address:              z.string().optional().nullable(),
  nidNumber:            z.string().optional().nullable(),
  tin:                  tinField,
  appointmentLetterUrl: z.string().optional().nullable(),
  agreementUrl:         z.string().optional().nullable(),
  panelAccessGranted:   z.boolean().optional(),
  customRoleId:         z.string().optional().nullable(),
  permissionOverrides:  z.object({
    added:   z.array(z.string()).optional().default([]),
    removed: z.array(z.string()).optional().default([]),
  }).optional(),
  password:             z.string().min(6).optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
  resign:               z.boolean().optional(),
})

// PII categories (see EMPLOYEE_PII) → writable fields. A caller who only ever
// sees a category masked may not overwrite it.
const PII_WRITE_FIELDS = {
  'pii.contact.view':   ['email', 'phone', 'emergencyContacts'],
  'pii.address.view':   ['address'],
  'pii.identity.view':  ['nidNumber', 'tin'],
  'pii.financial.view': ['salary'],
}

// GET /api/employees/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.employees.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    await connectDB()
    // An approved raise whose month has started is shown as the salary now.
    await applyDueRevisions({ employeeId: params.id })

    const employee = await Employee.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive role createdAt lastLogin' })

    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const [tasks, attendance, leaves] = await Promise.all([
      Task.find({ assignedEmployeeId: params.id })
        .sort({ createdAt: -1 })
        .populate({ path: 'projectId', select: 'id name' }),
      Attendance.find({ employeeId: params.id }).sort({ date: -1 }).limit(30),
      Leave.find({ employeeId: params.id }).sort({ createdAt: -1 }),
    ])

    const completedTasks  = tasks.filter(t => t.status === 'COMPLETED').length
    const totalTasks      = tasks.length
    const completionRate  = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    return NextResponse.json({
      data: maskDoc(session, { ...employee.toJSON(), tasks, attendance, leaves, completedTasks, totalTasks, completionRate }, EMPLOYEE_PII),
    })
  } catch (err) {
    console.error('[GET /api/employees/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/employees/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.update')
    if (denied) return denied

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    await connectDB()

    const current = await Employee.findById(params.id).lean()
    if (!current) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    // Edit forms are pre-filled from masked GET responses — put the real stored
    // value back for any masked placeholder (unmatched ones, e.g. email, are dropped).
    const body   = restoreMaskedValues(await request.json(), current)
    const parsed = updateEmployeeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    for (const [perm, keys] of Object.entries(PII_WRITE_FIELDS)) {
      if (!canDo(session, perm)) for (const k of keys) delete parsed.data[k]
    }

    const { name, email, phone, isActive, role, password, hireDate, resign, ...empData } = parsed.data

    const isSuperAdmin = session.user.role === 'SUPER_ADMIN'
    const targetUser   = await User.findById(current.userId).select('role email').lean()
    const isSelf       = String(current.userId) === String(session.user.id)
    const roleChanged  = role !== undefined && role !== targetUser?.role

    // Only a Super Admin may promote to MANAGER/SUPER_ADMIN — prevents a custom
    // role granted employee-edit from escalating privileges.
    if (roleChanged && role !== 'EMPLOYEE' && !isSuperAdmin) {
      return NextResponse.json({ error: 'Only a Super Admin can assign Manager or Super Admin roles' }, { status: 403 })
    }

    // Account-level changes (login, credentials, role, active status) on a
    // Manager / Super Admin are reserved for a Super Admin — otherwise any
    // employee-editor could take over or lock out a higher-privileged account.
    const emailChanged   = email !== undefined && email.trim().toLowerCase() !== String(targetUser?.email ?? '').toLowerCase()
    const touchesAccount = emailChanged || password || isActive !== undefined || roleChanged || resign
    if (!isSuperAdmin && ['MANAGER', 'SUPER_ADMIN'].includes(targetUser?.role) && touchesAccount) {
      return NextResponse.json({ error: 'Only a Super Admin can change login, role or status of a Manager or Super Admin' }, { status: 403 })
    }

    // Nobody changes their own role, active status or resignation from here.
    if (isSelf && (roleChanged || (isActive !== undefined && isActive !== true) || resign)) {
      return NextResponse.json({ error: 'You cannot change your own role or account status' }, { status: 403 })
    }

    // Assigning a custom role replaces the person's whole permission set — that
    // is role management, and nobody may pick their own custom role.
    if (empData.customRoleId !== undefined) {
      const nextRoleId = empData.customRoleId || null
      const curRoleId  = current.customRoleId ? String(current.customRoleId) : null
      if (nextRoleId !== curRoleId) {
        if (nextRoleId && !isValidObjectId(nextRoleId)) {
          return NextResponse.json({ error: 'Invalid custom role' }, { status: 400 })
        }
        if (!canDo(session, 'hr.roles.manage')) {
          return NextResponse.json({ error: 'You do not have permission to assign custom roles' }, { status: 403 })
        }
        if (isSelf && !isSuperAdmin) {
          return NextResponse.json({ error: 'You cannot change your own custom role' }, { status: 403 })
        }
      }
      empData.customRoleId = nextRoleId
    }

    // Granting/revoking individual permissions is role management — gate it behind
    // hr.roles.manage so an employee-editor can't hand out arbitrary access. Also
    // sanitise the override lists to known permission strings only.
    if (empData.permissionOverrides !== undefined) {
      if (!canDo(session, 'hr.roles.manage')) {
        return NextResponse.json({ error: 'You do not have permission to customise individual permissions' }, { status: 403 })
      }
      if (isSelf && !isSuperAdmin) {
        return NextResponse.json({ error: 'You cannot change your own permissions' }, { status: 403 })
      }
      const clean = (arr) => [...new Set((arr ?? []).filter(p => ALL_PERMISSIONS.includes(p)))]
      const added   = clean(empData.permissionOverrides.added)
      const removed  = clean(empData.permissionOverrides.removed)
      // A permission can't be both added and removed — an explicit add wins.
      empData.permissionOverrides = { added, removed: removed.filter(p => !added.includes(p)) }
    }

    const userUpdate = {}

    // Resign action — deactivate panel and user account
    if (resign) {
      empData.resigned          = true
      empData.resignDate        = new Date()
      empData.panelAccessGranted = false
      userUpdate.isActive       = false
    }

    if (name     !== undefined) userUpdate.name     = name
    if (emailChanged)           userUpdate.email    = email
    if (phone    !== undefined) { userUpdate.phone  = phone; empData.phone = phone }
    if (isActive !== undefined) userUpdate.isActive = isActive
    if (roleChanged)            userUpdate.role     = role
    if (password) {
      const bcrypt = (await import('bcryptjs')).default
      userUpdate.password = await bcrypt.hash(password, 10)
    }

    // Auto-generate employeeId if not yet set and we now have a department
    if (!current.employeeId && !empData.employeeId) {
      const dept    = empData.department ?? current.department
      const hd      = hireDate ? new Date(hireDate) : current.hireDate
      const venture = empData.venture ?? current.venture
      if (dept) {
        try {
          empData.employeeId = await generateEmployeeId({ venture, department: dept, hireDate: hd })
        } catch (e) {
          console.warn('[PUT /api/employees] employeeId generation skipped:', e.message)
        }
      }
    }

    // A typed employee ID is stored without separators and must not already be
    // someone else's in any spelling (EN-DEV2610001 is ENDEV2610001).
    if (empData.employeeId) {
      empData.employeeId = compactCode(empData.employeeId)
      if (await Employee.exists({ employeeId: codeEquals(empData.employeeId), _id: { $ne: current._id } })) {
        return NextResponse.json({ error: 'This employee ID is already in use' }, { status: 409 })
      }
    }

    // A salary typed here is a salary change too: kept in the salary history, and
    // refused while an approved change is still to come (Salary increments).
    const salaryChanged = empData.salary !== undefined
      && Math.abs((Number(empData.salary) || 0) - (Number(current.salary) || 0)) >= 0.01
    let salaryBefore = null
    if (salaryChanged) {
      try {
        await assertSalaryEditable(current)
      } catch (err) {
        if (err instanceof RevisionError) return NextResponse.json({ error: err.message }, { status: err.status })
        throw err
      }
      salaryBefore = await salaryForPeriod(current, currentPeriod())
    }

    await Promise.all([
      Object.keys(userUpdate).length > 0 ? User.findByIdAndUpdate(current.userId, userUpdate) : Promise.resolve(),
      Employee.findByIdAndUpdate(params.id, { ...empData, ...(hireDate ? { hireDate: new Date(hireDate) } : {}) }),
    ])
    if (salaryChanged) {
      await recordSalaryEdit({ employee: current, previousSalary: salaryBefore, newSalary: empData.salary, session })
        .catch(err => console.error('[PUT /api/employees/[id]] salary history not recorded', err))
    }

    const updated = await Employee.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar isActive' })
      .populate({ path: 'customRoleId', select: 'id title department color' })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'EMPLOYEE',
      entityId: params.id,
      changes:  JSON.stringify({
        name: updated?.userId?.name ?? null,
        // The e-TIN itself never goes to the audit log.
        ...(empData.tin !== undefined && String(empData.tin ?? '') !== String(current.tin ?? '')
          ? { tin: empData.tin ? 'updated' : 'cleared' } : {}),
      }),
      request,
    })

    return NextResponse.json({ data: updated ? maskDoc(session, updated.toJSON(), EMPLOYEE_PII) : null })
  } catch (err) {
    console.error('[PUT /api/employees/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/employees/[id] — partial update (documents, photo, etc.)
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.update')
    if (denied) return denied

    await connectDB()

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    // Drop masked placeholders (e.g. companyPhone) echoed back from a masked GET.
    const body = stripMaskedValues(await request.json()) ?? {}
    const allowed = ['documents', 'photo', 'appointmentLetterUrl', 'agreementUrl',
                     'companyPhone', 'companyWebmail', 'companyItems', 'tin']
    const update = {}
    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }

    // e-TIN: identity PII — only writable by callers who may see it unmasked,
    // and must be a 12-digit e-TIN (blank clears it).
    let tinChange = null
    if ('tin' in update) {
      if (!canDo(session, 'pii.identity.view')) {
        // Masked placeholders were stripped above, so a TIN here is a new value.
        return NextResponse.json({ error: 'You do not have permission to edit the TIN' }, { status: 403 })
      } else {
        const tinParsed = tinField.safeParse(update.tin)
        if (!tinParsed.success) {
          return NextResponse.json({
            error: 'Validation failed',
            details: { formErrors: [], fieldErrors: { tin: tinParsed.error.issues.map(i => i.message) } },
          }, { status: 422 })
        }
        update.tin = tinParsed.data ?? null
        tinChange = update.tin ? 'updated' : 'cleared'
      }
    }

    if (Object.keys(update).length === 0)
      return NextResponse.json({ error: 'Nothing to update' }, { status: 422 })

    const updated = await Employee.findByIdAndUpdate(params.id, update, { new: true })
      .populate({ path: 'userId', select: 'id name email avatar phone isActive role lastLogin' })

    if (!updated) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    if (tinChange) {
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'UPDATE',
        entity:   'EMPLOYEE',
        entityId: params.id,
        changes:  JSON.stringify({ tin: tinChange }),
        request,
      })
    }

    return NextResponse.json({ data: maskDoc(session, updated.toJSON(), EMPLOYEE_PII) })
  } catch (err) {
    console.error('[PATCH /api/employees/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/employees/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.employees.delete')
    if (denied) return denied

    await connectDB()

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const employee = await Employee.findById(params.id).lean()
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    if (String(employee.userId) === String(session.user.id)) {
      return NextResponse.json({ error: 'You cannot deactivate your own account' }, { status: 403 })
    }
    if (session.user.role !== 'SUPER_ADMIN') {
      const target = await User.findById(employee.userId).select('role').lean()
      if (['MANAGER', 'SUPER_ADMIN'].includes(target?.role)) {
        return NextResponse.json({ error: 'Only a Super Admin can deactivate a Manager or Super Admin' }, { status: 403 })
      }
    }

    await User.findByIdAndUpdate(employee.userId, { isActive: false })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'EMPLOYEE',
      entityId: params.id,
      changes:  JSON.stringify({ employeeId: employee.employeeId ?? null, deactivated: true }),
      request,
    })

    return NextResponse.json({ success: true, message: 'Employee deactivated' })
  } catch (err) {
    console.error('[DELETE /api/employees/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
