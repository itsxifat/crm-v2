'use client'

import {
  PackagePlus, PackageCheck, UserCheck, Undo2, ArrowLeftRight, BadgeCheck, ThumbsDown, Wrench,
  CircleCheckBig, TriangleAlert, SearchX, ShieldAlert, ScanSearch, Archive, ArchiveRestore,
  BadgeDollarSign, Trash2, FileX2, HeartHandshake, TrendingDown, Scale, ClipboardCheck, Pencil,
  StickyNote, HandCoins, FolderInput, Circle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_META, CONDITION_META, EVENT_META } from '@/lib/inventory/constants'

/**
 * Tailwind classes for the semantic colours used in lib/inventory/constants
 * (STATUS_META, CONDITION_META, EVENT_META, *_META). Kept here because
 * Tailwind only scans components/ and app/ for class names.
 *   badge — soft pill (bg + text + inset ring colour)
 *   dot   — status dot
 *   icon  — tinted glyph on a neutral surface (timeline icons)
 */
export const INVENTORY_TONE_CLASSES = {
  gray:   { badge: 'bg-gray-100 text-gray-700 ring-gray-500/10',         dot: 'bg-gray-400',    icon: 'text-gray-500' },
  blue:   { badge: 'bg-blue-50 text-blue-700 ring-blue-600/15',          dot: 'bg-blue-500',    icon: 'text-blue-600' },
  green:  { badge: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', dot: 'bg-emerald-500', icon: 'text-emerald-600' },
  yellow: { badge: 'bg-amber-50 text-amber-700 ring-amber-600/20',       dot: 'bg-amber-500',   icon: 'text-amber-600' },
  orange: { badge: 'bg-orange-50 text-orange-700 ring-orange-600/15',    dot: 'bg-orange-500',  icon: 'text-orange-600' },
  red:    { badge: 'bg-red-50 text-red-700 ring-red-600/15',             dot: 'bg-red-500',     icon: 'text-red-600' },
  purple: { badge: 'bg-violet-50 text-violet-700 ring-violet-600/15',    dot: 'bg-violet-500',  icon: 'text-violet-600' },
  teal:   { badge: 'bg-teal-50 text-teal-700 ring-teal-600/15',          dot: 'bg-teal-500',    icon: 'text-teal-600' },
  indigo: { badge: 'bg-indigo-50 text-indigo-700 ring-indigo-600/15',    dot: 'bg-indigo-500',  icon: 'text-indigo-600' },
}

/** Classes for a semantic colour name (unknown ⇒ gray). */
export function toneClasses(color) {
  return INVENTORY_TONE_CLASSES[color] ?? INVENTORY_TONE_CLASSES.gray
}

const EVENT_ICONS = {
  PackagePlus, PackageCheck, UserCheck, Undo2, ArrowLeftRight, BadgeCheck, ThumbsDown, Wrench,
  CircleCheckBig, TriangleAlert, SearchX, ShieldAlert, ScanSearch, Archive, ArchiveRestore,
  BadgeDollarSign, Trash2, FileX2, HeartHandshake, TrendingDown, Scale, ClipboardCheck, Pencil,
  StickyNote, HandCoins, FolderInput,
}

const humanize = (v) => (v ? String(v).replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : '')

/**
 * Generic inventory pill with a coloured dot — use with any *_META entry:
 *   <InventoryBadge label={m.label} color={m.color} />
 */
export function InventoryBadge({ label, color = 'gray', dot = true, className }) {
  const t = toneClasses(color)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        t.badge,
        className
      )}
    >
      {dot && <span className={cn('size-1.5 shrink-0 rounded-full', t.dot)} />}
      {label}
    </span>
  )
}

/** Asset lifecycle status pill (IN_STOCK, ASSIGNED, IN_REPAIR, …). */
export default function AssetStatusBadge({ status, className }) {
  if (!status) return <span className="text-xs text-gray-400">—</span>
  const m = STATUS_META[status]
  return <InventoryBadge label={m?.label ?? humanize(status)} color={m?.color ?? 'gray'} className={className} />
}

/** Physical condition pill (NEW, GOOD, FAIR, POOR, BROKEN). */
export function AssetConditionBadge({ condition, className }) {
  if (!condition) return <span className="text-xs text-gray-400">—</span>
  const m = CONDITION_META[condition]
  return <InventoryBadge label={m?.label ?? humanize(condition)} color={m?.color ?? 'gray'} className={className} />
}

/** Round icon for a timeline entry of the given AssetEvent type. */
export function AssetEventIcon({ type, size = 'md', className }) {
  const m = EVENT_META[type]
  const Icon = (m && EVENT_ICONS[m.icon]) || Circle
  const t = toneClasses(m?.color)
  const box = size === 'sm' ? 'size-6' : size === 'lg' ? 'size-10' : 'size-8'
  const glyph = size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-5' : 'size-4'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-gray-200/80 bg-white shadow-xs',
        box,
        t.icon,
        className
      )}
      title={m?.label ?? humanize(type)}
    >
      <Icon className={glyph} aria-hidden="true" />
    </span>
  )
}
