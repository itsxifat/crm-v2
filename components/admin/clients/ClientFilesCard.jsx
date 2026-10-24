'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FolderOpen, ExternalLink, Lock, RefreshCw } from 'lucide-react'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/Card'
import { usePermission } from '@/components/auth/Can'
import { formatMoney } from '@/lib/currencies'

/** Client overview card: their folder in encloud and what is locked there. Hidden while encloud is not connected. */
export default function ClientFilesCard({ clientId }) {
  const { can } = usePermission()
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/clients/${clientId}/drive`).then(r => r.ok ? r.json() : null).then(j => setD(j?.data ?? null)).catch(() => setD(null))
  }, [clientId])
  useEffect(() => { load() }, [load])

  async function sync() {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/drive`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Could not reach encloud')
      setD(j.data)
      toast.success('Folder ready in encloud')
    } catch (err) { toast.error(err.message) }
    finally { setBusy(false) }
  }

  if (!d?.enabled) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Files in encloud</CardTitle>
        {d.folder?.url && (
          <CardAction>
            <a href={d.folder.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-gray-700 underline-offset-4 hover:text-gray-900 hover:underline">
              Open folder <ExternalLink className="size-3.5" />
            </a>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-[13px] text-gray-600">
        {d.folder ? (
          <>
            <p className="flex items-center gap-2"><FolderOpen className="size-4 text-gray-400" />
              {d.projects.length} project folder{d.projects.length === 1 ? '' : 's'}
            </p>
            {d.openDue > 0 ? (
              <p className="flex items-center gap-2 text-amber-700"><Lock className="size-4" /> {formatMoney(d.openDue, 'BDT')} unpaid — the client pays before their files open</p>
            ) : (
              <p className="text-muted-foreground">Nothing is due: their shared links open.</p>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className={d.error ? 'text-red-600' : 'text-muted-foreground'}>{d.error ?? 'No folder in encloud yet.'}</p>
            {can('sales.customers.update') && (
              <Button variant="outline" size="sm" onClick={sync} loading={busy}>{!busy && <RefreshCw />} {d.error ? 'Retry' : 'Create folder'}</Button>
            )}
          </div>
        )}
        {d.liveError && <p className="text-red-600">{d.liveError}</p>}
      </CardContent>
    </Card>
  )
}
