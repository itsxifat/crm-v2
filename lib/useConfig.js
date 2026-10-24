'use client'

import { useState, useEffect, useMemo } from 'react'
import { unitOptions as buildUnitOptions } from '@/lib/units'

let _cache     = null
let _fetchPromise = null

function slugify(label) {
  return String(label ?? '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

/**
 * Normalize a category list to the nested shape [{ id, label, subcategories: [] }].
 * Tolerates legacy entries stored as plain strings.
 */
export function normalizeCategories(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, i) => {
      // Non-Latin labels slug to '' — fall back to a positional id so ids stay
      // non-empty and distinct (the config page persists them on next save).
      if (typeof item === 'string') {
        const label = item.trim()
        return label ? { id: slugify(label) || `cat-${i}`, label, subcategories: [] } : null
      }
      const label = (item?.label ?? item?.name ?? '').trim()
      if (!label) return null
      return {
        id: item?.id || slugify(label) || `cat-${i}`,
        label,
        subcategories: (Array.isArray(item?.subcategories) ? item.subcategories : [])
          .map(s => String(s ?? '').trim()).filter(Boolean),
      }
    })
    .filter(Boolean)
}

/** Subcategories belonging to a category label within a nested list. */
export function subcategoriesFor(categories, categoryLabel) {
  return categories.find(c => c.label === categoryLabel)?.subcategories ?? []
}

/**
 * Fetch /api/config once per page-load and share the result across all callers.
 * Returns { config, loading, ventures, ventureOptions, ventureCategories,
 *           products, productOptions, unitOptions, … }.
 *
 * ventures        – raw array from DB: [{ id, label, prefix, description, active }]
 * ventureOptions  – [{ value: id, label }] ready for <Select> (inactive ones included)
 * ventureCategories – { [ventureId]: { [serviceLabel]: [subcategory, …] } }
 *                     mirrors the old static VENTURE_CATEGORIES shape
 * products        – raw array from DB: [{ id, label, description, active }]
 * productOptions  – [{ value: id, label }] (inactive ones included, like ventureOptions)
 * unitOptions     – [{ value, label, kind }] business units for money entries:
 *                   active ventures, then active products, then Company / shared
 *                   (lib/units.js; values are 'VENTURE:<id>', 'PRODUCT:<id>', 'COMPANY')
 */
export function useConfig() {
  const [config,  setConfig]  = useState(_cache)
  const [loading, setLoading] = useState(!_cache)

  useEffect(() => {
    if (_cache) { setConfig(_cache); setLoading(false); return }

    if (!_fetchPromise) {
      _fetchPromise = fetch('/api/config')
        .then(r => r.json())
        .then(j => { _cache = j.data ?? {}; return _cache })
        .catch(() => { _cache = {}; return {} })
    }

    _fetchPromise.then(data => { setConfig(data); setLoading(false) })
  }, [])

  const ventures = config?.ventures ?? []

  const ventureOptions = ventures.map(v => ({ value: v.id, label: v.label }))

  // Memoised on the shared config object, so effects may depend on them.
  const { products, productOptions, unitOptions } = useMemo(() => {
    const list = Array.isArray(config?.products) ? config.products : []
    return {
      products:       list,
      productOptions: list.map(p => ({ value: p.id, label: p.label })),
      unitOptions:    buildUnitOptions(config ?? {}),
    }
  }, [config])

  const ventureCategories = {}
  const rawServices = config?.services ?? {}
  for (const [vid, serviceList] of Object.entries(rawServices)) {
    ventureCategories[vid] = {}
    for (const svc of serviceList) {
      ventureCategories[vid][svc.label] = svc.subcategories ?? []
    }
  }

  // Nested taxonomy from config — each category owns its subcategories. No defaults.
  const expenseCategories = normalizeCategories(config?.expenseCategories)
  const incomeCategories  = normalizeCategories(config?.incomeCategories)

  const paymentMethods = config?.paymentMethods ?? [
    { value: 'CASH',          label: 'Cash' },
    { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
    { value: 'CARD',          label: 'Card' },
    { value: 'CHEQUE',        label: 'Cheque' },
    { value: 'BKASH',         label: 'bKash' },
    { value: 'NAGAD',         label: 'Nagad' },
    { value: 'ROCKET',        label: 'Rocket' },
    { value: 'ONLINE',        label: 'Online Transfer' },
    { value: 'OTHER',         label: 'Other' },
  ]

  return {
    config, loading, ventures, ventureOptions, ventureCategories, paymentMethods,
    expenseCategories, incomeCategories, products, productOptions, unitOptions,
  }
}

/** Call this to invalidate the in-memory cache (e.g. after saving config). */
export function invalidateConfigCache() {
  _cache        = null
  _fetchPromise = null
}
