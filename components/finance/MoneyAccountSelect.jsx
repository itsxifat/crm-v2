'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn, formatCurrency } from '@/lib/utils'
import { formatMoney } from '@/lib/currencies'
import { accountTypeLabel } from '@/lib/finance/constants'

// ── Module-level cache shared by every picker on the page (30s TTL) ──────────
const CACHE_TTL_MS = 30 * 1000
const EMPTY = []
let _accounts  = null
let _goLiveDate = null
let _error     = null
let _fetchedAt = 0
let _promise   = null
const _listeners = new Set()

function isFresh() {
  return _accounts !== null && Date.now() - _fetchedAt < CACHE_TTL_MS
}

function notify() {
  for (const fn of _listeners) {
    try { fn() } catch { /* a stale listener must not break the others */ }
  }
}

function loadAccounts(force = false) {
  if (!force && isFresh()) return Promise.resolve(_accounts)
  if (_promise) return _promise
  _promise = fetch('/api/finance/accounts/options', { cache: 'no-store' })
    .then(async (res) => {
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Failed to load money accounts')
      return { list: Array.isArray(json.data) ? json.data : [], goLiveDate: json.meta?.goLiveDate ?? null }
    })
    .then(({ list, goLiveDate }) => {
      _accounts = list
      _goLiveDate = goLiveDate
      _error = null
      _fetchedAt = Date.now()
      return list
    })
    .catch((err) => {
      // Keep whatever we had; remember the failure for the TTL so a 403 is not refetched on every mount.
      _accounts = _accounts ?? []
      _error = err?.message || 'Failed to load money accounts'
      _fetchedAt = Date.now()
      return _accounts
    })
    .finally(() => {
      _promise = null
      notify()
    })
  return _promise
}

/** Force the next picker/hook to refetch (call after creating/editing accounts or posting money). */
export function invalidateMoneyAccounts() {
  _fetchedAt = 0
}

/**
 * Whether a form should ask for a money account on an entry dated `dayKey`
 * ('YYYY-MM-DD'). Client mirror of the server's requireAccountIfLive(): a date
 * before the go-live date never needs one (accounts usually open on go-live, so
 * the server would refuse them for such a date anyway). With no go-live date,
 * or no entry date yet, forms keep asking as before.
 */
export const accountRequiredOn = (dayKey, goLiveDate) => !goLiveDate || !dayKey || dayKey >= goLiveDate

/**
 * Active money accounts with balances from /api/finance/accounts/options.
 * goLiveDate: finance go-live day ('YYYY-MM-DD') or null.
 * @returns {{ accounts: Array<object>, goLiveDate: string|null, loading: boolean, reload: () => Promise<Array<object>>, error: string|null }}
 */
