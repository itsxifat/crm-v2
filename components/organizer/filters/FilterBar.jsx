'use client'

import { useMemo, useState } from 'react'
import {
  ArrowDownNarrowWide, ArrowUpDown, ArrowUpWideNarrow, Layers, RotateCcw, SlidersHorizontal, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Button, { buttonVariants } from '@/components/ui/Button'
import SearchInput from '@/components/ui/SearchInput'
import MultiSelect from './MultiSelect'
import DateRangeFilter, { formatRange } from './DateRangeFilter'
import { isSameValue } from './useUrlFilters'

/**
 * Config-driven filter bar (search, faceted multi/single selects, date range, toggles,
 * sort + direction, group by, active-filter chips, reset).
 *
 *   <FilterBar
 *     values={filters} defaults={defaults} onChange={setFilters} onReset={reset}
 *     search={{ key: 'q', placeholder: 'Search to-dos' }}
 *     fields={[
 *       { type: 'multi',     key: 'status', label: 'Status', options: [{ value, label, dotClass }] },
 *       { type: 'multi',     key: 'assignee', label: 'Assignee', options, loadOptions: async q => [...], getLabel: v => … },
 *       { type: 'select',    key: 'due', label: 'Due', options },
 *       { type: 'dateRange', fromKey: 'from', toKey: 'to', label: 'Due between' },
 *       { type: 'toggle',    key: 'pinned', label: 'Pinned', icon: Pin },
 *     ]}
 *     sort={{ key: 'sort', dirKey: 'dir', options: [{ value, label }], defaultDir: (sort) => 'asc' | 'desc' }}
 *     group={{ key: 'group', options: [{ value: 'none', label: 'None' }, …] }}
 *     actions={<ViewToggle />}
 *   />
 * `onChange(patch)` receives a partial object. Falsy entries in `fields` are ignored.
 */
export default function FilterBar({
  values = {},
  defaults = {},
  onChange,
  onReset,
  search,
  fields = [],
  sort,
  group,
  actions,
  className,
}) {
  const [showMobile, setShowMobile] = useState(false)
  const list = fields.filter(Boolean)

  const differs = (k) => !isSameValue(values[k], defaults[k])

  const chips = useMemo(() => {
    const out = []
    for (const f of list) {
      if (f.type === 'dateRange') {
        if (differs(f.fromKey) || differs(f.toKey)) {
          out.push({
            id: `${f.fromKey}:${f.toKey}`,
            label: f.label,
            text: formatRange(values[f.fromKey], values[f.toKey]),
            clear: { [f.fromKey]: defaults[f.fromKey] ?? '', [f.toKey]: defaults[f.toKey] ?? '' },
          })
        }
        continue
      }
      if (!differs(f.key)) continue
      const v = values[f.key]
      const nameOf = (x) => f.options?.find((o) => o.value === x)?.label ?? f.getLabel?.(x) ?? x
      if (f.type === 'toggle') {
        out.push({ id: f.key, label: f.label, text: null, clear: { [f.key]: defaults[f.key] ?? false } })
      } else if (f.type === 'multi') {
        const arr = Array.isArray(v) ? v : []
        if (!arr.length) continue
        out.push({ id: f.key, label: f.label, text: arr.map(nameOf).join(', '), clear: { [f.key]: defaults[f.key] ?? [] } })
      } else {
        if (!v) continue
        out.push({ id: f.key, label: f.label, text: nameOf(v), clear: { [f.key]: defaults[f.key] ?? '' } })
      }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, values, defaults])

  const searchActive = search && differs(search.key)
  const viewChanged =
    (sort && (differs(sort.key) || (sort.dirKey && differs(sort.dirKey)))) ||
    (group && differs(group.key))
  const showReset = chips.length > 0 || searchActive || viewChanged

  const sortValue = sort ? values[sort.key] : null
  const effectiveDir = sort
    ? (sort.dirKey && values[sort.dirKey]) || sort.defaultDir?.(sortValue) || 'asc'
    : 'asc'

  const facets = list.map((f) => {
    if (f.type === 'dateRange') {
      return (
        <DateRangeFilter
          key={`${f.fromKey}:${f.toKey}`}
          label={f.label}
          icon={f.icon}
          from={values[f.fromKey]}
          to={values[f.toKey]}
          onChange={({ from, to }) => onChange?.({ [f.fromKey]: from, [f.toKey]: to })}
        />
      )
    }
    if (f.type === 'toggle') {
      const on = !!values[f.key]
      const Icon = f.icon
      return (
        <button
          key={f.key}
          type="button"
          aria-pressed={on}
          onClick={() => onChange?.({ [f.key]: !on })}
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'font-normal',
            on ? 'border-gray-900 bg-gray-900 font-medium text-white hover:bg-gray-800 hover:text-white' : 'border-dashed text-gray-600'
          )}
        >
          {Icon && <Icon className={on ? 'text-white' : 'text-gray-500'} />}
          {f.label}
        </button>
      )
    }
    return (
      <MultiSelect
        key={f.key}
        label={f.label}
        icon={f.icon}
        options={f.options ?? []}
        loadOptions={f.loadOptions}
        getLabel={f.getLabel}
        searchable={f.searchable}
        width={f.width}
        multiple={f.type === 'multi'}
        value={values[f.key] ?? (f.type === 'multi' ? [] : '')}
        onChange={(v) => onChange?.({ [f.key]: v })}
        placeholder={f.placeholder}
        emptyText={f.emptyText}
      />
    )
  })

  const DirIcon = effectiveDir === 'desc' ? ArrowUpWideNarrow : ArrowDownNarrowWide

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex flex-wrap items-center gap-2">
        {(search || list.length > 0) && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {search && (
              <SearchInput
                value={values[search.key] ?? ''}
                onChange={(v) => onChange?.({ [search.key]: v })}
                placeholder={search.placeholder ?? 'Search…'}
                className="min-w-0 flex-1 sm:w-56 sm:flex-none lg:w-64"
              />
            )}
            {list.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className={cn('h-9 sm:hidden', showMobile && 'bg-accent', !search && 'w-full')}
                onClick={() => setShowMobile((s) => !s)}
                aria-expanded={showMobile}
              >
                <SlidersHorizontal className="text-gray-500" />
                Filters
                {chips.length > 0 && (
                  <span className="rounded-md bg-gray-900 px-1.5 text-[11px] font-medium tabular-nums text-white">{chips.length}</span>
                )}
              </Button>
            )}
          </div>
        )}

        {list.length > 0 && (
          <div className={cn('w-full flex-wrap items-center gap-2 sm:flex sm:w-auto', showMobile ? 'flex' : 'hidden')}>
            {facets}
          </div>
        )}

        {(sort || group || actions) && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {sort && (
              <div className="flex items-center">
                <MultiSelect
                  variant="value"
                  multiple={false}
                  clearable={false}
                  searchable={false}
                  icon={ArrowUpDown}
                  label="Sort"
                  align="end"
                  width={200}
                  options={sort.options}
                  value={sortValue ?? ''}
                  onChange={(v) => onChange?.(sort.dirKey ? { [sort.key]: v, [sort.dirKey]: '' } : { [sort.key]: v })}
                  className="rounded-r-none"
                />
                {sort.dirKey && (
                  <button
                    type="button"
                    title={effectiveDir === 'desc' ? 'Descending' : 'Ascending'}
                    aria-label={effectiveDir === 'desc' ? 'Descending' : 'Ascending'}
                    onClick={() => onChange?.({ [sort.dirKey]: effectiveDir === 'desc' ? 'asc' : 'desc' })}
                    className={cn(buttonVariants({ variant: 'outline', size: 'icon-sm' }), '-ml-px rounded-l-none text-gray-500')}
                  >
                    <DirIcon />
                  </button>
                )}
              </div>
            )}
            {group && (
              <MultiSelect
                variant="value"
                multiple={false}
                clearable={false}
                searchable={false}
                icon={Layers}
                label="Group"
                align="end"
                width={200}
                options={group.options}
                value={values[group.key] ?? ''}
                onChange={(v) => onChange?.({ [group.key]: v })}
              />
            )}
            {actions}
          </div>
        )}
      </div>

      {(chips.length > 0 || showReset) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <span
              key={c.id}
              className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-gray-200 bg-gray-50 pl-2.5 pr-1 text-xs"
            >
              <span className={cn('shrink-0', c.text ? 'text-gray-500' : 'font-medium text-gray-900')}>{c.label}</span>
              {c.text && <span className="min-w-0 max-w-[220px] truncate font-medium text-gray-900">{c.text}</span>}
              <button
                type="button"
                onClick={() => onChange?.(c.clear)}
                aria-label={`Remove ${c.label} filter`}
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-900"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {showReset && (
            <Button variant="ghost" size="xs" onClick={() => onReset?.()} className="text-gray-500">
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export { FilterBar }
