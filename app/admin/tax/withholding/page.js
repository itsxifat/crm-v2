'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Landmark, FileOutput, FileCheck, BadgePercent, FileClock, ClipboardList, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import TdsDepositTab from './_components/TdsDepositTab'
import IssueCertificatesTab from './_components/IssueCertificatesTab'
import CollectCertificatesTab from './_components/CollectCertificatesTab'
import WhtReturnTab from './_components/WhtReturnTab'

const TABS = [
  { key: 'tds-deposit',    label: 'TDS to deposit',               short: 'TDS deposit',   icon: Landmark },
  { key: 'vds-issue',      label: 'VDS deducted (issue 6.6)',     short: 'Issue 6.6',     icon: FileOutput },
  { key: 'tds-certs',      label: 'TDS certificates to issue',    short: 'TDS certs',     icon: FileCheck },
  { key: 'ait',            label: 'AIT credits (TDS by customers)', short: 'AIT credits', icon: BadgePercent },
  { key: 'vds-receivable', label: 'VDS receivable (collect 6.6)', short: 'Collect 6.6',   icon: FileClock },
  { key: 'wht-return',     label: 'Quarterly WHT return',         short: 'WHT return',    icon: ClipboardList },
]

function WithholdingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requested = searchParams.get('tab')
  const tab = TABS.some(t => t.key === requested) ? requested : 'tds-deposit'

  const setTab = (key) => {
    const params = new URLSearchParams()
    params.set('tab', key)
    router.replace(`/admin/tax/withholding?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1">
        <Link href="/admin/tax" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 w-fit"><ArrowLeft className="w-3.5 h-3.5" /> Tax dashboard</Link>
        <h1 className="text-xl font-semibold text-gray-900">Withholding tax</h1>
        <p className="text-sm text-gray-500">TDS / AIT and VDS: deposit what you deducted, issue and collect certificates, and prepare the quarterly return.</p>
      </div>

      <div className="-mx-4 sm:mx-0 overflow-x-auto">
        <div className="flex min-w-max gap-1 px-4 sm:px-0 border-b border-gray-200">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors',
                tab === t.key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800',
              )}
            >
              <t.icon className="w-4 h-4" />
              <span className="hidden md:inline">{t.label}</span>
              <span className="md:hidden">{t.short}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'tds-deposit' && <TdsDepositTab />}
      {tab === 'vds-issue' && <IssueCertificatesTab key="vds" type="VDS" />}
      {tab === 'tds-certs' && <IssueCertificatesTab key="tds" type="TDS" />}
      {tab === 'ait' && <CollectCertificatesTab key="ait" type="TDS" />}
      {tab === 'vds-receivable' && <CollectCertificatesTab key="vdsr" type="VDS" />}
      {tab === 'wht-return' && <WhtReturnTab initialQuarter={searchParams.get('quarter')} />}
    </div>
  )
}

export default function WithholdingTaxPage() {
  return (
    <Suspense fallback={<div className="py-24 text-center text-sm text-gray-400">Loading…</div>}>
      <WithholdingPage />
    </Suspense>
  )
}
