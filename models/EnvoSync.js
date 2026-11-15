import mongoose from 'mongoose'
import { productSyncSchema } from './productSyncSchema.js'

/**
 * EnvoSync — where one Envo invoice stands in the CRM (lib/products/sync.js):
 * envoId, envoStatus, envoVersion, the state, and the lease. See productSyncSchema.
 */
const EnvoSyncSchema = productSyncSchema('envo')

if (mongoose.models.EnvoSync) delete mongoose.models.EnvoSync
export default mongoose.model('EnvoSync', EnvoSyncSchema)
