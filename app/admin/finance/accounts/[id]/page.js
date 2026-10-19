'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  ArrowLeft, ArrowLeftRight, PlusCircle, Pencil, Loader2, Star, ShieldCheck, Clock, Lock, ChevronDown,
  FileText, ListChecks, Activity, ArchiveRestore, Landmark,
} from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { usePermission } from '@/components/auth/Can'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { MFS_PROVIDER_LABELS, WALLET_TYPES } from '@/lib/finance/constants'
import { useConfig } from '@/lib/useConfig'
import { invalidateMoneyAccounts, useMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import AccountIcon from '@/components/finance/AccountIcon'
import AccountFormModal from '@/components/finance/AccountFormModal'
import TransferModal from '@/components/finance/TransferModal'
import MovementModal from '@/components/finance/MovementModal'
import AccountStatement from '@/components/finance/AccountStatement'
import ReconcilePanel from '@/components/finance/ReconcilePanel'
import TransfersList from '@/components/finance/TransfersList'
import MovementsList from '@/components/finance/MovementsList'
import {
  BTN_PRIMARY, BTN_SECONDARY, accountColor, accountSubtitle, maskedNumber, formatAmount, fetchJson, withAlpha,
} from '@/components/finance/accountTheme'

const TABS = [
  { key: 'statement', label: 'Statement', icon: FileText },
  { key: 'reconcile', label: 'Reconcile', icon: ListChecks },
  { key: 'activity', label: 'Transfers & movements', icon: Activity },
]

function Stat({ label, value, sub, className, valueClass }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium truncate">{label}</p>
      <p className={cn('text-base font-semibold tabular-nums text-gray-900 truncate', valueClass)}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 truncate">{sub}</p>}
    </div>
  )
}

function Detail({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-800 break-words">{value}</dd>
    </div>
  )
}

