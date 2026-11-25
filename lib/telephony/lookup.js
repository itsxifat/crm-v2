/**
 * lib/telephony/lookup.js — SERVER-ONLY: who a phone number belongs to, what the caller
 * panel shows about them, the dialpad's contact search, and the number behind a call button.
 *
 * Everything follows the person's own permissions, as the client and lead pages do:
 *   clients            sales.customers.view (money figures also need sales.invoices.view)
 *   leads              sales.leads.view; an EMPLOYEE only sees leads assigned to them
 *   phones and emails  masked without pii.contact.view (lib/pii.js); the number is still
 *                      dialled, it is only not shown
 *   colleagues         name, designation and extension, to everyone who can call
 */
import connectDB from '@/lib/mongodb'
import { Client, User, Lead, LeadActivity, Project, Invoice, CompanyMembership, Employee } from '@/models'
import { canDo } from '@/lib/rbac'
import { maskPhone, maskEmail } from '@/lib/pii'
import { getOwnEmployeeId, canAccessLead } from '@/lib/leadAccess'
import { isValidObjectId } from '@/lib/objectId'
import {
  ACTIVE_PROJECT_STATUSES, OUTSTANDING_INVOICE_STATUSES, INVOICE_MONEY_FIELDS, sumInvoiceMoneyBDT, invoiceMoneyBDT,
} from '@/lib/clientStats'
import { numberRegex, digitsOf, dialable } from './numbers'
import { STAFF_ROLES, userIdForExtension } from './access'

