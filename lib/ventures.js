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
 * End = the next billing-anchor date - 1 day, with the anchor clamped to the
 * month's last day. `billingDay` (the project's stored anchor, 1-31) keeps
 * month-end clients on month-end: without it a Jan 31 start drifted to the 28th
 * forever after February. Falls back to the start date's day.
 * e.g. Jan 15 → Feb 14; billingDay 31: Jan 31 → Feb 27, Feb 28 → Mar 30, Mar 31 → Apr 29
 */
export function calcPeriodEnd(startDate, billingDay = null) {
  const start  = new Date(startDate)
  const y      = start.getFullYear()
  const m      = start.getMonth()   // 0-indexed
  const d      = start.getDate()
  const anchor = Number(billingDay) >= 1 && Number(billingDay) <= 31 ? Number(billingDay) : d

  // If the (clamped) anchor is still ahead in the start month, the period ends
  // there; otherwise it ends at next month's (clamped) anchor.
  const lastOfThisMonth = new Date(y, m + 1, 0).getDate()
  const thisMonthAnchor = Math.min(anchor, lastOfThisMonth)
  let end
  if (d < thisMonthAnchor) {
    end = new Date(y, m, thisMonthAnchor)
  } else {
    const lastOfNextMonth = new Date(y, m + 2, 0).getDate()
    end = new Date(y, m + 1, Math.min(anchor, lastOfNextMonth))
  }
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
