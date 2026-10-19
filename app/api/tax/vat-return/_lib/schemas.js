/**
 * zod schemas shared by the VAT return file / draft routes.
 */
import { z } from 'zod'

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const optText = (max) => z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(max).nullable()).optional()
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optDay = z.preprocess(v => (empty(v) ? null : v), dayStr.nullable()).optional()
// Required amount: blank ⇒ undefined ⇒ NaN ⇒ a clear validation error (never silently 0).
const moneyReq = z.preprocess(
  v => (empty(v) ? undefined : v),
  z.coerce.number({ invalid_type_error: 'Enter an amount' }).finite('Enter an amount').min(0, 'Amount cannot be negative').max(1e13),
)
// Optional amount: blank ⇒ null.
const moneyOpt = z.preprocess(
  v => (empty(v) ? null : v),
  z.union([z.null(), z.coerce.number().finite().min(0, 'Amount cannot be negative').max(1e13)]),
)

export const periodField = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')

export const challanSchema = z.object({
  challanNo:   optText(60),
  date:        optDay,
  bank:        optText(120),
  branch:      optText(120),
  accountCode: optText(60),
  amount:      moneyReq,
  // VAT ⇒ note 58, SD (supplementary duty) ⇒ note 59. Blank ⇒ VAT.
  head:        z.preprocess(
    v => (empty(v) ? 'VAT' : String(v).trim().toUpperCase()),
    z.enum(['VAT', 'SD'], { errorMap: () => ({ message: 'Challan head must be VAT or SD' }) }),
  ).optional(),
})

export const fileSchema = z.object({
  start:             periodField,
  end:               periodField,
  returnType:        z.preprocess(v => (empty(v) ? null : v), z.enum(['ORIGINAL', 'LATE', 'AMENDED', 'FULL_ADDITIONAL']).nullable()).optional(),
  acknowledgementNo: optText(80),
  filedAt:           optDay,
  challans:          z.array(challanSchema).max(50).optional(),
  refundRequested:   moneyOpt.optional(),
  notes:             optText(2000),
}).refine(d => d.start <= d.end, { message: 'Start period must not be after the end period', path: ['end'] })

export const draftSchema = z.object({
  start:           periodField,
  end:             periodField,
  challans:        z.array(challanSchema).max(50).optional(),
  refundRequested: moneyOpt.optional(),
  notes:           optText(2000),
}).refine(d => d.start <= d.end, { message: 'Start period must not be after the end period', path: ['end'] })

/** Clean challan list for lib/tax/vatReturn (dates stay 'YYYY-MM-DD'; toInstant parses them as Dhaka days). */
export function cleanChallans(list) {
  if (!Array.isArray(list)) return undefined
  return list.map(c => ({
    challanNo:   c.challanNo ?? null,
    date:        c.date ?? null,
    bank:        c.bank ?? null,
    branch:      c.branch ?? null,
    accountCode: c.accountCode ?? null,
    amount:      Number(c.amount) || 0,
    head:        c.head === 'SD' ? 'SD' : 'VAT',
  }))
}