function AccountDetailContent() {
  const { id } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = usePermission()
  const canManage = can('finance.accounts.manage')
  const canReconcile = can('finance.accounts.reconcile')
  const { paymentMethods } = useConfig()
  const { accounts: pickerAccounts } = useMoneyAccounts()

  const requestedTab = searchParams.get('tab')
  const tab = TABS.some(t => t.key === requestedTab) ? requestedTab : 'statement'
  const setTab = (key) => router.replace(`/admin/finance/accounts/${id}${key === 'statement' ? '' : `?tab=${key}`}`, { scroll: false })

  const [account, setAccount] = useState(null)
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showDetails, setShowDetails] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [movement, setMovement] = useState({ open: false, kind: null })
  const seq = useRef(0)

  const load = useCallback(async () => {
    const n = ++seq.current
    try {
      const json = await fetchJson(`/api/finance/accounts/${id}`)
      if (n !== seq.current) return
      setAccount(json.data)
      setSettings(json.settings ?? {})
      setError(null)
      setNotFound(false)
    } catch (err) {
      if (n !== seq.current) return
      if (err.status === 404) setNotFound(true)
      else setError(err.message)
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const afterMoney = useCallback(() => {
    invalidateMoneyAccounts()
    setRefreshKey(k => k + 1)
    load()
  }, [load])

  const restore = async () => {
    try {
      await fetchJson(`/api/finance/accounts/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }),
      })
      toast.success('Account restored')
      afterMoney()
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (loading && !account) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
  }
  if (notFound) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl">
        <EmptyState icon={Landmark} title="Account not found" description="It may have been deleted." action={<Link href="/admin/finance/accounts" className={BTN_SECONDARY}><ArrowLeft className="w-4 h-4" /> Money Accounts</Link>} />
      </div>
    )
  }
  if (error && !account) {
    return (
      <div className="bg-white border border-red-100 rounded-xl p-6 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <button type="button" onClick={load} className={cn(BTN_SECONDARY, 'mt-3')}>Try again</button>
      </div>
    )
  }
  if (!account) return null

  const color = accountColor(account)
  const archived = account.status === 'ARCHIVED'
  const cash = account.type === 'CASH' || account.type === 'PETTY_CASH'
  const negative = account.balance < -0.004
  const cur = account.currency
  const walletLabel = WALLET_TYPES.find(w => w.value === account.walletType)?.label

  return (
    <div className="space-y-5">
      <Link href="/admin/finance/accounts" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" /> Money Accounts
      </Link>

      {/* Header */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="h-1.5" style={{ backgroundColor: color }} />
        <div className="p-5 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-start gap-4">
            <div className="flex items-start gap-4 min-w-0 flex-1">
              <AccountIcon account={account} size="lg" />
              <div className="min-w-0">
                <h1 className="text-xl font-semibold text-gray-900 truncate">{account.name}</h1>
                <p className="text-sm text-gray-500 truncate">
                  {accountSubtitle(account)}{maskedNumber(account) ? ` · ${maskedNumber(account)}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: withAlpha(color, 0.1), color }}>{account.typeLabel}</span>
                  {cur !== 'BDT' && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{cur}</span>}
                  {account.isDefault && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><Star className="w-3 h-3" /> Default</span>}
                  {archived && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">Archived</span>}
                  {account.reconciliationInProgress && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">Reconciliation in progress</span>}
                  {!cash && account.isBankingChannel === false && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">Not a banking channel</span>}
                  {account.code && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-mono text-gray-600">{account.code}</span>}
                </div>
              </div>
            </div>
            {!archived && canManage && (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <button type="button" className={BTN_SECONDARY} onClick={() => setTransferOpen(true)}><ArrowLeftRight className="w-4 h-4" /> Transfer</button>
                <button type="button" className={BTN_SECONDARY} onClick={() => setMovement({ open: true, kind: null })}><PlusCircle className="w-4 h-4" /> Movement</button>
                <button type="button" className={BTN_SECONDARY} onClick={() => setFormOpen(true)}><Pencil className="w-4 h-4" /> Edit</button>
              </div>
            )}
            {archived && canManage && (
              <button type="button" className={BTN_PRIMARY} onClick={restore}><ArchiveRestore className="w-4 h-4" /> Restore account</button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 border-t border-gray-50 pt-4">
            <Stat label="Balance" value={formatAmount(account.balance, cur)} valueClass={cn('text-xl font-bold', negative && 'text-red-600')}
              sub={account.available !== null && account.available !== undefined ? `Available ${formatAmount(account.available, cur)}` : 'No overdraft limit'} />
            <Stat label="Cleared balance" value={formatAmount(account.clearedBalance, cur)} sub={`${account.unclearedCount} uncleared`} />
            <Stat label="Money in (since opening)" value={formatAmount(account.inflow, cur)} valueClass="text-emerald-700" />
            <Stat label="Money out (since opening)" value={formatAmount(account.outflow, cur)} />
            <Stat
              label="Opening balance"
              value={formatAmount(account.openingBalance, cur)}
              sub={account.openingDate ? `as of ${dayKeyLabel(account.openingDate)}` : 'No cut-off date'}
            />
            <Stat
              label={cash ? 'Last cash count' : 'Last reconciled'}
              value={account.lastReconciledDate ? dayKeyLabel(account.lastReconciledDate) : 'Never'}
              sub={account.lastReconciledDate ? `at ${formatAmount(account.lastReconciledBalance, cur)}` : (account.lastTxDate ? `Last activity ${dayKeyLabel(account.lastTxDate)}` : 'No activity yet')}
              valueClass={account.lastReconciledDate ? '' : 'text-gray-400'}
            />
          </div>

          <div>
            <button type="button" onClick={() => setShowDetails(s => !s)} className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900">
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showDetails && 'rotate-180')} /> Account details
            </button>
            {showDetails && (
              <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
                <Detail label={account.type === 'GATEWAY' ? 'Gateway' : 'Bank'} value={account.bankName} />
                <Detail label="Branch" value={account.branchName} />
                <Detail label={account.type === 'MFS' ? 'Wallet number' : 'Account number'} value={account.accountNumber} />
                <Detail label="Account title" value={account.accountName} />
                <Detail label="Routing number" value={account.routingNumber} />
                <Detail label="SWIFT / BIC" value={account.swiftCode} />
                <Detail label="Provider" value={account.mfsProvider ? MFS_PROVIDER_LABELS[account.mfsProvider] : null} />
                <Detail label="Wallet type" value={walletLabel} />
                <Detail label="Custodian" value={account.custodian?.name} />
                <Detail label="Overdraft" value={account.allowNegative ? 'No limit' : (Number(account.creditLimit) > 0 ? `Up to ${formatAmount(account.creditLimit, cur)}` : 'Not allowed')} />
                <Detail label="Opening reference" value={account.openingReference} />
                <Detail label="Default for" value={account.linkedPaymentMethods?.length ? account.linkedPaymentMethods.map(m => (paymentMethods ?? []).find(pm => String(pm.value).toUpperCase() === m)?.label ?? m.replace(/_/g, ' ')).join(', ') : null} />
                <Detail label="Notes" value={account.notes} />
              </dl>
            )}
          </div>
        </div>
      </div>

      {(settings.lockedUntil || settings.openingLocked) && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          {settings.lockedUntil && <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Books locked up to {dayKeyLabel(settings.lockedUntil)}</span>}
          {settings.openingLocked && <span className="inline-flex items-center gap-1"><Lock className="w-3 h-3" /> Opening balances locked</span>}
          {account.lastReconciledDate && <span className="inline-flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Reconciled to {dayKeyLabel(account.lastReconciledDate)}</span>}
          {account.lastTxDate && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Last entry {dayKeyLabel(account.lastTxDate)}</span>}
        </p>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-1 min-w-max" aria-label="Account sections">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === t.key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800',
              )}
            >
              <t.icon className="w-4 h-4" /> {t.label}
              {t.key === 'reconcile' && account.reconciliationInProgress && <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'statement' && <AccountStatement account={account} refreshKey={refreshKey} fyStartMonth={settings.fiscalYearStartMonth ?? 7} />}
      {tab === 'reconcile' && (
        <ReconcilePanel
          account={account}
          canReconcile={canReconcile && !archived}
          refreshKey={refreshKey}
          onChanged={load}
          onRecordMovement={canManage && !archived ? (kind) => setMovement({ open: true, kind }) : null}
        />
      )}
      {tab === 'activity' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <TransfersList accountId={account.id} refreshKey={refreshKey} canManage={canManage} limit={15} onChanged={afterMoney} title="Transfers" />
          <MovementsList accountId={account.id} refreshKey={refreshKey} canManage={canManage && !archived} limit={15} onChanged={afterMoney} />
        </div>
      )}

      {canManage && (
        <>
          <AccountFormModal open={formOpen} onOpenChange={setFormOpen} account={account} accounts={pickerAccounts} settings={settings} onSaved={afterMoney} />
          <TransferModal open={transferOpen} onOpenChange={setTransferOpen} defaultFromId={account.id} settings={settings} onDone={afterMoney} />
          <MovementModal
            open={movement.open}
            onOpenChange={(v) => setMovement(m => ({ ...m, open: v }))}
            defaultAccountId={account.id}
            defaultKind={movement.kind}
            settings={settings}
            onDone={afterMoney}
          />
        </>
      )}
    </div>
  )
}

export default function MoneyAccountDetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>}>
      <AccountDetailContent />
    </Suspense>
  )
}
