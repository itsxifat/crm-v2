'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, PackageX, ShieldAlert, ScanLine } from 'lucide-react'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

/**
 * Target of the QR code on asset labels: /admin/inventory/assets/tag/{tag}.
 * Inventory staff go to the asset page; the employee holding it goes to My Assets.
 */
export default function AssetTagResolverPage() {
  const { tag } = useParams()
  const router = useRouter()
  const [state, setState] = useState({ status: 'loading', message: null })
  const label = (() => {
    try { return decodeURIComponent(String(tag ?? '')).toUpperCase() } catch { return String(tag ?? '').toUpperCase() }
  })()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/inventory/assets/tag/${encodeURIComponent(label)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok && json.data?.id) {
          if (json.data.canView) { router.replace(`/admin/inventory/assets/${json.data.id}`); return }
          if (json.data.mine) { router.replace(`/admin/my-assets?asset=${json.data.id}`); return }
          setState({ status: 'forbidden', message: null })
          return
        }
        setState({ status: res.status === 403 ? 'forbidden' : res.status === 404 ? 'missing' : 'error', message: json.error || 'Could not open this asset' })
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'Network error — check your connection and scan again.' })
      }
    })()
    return () => { cancelled = true }
  }, [label, router])

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <p className="text-sm">Opening <span className="font-mono font-medium text-gray-900">{label}</span>…</p>
      </div>
    )
  }

  const Icon = state.status === 'forbidden' ? ShieldAlert : state.status === 'missing' ? PackageX : ScanLine
  const title = state.status === 'forbidden'
    ? 'Not assigned to you'
    : state.status === 'missing' ? 'Unknown asset tag' : "Couldn't open the asset"

  return (
    <div className="mx-auto max-w-md pt-6 sm:pt-10">
      <Card className="p-6 text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl border border-gray-200/80 bg-white shadow-xs">
          <Icon className="size-5 text-gray-500" />
        </div>
        <p className="mb-1 font-mono text-[13px] font-medium text-muted-foreground">{label}</p>
        <h1 className="text-base font-semibold text-gray-900">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.status === 'forbidden'
            ? 'Only its holder and the inventory team can open it. Found it? Hand it to the admin desk.'
            : state.message}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="outline" href="/admin/my-assets">My assets</Button>
          <Button href="/admin">Dashboard</Button>
        </div>
      </Card>
    </div>
  )
}
