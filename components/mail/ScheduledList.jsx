'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, CircleAlert, Clock, PanelLeft, RefreshCw, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { ListSkeleton } from './MessageList'
import { mailApi } from './mailApi'
import { formatFullDate, formatSendAt, shortName } from './mailUtils'
import { IconButton, Tip } from './ui'

function recipients(to = []) {
  if (!to.length) return '(no recipients)'
  const names = to.slice(0, 3).map(shortName).join(', ')
  return to.length > 3 ? `${names} +${to.length - 3}` : names
}

export default function ScheduledList({
  accountId, accountsById, showAccount, refreshKey, onCancelled, onChanged, onRailButton, railButtonLabel, className,
}) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState({})
  const seq = useRef(0)

  const load = useCallback(async ({ silent } = {}) => {
    const id = ++seq.current
    if (!silent) setRefreshing(true)
    try {
      const data = await mailApi.outbox(accountId)
      if (id !== seq.current) return
      setItems(data)
      setError(null)
    } catch (err) {
      if (id === seq.current) setError(err.message)
    } finally {
      if (id === seq.current) setRefreshing(false)
    }
  }, [accountId])

  useEffect(() => { setItems(null); load() }, [load])
  useEffect(() => { if (refreshKey) load({ silent: true }) }, [refreshKey, load])

  async function cancel(item) {
    setBusy(b => ({ ...b, [item.id]: 'cancel' }))
    try {
      const data = await mailApi.cancelOutbox(item.id)
      setItems(list => (list || []).filter(i => i.id !== item.id))
      onChanged?.()
      onCancelled?.(data?.payload, item)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(b => ({ ...b, [item.id]: null }))
    }
  }

  async function sendNow(item) {
    setBusy(b => ({ ...b, [item.id]: 'send' }))
    try {
      const data = await mailApi.sendNow(item.id)
      toast.success(data?.status === 'SENT' ? 'Sent' : 'Sending…')
      setItems(list => (list || []).filter(i => i.id !== item.id))
      onChanged?.()
      setTimeout(() => load({ silent: true }), 3000)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(b => ({ ...b, [item.id]: null }))
    }
  }

  const list = items || []

  return (
    <section className={cn('flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white', className)} aria-label="Scheduled">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-gray-200/80 pl-3 pr-2">
        {onRailButton && (
          <IconButton label={railButtonLabel || 'Folders'} onClick={onRailButton} className="-ml-1.5"><PanelLeft /></IconButton>
        )}
        <h2 className="text-sm font-semibold text-gray-900">Scheduled</h2>
        {list.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>}
        <IconButton label="Refresh" onClick={() => load()} disabled={refreshing} className="ml-auto">
          <RefreshCw className={cn(refreshing && 'animate-spin')} />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items === null && !error ? (
          <ListSkeleton rows={6} />
        ) : error && !items ? (
          <EmptyState icon={CircleAlert} title="Couldn't load scheduled mail" description={error}
            action={<Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>} />
        ) : !list.length ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={Clock} title="No scheduled messages" />
          </div>
        ) : (
          <ul>
            {list.map(item => {
              const account = accountsById[item.accountId]
              const failed = item.status === 'FAILED'
              return (
                <li key={item.id} className="group relative flex flex-col gap-2 border-b border-gray-100 py-3 pl-4 pr-3 transition-colors hover:bg-gray-50/80 sm:flex-row sm:items-center sm:gap-4">
                  {showAccount && account && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: account.color }} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-gray-900">
                        <span className="font-normal text-gray-500">To: </span>{recipients(item.to)}
                      </span>
                      {item.status === 'SENDING' && <Badge variant="primary">Sending</Badge>}
                      {failed && (
                        <Tip label={item.lastError || 'Failed'}>
                          <span><Badge variant="danger">Failed</Badge></span>
                        </Tip>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[13px] text-gray-600">
                      <span className="text-gray-800">{item.subject || '(no subject)'}</span>
                      {item.snippet && <span className="text-gray-500"> — {item.snippet}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span title={formatFullDate(item.sendAt)} className="flex items-center gap-1.5 text-xs tabular-nums text-gray-600">
                      <CalendarClock className="size-3.5 text-gray-400" />
                      {formatSendAt(item.sendAt)}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button size="xs" variant="ghost" onClick={() => sendNow(item)} loading={busy[item.id] === 'send'} disabled={!!busy[item.id] || item.status === 'SENDING'}>
                        {busy[item.id] !== 'send' && <Send />}
                        Send now
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => cancel(item)} loading={busy[item.id] === 'cancel'} disabled={!!busy[item.id] || item.status === 'SENDING'}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
