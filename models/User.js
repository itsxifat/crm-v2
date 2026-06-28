import mongoose from 'mongoose'
const UserSchema = new mongoose.Schema(
  {
    email:     { type: String, required: true, lowercase: true, trim: true },
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
    // Set true when an account is created without a self-chosen password; cleared
    // once the person sets their own password (forced after first OTP activation).
    mustChangePassword: { type: Boolean, default: false },

    // ── Client onboarding / recovery secrets (never exposed via toJSON) ──────────
    activationToken:       { type: String, default: null },  // magic-link token for first access
    activationTokenExpiry: { type: Date,   default: null },
    loginOtp:              { type: String, default: null },  // bcrypt-hashed 6-digit OTP
    loginOtpExpiry:        { type: Date,   default: null },
    passwordResetToken:    { type: String, default: null },  // set only after admin approval
    passwordResetExpiry:   { type: Date,   default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) {
        ret.id = ret._id.toString()
        delete ret._id; delete ret.__v; delete ret.password
        delete ret.loginOtp; delete ret.activationToken; delete ret.passwordResetToken
        return ret
      },
    },
  }
)

UserSchema.index({ email: 1 }, { unique: true })
UserSchema.index({ phone: 1 }, { sparse: true })

export default mongoose.models.User ?? mongoose.model('User', UserSchema)
