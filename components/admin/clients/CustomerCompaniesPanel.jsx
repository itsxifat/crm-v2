'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Building2, Plus, Trash2, Loader2, Crown, ExternalLink } from 'lucide-react'
import ClientSearch from '@/components/ui/ClientSearch'
import Button, { buttonVariants } from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'

/**
 * Companies this customer (the Client record's owner person) can access. Lets an
 * admin assign the customer to an existing company or revoke that access — the
 * customer-side counterpart to ClientMembersPanel. Removal reuses the shared
 * /members/[userId] endpoint.
 */
export default function CustomerCompaniesPanel({ clientId }) {
  const [companies, setCompanies]     = useState([])
  const [ownerUserId, setOwnerUserId] = useState(null)
  const [loading, setLoading]         = useState(true)
  const [picked, setPicked]           = useState(null)   // selected company (client object)
  const [pickerKey, setPickerKey]     = useState(0)       // bump to reset ClientSearch
  const [adding, setAdding]           = useState(false)
  const [removing, setRemoving]       = useState(null)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/clients/${clientId}/companies`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setCompanies(json.companies ?? [])
      setOwnerUserId(json.ownerUserId ?? null)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load companies')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  async function addCompany() {
    if (!picked?.id) { toast.error('Pick a company first'); return }
    setAdding(true)
    try {
      const res  = await fetch(`/api/clients/${clientId}/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: picked.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to link company')
      toast.success('Customer linked to the company')
      setPicked(null)
      setPickerKey(k => k + 1)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function removeCompany(c) {
    if (!confirm(`Remove this customer's access to ${c.company || c.clientCode || 'this company'}?`)) return
    setRemoving(c.id)
    try {
      const res = await fetch(`/api/clients/${c.id}/members/${ownerUserId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to remove')
      toast.success('Access removed')
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Add to a company */}
      <div className="rounded-lg bg-gray-50 p-4">
        <p
          className="mb-3 text-sm font-medium text-gray-900"
          title="Link this customer to an existing company so they can access its portal."
        >
          Add to a company
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="flex-1">
            <ClientSearch
              key={pickerKey}
              value={picked?.id ?? ''}
              onChange={(_, client) => setPicked(client)}
              placeholder="Search companies…"
            />
          </div>
          <Button onClick={addCompany} loading={adding} disabled={!picked} className="shrink-0">
            {!adding && <Plus />}
            Link
          </Button>
        </div>
      </div>

      {/* Companies list */}
      {loading ? (
        <LoadingSpinner className="py-10" />
      ) : companies.length === 0 ? (
        <EmptyState icon={Building2} title="No companies yet" className="py-8" />
      ) : (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200/80">
          {companies.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/70">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
                <Building2 className="size-4 text-gray-600" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-gray-900">{c.company || c.clientCode || 'Company'}</p>
                  {c.role === 'OWNER' && (
                    <Badge variant="warning"><Crown className="size-3" /> Owner</Badge>
                  )}
                  {c.isSelf && <span className="text-xs text-muted-foreground">(this account)</span>}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {c.clientCode}{c.clientType === 'COMPANY' ? ' · Company' : ' · Individual'}
                </p>
              </div>
              <Link
                href={`/admin/clients/${c.id}`}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'text-gray-400')}
                title="Open company"
              >
                <ExternalLink />
              </Link>
              {!c.isSelf && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeCompany(c)}
                  disabled={removing === c.id}
                  className="text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Remove access"
                >
                  {removing === c.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
