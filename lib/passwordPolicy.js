/**
 * Shared strong-password rules — used on both the client (live feedback) and the
 * server (authoritative validation) so they never drift.
 *
 * Rule: at least 8 characters, with an uppercase letter, a lowercase letter,
 * a number, and a symbol.
 */
export const PASSWORD_MIN_LENGTH = 8

export const PASSWORD_RULES = [
  { key: 'length',  label: 'At least 8 characters', test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { key: 'upper',   label: 'An uppercase letter',   test: (v) => /[A-Z]/.test(v) },
  { key: 'lower',   label: 'A lowercase letter',    test: (v) => /[a-z]/.test(v) },
  { key: 'number',  label: 'A number',              test: (v) => /[0-9]/.test(v) },
  { key: 'symbol',  label: 'A symbol',              test: (v) => /[^A-Za-z0-9]/.test(v) },
]

/** Per-rule pass/fail, for live UI checklists. */
export function passwordChecklist(value = '') {
  return PASSWORD_RULES.map(r => ({ key: r.key, label: r.label, passed: r.test(value) }))
}

export function isStrongPassword(value = '') {
  return PASSWORD_RULES.every(r => r.test(value))
}

/**
 * Authoritative check. Returns null when valid, otherwise an error message
 * naming the first unmet requirement.
 */
export function validateStrongPassword(value = '') {
  if (typeof value !== 'string') return 'Password is required'
  const failed = PASSWORD_RULES.find(r => !r.test(value))
  if (!failed) return null
  if (failed.key === 'length') return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  return `Password must include: ${PASSWORD_RULES.filter(r => !r.test(value)).map(r => r.label.toLowerCase()).join(', ')}`
}
