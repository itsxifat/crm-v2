// ─── Venture taxonomy: categories & subcategories ────────────────────────────
export const VENTURES = ['ENSTUDIO', 'ENTECH', 'ENMARK']

export const VENTURE_META = {
  ENSTUDIO: { label: 'Enstudio',  color: 'purple', description: 'Creative Services' },
  ENTECH:   { label: 'Entech',    color: 'blue',   description: 'Web & Tech' },
  ENMARK:   { label: 'Enmark',    color: 'green',  description: 'Marketing Services' },
}

export const VENTURE_CATEGORIES = {
  ENSTUDIO: {
    'Graphic Design':   ['Logo & Branding', 'Social Media Graphics', 'Print & Packaging', 'Illustration', 'Infographics'],
    'Video Production': ['Corporate Video', 'Product Video', 'Reels & Shorts', 'Motion Graphics', 'Video Editing'],
    'CGI & 3D':         ['3D Modeling', 'Product Visualization', 'Architectural Visualization', 'Animation'],
    'Photography':      ['Product Photography', 'Event Coverage', 'Portrait', 'Commercial'],
  },
  ENTECH: {
    'Web Development':     ['Landing Page', 'Corporate Website', 'E-commerce', 'Web App', 'API Development', 'CMS Integration'],
    'UI/UX Design':        ['Website UI', 'Mobile App UI', 'Dashboard Design', 'Prototyping', 'Design System'],
    'Mobile Development':  ['iOS App', 'Android App', 'Cross-Platform'],
    'Maintenance':         ['Bug Fixes', 'Performance Optimization', 'Security Audit', 'Updates'],
  },
  ENMARK: {
    'Social Media Management': ['Content Calendar', 'Post Scheduling', 'Community Management', 'Full Management'],
    'Paid Advertising':        ['Meta Ads', 'Google Ads', 'TikTok Ads', 'LinkedIn Ads'],
    'Strategy & Consulting':   ['Brand Strategy', 'Marketing Audit', 'Competitor Analysis', 'Growth Strategy'],
    'SEO':                     ['On-Page SEO', 'Technical SEO', 'Link Building', 'Local SEO'],
  },
}

// ─── Status lifecycles ────────────────────────────────────────────────────────
export const FIXED_STATUSES   = ['PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'REVISION', 'APPROVED', 'DELIVERED', 'FEEDBACK', 'SUBMITTED', 'CANCELLED']
export const MONTHLY_STATUSES = ['ACTIVE', 'EXPIRING_SOON', 'RENEWED', 'CANCELLED']

export const ALL_STATUSES = [...new Set([...FIXED_STATUSES, ...MONTHLY_STATUSES, 'ON_HOLD'])]

export const STATUS_META = {
  PENDING:        { label: 'Pending',        color: 'gray'   },
  IN_PROGRESS:    { label: 'In Progress',    color: 'blue'   },
  IN_REVIEW:      { label: 'In Review',      color: 'purple' },
  REVISION:       { label: 'Revision',       color: 'yellow' },
  APPROVED:       { label: 'Approved',       color: 'teal'   },
  DELIVERED:      { label: 'Delivered',      color: 'green'  },
  FEEDBACK:       { label: 'Feedback',       color: 'orange' },
  SUBMITTED:      { label: 'Submitted',      color: 'indigo' },
  ACTIVE:         { label: 'Active',         color: 'green'  },
  EXPIRING_SOON:  { label: 'Expiring Soon',  color: 'orange' },
  RENEWED:        { label: 'Renewed',        color: 'blue'   },
  ON_HOLD:        { label: 'On Hold',        color: 'yellow' },
  CANCELLED:      { label: 'Cancelled',      color: 'red'    },
}

// ─── Calendar billing logic ───────────────────────────────────────────────────
/**
 * Given a period start date, calculate the period end date.
 * End = same day next month - 1 day, clamped to last valid date.
 * e.g. Jan 15 → Feb 14, Jan 31 → Feb 27/28, Mar 31 → Apr 29
 */
export function calcPeriodEnd(startDate) {
  const start = new Date(startDate)
  const y = start.getFullYear()
  const m = start.getMonth()   // 0-indexed
  const d = start.getDate()

  // Last day of next month
  const lastOfNextMonth = new Date(y, m + 2, 0).getDate()
  const clampedDay = Math.min(d, lastOfNextMonth)

  // Same-day next month (clamped), then minus 1 day
  const end = new Date(y, m + 1, clampedDay)
  end.setDate(end.getDate() - 1)
  return end
}

/**
 * Given a period end, get the next period start (end + 1 day)
 */
export function nextPeriodStart(periodEnd) {
  const d = new Date(periodEnd)
  d.setDate(d.getDate() + 1)
  return d
}

/**
 * Days remaining until a target date
 */
export function daysUntil(date) {
  const now    = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target - now) / 86400000)
}

export const EXPENSE_CATEGORIES = [
  'Software / Tools', 'Freelancer Payment', 'Advertising Spend',
  'Equipment', 'Travel', 'Hosting / Domain', 'Legal / Compliance',
  'Marketing Materials', 'Office Supplies', 'Other',
]
