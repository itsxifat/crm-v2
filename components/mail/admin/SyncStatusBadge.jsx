'use client'

import { Loader2 } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Tip from './Tip'

/**
 * Resolve the display state of an account's sync.
 * Live (IDLE open) wins over a background SYNCING blip so the badge doesn't flicker on every new mail.
 */
export function syncState(account, { syncing = false } = {}) {
  const s = account?.sync ?? {}
  if (!account?.isActive) return 'inactive'
  if (!account.syncEnabled || s.status === 'PAUSED') return 'paused'
  if (syncing) return 'syncing'
  if (s.status === 'ERROR') return 'error'
  if (s.idle) return 'live'
  if (s.status === 'SYNCING') return 'syncing'
  if (s.status === 'PENDING' || !s.lastSyncAt) return 'pending'
  return 'ok'
}

function PulseDot() {
  return (
    <span className="relative flex size-1.5">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
    </span>
  )
}

export default function SyncStatusBadge({ account, syncing = false }) {
  const state = syncState(account, { syncing })

  switch (state) {
    case 'live':
      return <Badge variant="success"><PulseDot />Live</Badge>
    case 'syncing':
      return <Badge variant="primary"><Loader2 className="size-3 animate-spin" />Syncing</Badge>
    case 'error':
      return (
        <Tip content={account.sync?.lastError || 'Sync failed'} focusable>
          <Badge variant="danger" dot className="cursor-default">Error</Badge>
        </Tip>
      )
    case 'paused':
      return <Badge variant="warning" dot>Paused</Badge>
    case 'inactive':
      return <Badge variant="outline">Inactive</Badge>
    case 'pending':
      return <Badge variant="default" dot>Pending</Badge>
    default:
      return <Badge variant="success" dot>Synced</Badge>
  }
}
