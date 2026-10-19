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
 */
export const INVENTORY_TONE_CLASSES = {
  gray:   { badge: 'bg-gray-100 text-gray-600',    dot: 'bg-gray-400',   icon: 'bg-gray-100 text-gray-600' },
  blue:   { badge: 'bg-blue-50 text-blue-700',     dot: 'bg-blue-500',   icon: 'bg-blue-50 text-blue-600' },
  green:  { badge: 'bg-green-50 text-green-700',   dot: 'bg-green-500',  icon: 'bg-green-50 text-green-600' },
  yellow: { badge: 'bg-amber-50 text-amber-700',   dot: 'bg-amber-400',  icon: 'bg-amber-50 text-amber-600' },
  orange: { badge: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500', icon: 'bg-orange-50 text-orange-600' },
  red:    { badge: 'bg-red-50 text-red-700',       dot: 'bg-red-500',    icon: 'bg-red-50 text-red-600' },
  purple: { badge: 'bg-purple-50 text-purple-700', dot: 'bg-purple-500', icon: 'bg-purple-50 text-purple-600' },
  teal:   { badge: 'bg-teal-50 text-teal-700',     dot: 'bg-teal-500',   icon: 'bg-teal-50 text-teal-600' },
  indigo: { badge: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500', icon: 'bg-indigo-50 text-indigo-600' },
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
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap', t.badge, className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', t.dot)} />}
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
  const box = size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-10 h-10' : 'w-8 h-8'
  const glyph = size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4'
  return (
    <span className={cn('inline-flex items-center justify-center rounded-full shrink-0', box, t.icon, className)}
      title={m?.label ?? humanize(type)}>
      <Icon className={glyph} aria-hidden="true" />
    </span>
  )
}
