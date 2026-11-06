// Shared organizer constants (client side). Class strings are written out in full
// so Tailwind's content scan (components/**) picks them up.

export const PALETTE_KEYS = ['zinc', 'blue', 'emerald', 'amber', 'red', 'violet', 'pink', 'teal', 'orange', 'indigo']

export const PALETTE = {
  zinc:    { label: 'Gray',    dot: 'bg-gray-500',    soft: 'bg-gray-100',    softHover: 'hover:bg-gray-200/70',  text: 'text-gray-800',    border: 'border-gray-500',    ring: 'ring-gray-500',    tint: 'bg-gray-50',      bar: 'bg-gray-500' },
  blue:    { label: 'Blue',    dot: 'bg-blue-500',    soft: 'bg-blue-50',     softHover: 'hover:bg-blue-100',     text: 'text-blue-800',    border: 'border-blue-500',    ring: 'ring-blue-500',    tint: 'bg-blue-50/60',   bar: 'bg-blue-500' },
  emerald: { label: 'Green',   dot: 'bg-emerald-500', soft: 'bg-emerald-50',  softHover: 'hover:bg-emerald-100',  text: 'text-emerald-800', border: 'border-emerald-500', ring: 'ring-emerald-500', tint: 'bg-emerald-50/60', bar: 'bg-emerald-500' },
  amber:   { label: 'Amber',   dot: 'bg-amber-500',   soft: 'bg-amber-50',    softHover: 'hover:bg-amber-100',    text: 'text-amber-800',   border: 'border-amber-500',   ring: 'ring-amber-500',   tint: 'bg-amber-50/60',  bar: 'bg-amber-500' },
  red:     { label: 'Red',     dot: 'bg-red-500',     soft: 'bg-red-50',      softHover: 'hover:bg-red-100',      text: 'text-red-800',     border: 'border-red-500',     ring: 'ring-red-500',     tint: 'bg-red-50/60',    bar: 'bg-red-500' },
  violet:  { label: 'Violet',  dot: 'bg-violet-500',  soft: 'bg-violet-50',   softHover: 'hover:bg-violet-100',   text: 'text-violet-800',  border: 'border-violet-500',  ring: 'ring-violet-500',  tint: 'bg-violet-50/60', bar: 'bg-violet-500' },
  pink:    { label: 'Pink',    dot: 'bg-pink-500',    soft: 'bg-pink-50',     softHover: 'hover:bg-pink-100',     text: 'text-pink-800',    border: 'border-pink-500',    ring: 'ring-pink-500',    tint: 'bg-pink-50/60',   bar: 'bg-pink-500' },
  teal:    { label: 'Teal',    dot: 'bg-teal-500',    soft: 'bg-teal-50',     softHover: 'hover:bg-teal-100',     text: 'text-teal-800',    border: 'border-teal-500',    ring: 'ring-teal-500',    tint: 'bg-teal-50/60',   bar: 'bg-teal-500' },
  orange:  { label: 'Orange',  dot: 'bg-orange-500',  soft: 'bg-orange-50',   softHover: 'hover:bg-orange-100',   text: 'text-orange-800',  border: 'border-orange-500',  ring: 'ring-orange-500',  tint: 'bg-orange-50/60', bar: 'bg-orange-500' },
  indigo:  { label: 'Indigo',  dot: 'bg-indigo-500',  soft: 'bg-indigo-50',   softHover: 'hover:bg-indigo-100',   text: 'text-indigo-800',  border: 'border-indigo-500',  ring: 'ring-indigo-500',  tint: 'bg-indigo-50/60', bar: 'bg-indigo-500' },
}

/** Class bundle for a palette key (falls back to zinc). */
export function colorClasses(color) {
  return PALETTE[color] ?? PALETTE.zinc
}

export const PRIORITY = {
  LOW:    { label: 'Low',    rank: 1, variant: 'default', icon: 'text-gray-400' },
  MEDIUM: { label: 'Medium', rank: 2, variant: 'primary', icon: 'text-blue-500' },
  HIGH:   { label: 'High',   rank: 3, variant: 'orange',  icon: 'text-orange-500' },
  URGENT: { label: 'Urgent', rank: 4, variant: 'danger',  icon: 'text-red-500' },
}
export const PRIORITY_KEYS = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']

export const TODO_STATUS = {
  OPEN:        { label: 'Open',        variant: 'default', dot: 'bg-gray-400' },
  IN_PROGRESS: { label: 'In progress', variant: 'primary', dot: 'bg-blue-500' },
  DONE:        { label: 'Done',        variant: 'success', dot: 'bg-emerald-500' },
}
export const TODO_STATUS_KEYS = ['OPEN', 'IN_PROGRESS', 'DONE']

export const REPEAT_OPTIONS = [
  { value: 'NONE',    label: 'Does not repeat' },
  { value: 'DAILY',   label: 'Daily' },
  { value: 'WEEKLY',  label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'YEARLY',  label: 'Yearly' },
]

// Bangladesh work week starts on Saturday (date-fns weekStartsOn: 6).
export const WEEK_STARTS_ON = 6

/** 'YYYY-MM-DD' for a local Date. */
export function toYMD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Local Date (midnight) from 'YYYY-MM-DD' — or from an all-day ISO ('YYYY-MM-DDT00:00:00.000Z'). */
export function fromYMD(s) {
  if (!s) return null
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Today as 'YYYY-MM-DD' in the browser's local time. */
export function todayYMD() {
  return toYMD(new Date())
}

/** Display name for a user-ish object. */
export function personName(p) {
  return p?.name || 'Unknown'
}
