import mongoose from 'mongoose'

const UserSchema = new mongoose.Schema(
  {
    email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:  { type: String, required: true },
    name:      { type: String, required: true, trim: true },
    role:      {
      type:    String,
      enum:    ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE', 'FREELANCER', 'CLIENT', 'VENDOR'],
      default: 'EMPLOYEE',
    },
    avatar:    { type: String, default: null },
    phone:     { type: String, default: null },
    isActive:  { type: Boolean, default: true },
    lastLogin: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) {
        ret.id = ret._id.toString()
        delete ret._id
        delete ret.__v
        delete ret.password
        return ret
      },
    },
  }
)

export default mongoose.models.User ?? mongoose.model('User', UserSchema)
