/**
 * lib/agreementAccess.js — read scoping for Agreement routes.
 *
 * Staff reads are limited to managers (the same roles that create/edit
 * agreements). External users (CLIENT / FREELANCER / VENDOR) only see
 * non-draft agreements that are addressed to them.
 */
import { Freelancer, Vendor } from '@/models'
import { getMyCompanyIds } from '@/lib/clientAccess'

const MANAGER_ROLES = ['SUPER_ADMIN', 'MANAGER']
const EXTERNAL_ROLES = ['CLIENT', 'FREELANCER', 'VENDOR']

// Populate specs that never expose KYC, bank, identity, invite tokens or notes.
export const AGREEMENT_POPULATE = [
  { path: 'clientId',     select: 'clientCode clientType company userId', populate: { path: 'userId', select: 'name' } },
  { path: 'freelancerId', select: 'type agencyInfo.agencyName userId',     populate: { path: 'userId', select: 'name' } },
  { path: 'vendorId',     select: 'company' },
]

/**
 * Returns a Mongo filter restricting agreements to what the caller may read,
 * `{}` for managers, or null when the caller may read nothing.
 */
export async function agreementScopeFilter(session) {
  const role = session?.user?.role
  if (MANAGER_ROLES.includes(role)) return {}
  if (!EXTERNAL_ROLES.includes(role)) return null

  const userId = session.user.id
  const notDraft = { status: { $ne: 'DRAFT' } }

  if (role === 'CLIENT') {
    const companyIds = await getMyCompanyIds(userId)
    if (!companyIds.length) return null
    return { ...notDraft, clientId: { $in: companyIds } }
  }
  if (role === 'FREELANCER') {
    const me = await Freelancer.findOne({ userId }).select('_id').lean()
    if (!me) return null
    return { ...notDraft, freelancerId: me._id }
  }
  // VENDOR
  const me = await Vendor.findOne({ userId }).select('_id').lean()
  if (!me) return null
  return { ...notDraft, vendorId: me._id }
}
