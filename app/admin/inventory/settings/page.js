'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import CategoriesTab from './_components/CategoriesTab'
import LocationsTab from './_components/LocationsTab'
import PolicyTab from './_components/PolicyTab'
import OpeningImportTab from './_components/OpeningImportTab'

const TABS = [
  { key: 'categories', label: 'Categories' },
  { key: 'locations', label: 'Locations' },
  { key: 'policy', label: 'Policy' },
  { key: 'opening', label: 'Opening import' },
]

function SettingsInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requested = searchParams.get('tab')
  const tab = TABS.some(t => t.key === requested) ? requested : 'categories'

  const pick = (key) => router.replace(`${pathname}?tab=${key}`, { scroll: false })

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory settings" />

      <Tabs
        variant="underline"
        value={tab}
        onChange={pick}
        tabs={TABS.map(t => ({ value: t.key, label: t.label }))}
      />

      {tab === 'categories' && <CategoriesTab />}
      {tab === 'locations' && <LocationsTab />}
      {tab === 'policy' && <PolicyTab />}
      {tab === 'opening' && <OpeningImportTab />}
    </div>
  )
}

export default function InventorySettingsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <SettingsInner />
    </Suspense>
  )
}
