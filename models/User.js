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
    passwordResetToken:    { type: String, default: null },  // legacy: set only after admin approval
    passwordResetExpiry:   { type: Date,   default: null },

    // ── Self-service reset by emailed code (lib/passwordReset.js) ────────────────
    resetOtp:            { type: String, default: null },  // HMAC of the 6-digit code
    resetOtpExpiry:      { type: Date,   default: null },
    resetOtpAttempts:    { type: Number, default: 0 },
    resetOtpSentAt:      { type: Date,   default: null },  // resend cooldown
    resetOtpWindowStart: { type: Date,   default: null },  // send-cap window
    resetOtpSendCount:   { type: Number, default: 0 },
    resetTokenHash:      { type: String, default: null },  // sha256 of the post-verify token
    resetTokenExpiry:    { type: Date,   default: null },
    // Sessions signed in before this instant are revoked (set on password reset).
    passwordChangedAt:   { type: Date,   default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) {
        ret.id = ret._id.toString()
        delete ret._id; delete ret.__v; delete ret.password
        delete ret.loginOtp; delete ret.activationToken; delete ret.passwordResetToken
        delete ret.resetOtp; delete ret.resetTokenHash
        return ret
      },
    },
  }
)

UserSchema.index({ email: 1 }, { unique: true })
UserSchema.index({ phone: 1 }, { sparse: true })

export default mongoose.models.User ?? mongoose.model('User', UserSchema)
