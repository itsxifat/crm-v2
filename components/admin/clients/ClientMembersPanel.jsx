'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { UserPlus, Trash2, Loader2, Crown, Mail, Phone } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'

/**
 * People who can access this company (CompanyMembership rows).
 * Add by email — an existing email is linked (no new credentials), a new email
 * gets an account + welcome credentials.
 */
export default function ClientMembersPanel({ clientId }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm]       = useState({ email: '', name: '', phone: '' })
  const [adding, setAdding]   = useState(false)
  const [removing, setRemoving] = useState(null)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/clients/${clientId}/members`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMembers(json.members ?? [])
    } catch (err) {
      toast.error(err.message ?? 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  async function addMember(e) {
    e.preventDefault()
    if (!form.email.trim()) { toast.error('Email is required'); return }
    setAdding(true)
    try {
      const res  = await fetch(`/api/clients/${clientId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to add person')
      toast.success(json.isNew
        ? `Account created — credentials ${json.emailSent ? 'emailed' : 'generated'}`
        : 'Existing person linked to this company')
      setForm({ email: '', name: '', phone: '' })
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setAdding(false)
    }
  }

  async function removeMember(m) {
    if (!confirm(`Remove ${m.name || m.email}'s access to this company?`)) return
    setRemoving(m.userId)
    try {
      const res = await fetch(`/api/clients/${clientId}/members/${m.userId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to remove')
      toast.success('Access removed')
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRemoving(null)
    }
  }

  const ic = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

  return (
    <div className="space-y-5">
      {/* Add person */}
      <form onSubmit={addMember} className="bg-gray-50 border border-gray-100 rounded-xl p-4">
        <p className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-1.5">
          <UserPlus className="w-4 h-4 text-gray-400" /> Add a person to this company
        </p>
        <p className="text-xs text-gray-400 mb-3">
          Enter an email. If the person already exists they’re simply linked (no new password); otherwise an account is created and login credentials are sent.
        </p>
        <div className="grid sm:grid-cols-3 gap-2">
          <input className={ic} type="email" placeholder="Email *" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          <input className={ic} placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className={ic} placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
        </div>
        <div className="flex justify-end mt-3">
          <button type="submit" disabled={adding} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Add person
          </button>
        </div>
      </form>

      {/* Members list */}
      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : members.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-400">No people linked to this company yet.</p>
      ) : (
        <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
          {members.map(m => (
            <div key={m.userId} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
              <Avatar name={m.name} src={m.avatar} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">{m.name}</p>
                  {m.role === 'OWNER' && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                      <Crown className="w-3 h-3" /> Owner
                    </span>
                  )}
                  {!m.isActive && <span className="text-[11px] text-gray-400">(inactive)</span>}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                  <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3" /> {m.email}</span>
                  {m.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {m.phone}</span>}
                </div>
              </div>
              <button
                onClick={() => removeMember(m)}
                disabled={removing === m.userId}
                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                title="Remove access"
              >
                {removing === m.userId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
