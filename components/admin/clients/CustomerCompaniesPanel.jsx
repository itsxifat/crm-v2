'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Building2, Plus, Trash2, Loader2, Crown, ExternalLink } from 'lucide-react'
import ClientSearch from '@/components/ui/ClientSearch'

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
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
          <Plus className="w-4 h-4 text-gray-400" /> Add this customer to a company
        </p>
        <p className="text-xs text-gray-400 mb-3">
          Search for an existing company and link this customer so they can access its portal.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-start">
          <div className="flex-1">
            <ClientSearch
              key={pickerKey}
              value={picked?.id ?? ''}
              onChange={(_, client) => setPicked(client)}
              placeholder="Search company by name, code, email…"
            />
          </div>
          <button
            onClick={addCompany}
            disabled={adding || !picked}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors shrink-0"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Link
          </button>
        </div>
      </div>

      {/* Companies list */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : companies.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-400">This customer doesn’t belong to any company yet.</p>
      ) : (
        <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
          {companies.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0 overflow-hidden">
                <Building2 className="w-4 h-4 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.company || c.clientCode || 'Company'}</p>
                  {c.role === 'OWNER' && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                      <Crown className="w-3 h-3" /> Owner
                    </span>
                  )}
                  {c.isSelf && <span className="text-[11px] text-gray-400">(this account)</span>}
                </div>
                <p className="text-xs text-gray-400 truncate">
                  {c.clientCode}{c.clientType === 'COMPANY' ? ' · Company' : ' · Individual'}
                </p>
              </div>
              <Link
                href={`/admin/clients/${c.id}`}
                className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                title="Open company"
              >
                <ExternalLink className="w-4 h-4" />
              </Link>
              {!c.isSelf && (
                <button
                  onClick={() => removeCompany(c)}
                  disabled={removing === c.id}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                  title="Remove access"
                >
                  {removing === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