const MAX_MATCHES = 6
const DETAILED = 3 // matches that get projects, invoices and activities
const PRIORITY_RANK = { VIP: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

const escapeRegex = (s) => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const clip = (s, n = 280) => (s && String(s).length > n ? `${String(s).slice(0, n - 1)}…` : s || null)
const idOf = (doc) => String(doc?._id ?? doc?.id ?? doc ?? '')

function viewer(session) {
  const contact = canDo(session, 'pii.contact.view')
  return {
    clients: canDo(session, 'sales.customers.view'),
    leads:   canDo(session, 'sales.leads.view'),
    money:   canDo(session, 'sales.invoices.view'),
    leadValue: canDo(session, 'pii.financial.view'),
    address: canDo(session, 'pii.address.view'),
    phone: (v) => (v ? (contact ? v : maskPhone(v)) : null),
    email: (v) => (v ? (contact ? v : maskEmail(v)) : null),
  }
}

function clientTitle(c, owner) {
  if (c.clientType === 'COMPANY' && c.company) return c.company
  return owner?.name || c.company || c.contactPerson || c.clientCode || 'Client'
}

/** Lead filter for this person: an EMPLOYEE sees only their own leads. */
async function leadScope(session) {
  if (session.user.role !== 'EMPLOYEE') return {}
  const own = await getOwnEmployeeId(session)
  return own ? { assignedToId: own } : null
}

async function staffDetails(userIds) {
  if (!userIds.length) return new Map()
  const emps = await Employee.find({ userId: { $in: userIds } }).select('userId designation department').lean()
  return new Map(emps.map(e => [String(e.userId), e]))
}

// ── Cards ────────────────────────────────────────────────────────────────────

async function clientCard(c, owner, via, v, detailed) {
  const card = {
    type: 'client',
    id: idOf(c),
    href: `/admin/clients/${idOf(c)}`,
    title: clientTitle(c, owner),
    subtitle: [c.clientType === 'COMPANY' ? (c.contactPerson || owner?.name) : null, c.designation].filter(Boolean).join(' · ') || null,
    via,
    code: c.clientCode ?? null,
    clientType: c.clientType,
    priority: c.priority ?? 'MEDIUM',
    industry: c.industry ?? null,
    city: v.address ? (c.city ?? null) : null,
    isActive: c.isActive !== false,
    envoCustomer: !!c.envoId,
    phone: v.phone(owner?.phone || c.companyPhone || c.altPhone),
    email: v.email(owner?.email || c.companyEmail),
    notes: clip(c.notes),
  }
  if (!detailed) return card

  const [projects, invoices] = await Promise.all([
    Project.find({ clientId: c._id }).select('name projectCode status deadline updatedAt').sort({ updatedAt: -1 }).lean(),
    v.money ? Invoice.find({ clientId: c._id }).select(`${INVOICE_MONEY_FIELDS} invoiceNumber dueDate issueDate`).lean() : [],
  ])
  const active = projects.filter(p => ACTIVE_PROJECT_STATUSES.includes(p.status))
  card.projects = {
    active: active.length,
    total: projects.length,
    items: (active.length ? active : projects).slice(0, 3).map(p => ({
      id: idOf(p), name: p.name, code: p.projectCode ?? null, status: p.status, deadline: p.deadline ?? null,
    })),
  }
  if (v.money) {
    const { totalRevenue, outstandingBalance } = sumInvoiceMoneyBDT(invoices)
    const open = invoices
      .filter(i => OUTSTANDING_INVOICE_STATUSES.includes(i.status))
      .map(i => ({ id: idOf(i), number: i.invoiceNumber ?? null, status: i.status, dueDate: i.dueDate ?? null, due: Math.round(invoiceMoneyBDT(i).outstanding * 100) / 100 }))
      .sort((a, b) => (a.dueDate ? +new Date(a.dueDate) : Infinity) - (b.dueDate ? +new Date(b.dueDate) : Infinity))
    card.money = {
      revenue: totalRevenue,
      outstanding: outstandingBalance,
      overdue: open.filter(i => i.status === 'OVERDUE').length,
      openInvoices: open.length,
      invoices: open.slice(0, 3),
    }
  }
  return card
}

async function leadCard(l, via, v, detailed) {
  const card = {
    type: 'lead',
    id: idOf(l),
    href: `/admin/leads/${idOf(l)}`,
    title: l.name,
    subtitle: [l.designation, l.company].filter(Boolean).join(' · ') || null,
    via,
    status: l.status,
    priority: l.priority ?? 'NORMAL',
    service: l.service ?? null,
    source: l.source ?? null,
    followUpDate: l.followUpDate ?? null,
    value: v.leadValue && l.value != null && l.value !== '' ? Number(l.value) || null : null,
    phone: v.phone(l.phone || l.alternativePhone),
    email: v.email(l.email),
    notes: clip(l.notes),
  }
  if (!detailed) return card
  const [assignee, activities] = await Promise.all([
    l.assignedToId ? Employee.findById(l.assignedToId).select('userId').populate('userId', 'name').lean() : null,
    LeadActivity.find({ leadId: l._id }).sort({ createdAt: -1 }).limit(3).lean(),
  ])
  card.assignedTo = assignee?.userId?.name ?? null
  card.activities = activities.map(a => ({ type: a.type, note: clip(a.note, 160), by: a.createdByName ?? null, at: a.createdAt }))
  return card
}

function staffCard(u, emp, extension) {
  return {
    type: 'staff',
    id: idOf(u),
    title: u.name,
    subtitle: [emp?.designation, emp?.department].filter(Boolean).join(' · ') || 'Staff',
    via: extension ? `Extension ${extension}` : 'Staff phone',
    extension: extension ?? null,
  }
}

// ── Who is calling ───────────────────────────────────────────────────────────

/**
 * Everything the caller panel shows about `number`, most relevant first: clients (VIP
 * first), then leads, then colleagues. [] when nobody matches.
 */
export async function identify(session, number, settings) {
  await connectDB()
  const v = viewer(session)
  const re = numberRegex(number)

  // Too short to be a phone number: a colleague's extension, or nobody.
  if (!re) {
    const uid = userIdForExtension(settings, digitsOf(number))
    if (!uid || !isValidObjectId(uid)) return []
    const u = await User.findById(uid).select('name role').lean()
    if (!u) return []
    const emps = await staffDetails([u._id])
    return [staffCard(u, emps.get(String(u._id)), digitsOf(number))]
  }

  const rx = { $regex: re }
  const scope = v.leads ? await leadScope(session) : null
  const [users, clientsByField, leads] = await Promise.all([
    User.find({ phone: rx }).select('name role phone email').limit(25).lean(),
    v.clients ? Client.find({ $or: [{ companyPhone: rx }, { altPhone: rx }] }).limit(MAX_MATCHES).lean() : [],
    scope ? Lead.find({ ...scope, $or: [{ phone: rx }, { alternativePhone: rx }] }).sort({ updatedAt: -1 }).limit(MAX_MATCHES).lean() : [],
  ])

  // Clients: by their own numbers, by their owner's login phone, or a member's.
  const via = new Map() // clientId → why it matched
  for (const c of clientsByField) via.set(idOf(c), new RegExp(re).test(c.companyPhone ?? '') ? 'Company phone' : 'Alternate phone')
  const clientUsers = users.filter(u => u.role === 'CLIENT')
  let clients = [...clientsByField]
  if (v.clients && clientUsers.length) {
    const ids = clientUsers.map(u => u._id)
    const [owned, memberships] = await Promise.all([
      Client.find({ userId: { $in: ids } }).limit(MAX_MATCHES).lean(),
      CompanyMembership.find({ userId: { $in: ids }, status: 'ACTIVE' }).select('userId clientId').limit(MAX_MATCHES).lean(),
    ])
    const byUser = new Map(clientUsers.map(u => [String(u._id), u]))
    for (const c of owned) if (!via.has(idOf(c))) { via.set(idOf(c), 'Main contact'); clients.push(c) }
    const missing = memberships.filter(m => !via.has(String(m.clientId)))
    if (missing.length) {
      const extra = await Client.find({ _id: { $in: missing.map(m => m.clientId) } }).lean()
      for (const c of extra) {
        const m = missing.find(x => String(x.clientId) === idOf(c))
        via.set(idOf(c), `${byUser.get(String(m.userId))?.name ?? 'A member'} (member)`)
        clients.push(c)
      }
    }
  }
  clients = clients
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) || (b.isActive !== false) - (a.isActive !== false))
    .slice(0, MAX_MATCHES)

  const owners = clients.length
    ? new Map((await User.find({ _id: { $in: clients.map(c => c.userId) } }).select('name email phone').lean()).map(u => [String(u._id), u]))
    : new Map()

  const staff = users.filter(u => STAFF_ROLES.includes(u.role))
  const emps = await staffDetails(staff.map(u => u._id))
  const extOf = (uid) => settings?.extensions?.[String(uid)] ?? null

  const out = []
  let detailed = 0
  for (const c of clients) {
    if (out.length >= MAX_MATCHES) break
    out.push(await clientCard(c, owners.get(String(c.userId)), via.get(idOf(c)), v, detailed++ < DETAILED))
  }
  for (const l of leads) {
    if (out.length >= MAX_MATCHES) break
    out.push(await leadCard(l, new RegExp(re).test(l.phone ?? '') ? 'Phone' : 'Alternate phone', v, detailed++ < DETAILED))
  }
  for (const u of staff) {
    if (out.length >= MAX_MATCHES) break
    out.push(staffCard(u, emps.get(String(u._id)), extOf(u._id)))
  }
  return out
}

