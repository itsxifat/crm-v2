import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO, isValid } from 'date-fns'

// ---------------------------------------------------------------------------
// Tailwind class merger
// ---------------------------------------------------------------------------
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

// ---------------------------------------------------------------------------
// Currency formatting
// ---------------------------------------------------------------------------
export function formatCurrency(amount, currency = 'BDT', locale = 'en-BD') {
  if (amount === null || amount === undefined) return '—'
  if (!currency || currency === 'BDT') {
    const num = new Intl.NumberFormat('en-BD', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
    return `৳ ${num}`
  }
  return new Intl.NumberFormat(locale, {
    style:    'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------
export function formatDate(date, pattern = 'MMM dd, yyyy') {
  if (!date) return '—'
  try {
    const d = typeof date === 'string' ? parseISO(date) : date
    if (!isValid(d)) return '—'
    return format(d, pattern)
  } catch {
    return '—'
  }
}

export function formatDateTime(date, pattern = 'MMM dd, yyyy HH:mm') {
  return formatDate(date, pattern)
}

export function formatRelativeTime(date) {
  if (!date) return '—'
  try {
    const d = typeof date === 'string' ? parseISO(date) : date
    if (!isValid(d)) return '—'
    return formatDistanceToNow(d, { addSuffix: true })
  } catch {
    return '—'
  }
}

// ---------------------------------------------------------------------------
// Invoice number generator
// ---------------------------------------------------------------------------
export function generateInvoiceNumber(prefix = 'INV') {
  const now    = new Date()
  const year   = now.getFullYear()
  const month  = String(now.getMonth() + 1).padStart(2, '0')
  const random = Math.floor(Math.random() * 9000) + 1000
  return `${prefix}-${year}${month}-${random}`
}

// ---------------------------------------------------------------------------
// Priority colours  (Tailwind utility classes)
// ---------------------------------------------------------------------------
export function getPriorityColor(priority) {
  const map = {
    LOW:    'bg-slate-100   text-slate-600   border-slate-200',
    MEDIUM: 'bg-blue-100    text-blue-700    border-blue-200',
    HIGH:   'bg-orange-100  text-orange-700  border-orange-200',
    URGENT: 'bg-red-100     text-red-700     border-red-200',
  }
  return map[priority] ?? 'bg-gray-100 text-gray-600 border-gray-200'
}

export function getPriorityBadgeColor(priority) {
  const map = {
    LOW:    'bg-slate-100  text-slate-700',
    MEDIUM: 'bg-blue-100   text-blue-700',
    HIGH:   'bg-orange-100 text-orange-700',
    URGENT: 'bg-red-100    text-red-700',
  }
  return map[priority] ?? 'bg-gray-100 text-gray-700'
}

// ---------------------------------------------------------------------------
// Status colours
// ---------------------------------------------------------------------------
export function getStatusColor(status) {
  const map = {
    // Lead
    NEW:            'bg-blue-100    text-blue-700',
    CONTACTED:      'bg-purple-100  text-purple-700',
    PROPOSAL_SENT:  'bg-yellow-100  text-yellow-700',
    NEGOTIATION:    'bg-orange-100  text-orange-700',
    WON:            'bg-green-100   text-green-700',
    LOST:           'bg-red-100     text-red-700',
    // Project
    PLANNING:       'bg-blue-100    text-blue-700',
    IN_PROGRESS:    'bg-yellow-100  text-yellow-700',
    ON_HOLD:        'bg-gray-100    text-gray-700',
    COMPLETED:      'bg-green-100   text-green-700',
    CANCELLED:      'bg-red-100     text-red-700',
    // Task
    TODO:           'bg-slate-100   text-slate-700',
    IN_REVIEW:      'bg-purple-100  text-purple-700',
    // Invoice
    DRAFT:          'bg-gray-100    text-gray-700',
    SENT:           'bg-blue-100    text-blue-700',
    PARTIALLY_PAID: 'bg-yellow-100  text-yellow-700',
    PAID:           'bg-green-100   text-green-700',
    OVERDUE:        'bg-red-100     text-red-700',
    // Agreement
    SIGNED:         'bg-green-100   text-green-700',
    EXPIRED:        'bg-gray-100    text-gray-700',
    // Withdrawal / Leave / Payment
    PENDING:        'bg-yellow-100  text-yellow-700',
    APPROVED:       'bg-green-100   text-green-700',
    REJECTED:       'bg-red-100     text-red-700',
    PAID:           'bg-green-100   text-green-700',
    FAILED:         'bg-red-100     text-red-700',
    REFUNDED:       'bg-purple-100  text-purple-700',
  }
  return map[status] ?? 'bg-gray-100 text-gray-700'
}

// ---------------------------------------------------------------------------
// Text truncation
// ---------------------------------------------------------------------------
export function truncateText(text, maxLength = 100) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}…`
}

// ---------------------------------------------------------------------------
// Number formatting helpers
// ---------------------------------------------------------------------------
export function formatNumber(num, locale = 'en-US') {
  if (num === null || num === undefined) return '0'
  return new Intl.NumberFormat(locale).format(num)
}

export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined) return '0%'
  return `${Number(value).toFixed(decimals)}%`
}

// ---------------------------------------------------------------------------
// Role display helpers
// ---------------------------------------------------------------------------
export function getRoleLabel(role) {
  const map = {
    SUPER_ADMIN: 'Super Admin',
    MANAGER:     'Manager',
    EMPLOYEE:    'Employee',
    FREELANCER:  'Freelancer',
    CLIENT:      'Client',
    VENDOR:      'Vendor',
  }
  return map[role] ?? role
}

export function getRoleColor(role) {
  const map = {
    SUPER_ADMIN: 'bg-purple-100 text-purple-700',
    MANAGER:     'bg-blue-100   text-blue-700',
    EMPLOYEE:    'bg-teal-100   text-teal-700',
    FREELANCER:  'bg-orange-100 text-orange-700',
    CLIENT:      'bg-green-100  text-green-700',
    VENDOR:      'bg-pink-100   text-pink-700',
  }
  return map[role] ?? 'bg-gray-100 text-gray-700'
}

// ---------------------------------------------------------------------------
// Miscellaneous
// ---------------------------------------------------------------------------
export function getInitials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0].toUpperCase())
    .join('')
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function debounce(fn, delay = 300) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

export function capitalize(str = '') {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

export function parseError(error) {
  if (typeof error === 'string') return error
  if (error?.response?.data?.message) return error.response.data.message
  if (error?.message) return error.message
  return 'An unexpected error occurred'
}
