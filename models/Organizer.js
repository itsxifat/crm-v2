import mongoose from 'mongoose'
import { PALETTE_KEYS, ORGANIZER_STATUSES } from '../lib/organizer/constants.js'

// A workspace (usually for one client) holding calendars, to-do lists and notes.
const OrganizerSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: null, maxlength: 2000 },
    color:       { type: String, enum: PALETTE_KEYS, default: 'zinc' },
    clientId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    projectIds:  { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }], default: [] },
    status:      { type: String, enum: ORGANIZER_STATUSES, default: 'ACTIVE' },
    pinned:      { type: Boolean, default: false },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

OrganizerSchema.index({ status: 1, updatedAt: -1 })
OrganizerSchema.index({ clientId: 1 })

export default mongoose.models.Organizer ?? mongoose.model('Organizer', OrganizerSchema)
