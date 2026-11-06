import mongoose from 'mongoose'
import { PALETTE_KEYS, REPEAT_VALUES } from '../lib/organizer/constants.js'

// One calendar event, or the master of a recurring series (expanded on read by
// lib/organizer/recurrence.js).
//   allDay: start = UTC midnight of the first day, end = UTC midnight of the LAST
//           day (inclusive) — clients read the day with iso.slice(0, 10).
//   timed:  start / end are real instants.
const OrganizerEventSchema = new mongoose.Schema(
  {
    organizerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Organizer', required: true },   // denormalised from the calendar
    calendarId:     { type: mongoose.Schema.Types.ObjectId, ref: 'OrganizerCalendar', required: true },
    projectId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null },
    title:          { type: String, required: true, trim: true, maxlength: 200 },
    description:    { type: String, default: null, maxlength: 5000 },
    location:       { type: String, default: null, maxlength: 300 },
    allDay:         { type: Boolean, default: false },
    start:          { type: Date, required: true },
    end:            { type: Date, required: true },
    repeat:         { type: String, enum: REPEAT_VALUES, default: 'NONE' },
    repeatInterval: { type: Number, default: 1, min: 1, max: 365 },
    // Inclusive: UTC midnight of the last day a series occurrence may START on.
    repeatUntil:    { type: Date, default: null },
    // Start instants of skipped occurrences.
    exDates:        { type: [Date], default: [] },
    // Override of the calendar colour (null = use the calendar colour).
    color:          { type: String, enum: [...PALETTE_KEYS, null], default: null },
    createdBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

OrganizerEventSchema.index({ calendarId: 1, start: 1 })
OrganizerEventSchema.index({ organizerId: 1, start: 1 })

OrganizerEventSchema.pre('validate', function (next) {
  if (this.start && this.end && this.end < this.start) this.invalidate('end', 'End must be on or after start')
  next()
})

export default mongoose.models.OrganizerEvent ?? mongoose.model('OrganizerEvent', OrganizerEventSchema)
