import mongoose from 'mongoose'

const EditRequestSchema = new mongoose.Schema(
  {
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    itemType:    { type: String, enum: ['PROJECT_EXPENSE'], required: true },
    itemId:      { type: mongoose.Schema.Types.ObjectId, required: true },
    reason:      { type: String, required: true, trim: true },
    status:      { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },

    otp:         { type: String, default: null },
    otpExpiry:   { type: Date,   default: null },
    otpUsed:     { type: Boolean, default: false },

    reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt:  { type: Date,   default: null },
    reviewNote:  { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) {
        ret.id = ret._id.toString()
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  }
)

if (mongoose.models.EditRequest) delete mongoose.models.EditRequest
export default mongoose.model('EditRequest', EditRequestSchema)
