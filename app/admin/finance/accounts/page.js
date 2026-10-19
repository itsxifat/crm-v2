'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  Plus, ArrowLeftRight, PlusCircle, Landmark, Search, Lock, Info, Loader2, RefreshCw, X,
} from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { usePermission } from '@/components/auth/Can'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import AccountCard from '@/components/finance/AccountCard'
import AccountFormModal from '@/components/finance/AccountFormModal'
import TransferModal from '@/components/finance/TransferModal'
import MovementModal from '@/components/finance/MovementModal'
import FundsSummary from '@/components/finance/FundsSummary'
import TransfersList from '@/components/finance/TransfersList'
import MovementsList from '@/components/finance/MovementsList'
import { ConfirmDialog } from '@/components/finance/FinanceDialogs'
import {
  ACCOUNT_GROUPS, FUND_GROUP_COLORS, BTN_PRIMARY, BTN_SECONDARY, formatAmount, fetchJson, accountSubtitle,
} from '@/components/finance/accountTheme'

function MoneyAccountsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can, ready } = usePermission()
  const canManage = can('finance.accounts.manage')
  const canReconcile = can('finance.accounts.reconcile')
  const canOpening = can('finance.opening.manage')

  const [accounts, setAccounts] = useState([])
  const [totals, setTotals] = useState(null)
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('all')
  const [refreshKey, setRefreshKey] = useState(0)

  const [form, setForm] = useState({ open: false, account: null })
  const [transfer, setTransfer] = useState({ open: false, fromId: null, toId: null })
  const [movement, setMovement] = useState({ open: false, accountId: null, kind: null })
  const [confirm, setConfirm] = useState(null) // { kind: 'archive'|'force'|'delete', account, message }
  const seq = useRef(0)

  const load = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    try {
      const json = await fetchJson(`/api/finance/accounts?status=${showArchived ? 'all' : 'ACTIVE'}`)
      if (id !== seq.current) return
      setAccounts(json.data ?? [])
      setTotals(json.totals ?? null)
      setSettings(json.settings ?? {})
      setError(null)
    } catch (err) {
      if (id === seq.current) setError(err.message)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [showArchived])

  useEffect(() => { load() }, [load])

  // Deep links: ?new=1, ?transfer=1, ?movement=1 (e.g. from the opening-balance wizard or account pickers).
  useEffect(() => {
    if (!ready || !canManage) return
    const open = (fn) => { fn(); router.replace('/admin/finance/accounts', { scroll: false }) }
    if (searchParams.get('new') === '1') open(() => setForm({ open: true, account: null }))
    else if (searchParams.get('transfer') === '1') open(() => setTransfer({ open: true, fromId: null, toId: null }))
    else if (searchParams.get('movement') === '1') open(() => setMovement({ open: true, accountId: null, kind: null }))
  }, [ready, canManage, searchParams, router])

  const afterChange = useCallback(() => {
    invalidateMoneyAccounts()
    setRefreshKey(k => k + 1)
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accounts.filter(a => {
      if (group !== 'all' && a.group !== group) return false
      if (!q) return true
      return [a.name, a.code, a.bankName, a.branchName, a.accountName, a.last4, accountSubtitle(a), a.currency]
        .some(v => v && String(v).toLowerCase().includes(q))
    })
  }, [accounts, search, group])

  const grouped = useMemo(() => ACCOUNT_GROUPS.map(g => {
    const list = filtered.filter(a => a.group === g.key)
    const bdtTotal = list.filter(a => a.status === 'ACTIVE' && a.currency === 'BDT').reduce((s, a) => s + a.balance, 0)
    return { ...g, list, bdtTotal }
  }).filter(g => g.list.length > 0), [filtered])

  const groupCounts = useMemo(() => {
    const c = { all: accounts.length }
    for (const a of accounts) c[a.group] = (c[a.group] ?? 0) + 1
    return c
  }, [accounts])

  // ── actions ──
  const archive = async (account, force = false) => {
    try {
      await fetchJson(`/api/finance/accounts/${account.id}${force ? '?force=1' : ''}`, { method: 'DELETE' })
      toast.success(`${account.name} archived`)
      setConfirm(null)
      afterChange()
    } catch (err) {
      if (err.status === 409 && err.code === 'UNCLEARED_ITEMS') {
        setConfirm({ kind: 'force', account, message: err.message })
        return
      }
      setConfirm(null)
      toast.error(err.message)
    }
  }

  const restore = async (account) => {
    try {
      await fetchJson(`/api/finance/accounts/${account.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }),
      })
      toast.success(`${account.name} restored`)
      afterChange()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const removeForever = async (account) => {
    try {
      await fetchJson(`/api/finance/accounts/${account.id}?permanent=1`, { method: 'DELETE' })
      toast.success(`${account.name} deleted`)
      setConfirm(null)
      afterChange()
    } catch (err) {
      setConfirm(null)
      toast.error(err.message)
    }
  }

  const activeCount = accounts.filter(a => a.status === 'ACTIVE').length
  const noAccounts = !loading && !error && accounts.length === 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Money Accounts</h1>
          <p className="text-sm text-gray-500">Where the money actually is — bank accounts, cash and mobile wallets, with live balances.</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setTransfer({ open: true, fromId: null, toId: null })} disabled={activeCount < 2}>
              <ArrowLeftRight className="w-4 h-4" /> Transfer
            </button>
            <button type="button" className={BTN_SECONDARY} onClick={() => setMovement({ open: true, accountId: null, kind: null })} disabled={activeCount < 1}>
              <PlusCircle className="w-4 h-4" /> Record movement
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => setForm({ open: true, account: null })}>
              <Plus className="w-4 h-4" /> Add account
            </button>
          </div>
        )}
      </div>

      {/* Go-live / lock notices */}
      {!loading && !error && (
        <div className="flex flex-col gap-2">
          {!settings.goLiveDate && activeCount > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                No go-live date yet. Until it is set, payments can still be recorded without an account, so balances here may be incomplete.
                {canOpening && <> <Link href="/admin/finance/opening-balances" className="font-medium underline">Set opening balances &amp; go-live</Link></>}
              </span>
            </div>
          )}
          {(settings.goLiveDate || settings.lockedUntil || settings.openingLocked) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              {settings.goLiveDate && <span>Go-live: <strong className="text-gray-700">{dayKeyLabel(settings.goLiveDate)}</strong></span>}
              {settings.openingLocked && <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Opening balances locked</span>}
              {settings.lockedUntil && <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Books locked up to {dayKeyLabel(settings.lockedUntil)}</span>}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-white border border-red-100 rounded-xl p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button type="button" onClick={load} className={cn(BTN_SECONDARY, 'mt-3')}><RefreshCw className="w-4 h-4" /> Try again</button>
        </div>
      )}

      {!error && !noAccounts && <FundsSummary totals={totals} loading={loading} />}

      {noAccounts && (
        <div className="bg-white border border-gray-100 rounded-xl">
          <EmptyState
            icon={Landmark}
            title="Add your first money account"
            description="Create one account for each bank account, cash box and bKash/Nagad wallet the business uses. Every payment and receipt will then say where the money went, and balances stay true."
            action={canManage ? (
              <button type="button" className={BTN_PRIMARY} onClick={() => setForm({ open: true, account: null })}>
                <Plus className="w-4 h-4" /> Add account
              </button>
            ) : <p className="text-xs text-gray-400">Ask a finance manager to add accounts.</p>}
          />
        </div>
      )}

      {/* Toolbar */}
      {!noAccounts && !error && (
        <div className="bg-white border border-gray-100 rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative md:w-72">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, bank, last 4…"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700" aria-label="Clear search">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[{ key: 'all', short: 'All' }, ...ACCOUNT_GROUPS].map(g => (
              <button
                key={g.key}
                type="button"
                onClick={() => setGroup(g.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors',
                  group === g.key ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                )}
              >
                {g.key !== 'all' && <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: FUND_GROUP_COLORS[g.key] }} />}
                {g.short}
                <span className={cn('tabular-nums', group === g.key ? 'text-gray-300' : 'text-gray-400')}>{groupCounts[g.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <label className="md:ml-auto inline-flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer select-none">
            <span className="relative inline-flex">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="peer sr-only" />
              <span className="w-8 h-[18px] rounded-full bg-gray-200 peer-checked:bg-gray-900 transition-colors" />
              <span className="absolute left-0.5 top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-3.5" />
            </span>
            Show archived{totals?.archivedCount ? ` (${totals.archivedCount})` : ''}
          </label>
        </div>
      )}

      {/* Account groups */}
      {loading && accounts.length === 0 && !error && (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
      )}
      {!noAccounts && !error && grouped.map(g => (
        <section key={g.key} className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: FUND_GROUP_COLORS[g.key] }} />
              {g.label}
              <span className="text-xs font-normal text-gray-400">{g.list.length}</span>
            </h2>
            <span className={cn('text-sm font-semibold tabular-nums', g.bdtTotal < -0.004 ? 'text-red-600' : 'text-gray-700')}>
              {formatAmount(g.bdtTotal, 'BDT')}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {g.list.map(a => (
              <AccountCard
                key={a.id}
                account={a}
                canManage={canManage}
                canReconcile={canReconcile}
                onTransfer={(acc) => setTransfer({ open: true, fromId: acc.id, toId: null })}
                onMovement={(acc) => setMovement({ open: true, accountId: acc.id, kind: null })}
                onEdit={(acc) => setForm({ open: true, account: acc })}
                onArchive={(acc) => setConfirm({ kind: 'archive', account: acc })}
                onRestore={restore}
                onDelete={(acc) => setConfirm({ kind: 'delete', account: acc })}
              />
            ))}
          </div>
        </section>
      ))}
      {!noAccounts && !error && !loading && grouped.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-xl py-10 text-center text-sm text-gray-500">
          No accounts match {search ? `“${search}”` : 'this filter'}.
          <button type="button" onClick={() => { setSearch(''); setGroup('all') }} className="ml-2 font-medium text-gray-900 underline">Clear filters</button>
        </div>
      )}

      {/* Activity */}
      {!noAccounts && !error && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <TransfersList refreshKey={refreshKey} canManage={canManage} onChanged={afterChange} />
          <MovementsList refreshKey={refreshKey} canManage={canManage} onChanged={afterChange} />
        </div>
      )}

      {/* Modals */}
      {canManage && (
        <>
          <AccountFormModal
            open={form.open}
            onOpenChange={(v) => setForm(f => ({ ...f, open: v }))}
            account={form.account}
            accounts={accounts}
            settings={settings}
            onSaved={afterChange}
          />
          <TransferModal
            open={transfer.open}
            onOpenChange={(v) => setTransfer(t => ({ ...t, open: v }))}
            defaultFromId={transfer.fromId}
            defaultToId={transfer.toId}
            settings={settings}
            onDone={afterChange}
          />
          <MovementModal
            open={movement.open}
            onOpenChange={(v) => setMovement(m => ({ ...m, open: v }))}
            defaultAccountId={movement.accountId}
            defaultKind={movement.kind}
            settings={settings}
            onDone={afterChange}
          />
          <ConfirmDialog
            open={confirm?.kind === 'archive'}
            onOpenChange={(v) => !v && setConfirm(null)}
            title={`Archive ${confirm?.account?.name ?? 'account'}?`}
            description="Archived accounts disappear from pickers and totals but keep their full history. The balance must be zero first."
            confirmLabel="Archive"
            danger
            onConfirm={() => archive(confirm.account)}
          >
            {confirm?.account && Math.abs(confirm.account.balance) > 0.004 && (
              <p className="text-red-600">Current balance is {formatAmount(confirm.account.balance, confirm.account.currency)} — transfer it out first.</p>
            )}
          </ConfirmDialog>
          <ConfirmDialog
            open={confirm?.kind === 'force'}
            onOpenChange={(v) => !v && setConfirm(null)}
            title="Archive with uncleared items?"
            description={confirm?.message}
            confirmLabel="Archive anyway"
            danger
            onConfirm={() => archive(confirm.account, true)}
          />
          <ConfirmDialog
            open={confirm?.kind === 'delete'}
            onOpenChange={(v) => !v && setConfirm(null)}
            title={`Delete ${confirm?.account?.name ?? 'account'}?`}
            description="This account has no transactions, so it can be removed completely. This cannot be undone."
            confirmLabel="Delete"
            danger
            onConfirm={() => removeForever(confirm.account)}
          />
        </>
      )}
    </div>
  )
}

export default function MoneyAccountsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>}>
      <MoneyAccountsContent />
    </Suspense>
  )
}
