import mongoose from 'mongoose'
import { PALETTE_KEYS } from '../lib/organizer/constants.js'

const OrganizerNoteSchema = new mongoose.Schema(
  {
    organizerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organizer', required: true, index: true },
    projectId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    title:       { type: String, trim: true, default: '', maxlength: 200 },
    // Plain text; newlines preserved.
    content:     { type: String, default: '', maxlength: 50000 },
    color:       { type: String, enum: PALETTE_KEYS, default: 'zinc' },
    pinned:      { type: Boolean, default: false },
    // Same rules as to-do tags.
    tags:        { type: [String], default: [] },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

export default mongoose.models.OrganizerNote ?? mongoose.model('OrganizerNote', OrganizerNoteSchema)
