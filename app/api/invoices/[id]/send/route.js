export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { requirePerm, canDo } from '@/lib/rbac'
import { maskDoc, maskEmail, INVOICE_PII } from '@/lib/pii'
import { isValidObjectId } from '@/lib/objectId'
import { ensureCombinedInvoice } from '@/lib/combinedInvoice'
import { syncSoon } from '@/lib/encloud/sync'
import { issueDraftInvoice, ensureIssuedOutputVat } from './issue'

// POST /api/invoices/[id]/send
// DRAFT → SENT is the VAT tax point: stamps issuedAt, snapshots seller/buyer
// (BINs as they are today) and records the OUTPUT_VAT entry. Re-sending an
// issued invoice only stamps sentAt and keeps its payment / overdue state.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.send')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    await connectDB()

    const invoice = await Invoice.findById(params.id)
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email' } })

    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') {
      return NextResponse.json({ error: `Cannot send an invoice with status ${invoice.status}` }, { status: 400 })
    }

    let updated
    let warnings = []
    let outputVatEntry = null
    const wasDraft = invoice.status === 'DRAFT'

    if (wasDraft) {
      try {
        const issued = await issueDraftInvoice(invoice, { userId: session.user.id, stampSentAt: true })
        updated = issued.invoice
        warnings = issued.warnings
        outputVatEntry = issued.outputVatEntry
      } catch (err) {
        if (err.status) return NextResponse.json({ error: err.message }, { status: err.status })
        throw err
      }
    } else {
      updated = await Invoice.findOneAndUpdate(
        { _id: params.id, status: { $nin: ['DRAFT', 'PAID', 'CANCELLED'] } },
        { $set: { sentAt: new Date() } },
        { new: true }
      )
      if (!updated)
        return NextResponse.json({ error: 'Invoice status changed in the meantime. Reload and try again.' }, { status: 409 })
      const repaired = await ensureIssuedOutputVat(updated, { userId: session.user.id })
      warnings = repaired.warnings
      outputVatEntry = repaired.outputVatEntry
    }

    // Issuing can push the project over the "needs a combined invoice" line.
    const projectId = updated.projectId ?? updated.projectIds?.[0] ?? null
    if (projectId) {
      try { await ensureCombinedInvoice(projectId, { createdBy: session.user.id }) }
      catch (e) { console.error('[POST /api/invoices/[id]/send] ensureCombinedInvoice', e) }
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'SEND',
      entity:   'INVOICE',
      entityId: params.id,
      changes:  JSON.stringify({
        invoiceNumber: invoice.invoiceNumber,
        status:        wasDraft ? { from: 'DRAFT', to: updated.status } : updated.status,
        sentAt:        updated.sentAt,
        ...(wasDraft ? { issuedAt: updated.issuedAt } : {}),
        ...(outputVatEntry ? { outputVatEntry: outputVatEntry.entryNo ?? String(outputVatEntry._id) } : {}),
      }),
      request,
    })

    // Issued with a balance: the client's files in encloud lock until it is paid.
    syncSoon('invoice', params.id)

    // The recipient's login email and the buyer snapshot (e-TIN) are client PII:
    // masked for staff without pii.* permissions, exactly like GET /api/invoices/:id.
    const recipient = invoice.clientId?.userId?.email ?? null
    return NextResponse.json({
      message: `Invoice ${invoice.invoiceNumber} marked as sent`,
      sentTo:  recipient ? (canDo(session, 'pii.contact.view') ? recipient : maskEmail(recipient)) : 'unknown',
      data:    maskDoc(session, updated.toJSON(), INVOICE_PII),
      ...(warnings.length ? { warning: warnings.join(' '), warnings } : {}),
    })
  } catch (err) {
    console.error('[POST /api/invoices/[id]/send]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