export function useMoneyAccounts() {
  const [, setTick] = useState(0)
  const [loading, setLoading] = useState(() => !isFresh())

  useEffect(() => {
    let alive = true
    const listener = () => {
      if (!alive) return
      setTick(t => t + 1)
      setLoading(false)
    }
    _listeners.add(listener)
    if (isFresh()) setLoading(false)
    else {
      setLoading(true)
      loadAccounts()
    }
    return () => {
      alive = false
      _listeners.delete(listener)
    }
  }, [])

  const reload = useCallback(() => {
    setLoading(true)
    return loadAccounts(true)
  }, [])

  return { accounts: _accounts ?? EMPTY, goLiveDate: _goLiveDate, loading, reload, error: _error }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatBalance(balance, currency) {
  const n = Number(balance) || 0
  if (!currency || currency === 'BDT') return formatCurrency(n, 'BDT')
  return formatMoney(n, currency)
}

export function moneyAccountLabel(account, { showBalance = true } = {}) {
  if (!account) return ''
  const last4 = account.last4 ? ` ••${account.last4}` : ''
  const base = `${account.name} · ${accountTypeLabel(account.type)}${last4}`
  return showBalance ? `${base} — ${formatBalance(account.balance, account.currency)}` : base
}

/** First account linked to the payment method, else a wallet of that provider, else the default. */
function pickAccount(options, paymentMethod) {
  const pm = paymentMethod ? String(paymentMethod).trim().toUpperCase() : ''
  if (pm) {
    const linked = options.find(a => (a.linkedPaymentMethods ?? []).some(m => String(m).toUpperCase() === pm))
    if (linked) return linked
    const wallet = options.find(a => a.type === 'MFS' && a.mfsProvider && a.mfsProvider === pm)
    if (wallet) return wallet
  }
  return options.find(a => a.isDefault) ?? null
}

const BASE_CLASS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed'

/**
 * Native <select> of ACTIVE money accounts (bank / cash / wallet …).
 *
 * @param {object}   props
 * @param {string|null} props.value
 * @param {(id: string|null, account: object|null) => void} props.onChange
 * @param {string|null} [props.currency]       only accounts in this currency or BDT
 * @param {string|null} [props.paymentMethod]  auto-selects the linked account (else the default) while value is empty
 * @param {string}   [props.placeholder='Select account']
 * @param {boolean}  [props.disabled]
 * @param {string}   [props.className]
 * @param {boolean}  [props.showBalance=true]
 * @param {boolean}  [props.required]
 * @param {boolean}  [props.autoSelect=true]   false = never auto-pick an account (filters, legacy rows)
 * @param {string|null} [props.date]           entry day 'YYYY-MM-DD': accounts opened after it are greyed out and never auto-picked
 */
export default function MoneyAccountSelect({
  value,
  onChange,
  currency = null,
  paymentMethod = null,
  placeholder = 'Select account',
  disabled = false,
  className,
  showBalance = true,
  required = false,
  autoSelect = true,
  date = null,
  id,
  name,
}) {
  const { accounts, loading, error } = useMoneyAccounts()
  // The server refuses a date before the account's opening date.
  const opensAfter = (a) => !!(date && a.openingDate && a.openingDate > date)

  const options = useMemo(() => {
    if (!currency) return accounts
    const cur = String(currency).toUpperCase()
    return accounts.filter(a => a.currency === cur || a.currency === 'BDT')
  }, [accounts, currency])

  const current = value ? String(value) : ''

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Auto-pick: runs once per (paymentMethod, currency) context. It only ever
  // replaces an empty value or a value it picked itself, so a user's choice
  // (or a value loaded for editing) is never overridden, and clearing the
  // field does not immediately re-fill it. When autoSelect turns off later
  // (e.g. the entry date moved before go-live), its own pick is cleared again.
  const autoRef = useRef({ key: null, id: null })
  useEffect(() => {
    if (loading || disabled) return
    const ownPick = current !== '' && current === autoRef.current.id
    if (!autoSelect) {
      if (ownPick) {
        autoRef.current = { key: null, id: null }
        onChangeRef.current?.(null, null)
      }
      return
    }
    const key = `${paymentMethod ?? ''}|${currency ?? ''}|${date ?? ''}`
    if (current !== '' && !ownPick) return
    if (autoRef.current.key === key) return
    const usable = date ? options.filter(a => !(a.openingDate && a.openingDate > date)) : options
    const pick = usable.length ? pickAccount(usable, paymentMethod) : null
    autoRef.current = { key, id: pick?.id ?? null }
    if (pick && pick.id !== current) onChangeRef.current?.(pick.id, pick)
    else if (!pick && ownPick) onChangeRef.current?.(null, null)
  }, [autoSelect, loading, disabled, options, paymentMethod, currency, current, date])

  const handleChange = (e) => {
    const nextId = e.target.value || null
    const account = nextId ? (accounts.find(a => a.id === nextId) ?? null) : null
    onChangeRef.current?.(nextId, account)
  }

  const inList = current !== '' && options.some(a => a.id === current)
  const outside = !loading && current !== '' && !inList
    ? accounts.find(a => a.id === current) ?? null
    : null

  let emptyLabel = placeholder
  if (loading) emptyLabel = 'Loading accounts…'
  else if (error && !accounts.length) emptyLabel = 'Could not load accounts'
  else if (!options.length) emptyLabel = 'No money accounts — add one in Finance → Money Accounts'

  return (
    <select
      id={id}
      name={name}
      value={current}
      onChange={handleChange}
      disabled={disabled || loading}
      required={required}
      title={error || undefined}
      className={cn(BASE_CLASS, className)}
    >
      <option value="">{emptyLabel}</option>
      {!loading && current !== '' && !inList && (
        <option value={current}>
          {outside ? `${moneyAccountLabel(outside, { showBalance })} (other currency)` : 'Unavailable account (archived)'}
        </option>
      )}
      {options.map(a => (
        <option key={a.id} value={a.id} disabled={opensAfter(a) && a.id !== current}>
          {`${moneyAccountLabel(a, { showBalance })}${opensAfter(a) ? ` (opens ${a.openingDate})` : ''}`}
        </option>
      ))}
    </select>
  )
}
