/**
 * lib/encloud/events.js — SERVER-ONLY. Events encloud sends the CRM
 * (POST /api/webhooks/encloud, signed; contract: encloud docs/crm-api.md).
 *
 *   due.paid       paid on an encloud link (paid_via enfinito_pay) → book the money
 *                  marked paid by encloud staff (staff)            → files stay open, finance told
 *                  marked paid by the CRM itself (crm)             → an echo, nothing to do
 *   due.updated    waived, cancelled or reopened in encloud — or an echo of the CRM's own change
 *   share.verified a customer confirmed their email on a shared link
 *   files.added    files were uploaded to a client's or project's folder
 *   ping           "Send test event" in encloud
 *
 * @returns 'PROCESSED' | 'IGNORED'
 */
import connectDB from '@/lib/mongodb'
import { Invoice, Project, EncloudLink } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { recordEncloudPayment } from '@/lib/onlinePayments'
import { remoteOfDue, isOwnDueChange, CRM_PAID_VIA } from '@/lib/encloud/sync'
import { createNotification } from '@/lib/createNotification'
import { inventoryManagerUserIds } from '@/app/api/my-assets/_lib/shared'
import { invoiceLabel } from '@/lib/paymentLedger'
import { formatMoney } from '@/lib/currencies'

async function notifyFinance(title, message, link) {
  const ids = await inventoryManagerUserIds({ perms: ['finance.payments.confirm'] })
  if (ids.length) await createNotification({ userId: ids, title, message, type: 'PAYMENT', link })
}

/** The invoice behind a due (its crm_id), or null for a due staff made in encloud. */
async function invoiceOf(due) {
  const id = due?.crm_id
  if (!id || !isValidObjectId(id)) return null
  return Invoice.findById(id).select('invoiceNumber clientId projectId projectIds status currency total paidAmount').lean()
}

/**
 * Stores encloud's view of the due — unless what is stored is newer (events can
 * arrive late, or twice). Returns the link.
 */
async function recordRemote(invoice, due, at) {
  const link = await EncloudLink.findOneAndUpdate(
    { kind: 'DUE', refId: invoice._id },
    { $setOnInsert: { kind: 'DUE', refId: invoice._id } },
    { upsert: true, new: true },
  ).lean()
  const asOf = link.remote?.asOf ? new Date(link.remote.asOf) : null
  if (!asOf || asOf < at) {
    await EncloudLink.updateOne(
      { _id: link._id, 'remote.asOf': link.remote?.asOf ?? null },
      { $set: { remote: remoteOfDue(due, at) } },
    )
  }
  return link
}

async function stopLocking(invoice, reason) {
  await EncloudLink.updateOne(
    { kind: 'DUE', refId: invoice._id, mode: { $ne: 'OFF' } },
    { $set: { mode: 'OFF', offReason: reason, offAt: new Date(), offBy: null } },
  )
}

async function onDuePaid(due, at) {
  const invoice = await invoiceOf(due)
  if (!invoice) return 'IGNORED'
  const link = await recordRemote(invoice, due, at)

  if (due.paid_via === 'enfinito_pay') {
    // Money was taken: always booked, however late the event arrives.
    await recordEncloudPayment({ invoice, due })
    return 'PROCESSED'
  }
  if (due.paid_via === 'staff') {
    // An encloud admin opened the files by hand. The CRM still counts the money as due.
    // (Unless the CRM changed the due since — then its newer state stands.)
    const superseded = link.remote?.asOf && new Date(link.remote.asOf) > at
    if (!superseded) await stopLocking(invoice, 'Marked paid in encloud by staff')
    await notifyFinance(
      'Files unlocked in encloud',
      `encloud staff marked ${invoiceLabel(invoice)} (${formatMoney(due.amount, 'BDT')}) as paid, so the customer's files are open. If the money was received, record the payment on the invoice.`,
      `/admin/invoices/${invoice._id}`,
    )
    return 'PROCESSED'
  }
  // paid_via "crm" (or another value the CRM sent with mark-paid): our own change coming back.
  return due.paid_via === CRM_PAID_VIA ? 'IGNORED' : 'PROCESSED'
}

async function onDueUpdated(due, at) {
  const invoice = await invoiceOf(due)
  if (!invoice) return 'IGNORED'
  const link = await recordRemote(invoice, due, at)
  // The echo of the CRM's own push (also a late one, after newer pushes).
  if (isOwnDueChange(link, due.status, at)) return 'IGNORED'
  // Older than the newest state the CRM knows: superseded, nothing to act on.
  if (link.remote?.asOf && new Date(link.remote.asOf) > at) return 'IGNORED'

  if (due.status === 'waived' || due.status === 'cancelled') {
    await stopLocking(invoice, due.status === 'waived' ? 'Waived in encloud' : 'Cancelled in encloud')
    await notifyFinance(
      'Files unlocked in encloud',
      `The due for ${invoiceLabel(invoice)} was ${due.status} in encloud, so the customer's files are open. The invoice in the CRM is unchanged.`,
      `/admin/invoices/${invoice._id}`,
    )
    return 'PROCESSED'
  }
  if (due.status === 'open') {
    // Reopened in encloud — after a refund there, or by staff. The CRM's books are not changed.
    await notifyFinance(
      'Files locked again in encloud',
      `encloud reopened the due for ${invoiceLabel(invoice)} (${formatMoney(due.amount, 'BDT')}), so the customer's files are locked again. If an online payment was refunded, reverse it on the invoice.`,
      `/admin/invoices/${invoice._id}`,
    )
    return 'PROCESSED'
  }
  return 'IGNORED'
}

async function onShareVerified(data) {
  const pid = data?.project_crm_id
  if (!pid || !isValidObjectId(pid)) return 'IGNORED'
  const project = await Project.findById(pid).select('name projectManagerId').lean()
  if (!project?.projectManagerId) return 'IGNORED'
  await createNotification({
    userId:  String(project.projectManagerId),
    title:   'Client opened the shared files',
    message: `${String(data.email ?? 'The client')} confirmed their email and opened "${String(data.item?.name ?? project.name)}" in encloud.`,
    type:    'PROJECT',
    link:    `/admin/projects/${project._id}`,
  })
  return 'PROCESSED'
}

async function onFilesAdded(data) {
  const pid = data?.project?.crm_id
  if (!pid || !isValidObjectId(pid)) return 'IGNORED'
  await EncloudLink.updateOne(
    { kind: 'PROJECT', refId: pid },
    { $inc: { 'remote.files': Number(data.files) || 0, 'remote.bytes': Number(data.bytes) || 0 }, $set: { 'remote.lastAddedAt': new Date() } },
  )
  return 'PROCESSED'
}

/** When encloud made the event (its created_at), else now. */
function eventTime(event) {
  const t = Date.parse(event?.created_at ?? '')
  return Number.isFinite(t) ? new Date(t) : new Date()
}

export async function handleEncloudEvent(event) {
  await connectDB()
  const data = event?.data ?? {}
  const at = eventTime(event)
  switch (event?.type) {
    case 'due.paid':       return onDuePaid(data.due, at)
    case 'due.updated':    return onDueUpdated(data.due, at)
    case 'share.verified': return onShareVerified(data)
    case 'files.added':    return onFilesAdded(data)
    case 'ping':           return 'PROCESSED'
    default:               return 'IGNORED'
  }
}
