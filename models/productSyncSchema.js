import mongoose from 'mongoose'

/**
 * The schema of a product's sync record (EnvoSync, NcomSync): where one of its
 * invoices stands in the CRM (lib/products/sync.js). `prefix` names the fields that
 * tie it to the product: envoId / envoStatus / envoVersion, ncomId / ncomStatus / ncomVersion.
 *
 * The product pushes the whole state of an invoice whenever it changes, so repeating a
 * push is harmless. This record serialises the work on one invoice (`leaseUntil`)
 * and shows finance what could not be done automatically:
 *   RUNNING   first push still going, or it died: the next one settles it
 *   OK        the CRM matches what the product sent
 *   REVIEW    the money is safe but someone has to act (books locked, no money
 *             account, paid twice…); the product keeps retrying, so fixing the cause is enough
 *   REJECTED  what the product sent failed validation; nothing was written
 */
export function productSyncSchema(prefix) {
  const schema = new mongoose.Schema(
    {
      [`${prefix}Id`]: { type: Number, required: true },
      invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
      clientId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Client',  default: null },
      number:    { type: String, default: null },

      state: { type: String, enum: ['RUNNING', 'OK', 'REVIEW', 'REJECTED'], default: 'RUNNING' },
      code:  { type: String, default: null },
      note:  { type: String, default: null },

      [`${prefix}Status`]:  { type: String, default: null },
      [`${prefix}Version`]: { type: Number, default: null },
      total:       { type: Number, default: null },
      attempts:    { type: Number, default: 0 },
      syncedAt:    { type: Date, default: null },

      leaseUntil: { type: Date, default: null },
      leaseId:    { type: String, default: null },   // whose lease: a run that lost it records nothing
    },
    {
      timestamps: true,
      toJSON: {
        virtuals: true,
        transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; delete ret.leaseUntil; delete ret.leaseId; return ret },
      },
    }
  )
  schema.index({ [`${prefix}Id`]: 1 }, { unique: true })
  schema.index({ state: 1, updatedAt: -1 })
  return schema
}
