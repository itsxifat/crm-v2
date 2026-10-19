/**
 * Shared validation & serialisation for the asset-category routes.
 * (Not a route: only route.js files are routed.)
 */

import { z } from 'zod'
import { TAX_DEPRECIATION_CLASSES } from '@/lib/tax/catalog'
import { CATEGORY_TYPES, DEPRECIATION_METHODS, CATEGORY_CODE_REGEX } from '@/lib/inventory/constants'

export const TAX_CLASS_KEYS = Object.keys(TAX_DEPRECIATION_CLASSES)

const code = z.string().trim()
  .transform(s => s.toUpperCase().replace(/\s+/g, ''))
  .pipe(z.string().regex(CATEGORY_CODE_REGEX, 'Code must be 2–6 letters or digits (A–Z, 0–9)'))

const optNum = (schema) => z.preprocess(v => (v === '' ? null : v), schema.optional().nullable())

const fields = {
  name:               z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name is too long'),
  code,
  type:               z.enum(CATEGORY_TYPES),
  taxClass:           z.enum(TAX_CLASS_KEYS, { errorMap: () => ({ message: 'Choose a Third Schedule tax class' }) }),
  depreciationMethod: z.enum(DEPRECIATION_METHODS),
  usefulLifeMonths:   optNum(z.coerce.number().int('Useful life must be whole months').min(1, 'Useful life must be at least 1 month').max(1200, 'Useful life is at most 1200 months')),
  residualPct:        optNum(z.coerce.number().min(0, 'Residual % cannot be negative').max(99, 'Residual % must be below 100')),
  decliningRatePct:   optNum(z.coerce.number().gt(0, 'Declining rate must be above 0').max(100, 'Declining rate is at most 100%')),
  capitalize:              z.boolean(),
  requiresAcknowledgement: z.boolean(),
  inputVatCreditable:      z.boolean(),
  description:        z.string().trim().max(500, 'Description is too long').optional().nullable(),
  isActive:           z.boolean(),
  sortOrder:          optNum(z.coerce.number().int().min(0).max(100000)),
}

export const createCategorySchema = z.object({
  ...fields,
  type: fields.type.default('ASSET'),
  taxClass: fields.taxClass.default('OTHER'),
  depreciationMethod: fields.depreciationMethod.default('STRAIGHT_LINE'),
  capitalize: fields.capitalize.optional(),
  requiresAcknowledgement: fields.requiresAcknowledgement.optional(),
  inputVatCreditable: fields.inputVatCreditable.optional(),
  isActive: fields.isActive.optional(),
})

export const updateCategorySchema = z.object(fields).partial()

/**
 * Apply type-driven rules to a (partial) payload merged over the current
 * values: consumables are never capitalised or depreciated and need no
 * acknowledgement.
 */
export function applyCategoryRules(data, current = {}) {
  const type = data.type ?? current.type ?? 'ASSET'
  const out = { ...data }
  if (type === 'CONSUMABLE') {
    out.depreciationMethod = 'NONE'
    out.capitalize = false
    out.requiresAcknowledgement = false
    out.decliningRatePct = null
  }
  const method = out.depreciationMethod ?? current.depreciationMethod
  if (method && method !== 'DECLINING_BALANCE' && Object.prototype.hasOwnProperty.call(out, 'decliningRatePct') && out.decliningRatePct !== null) {
    out.decliningRatePct = null
  }
  if (typeof out.description === 'string' && !out.description.trim()) out.description = null
  return out
}

/** API shape of a category (with optional usage counts). */
export function serializeCategory(c, counts = null) {
  const cls = TAX_DEPRECIATION_CLASSES[c.taxClass] || TAX_DEPRECIATION_CLASSES.OTHER
  const id = String(c._id ?? c.id)
  const usage = counts?.get(id) ?? null
  return {
    id,
    name: c.name,
    code: c.code,
    type: c.type || 'ASSET',
    taxClass: c.taxClass || 'OTHER',
    taxClassLabel: cls?.label ?? c.taxClass,
    taxRate: cls?.rate ?? null,
    taxMethod: cls?.method === 'SL' ? 'SL' : 'WDV',
    depreciationMethod: c.depreciationMethod || 'STRAIGHT_LINE',
    usefulLifeMonths: c.usefulLifeMonths ?? cls?.bookLifeMonths ?? null,
    residualPct: c.residualPct ?? 0,
    decliningRatePct: c.decliningRatePct ?? null,
    capitalize: c.capitalize !== false,
    requiresAcknowledgement: c.requiresAcknowledgement !== false,
    inputVatCreditable: Boolean(c.inputVatCreditable),
    description: c.description ?? null,
    isActive: c.isActive !== false,
    sortOrder: c.sortOrder ?? 0,
    createdAt: c.createdAt ?? null,
    updatedAt: c.updatedAt ?? null,
    ...(counts ? {
      assetCount: usage?.assets ?? 0,
      heldCount: usage?.held ?? 0,
      stockItemCount: usage?.stockItems ?? 0,
    } : {}),
  }
}
