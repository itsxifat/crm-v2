'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Landmark, FileOutput, FileCheck, BadgePercent, FileClock, ClipboardList } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import { PageLoader } from '@/components/ui/LoadingSpinner'
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
    <div className="space-y-6">
      <PageHeader title="Withholding tax" back="/admin/tax" backLabel="Tax dashboard" />

      <Tabs
        variant="underline"
        value={tab}
        onChange={setTab}
        tabs={TABS.map(t => ({
          value: t.key,
          icon: t.icon,
          label: (
            <>
              <span className="hidden md:inline">{t.label}</span>
              <span className="md:hidden">{t.short}</span>
            </>
          ),
        }))}
      />

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
    <Suspense fallback={<PageLoader />}>
      <WithholdingPage />
    </Suspense>
  )
}
