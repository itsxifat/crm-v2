'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, ShieldCheck, Lock } from 'lucide-react'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { ProfileForm, VatSettingsForm, IncomeTaxForm } from './_components/ProfileForms'
import { RATES_VERIFIED_AS_OF } from '@/lib/tax/catalog'
import TaxCodesTable from './_components/TaxCodesTable'
import { readJson, fmtDay, btnPrimary } from '../vat-return/_lib/format'

const TABS = [
  { key: 'profile', label: 'Tax profile' },
  { key: 'vat', label: 'VAT' },
  { key: 'income-tax', label: 'Income tax' },
  { key: 'vat-codes', label: 'VAT service codes' },
  { key: 'tds-sections', label: 'TDS sections' },
]

const SOURCES = [
  'VAT & SD Act 2012 and Rules 2016, as amended by the Finance Act 2026',
  'VDS Rules 2025 (SRO 182-Ain/2025/310-Mushak), amended by SRO 140/2026',
  'Income Tax Act 2023; Withholding Tax Rules 2026 (SRO 273-Ain/Aykor-5/2026, from 1 Jul 2026)',
  'FY2025-26 withholding variants: Finance Ordinance 2025 rules',
]

export default function TaxSettingsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <TaxSettingsContent />
    </Suspense>
  )
}

function TaxSettingsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = TABS.some(t => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'profile'

  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tax/profile')
      const json = await readJson(res)
      if (my === seq.current) setProfile(json.data)
    } catch (err) {
      if (my === seq.current) setError(err.message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const setTab = (key) => router.replace(`/admin/tax/settings?tab=${key}`, { scroll: false })
  const isCodes = tab === 'vat-codes' || tab === 'tds-sections'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Tax settings</h1>
        <p className="text-sm text-gray-500">Company tax identity, VAT and income-tax settings, and the VAT / TDS rate tables.</p>
      </div>

      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-1 min-w-max" aria-label="Tax settings">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap',
                tab === t.key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {isCodes ? (
        <>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
            <CalendarClock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-900 space-y-1">
              <p className="font-medium">Rates change with each Finance Act, usually from 1 July.</p>
              <p className="text-xs text-amber-800">
                Review these tables every July. Don&apos;t overwrite an old rate — add a <span className="font-semibold">new rate version</span> from
                its effective date so earlier invoices, bills and certificates keep the rate that applied then. Rows marked
                <span className="mx-1 px-1.5 py-0.5 rounded bg-amber-100 text-[10px] font-semibold">Verify</span>need confirmation from your tax adviser.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-4 flex gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="text-xs text-gray-600 space-y-1">
              <p className="text-sm font-medium text-gray-900">Built-in rates verified as of {fmtDay(RATES_VERIFIED_AS_OF)}</p>
              <ul className="list-disc ml-4 space-y-0.5">
                {SOURCES.map(s => <li key={s}>{s}</li>)}
              </ul>
              <p>Each row shows its own source and when it was last changed.</p>
            </div>
          </div>
          <TaxCodesTable
            key={tab}
            kind={tab === 'vat-codes' ? 'VAT_SERVICE' : 'TDS_SECTION'}
            canEdit={!!profile?.canEdit}
          />
        </>
      ) : loading && !profile ? (
        <PageLoader />
      ) : error && !profile ? (
        <div className="bg-white border border-gray-100 rounded-xl">
          <EmptyState icon={AlertTriangle} title="Could not load tax settings" description={error}
            action={<button type="button" onClick={load} className={btnPrimary}>Try again</button>} />
        </div>
      ) : profile ? (
        <div className="space-y-4 max-w-4xl">
          {!profile.canEdit && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600 flex items-center gap-2">
              <Lock className="w-4 h-4" /> You can view these settings. Changing them needs the “Manage tax entries, certificates, codes & tax profile” permission.
            </div>
          )}
          {tab === 'profile' && <ProfileForm profile={profile} onSaved={setProfile} />}
          {tab === 'vat' && <VatSettingsForm profile={profile} onSaved={setProfile} />}
          {tab === 'income-tax' && <IncomeTaxForm profile={profile} onSaved={setProfile} />}
          {(profile.taxLockedUntil || profile.lockedUntil || profile.goLiveDate) && (
            <div className="rounded-lg border border-gray-100 bg-white px-4 py-3 text-xs text-gray-500 flex flex-wrap gap-x-5 gap-y-1">
              {profile.goLiveDate && <span>Go-live: <span className="text-gray-800 font-medium">{fmtDay(profile.goLiveDate)}</span></span>}
              {profile.lockedUntil && <span>Books locked to: <span className="text-gray-800 font-medium">{fmtDay(profile.lockedUntil)}</span></span>}
              {profile.taxLockedUntil && <span>VAT entries locked to: <span className="text-gray-800 font-medium">{fmtDay(profile.taxLockedUntil)}</span> (last filed return)</span>}
              <Link href="/admin/finance/opening-balances" className="text-blue-600 hover:underline">Opening balances &amp; period locks</Link>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
