import mongoose from 'mongoose'
import { TODO_STATUSES, TODO_PRIORITIES } from '../lib/organizer/constants.js'

const OrganizerTodoSchema = new mongoose.Schema(
  {
    organizerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Organizer', required: true },
    listId:       { type: mongoose.Schema.Types.ObjectId, ref: 'OrganizerTodoList', required: true },
    projectId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    title:        { type: String, required: true, trim: true, maxlength: 300 },
    notes:        { type: String, default: null, maxlength: 5000 },
    status:       { type: String, enum: TODO_STATUSES, default: 'OPEN' },
    priority:     { type: String, enum: TODO_PRIORITIES, default: 'MEDIUM' },
    // LOW 1 · MEDIUM 2 · HIGH 3 · URGENT 4 — always written by the API with priority.
    priorityRank: { type: Number, default: 2 },
    // Date-only: UTC midnight of the 'YYYY-MM-DD' day.
    dueDate:      { type: Date, default: null },
    assigneeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Lowercase, trimmed, at most 10 tags of at most 30 chars (lib/organizer/validation.js).
    tags:         { type: [String], default: [] },
    position:     { type: Number, default: 0 },
    // Set on the transition into DONE, cleared when it leaves DONE.
    completedAt:  { type: Date, default: null },
    createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

OrganizerTodoSchema.index({ organizerId: 1, listId: 1, position: 1 })
OrganizerTodoSchema.index({ dueDate: 1 })
OrganizerTodoSchema.index({ assigneeId: 1 })

export default mongoose.models.OrganizerTodo ?? mongoose.model('OrganizerTodo', OrganizerTodoSchema)
