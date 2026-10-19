'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, PackageX, ShieldAlert, ScanLine } from 'lucide-react'
import { btnPrimary, btnSecondary, cardCls } from '../../_components/shared'

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
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-gray-500">
        <Loader2 className="w-7 h-7 animate-spin" />
        <p className="text-sm">Opening <span className="font-mono font-semibold text-gray-900">{label}</span>…</p>
      </div>
    )
  }

  const Icon = state.status === 'forbidden' ? ShieldAlert : state.status === 'missing' ? PackageX : ScanLine
  const title = state.status === 'forbidden'
    ? 'This equipment is not assigned to you'
    : state.status === 'missing' ? 'Unknown asset tag' : 'Could not open the asset'

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <div className={`${cardCls} p-6 text-center`}>
        <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <Icon className="w-7 h-7 text-gray-500" />
        </div>
        <p className="font-mono text-sm font-semibold text-gray-900 mb-1">{label}</p>
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {state.status === 'forbidden'
            ? 'Only the person holding it and the inventory team can open it. If you found it, please hand it to the admin desk.'
            : state.message}
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-5">
          <Link href="/admin/my-assets" className={btnSecondary}>My assets</Link>
          <Link href="/admin" className={btnPrimary}>Dashboard</Link>
        </div>
      </div>
    </div>
  )
}
