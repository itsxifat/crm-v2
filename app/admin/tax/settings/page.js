'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, ShieldCheck, Lock, ChevronDown } from 'lucide-react'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ProfileForm, VatSettingsForm, IncomeTaxForm } from './_components/ProfileForms'
import { RATES_VERIFIED_AS_OF } from '@/lib/tax/catalog'
import TaxCodesTable from './_components/TaxCodesTable'
import { readJson, fmtDay } from '../vat-return/_lib/format'

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
    <div className="space-y-6">
      <PageHeader title="Tax settings" />

      <Tabs
        variant="underline"
        value={tab}
        onChange={setTab}
        tabs={TABS.map(t => ({ value: t.key, label: t.label }))}
      />

      {isCodes ? (
        <>
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <CalendarClock className="mt-0.5 size-4 shrink-0" />
            <p>
              Rates change with each Finance Act (usually 1 July). Add a <span className="font-medium">new rate version</span> instead
              of overwriting, so past documents keep their rate. Rows marked <span className="font-medium">Verify</span> need adviser confirmation.
            </p>
          </div>
          <Card as="details" className="group px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-gray-900 [&::-webkit-details-marker]:hidden">
              <ShieldCheck className="size-4 text-emerald-600" />
              Built-in rates verified as of {fmtDay(RATES_VERIFIED_AS_OF)}
              <ChevronDown className="ml-auto size-4 text-gray-400 transition-transform group-open:rotate-180" />
            </summary>
            <ul className="ml-6 mt-2 list-disc space-y-0.5 text-xs text-muted-foreground">
              {SOURCES.map(s => <li key={s}>{s}</li>)}
            </ul>
          </Card>
          <TaxCodesTable
            key={tab}
            kind={tab === 'vat-codes' ? 'VAT_SERVICE' : 'TDS_SECTION'}
            canEdit={!!profile?.canEdit}
          />
        </>
      ) : loading && !profile ? (
        <PageLoader />
      ) : error && !profile ? (
        <Card>
          <EmptyState icon={AlertTriangle} title="Couldn’t load tax settings" description={error}
            action={<Button variant="outline" onClick={load}>Try again</Button>} />
        </Card>
      ) : profile ? (
        <div className="max-w-4xl space-y-4">
          {!profile.canEdit && (
            <div className="flex items-center gap-2 rounded-lg border border-gray-200/80 bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
              <Lock className="size-4 shrink-0" /> View only — editing needs the “Manage tax entries, certificates, codes &amp; tax profile” permission.
            </div>
          )}
          {tab === 'profile' && <ProfileForm profile={profile} onSaved={setProfile} />}
          {tab === 'vat' && <VatSettingsForm profile={profile} onSaved={setProfile} />}
          {tab === 'income-tax' && <IncomeTaxForm profile={profile} onSaved={setProfile} />}
          {(profile.taxLockedUntil || profile.lockedUntil || profile.goLiveDate) && (
            <Card className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-3 text-[13px] text-muted-foreground">
              {profile.goLiveDate && <span>Go-live <span className="font-medium text-gray-900">{fmtDay(profile.goLiveDate)}</span></span>}
              {profile.lockedUntil && <span>Books locked to <span className="font-medium text-gray-900">{fmtDay(profile.lockedUntil)}</span></span>}
              {profile.taxLockedUntil && <span>VAT entries locked to <span className="font-medium text-gray-900">{fmtDay(profile.taxLockedUntil)}</span> (last filed return)</span>}
              <Link href="/admin/finance/opening-balances" className="font-medium text-gray-900 underline-offset-4 hover:underline sm:ml-auto">Opening balances &amp; period locks</Link>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  )
}
