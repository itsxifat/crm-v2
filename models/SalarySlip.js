import mongoose from 'mongoose'

// A generated payslip for one employee for one period ('YYYY-MM'). Snapshots the
// earnings/deductions breakdown at generation time. Payment state is NOT
// duplicated here — it's owned by the linked ProjectExpense (origin SALARY),
// which flows through the normal PENDING → PAID → AUTHORIZED expense pipeline
// (see lib/expensePayment.js). Read `expenseId.status` for the live status.
const SalarySlipSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    period:     { type: String, required: true }, // 'YYYY-MM'
    slipNo:     { type: String, default: null },  // SLP-YYMM-####

    baseSalary: { type: Number, required: true }, // snapshot of Employee.salary at generation

    items: [{
      type:   { type: String, enum: ['EARNING', 'DEDUCTION'], required: true },
      label:  { type: String, required: true, trim: true },
      amount: { type: Number, required: true },
    }],

    grossEarnings:   { type: Number, required: true }, // baseSalary + sum(EARNING items)
    totalDeductions: { type: Number, required: true }, // sum(DEDUCTION items)
    netPay:          { type: Number, required: true }, // grossEarnings - totalDeductions

    currency:  { type: String, default: 'BDT' },
    amountBDT: { type: Number, default: null }, // BDT-equivalent; == netPay for BDT

    note: { type: String, default: null },

    expenseId:   { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectExpense', default: null },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_, ret) { ret.id = ret._id.toString(); delete ret._id; delete ret.__v; return ret },
    },
  }
)

// One slip per employee per period — regenerating requires cancelling the old one first.
SalarySlipSchema.index({ employeeId: 1, period: 1 }, { unique: true })

// Human-readable slip number (SLP-YYMM-####), assigned on creation.
SalarySlipSchema.pre('validate', async function () {
  if (this.slipNo) return
  const now    = new Date()
  const yymm   = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `SLP-${yymm}-`
  const count  = await mongoose.model('SalarySlip').countDocuments({ slipNo: { $regex: `^${prefix}` } })
  this.slipNo = `${prefix}${String(count + 1).padStart(4, '0')}`
})

if (mongoose.models.SalarySlip) delete mongoose.models.SalarySlip
export default mongoose.model('SalarySlip', SalarySlipSchema)
