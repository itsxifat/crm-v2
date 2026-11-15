import mongoose from 'mongoose'
import { productSyncSchema } from './productSyncSchema.js'

/**
 * NcomSync — where one NCOM invoice stands in the CRM (lib/products/sync.js):
 * ncomId, ncomStatus, ncomVersion, the state, and the lease. See productSyncSchema.
 */
const NcomSyncSchema = productSyncSchema('ncom')

if (mongoose.models.NcomSync) delete mongoose.models.NcomSync
export default mongoose.model('NcomSync', NcomSyncSchema)
