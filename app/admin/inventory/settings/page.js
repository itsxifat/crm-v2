'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Tags, MapPin, SlidersHorizontal, FolderInput } from 'lucide-react'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'
import CategoriesTab from './_components/CategoriesTab'
import LocationsTab from './_components/LocationsTab'
import PolicyTab from './_components/PolicyTab'
import OpeningImportTab from './_components/OpeningImportTab'

const TABS = [
  { key: 'categories', label: 'Categories', icon: Tags, description: 'Asset and consumable categories, tax classes and depreciation rules' },
  { key: 'locations', label: 'Locations', icon: MapPin, description: 'Offices, floors, rooms and stores' },
  { key: 'policy', label: 'Policy', icon: SlidersHorizontal, description: 'Capitalisation threshold, depreciation convention, tag prefix' },
  { key: 'opening', label: 'Opening import', icon: FolderInput, description: 'Bring in the assets and stock you owned at go-live' },
]

function SettingsInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requested = searchParams.get('tab')
  const tab = TABS.some(t => t.key === requested) ? requested : 'categories'
  const active = TABS.find(t => t.key === tab)

  const pick = (key) => router.replace(`${pathname}?tab=${key}`, { scroll: false })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Inventory settings</h1>
        <p className="text-sm text-gray-500">{active.description}</p>
      </div>

      <div className="border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-1 min-w-max" aria-label="Inventory settings">
          {TABS.map(t => (
            <button key={t.key} onClick={() => pick(t.key)}
              className={cn('inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap',
                tab === t.key ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700')}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </nav>
      </div>

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
