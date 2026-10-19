'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  Plus, ArrowLeftRight, PlusCircle, Landmark, Search, Lock, AlertTriangle, RefreshCw,
} from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import Tabs from '@/components/ui/Tabs'
import SearchInput from '@/components/ui/SearchInput'
import LoadingSpinner, { PageLoader } from '@/components/ui/LoadingSpinner'
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
  ACCOUNT_GROUPS, FUND_GROUP_COLORS, formatAmount, fetchJson, accountSubtitle,
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
      <PageHeader
        title="Money accounts"
        actions={canManage && (
          <>
            <Button variant="outline" onClick={() => setTransfer({ open: true, fromId: null, toId: null })} disabled={activeCount < 2}>
              <ArrowLeftRight /> Transfer
            </Button>
            <Button variant="outline" onClick={() => setMovement({ open: true, accountId: null, kind: null })} disabled={activeCount < 1}>
              <PlusCircle /> Record movement
            </Button>
            <Button onClick={() => setForm({ open: true, account: null })}>
              <Plus /> New account
            </Button>
          </>
        )}
      >
        {!loading && !error && (settings.goLiveDate || settings.lockedUntil || settings.openingLocked) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            {settings.goLiveDate && <span>Go-live <span className="font-medium text-gray-900">{dayKeyLabel(settings.goLiveDate)}</span></span>}
            {settings.openingLocked && <span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> Opening balances locked</span>}
            {settings.lockedUntil && <span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> Books locked to {dayKeyLabel(settings.lockedUntil)}</span>}
          </div>
        )}
      </PageHeader>

      {!loading && !error && !settings.goLiveDate && activeCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            No go-live date set — balances may be incomplete.
            {canOpening && <> <Link href="/admin/finance/opening-balances" className="font-medium underline underline-offset-4">Set up opening balances</Link></>}
          </span>
        </div>
      )}

      {error && (
        <Card className="p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <Button variant="outline" size="sm" onClick={load} className="mt-3"><RefreshCw /> Try again</Button>
        </Card>
      )}

      {!error && !noAccounts && <FundsSummary totals={totals} loading={loading} />}

      {noAccounts && (
        <Card>
          <EmptyState
            icon={Landmark}
            title="No money accounts yet"
            description="Add each bank, cash box and mobile wallet."
            action={canManage ? (
              <Button onClick={() => setForm({ open: true, account: null })}>
                <Plus /> New account
              </Button>
            ) : <p className="text-xs text-muted-foreground">Ask a finance manager to add accounts.</p>}
          />
        </Card>
      )}

      {/* Toolbar */}
      {!noAccounts && !error && (
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            debounceMs={0}
            placeholder="Search…"
            className="w-full sm:w-64"
          />
          <Tabs
            value={group}
            onChange={setGroup}
            tabs={[{ key: 'all', short: 'All' }, ...ACCOUNT_GROUPS].map(g => ({
              value: g.key,
              label: g.key === 'all' ? g.short : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: FUND_GROUP_COLORS[g.key] }} />
                  {g.short}
                </span>
              ),
              count: groupCounts[g.key] ?? 0,
            }))}
          />
          <label className="ml-auto inline-flex cursor-pointer select-none items-center gap-2 text-[13px] font-medium text-gray-700">
            <span className="relative inline-flex">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="peer sr-only" />
              <span className="h-[18px] w-8 rounded-full bg-gray-200 transition-colors peer-checked:bg-gray-900" />
              <span className="absolute left-0.5 top-0.5 size-3.5 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-3.5" />
            </span>
            Show archived{totals?.archivedCount ? ` (${totals.archivedCount})` : ''}
          </label>
        </div>
      )}

      {/* Account groups */}
      {loading && accounts.length === 0 && !error && (
        <LoadingSpinner className="py-10" />
      )}
      {!noAccounts && !error && grouped.map(g => (
        <section key={g.key} className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
              <span className="size-2 rounded-full" style={{ backgroundColor: FUND_GROUP_COLORS[g.key] }} />
              {g.label}
              <span className="text-xs font-normal text-muted-foreground">{g.list.length}</span>
            </h2>
            <span className={cn('text-sm font-semibold tabular-nums', g.bdtTotal < -0.004 ? 'text-red-600' : 'text-gray-900')}>
              {formatAmount(g.bdtTotal, 'BDT')}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
        <Card>
          <EmptyState
            icon={Search}
            title="No results"
            action={<Button variant="outline" size="sm" onClick={() => { setSearch(''); setGroup('all') }}>Clear filters</Button>}
          />
        </Card>
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
            description="It's hidden from pickers and totals; history is kept. Balance must be zero."
            confirmLabel="Archive"
            danger
            onConfirm={() => archive(confirm.account)}
          >
            {confirm?.account && Math.abs(confirm.account.balance) > 0.004 && (
              <p className="text-red-600">Balance is {formatAmount(confirm.account.balance, confirm.account.currency)} — transfer it out first.</p>
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
            description="This account has no transactions. This can't be undone."
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
    <Suspense fallback={<PageLoader />}>
      <MoneyAccountsContent />
    </Suspense>
  )
}
