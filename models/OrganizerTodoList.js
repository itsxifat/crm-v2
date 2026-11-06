import mongoose from 'mongoose'
import { PALETTE_KEYS } from '../lib/organizer/constants.js'

const OrganizerTodoListSchema = new mongoose.Schema(
  {
    organizerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organizer', required: true, index: true },
    name:        { type: String, required: true, trim: true, maxlength: 80 },
    color:       { type: String, enum: PALETTE_KEYS, default: 'zinc' },
    position:    { type: Number, default: 0 },
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

export default mongoose.models.OrganizerTodoList ?? mongoose.model('OrganizerTodoList', OrganizerTodoListSchema)
