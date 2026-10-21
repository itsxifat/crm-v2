// Server-only: recipient autocomplete (mail history + CRM records) and CRM lookup for a sender.
// Errors: none thrown for normal input (unauthorised sessions just get []); routes return `err.status ?? 500` for anything unexpected.
import { MailAccount, MailMessage, User, Lead, Client, Employee } from '@/models'
import { canDo } from '@/lib/rbac'
import { ciContains, ciEquals } from '@/lib/searchMatch'
import { isStaff, accessibleAccountIds } from '@/lib/mail/access'

const STAFF_ROLES = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']
const ADDRESS_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/
const DAY_MS = 24 * 60 * 60 * 1000

const canSeeClients = session => canDo(session, 'sales.customers.view')
const canSeeLeads = session => canDo(session, 'sales.leads.view')

function cleanAddress(v) {
  const a = String(v ?? '').trim().toLowerCase()
  return a.length <= 254 && ADDRESS_RE.test(a) ? a : null
}

function cleanName(v, address) {
  const n = String(v ?? '').replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim()
  return n && n.toLowerCase() !== address ? n.slice(0, 120) : ''
}

/** Prefix hits (start of the address, or of any word in the name) outrank plain substring hits. */
function prefixBoost(name, address, ql) {
  if (!ql) return 0
  if (address.startsWith(ql)) return 4
  const n = name.toLowerCase()
  if (n.startsWith(ql) || n.split(/[\s.'_-]+/).some(w => w.startsWith(ql))) return 4
  if ((address.split('@')[1] || '').startsWith(ql)) return 1
  return 0
}

async function historyContacts(session, q) {
  const ids = await accessibleAccountIds(session)
  if (!ids.length) return []
  const own = (await MailAccount.find({ _id: { $in: ids } }).select('email').lean())
    .map(a => String(a.email || '').toLowerCase())
    .filter(Boolean)

  const rx = q ? ciContains(q) : null
  const match = { accountId: { $in: ids }, folderRole: { $nin: ['SPAM', 'TRASH', 'DRAFTS'] } }
  if (rx) {
    match.$or = ['from.address', 'from.name', 'to.address', 'to.name', 'cc.address', 'cc.name'].map(f => ({ [f]: rx }))
  }

  const rows = await MailMessage.aggregate([
    { $match: match },
    { $sort: { date: -1 } },
    // Bounded scan: the newest matching messages are what "recent contacts" means anyway.
    { $limit: q ? 2000 : 500 },
    {
      $project: {
        date: 1,
        folderRole: 1,
        people: { $concatArrays: [[{ $ifNull: ['$from', {}] }], { $ifNull: ['$to', []] }, { $ifNull: ['$cc', []] }] },
      },
    },
    { $unwind: '$people' },
    {
      $project: {
        date: 1,
        folderRole: 1,
        name: { $ifNull: ['$people.name', ''] },
        address: { $toLower: { $trim: { input: { $ifNull: ['$people.address', ''] } } } },
      },
    },
    { $match: { address: { $nin: [...own, ''] }, ...(rx ? { $or: [{ address: rx }, { name: rx }] } : {}) } },
    {
      $group: {
        _id: '$address',
        recentName: { $first: '$name' },
        anyName: { $max: '$name' },
        count: { $sum: 1 },
        // People you write to matter more than people who write to you (newsletters)
        sent: { $sum: { $cond: [{ $eq: ['$folderRole', 'SENT'] }, 1, 0] } },
        last: { $max: '$date' },
      },
    },
    { $sort: { count: -1, last: -1 } },
    { $limit: 150 },
  ])

  const now = Date.now()
  const ql = q.toLowerCase()
  const out = []
  for (const r of rows) {
    const address = cleanAddress(r._id)
    if (!address) continue
    const name = cleanName(r.recentName, address) || cleanName(r.anyName, address)
    const ageDays = r.last ? (now - new Date(r.last).getTime()) / DAY_MS : 365
    const recency = Math.max(0, 3 - ageDays / 30)
    const freq = Math.log2(1 + r.count + 2 * r.sent)
    out.push({ name, address, source: 'history', score: 2 + freq + recency + prefixBoost(name, address, ql) })
  }
  return out
}

async function crmContacts(session, q, limit) {
  const rx = ciContains(q)
  const ql = q.toLowerCase()
  const take = limit * 2
  const clients = canSeeClients(session)
  const leads = canSeeLeads(session)

  const [users, leadRows, clientRows] = await Promise.all([
    User.find({
      isActive: true,
      role: { $in: clients ? [...STAFF_ROLES, 'CLIENT'] : STAFF_ROLES },
      $or: [{ name: rx }, { email: rx }],
    }).select('name email role').limit(take).lean(),
    leads
      ? Lead.find({ email: { $nin: [null, ''] }, $or: [{ name: rx }, { email: rx }, { company: rx }] })
        .select('name email company').sort({ updatedAt: -1 }).limit(take).lean()
      : [],
    clients
      ? Client.find({ companyEmail: { $nin: [null, ''] }, $or: [{ companyEmail: rx }, { company: rx }, { contactPerson: rx }] })
        .select('company contactPerson companyEmail').limit(take).lean()
      : [],
  ])

  const out = []
  const add = (name, rawAddress, source) => {
    const address = cleanAddress(rawAddress)
    if (!address) return
    const n = cleanName(name, address)
    out.push({ name: n, address, source, score: 2.5 + prefixBoost(n, address, ql) })
  }
  for (const u of users) add(u.name, u.email, u.role === 'CLIENT' ? 'client' : 'staff')
  for (const c of clientRows) add(c.company || c.contactPerson, c.companyEmail, 'client')
  for (const l of leadRows) add(l.name, l.email, 'lead')
  return out
}

/**
 * Recipient suggestions for the composer.
 * @returns {Promise<{ name: string, address: string, source: 'history'|'client'|'lead'|'staff' }[]>}
 */
export async function suggestContacts(session, q, limit = 8) {
  if (!isStaff(session)) return []
  const query = String(q ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
  const max = Math.min(20, Math.max(1, Number(limit) || 8))

  const [history, crm] = await Promise.all([
    historyContacts(session, query),
    query.length >= 2 ? crmContacts(session, query, max) : [],
  ])

  const byAddress = new Map()
  for (const h of history) if (!byAddress.has(h.address)) byAddress.set(h.address, { ...h })
  for (const c of crm) {
    const hit = byAddress.get(c.address)
    if (!hit) {
      byAddress.set(c.address, { ...c })
    } else {
      // Known to both: keep the history rank, show the CRM badge, bump it slightly.
      if (hit.source === 'history') {
        hit.source = c.source
        hit.score += 1
      }
      if (!hit.name) hit.name = c.name
    }
  }

  return [...byAddress.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ name, address, source }) => ({ name, address, source }))
}

/**
 * CRM record behind an email address (for the reader's "Client · Acme" chip).
 * Pass `session` to hide clients/leads from staff without those permissions.
 * @returns {Promise<{ type: 'client'|'lead'|'staff', id: string, name: string, label: string, href: string|null } | null>}
 */
export async function lookupCrmContact(address, session = null) {
  const addr = cleanAddress(address)
  if (!addr) return null
  const allowClients = !session || canSeeClients(session)
  const allowLeads = !session || canSeeLeads(session)

  const user = await User.findOne({ email: addr }).select('name role').lean()

  if (user?.role === 'CLIENT' && allowClients) {
    const client = await Client.findOne({ userId: user._id }).select('company contactPerson').lean()
    if (client) {
      return {
        type: 'client',
        id: String(client._id),
        name: user.name,
        label: client.company || client.contactPerson || user.name,
        href: `/admin/clients/${client._id}`,
      }
    }
  }

  if (user && STAFF_ROLES.includes(user.role)) {
    const emp = await Employee.findOne({ userId: user._id }).select('_id').lean()
    return {
      type: 'staff',
      id: String(emp?._id ?? user._id),
      name: user.name,
      label: user.name,
      // Admin accounts may have no Employee profile to link to
      href: emp ? `/admin/employees/${emp._id}` : null,
    }
  }

  if (allowClients) {
    const client = await Client.findOne({ companyEmail: ciEquals(addr) }).select('company contactPerson').lean()
    if (client) {
      const label = client.company || client.contactPerson || addr
      return { type: 'client', id: String(client._id), name: client.contactPerson || label, label, href: `/admin/clients/${client._id}` }
    }
  }

  if (allowLeads) {
    const lead = await Lead.findOne({ email: ciEquals(addr) }).sort({ updatedAt: -1 }).select('name company').lean()
    if (lead) {
      return { type: 'lead', id: String(lead._id), name: lead.name, label: lead.company || lead.name, href: `/admin/leads/${lead._id}` }
    }
  }

  return null
}