// ── Dialpad search ───────────────────────────────────────────────────────────

/**
 * People to call, by name or by part of their number. Each entry lists its numbers
 * by field (shown masked without pii.contact.view); dialling goes through
 * resolveTarget, or straight to a colleague's extension.
 */
export async function searchContacts(session, query, settings) {
  await connectDB()
  const v = viewer(session)
  const q = String(query ?? '').trim()
  const digits = digitsOf(q)
  const byNumber = digits.length >= 3 && digits.length >= q.replace(/[\s\-()+]/g, '').length - 1
  if (!byNumber && q.length < 2) return []
  // 01712…, 8801712… and +8801712… are spelt every way in the CRM: search without the prefix.
  const core = digits.length >= 5 ? digits.replace(/^(?:00)?880/, '').replace(/^0/, '') : digits
  const rx = byNumber ? { $regex: core.split('').join('\\D*') } : { $regex: escapeRegex(q), $options: 'i' }
  const scope = v.leads ? await leadScope(session) : null

  const [clientsDirect, matchedUsers, leads] = await Promise.all([
    v.clients
      ? Client.find(byNumber ? { $or: [{ companyPhone: rx }, { altPhone: rx }] } : { $or: [{ company: rx }, { contactPerson: rx }, { clientCode: rx }] })
        .sort({ updatedAt: -1 }).limit(8).lean()
      : [],
    User.find(byNumber ? { phone: rx } : { name: rx })
      .where('role').in(v.clients ? ['CLIENT', ...STAFF_ROLES] : STAFF_ROLES)
      .select('name role phone').limit(16).lean(),
    scope
      ? Lead.find({ ...scope, ...(byNumber ? { $or: [{ phone: rx }, { alternativePhone: rx }] } : { $or: [{ name: rx }, { company: rx }] }) })
        .sort({ updatedAt: -1 }).limit(8).lean()
      : [],
  ])

  // Clients found through their owner's name or phone.
  const clientUsers = matchedUsers.filter(u => u.role === 'CLIENT')
  const owned = clientUsers.length ? await Client.find({ userId: { $in: clientUsers.map(u => u._id) } }).limit(8).lean() : []
  const clients = [...clientsDirect, ...owned.filter(c => !clientsDirect.some(d => idOf(d) === idOf(c)))].slice(0, 8)
  const owners = clients.length
    ? new Map((await User.find({ _id: { $in: clients.map(c => c.userId) } }).select('name phone').lean()).map(u => [String(u._id), u]))
    : new Map()

  const out = []
  for (const c of clients) {
    const owner = owners.get(String(c.userId))
    const numbers = [
      owner?.phone && { field: 'phone', label: 'Main', display: v.phone(owner.phone) },
      c.companyPhone && { field: 'companyPhone', label: 'Company', display: v.phone(c.companyPhone) },
      c.altPhone && { field: 'altPhone', label: 'Alternate', display: v.phone(c.altPhone) },
    ].filter(Boolean)
    if (numbers.length) out.push({ type: 'client', id: idOf(c), name: clientTitle(c, owner), detail: c.clientCode ?? 'Client', numbers })
  }
  for (const l of leads) {
    const numbers = [
      l.phone && { field: 'phone', label: 'Phone', display: v.phone(l.phone) },
      l.alternativePhone && { field: 'alternativePhone', label: 'Alternate', display: v.phone(l.alternativePhone) },
    ].filter(Boolean)
    if (numbers.length) out.push({ type: 'lead', id: idOf(l), name: l.name, detail: ['Lead', l.company].filter(Boolean).join(' · '), numbers })
  }
  const exts = settings?.extensions ?? {}
  for (const u of matchedUsers.filter(x => STAFF_ROLES.includes(x.role))) {
    const ext = exts[String(u._id)]
    if (ext && String(u._id) !== session.user.id) {
      out.push({ type: 'staff', id: idOf(u), name: u.name, detail: 'Colleague', numbers: [{ field: 'extension', label: 'Extension', display: String(ext), dial: String(ext) }] })
    }
  }
  // Colleagues by extension number.
  if (byNumber && digits.length <= 8 && Object.keys(exts).length) {
    for (const [uid, ext] of Object.entries(exts)) {
      if (!String(ext).startsWith(digits) || uid === session.user.id || out.some(o => o.type === 'staff' && o.id === uid)) continue
      if (!isValidObjectId(uid)) continue
      const u = await User.findById(uid).select('name').lean()
      if (u) out.push({ type: 'staff', id: uid, name: u.name, detail: 'Colleague', numbers: [{ field: 'extension', label: 'Extension', display: String(ext), dial: String(ext) }] })
    }
  }
  return out.slice(0, 10)
}

