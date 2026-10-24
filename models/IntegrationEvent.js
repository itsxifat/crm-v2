import mongoose from 'mongoose'

/**
 * IntegrationEvent — inbox of signed webhooks from Enfinito Pay and encloud.
 * Both resend an event until it is acknowledged and may deliver one twice, so
 * (provider, eventId) is unique: a repeat is acknowledged without running again.
 * Kept 90 days.
 */
const IntegrationEventSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ['ENFINITO_PAY', 'ENCLOUD'], required: true },
    eventId:  { type: String, required: true },
    type:     { type: String, required: true },
    status:   { type: String, enum: ['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'], default: 'RECEIVED' },
    error:    { type: String, default: null },
    attempts: { type: Number, default: 0 },
    payload:  { type: mongoose.Schema.Types.Mixed, default: null },
    processedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

IntegrationEventSchema.index({ provider: 1, eventId: 1 }, { unique: true })
IntegrationEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })

if (mongoose.models.IntegrationEvent) delete mongoose.models.IntegrationEvent
export default mongoose.model('IntegrationEvent', IntegrationEventSchema)
