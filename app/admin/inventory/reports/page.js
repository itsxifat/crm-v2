'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { REPORT_GROUPS, REPORTS } from './_components/catalog'
import ReportView from './_components/ReportView'
import { fetchJson } from './_components/format'

function ReportCatalog({ onPick }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Inventory reports</h1>
        <p className="text-sm text-gray-500">Registers, depreciation schedules for the accounts and the tax return, damage records and stock reports. Every report exports to CSV and prints.</p>
      </div>
      {REPORT_GROUPS.map(g => (
        <section key={g.title}>
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{g.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {g.items.map(r => (
              <button key={r.type} onClick={() => onPick(r.type)}
                className="group text-left bg-white border border-gray-100 rounded-xl p-4 hover:border-gray-200 hover:shadow-sm transition-all flex gap-3">
                <div className="w-10 h-10 rounded-lg bg-gray-100 group-hover:bg-gray-900 flex items-center justify-center shrink-0 transition-colors">
                  <r.icon className="w-5 h-5 text-gray-600 group-hover:text-white transition-colors" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 flex items-center gap-1">
                    {r.title}
                    <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" />
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{r.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ReportsInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const type = searchParams.get('type')
  const validType = type && REPORTS[type] ? type : null
  const [categories, setCategories] = useState([])
  const [locations, setLocations] = useState([])

  const params = useMemo(() => {
    const p = {}
    for (const [k, v] of searchParams.entries()) if (k !== 'type' && v) p[k] = v
    return p
  }, [searchParams])

  useEffect(() => {
    let alive = true
    Promise.all([
      fetchJson('/api/inventory/categories').catch(() => ({ data: [] })),
      fetchJson('/api/inventory/locations').catch(() => ({ data: [] })),
    ]).then(([c, l]) => {
      if (!alive) return
      setCategories(c.data || [])
      setLocations(l.data || [])
    })
    return () => { alive = false }
  }, [])

  const go = useCallback((nextType, nextParams = {}) => {
    const q = new URLSearchParams()
    if (nextType) q.set('type', nextType)
    for (const [k, v] of Object.entries(nextParams)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v))
    const qs = q.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname])

  if (!validType) return <ReportCatalog onPick={t => router.push(`${pathname}?type=${t}`)} />

  return (
    <ReportView
      key={validType}
      type={validType}
      params={params}
      onParamsChange={p => go(validType, p)}
      categories={categories}
      locations={locations}
    />
  )
}

export default function InventoryReportsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ReportsInner />
    </Suspense>
  )
}