// ── The number behind a call button ──────────────────────────────────────────

const TARGET_FIELDS = { client: ['phone', 'companyPhone', 'altPhone'], lead: ['phone', 'alternativePhone'] }

/**
 * The number to dial for { type, id, field }, if this person may see that record:
 * { number (dialable), display (masked without pii.contact.view), name } or null.
 */
export async function resolveTarget(session, { type, id, field }) {
  if (!TARGET_FIELDS[type]?.includes(field) || !isValidObjectId(id)) return null
  await connectDB()
  const v = viewer(session)
  if (type === 'client') {
    if (!v.clients) return null
    const c = await Client.findById(id).select('userId clientType company contactPerson clientCode companyPhone altPhone').lean()
    if (!c) return null
    const owner = await User.findById(c.userId).select('name phone').lean()
    const raw = field === 'phone' ? owner?.phone : c[field]
    if (!dialable(raw)) return null
    return { number: dialable(raw), display: v.phone(raw), name: clientTitle(c, owner) }
  }
  if (!v.leads) return null
  const l = await Lead.findById(id).select('name phone alternativePhone assignedToId').lean()
  if (!l || !(await canAccessLead(session, l))) return null
  const raw = l[field]
  if (!dialable(raw)) return null
  return { number: dialable(raw), display: v.phone(raw), name: l.name }
}
