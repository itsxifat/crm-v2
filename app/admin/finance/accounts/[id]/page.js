'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  ArrowLeft, ArrowLeftRight, PlusCircle, Pencil, Star, ShieldCheck, Clock, Lock, ChevronDown,
  FileText, ListChecks, Activity, ArchiveRestore, Landmark,
} from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import Tabs from '@/components/ui/Tabs'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { usePermission } from '@/components/auth/Can'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { MFS_PROVIDER_LABELS, WALLET_TYPES } from '@/lib/finance/constants'
import { useConfig } from '@/lib/useConfig'
import { invalidateMoneyAccounts, useMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import AccountFormModal from '@/components/finance/AccountFormModal'
import TransferModal from '@/components/finance/TransferModal'
import MovementModal from '@/components/finance/MovementModal'
import AccountStatement from '@/components/finance/AccountStatement'
import ReconcilePanel from '@/components/finance/ReconcilePanel'
import TransfersList from '@/components/finance/TransfersList'
import MovementsList from '@/components/finance/MovementsList'
import {
  accountSubtitle, maskedNumber, formatAmount, fetchJson,
} from '@/components/finance/accountTheme'

const TABS = [
  { key: 'statement', label: 'Statement', icon: FileText },
  { key: 'reconcile', label: 'Reconcile', icon: ListChecks },
  { key: 'activity', label: 'Transfers & movements', icon: Activity },
]

function Stat({ label, value, sub, className, valueClass }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="truncate text-[13px] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 truncate text-base font-semibold tabular-nums text-gray-900', valueClass)}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Detail({ label, value }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-gray-900">{value}</dd>
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
    return <PageLoader />
  }
  if (notFound) {
    return (
      <Card>
        <EmptyState icon={Landmark} title="Account not found" description="It may have been deleted." action={<Button variant="outline" href="/admin/finance/accounts"><ArrowLeft /> Money accounts</Button>} />
      </Card>
    )
  }
  if (error && !account) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Button variant="outline" size="sm" onClick={load} className="mt-3">Try again</Button>
      </Card>
    )
  }
  if (!account) return null

  const archived = account.status === 'ARCHIVED'
  const cash = account.type === 'CASH' || account.type === 'PETTY_CASH'
  const negative = account.balance < -0.004
  const cur = account.currency
  const walletLabel = WALLET_TYPES.find(w => w.value === account.walletType)?.label

  return (
    <div className="space-y-6">
      <PageHeader
        back="/admin/finance/accounts"
        backLabel="Money accounts"
        title={account.name}
        description={`${accountSubtitle(account)}${maskedNumber(account) ? ` · ${maskedNumber(account)}` : ''}`}
        meta={
          <>
            <Badge variant="outline">{account.typeLabel}</Badge>
            {cur !== 'BDT' && <Badge variant="indigo">{cur}</Badge>}
            {account.isDefault && <Badge variant="warning"><Star className="size-3" /> Default</Badge>}
            {archived && <Badge>Archived</Badge>}
            {account.reconciliationInProgress && <Badge variant="primary">Reconciling</Badge>}
            {!cash && account.isBankingChannel === false && <Badge variant="outline">Not a banking channel</Badge>}
            {account.code && <Badge variant="outline" className="font-mono">{account.code}</Badge>}
          </>
        }
        actions={canManage && (archived ? (
          <Button onClick={restore}><ArchiveRestore /> Restore account</Button>
        ) : (
          <>
            <Button variant="outline" onClick={() => setTransferOpen(true)}><ArrowLeftRight /> Transfer</Button>
            <Button variant="outline" onClick={() => setMovement({ open: true, kind: null })}><PlusCircle /> Movement</Button>
            <Button variant="outline" onClick={() => setFormOpen(true)}><Pencil /> Edit</Button>
          </>
        ))}
      />

      <Card>
        <div className="grid grid-cols-2 gap-4 p-5 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Balance" value={formatAmount(account.balance, cur)} valueClass={cn('text-xl', negative && 'text-red-600')}
            sub={account.available !== null && account.available !== undefined ? `Available ${formatAmount(account.available, cur)}` : 'No overdraft limit'} />
          <Stat label="Cleared balance" value={formatAmount(account.clearedBalance, cur)} sub={`${account.unclearedCount} uncleared`} />
          <Stat label="Money in" value={formatAmount(account.inflow, cur)} valueClass="text-emerald-700" sub="Since opening" />
          <Stat label="Money out" value={formatAmount(account.outflow, cur)} sub="Since opening" />
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

        <div className="border-t border-gray-100 px-5 py-3">
          <button type="button" onClick={() => setShowDetails(s => !s)} className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground hover:text-gray-900">
            <ChevronDown className={cn('size-4 transition-transform', showDetails && 'rotate-180')} /> Account details
          </button>
          {showDetails && (
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 pb-2 sm:grid-cols-2 lg:grid-cols-4">
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
      </Card>

      {(settings.lockedUntil || settings.openingLocked) && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          {settings.lockedUntil && <span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> Books locked to {dayKeyLabel(settings.lockedUntil)}</span>}
          {settings.openingLocked && <span className="inline-flex items-center gap-1"><Lock className="size-3.5" /> Opening balances locked</span>}
          {account.lastReconciledDate && <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5" /> Reconciled to {dayKeyLabel(account.lastReconciledDate)}</span>}
          {account.lastTxDate && <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> Last entry {dayKeyLabel(account.lastTxDate)}</span>}
        </p>
      )}

      <Tabs
        variant="underline"
        value={tab}
        onChange={setTab}
        tabs={TABS.map(t => ({
          value: t.key,
          icon: t.icon,
          label: t.key === 'reconcile' && account.reconciliationInProgress
            ? <span className="inline-flex items-center gap-1.5">{t.label}<span className="size-1.5 rounded-full bg-blue-500" /></span>
            : t.label,
        }))}
      />

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
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
    <Suspense fallback={<PageLoader />}>
      <AccountDetailContent />
    </Suspense>
  )
}
