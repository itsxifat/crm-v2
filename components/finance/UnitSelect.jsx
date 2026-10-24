'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useConfig } from '@/lib/useConfig'
import { unitOptions, unitLabel, parseUnit } from '@/lib/units'
import { selectClass } from '@/components/ui/Input'

const GROUPS = [
  { kind: 'VENTURE', label: 'Ventures' },
  { kind: 'PRODUCT', label: 'Products' },
  { kind: 'COMPANY', label: 'Company' },
]

const EMPTY_CONFIG = { ventures: [], products: [] }

/**
 * Native <select> of business units (lib/units.js) for a money record:
 * ventures, products and Company / shared, in that order, grouped.
 *
 * Unassigned is never offered as a choice. It is shown only for a null value
 * that is already stored (pass `null`); pass '' or undefined while nothing is
 * chosen yet, and the placeholder shows. A stored unit that is now inactive,
 * or no longer configured, still shows as the current value.
 *
 * @param {object}   props
 * @param {string|null} props.value       'VENTURE:<id>' | 'PRODUCT:<id>' | 'COMPANY' | null (stored Unassigned) | ''
 * @param {(unit: string|null, option: { value, label, kind }|null) => void} props.onChange
 * @param {boolean}  [props.required]     the empty choice cannot be picked again once a unit is chosen
 * @param {boolean}  [props.disabled]     read-only display
 * @param {boolean}  [props.includeInactive=false]  also offer inactive ventures / products
 * @param {string}   [props.placeholder='Select venture / product']
 * @param {string}   [props.className]
 * @param {string}   [props.id]
 * @param {string}   [props.name]
 * @param {boolean}  [props.invalid]
 */
export default function UnitSelect({
  value,
  onChange,
  required = false,
  disabled = false,
  includeInactive = false,
  placeholder = 'Select venture / product',
  className,
  id,
  name,
  invalid,
}) {
  const { config, loading } = useConfig()
  const cfg = config ?? EMPTY_CONFIG

  const options = useMemo(() => unitOptions(cfg, { includeInactive }), [cfg, includeInactive])
  const current = typeof value === 'string' ? value : ''

  // A stored value the list does not offer (inactive, or removed from the
  // configuration) stays visible in its own group, so editing never drops it.
  const extra = useMemo(() => {
    if (loading || !current || options.some(o => o.value === current)) return null
    const known = unitOptions(cfg, { includeInactive: true }).find(o => o.value === current)
    if (known) return known
    // Shown inside its group, so the bare id is enough; a malformed value shows as stored.
    const parsed = parseUnit(current)
    return parsed
      ? { value: current, label: `${parsed.id} (not configured)`, kind: parsed.kind }
      : { value: current, label: unitLabel(current, cfg), kind: null }
  }, [cfg, current, options, loading])

  function handleChange(e) {
    const next = e.target.value || null
    const option = next ? ([...options, extra].find(o => o?.value === next) ?? null) : null
    onChange?.(next, option)
  }

  const emptyLabel = loading ? 'Loading…' : value === null ? 'Unassigned' : placeholder

  const grouped = GROUPS
    .map(g => ({
      ...g,
      items: [...options.filter(o => o.kind === g.kind), ...(extra?.kind === g.kind ? [extra] : [])],
    }))
    .filter(g => g.items.length)

  return (
    <select
      id={id}
      name={name}
      value={current}
      onChange={handleChange}
      disabled={disabled || loading}
      required={required}
      aria-invalid={invalid || undefined}
      className={cn(selectClass, className)}
    >
      <option value="" disabled={required && current !== ''}>{emptyLabel}</option>
      {extra && !extra.kind && <option value={extra.value}>{extra.label}</option>}
      {grouped.map(g => (
        <optgroup key={g.kind} label={g.label}>
          {g.items.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      ))}
    </select>
  )
}
