'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import PageHeader from '@/components/ui/PageHeader'
import { REPORT_GROUPS, REPORTS } from './_components/catalog'
import ReportView from './_components/ReportView'
import { fetchJson } from './_components/format'

function ReportCatalog({ onPick }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Inventory reports" />
      {REPORT_GROUPS.map(g => (
        <section key={g.title}>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">{g.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {g.items.map(r => (
              <button key={r.type} type="button" onClick={() => onPick(r.type)}
                className="group flex gap-3 rounded-xl border border-gray-200/80 bg-white p-4 text-left shadow-xs transition-colors hover:border-gray-300 hover:bg-gray-50/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
                  <r.icon className="size-4 text-gray-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-sm font-medium text-gray-900">
                    {r.title}
                    <ChevronRight className="size-3.5 text-gray-300 transition-colors group-hover:text-gray-500" />
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{r.description}</p>
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
