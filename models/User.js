import mongoose from 'mongoose'
import { encryptionPlugin } from '@/lib/encryptionPlugin'

const UserSchema = new mongoose.Schema(
  {
    email:     { type: String, required: true },   // stored encrypted
    password:  { type: String, required: true },
    name:      { type: String, required: true, trim: true }, // stored encrypted
    role:      {
      type:    String,
      enum:    ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE', 'FREELANCER', 'CLIENT', 'VENDOR'],
      default: 'EMPLOYEE',
    },
    avatar:    { type: String, default: null },    // stored encrypted
    phone:     { type: String, default: null },    // stored encrypted
    isActive:  { type: Boolean, default: true },
    lastLogin: { type: Date, default: null },

    // Blind indexes — HMAC tokens for equality-safe lookups on encrypted fields.
    // Never returned in API responses.
    emailIdx: { type: String, default: null, select: false },
    phoneIdx: { type: String, default: null, select: false },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) {
        ret.id = ret._id.toString()
        delete ret._id; delete ret.__v; delete ret.password
        delete ret.emailIdx; delete ret.phoneIdx
        return ret
      },
    },
  }
)

// Unique constraint on the blind index, not the ciphertext
UserSchema.index({ emailIdx: 1 }, { unique: true, sparse: true })
UserSchema.index({ phoneIdx: 1 }, { sparse: true })

UserSchema.plugin(encryptionPlugin, {
  collection: 'users',
  fields: [
    { path: 'email'  },
    { path: 'name'   },
    { path: 'phone'  },
    { path: 'avatar' },
  ],
  blindIndexes: [
    { path: 'email', indexField: 'emailIdx' },
    { path: 'phone', indexField: 'phoneIdx' },
  ],
})

export default mongoose.models.User ?? mongoose.model('User', UserSchema)
