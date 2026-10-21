'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Mail, RefreshCw, Search } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import SearchInput from '@/components/ui/SearchInput'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { MAIL_PROVIDERS } from '@/lib/mail/constants'
import AccountsTable from '@/components/mail/admin/AccountsTable'
import AccountFormModal from '@/components/mail/admin/AccountFormModal'
import ConfirmDialog from '@/components/mail/admin/ConfirmDialog'
import { mailApi } from '@/components/mail/admin/api'

const POLL_MS = 15_000
const SEARCH_MIN = 6 // show the search box once the list gets long

export default function MailAccountsPage() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ open: false, account: null })
  const [toDelete, setToDelete] = useState({ open: false, account: null })
  const [syncingIds, setSyncingIds] = useState(() => new Set())
  const seq = useRef(0)
  const pending = useRef(0) // in-flight optimistic mutations; background polls must not overwrite them

  const load = useCallback(async ({ silent = false } = {}) => {
    const id = ++seq.current
    if (!silent) setLoading(true)
    try {
      const json = await mailApi('/api/mail/accounts?manage=1')
      const list = Array.isArray(json.data) ? json.data : []
      if (id === seq.current && !(silent && pending.current > 0)) {
        setAccounts(list)
        setError(null)
      }
      return list
    } catch (err) {
      if (id === seq.current && !silent) setError(err.message)
      return null
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Keep sync badges fresh while the page is visible.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load({ silent: true }) }
    const timer = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load])

  const replaceAccount = (item) => {
    if (!item?.id) return
    setAccounts(list => (list.some(a => a.id === item.id) ? list.map(a => (a.id === item.id ? item : a)) : [...list, item]))
  }

  const onSaved = (item) => {
    replaceAccount(item)
    load({ silent: true })
  }

  const patchAccount = async (account, patch, successMessage) => {
    pending.current++
    setAccounts(list => list.map(a => (a.id === account.id ? { ...a, ...patch } : a)))
    try {
      const json = await mailApi(`/api/mail/accounts/${account.id}`, { method: 'PATCH', body: patch })
      replaceAccount(json.data)
      toast.success(successMessage)
    } catch (err) {
      setAccounts(list => list.map(a => (a.id === account.id ? account : a)))
      toast.error(err.message)
    } finally {
      pending.current--
    }
  }

  const toggleSync = (a) => patchAccount(a, { syncEnabled: !a.syncEnabled }, a.syncEnabled ? 'Sync paused' : 'Sync resumed')
  const toggleActive = (a) => patchAccount(a, { isActive: !a.isActive }, a.isActive ? `${a.name} deactivated` : `${a.name} activated`)

  const syncNow = async (account) => {
    setSyncingIds(s => new Set(s).add(account.id))
    try {
      const json = await mailApi(`/api/mail/accounts/${account.id}/sync`, { method: 'POST' })
      const result = json.data ?? {}
      const list = await load({ silent: true })
      const fresh = list?.find(a => a.id === account.id)
      // The sync endpoint records failures on the account rather than throwing.
      if (fresh?.sync?.status === 'ERROR') toast.error(fresh.sync.lastError || 'Sync failed')
      else if (result.queued) toast.success('Sync started')
      else if (result.newMessages) toast.success(`${result.newMessages.toLocaleString()} new message${result.newMessages === 1 ? '' : 's'}`)
      else toast.success('Up to date')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSyncingIds(s => {
        const next = new Set(s)
        next.delete(account.id)
        return next
      })
    }
  }

  const remove = async () => {
    const { account } = toDelete
    if (!account) return
    try {
      await mailApi(`/api/mail/accounts/${account.id}`, { method: 'DELETE' })
      setAccounts(list => list.filter(a => a.id !== account.id))
      setToDelete(d => ({ ...d, open: false }))
      toast.success(`${account.name} deleted`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return accounts
    return accounts.filter(a =>
      [a.name, a.email, a.fromName, MAIL_PROVIDERS[a.provider]?.label, ...(a.assignedUsers ?? []).map(u => u.name)]
        .some(v => v && String(v).toLowerCase().includes(q))
    )
  }, [accounts, search])

  const openCreate = () => setForm({ open: true, account: null })
  const isEmpty = !loading && !error && accounts.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mail accounts"
        meta={accounts.length > 0 ? <Badge variant="default">{accounts.length}</Badge> : null}
        actions={<Button onClick={openCreate}><Plus /> Add account</Button>}
      />

      {error && (
        <Card className="p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
          <Button variant="outline" size="sm" onClick={() => load()} className="mt-3"><RefreshCw /> Try again</Button>
        </Card>
      )}

      {!error && loading && accounts.length === 0 && (
        <Card><LoadingSpinner className="py-16" /></Card>
      )}

      {isEmpty && (
        <Card>
          <EmptyState
            icon={Mail}
            title="No mail accounts"
            action={<Button onClick={openCreate}><Plus /> Add account</Button>}
          />
        </Card>
      )}

      {!error && accounts.length > 0 && (
        <div className="space-y-3">
          {accounts.length >= SEARCH_MIN && (
            <SearchInput value={search} onChange={setSearch} debounceMs={0} placeholder="Search accounts" className="w-full sm:w-72" />
          )}
          {filtered.length > 0 ? (
            <AccountsTable
              accounts={filtered}
              syncingIds={syncingIds}
              onEdit={(a) => setForm({ open: true, account: a })}
              onSync={syncNow}
              onToggleSync={toggleSync}
              onToggleActive={toggleActive}
              onDelete={(a) => setToDelete({ open: true, account: a })}
            />
          ) : (
            <Card>
              <EmptyState
                icon={Search}
                title="No results"
                action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Clear search</Button>}
              />
            </Card>
          )}
        </div>
      )}

      <AccountFormModal
        open={form.open}
        onOpenChange={(v) => setForm(f => ({ ...f, open: v }))}
        account={form.account}
        onSaved={onSaved}
      />

      <ConfirmDialog
        open={toDelete.open}
        onOpenChange={(v) => setToDelete(d => ({ ...d, open: v }))}
        title={`Delete ${toDelete.account?.name ?? 'account'}?`}
        description="Synced mail and scheduled sends are removed from the CRM. The mailbox on the server isn't touched."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
      />
    </div>
  )
}
