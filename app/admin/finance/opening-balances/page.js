'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, Lock, LockOpen, RefreshCw, Scale } from 'lucide-react'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'
import { usePermission } from '@/components/auth/Can'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { cn } from '@/lib/utils'
import { computeOpeningPosition, readFxRates } from './_lib/position'
import { STEPS } from './_lib/meta'
import Stepper from './_components/Stepper'
import GoLiveStep from './_components/GoLiveStep'
import MoneyAccountsStep from './_components/MoneyAccountsStep'
import TaxBalancesStep from './_components/TaxBalancesStep'
import AssetsStockStep from './_components/AssetsStockStep'
import ReviewStep from './_components/ReviewStep'
import PositionCard from './_components/PositionCard'
import PeriodLockCard from './_components/PeriodLockCard'
import { apiFetch, btnGhost, parseAmount } from './_components/shared'

function OpeningBalancesContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can, ready } = usePermission()

  const [data, setData] = useState(null)
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState({})
  const [fxDraft, setFxDraft] = useState({})
  const [periodsKey, setPeriodsKey] = useState(0)
  const seq = useRef(0)

  const rawStep = Number(searchParams.get('step'))
  const step = STEPS.some(s => s.key === rawStep) ? rawStep : 1

  const setStep = useCallback((n) => {
    const qs = new URLSearchParams(searchParams.toString())
    qs.set('step', String(n))
    router.replace(`${pathname}?${qs.toString()}`, { scroll: false })
  }, [router, pathname, searchParams])

  const load = useCallback(async ({ quiet = false } = {}) => {
    const my = ++seq.current
    if (!quiet) setLoading(true)
    setError(null)
    try {
      const json = await apiFetch('/api/finance/opening-balances')
      if (my !== seq.current) return
      setData(json.data)
      setMeta(json.meta)
    } catch (err) {
      if (my === seq.current) setError(err.message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Responses of PUT money-accounts / POST lock carry the fresh data.
  const applyResponse = useCallback((json) => {
    if (json?.data) setData(json.data)
    if (json?.meta) setMeta(json.meta)
    setPeriodsKey(k => k + 1)
  }, [])

  const refreshAll = useCallback(() => {
    load({ quiet: true })
    setPeriodsKey(k => k + 1)
  }, [load])

  const dirty = Object.keys(draft).length > 0 || Object.keys(fxDraft).length > 0

  // Warn before leaving with unsaved balances.
  useEffect(() => {
    if (!dirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // Live position: saved figures + unsaved edits in step 2.
  const livePosition = useMemo(() => {
    if (!data) return null
    if (!dirty) return data.position
    const accounts = (data.moneyAccounts ?? []).map(a => {
      const d = draft[a.id]
      if (!d || d.openingBalance === undefined) return a
      const n = parseAmount(d.openingBalance)
      return { ...a, openingBalance: n === null || Number.isNaN(n) ? 0 : n }
    })
    const fx = { ...(data.fxRates ?? {}) }
    for (const [cur, raw] of Object.entries(fxDraft)) {
      const n = parseAmount(raw)
      if (n === null || Number.isNaN(n) || n <= 0) delete fx[cur]
      else fx[cur] = n
    }
    return computeOpeningPosition({
      accounts,
      fxRates: readFxRates(fx),
      tax: data.tax,
      fixedAssets: data.assets,
      stock: data.stock,
      receivables: data.receivables,
    })
  }, [data, draft, fxDraft, dirty])

  const done = useMemo(() => {
    if (!data) return {}
    const active = (data.moneyAccounts ?? []).filter(a => a.status === 'ACTIVE')
    const taxCount = (data.taxOpenings ?? []).length
    return {
      1: !!data.goLiveDate,
      2: !!data.goLiveDate && active.length > 0 && active.every(a => !!a.openingDate),
      3: taxCount > 0,
      4: (data.assets?.count ?? 0) + (data.assets?.nonCapitalizedCount ?? 0) + (data.stock?.lines ?? 0) > 0,
      5: !!data.openingLocked,
    }
  }, [data])

  const canManage = ready && can('finance.opening.manage')

  if (loading && !data) return <PageLoader />

  if (error && !data) {
    return (
      <EmptyState
        icon={Scale}
        title="Couldn't load opening balances"
        description={error}
        action={<button type="button" className={btnGhost} onClick={() => load()}><RefreshCw className="w-4 h-4" /> Try again</button>}
      />
    )
  }
  if (!data) return null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900">Opening balances</h1>
          <p className="text-sm text-gray-500">
            Where the business stood the day before it started using the CRM — money, tax, assets and what clients owed.
            {data.asOfDate && <> Figures are as at the end of <span className="font-medium text-gray-700">{dayKeyLabel(data.asOfDate)}</span>.</>}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            data.openingLocked ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
          )}>
            {data.openingLocked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
            {data.openingLocked ? 'Locked' : 'Draft — not locked'}
          </span>
          <button type="button" onClick={refreshAll} className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" aria-label="Refresh">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <Stepper step={step} done={done} onStep={setStep} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 space-y-6 min-w-0">
          {step === 1 && <GoLiveStep data={data} canEdit={canManage} onSaved={refreshAll} />}
          {step === 2 && (
            <MoneyAccountsStep
              data={data}
              canEdit={canManage}
              draft={draft}
              setDraft={setDraft}
              fxDraft={fxDraft}
              setFxDraft={setFxDraft}
              onSaved={applyResponse}
            />
          )}
          {step === 3 && <TaxBalancesStep data={data} canEdit={canManage} onChanged={refreshAll} />}
          {step === 4 && <AssetsStockStep data={data} />}
          {step === 5 && (
            <ReviewStep
              data={data}
              meta={meta}
              position={livePosition}
              dirty={dirty}
              onLockChanged={applyResponse}
              goToStep={setStep}
            />
          )}

          <div className="flex items-center justify-between gap-2">
            <button type="button" className={btnGhost} disabled={step === 1} onClick={() => setStep(step - 1)}>
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            {step < STEPS.length && (
              <button type="button" className={btnGhost} onClick={() => setStep(step + 1)}>
                Next: {STEPS[step].label} <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="space-y-6 lg:sticky lg:top-6">
          {step !== 5 && (
            <PositionCard position={livePosition} tax={data.tax} asOfDate={data.asOfDate} dirty={dirty} />
          )}
          {step === 5 && (
            <div className="bg-white border border-gray-100 rounded-xl p-4 text-sm text-gray-600 space-y-2">
              <p className="font-medium text-gray-900">How to check the figures</p>
              <p>Total assets and liabilities should match your last balance sheet (or the accountant&apos;s trial balance) at {data.asOfDate ? dayKeyLabel(data.asOfDate) : 'the day before go-live'}.</p>
              <p>The opening equity should equal paid-up capital plus retained earnings on that balance sheet. A big difference usually means a missing account, a payable not entered, or assets still to import.</p>
            </div>
          )}
        </div>
      </div>

      <PeriodLockCard refreshKey={periodsKey} onChanged={() => load({ quiet: true })} />
    </div>
  )
}

export default function OpeningBalancesPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <OpeningBalancesContent />
    </Suspense>
  )
}
