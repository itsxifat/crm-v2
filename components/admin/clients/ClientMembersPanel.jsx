'use client'

import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'
import { UserPlus, Trash2, Loader2, Crown, Users } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { Input } from '@/components/ui/Input'

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

  return (
    <div className="space-y-5">
      {/* Add person */}
      <form onSubmit={addMember} className="rounded-lg bg-gray-50 p-4">
        <p
          className="mb-3 text-sm font-medium text-gray-900"
          title="Existing emails are linked without a new password; new emails get an account and login credentials."
        >
          Add a person
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input type="email" placeholder="Email *" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          <Input placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <Input placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          <Button type="submit" loading={adding}>
            {!adding && <UserPlus />}
            Add person
          </Button>
        </div>
      </form>

      {/* Members list */}
      {loading ? (
        <LoadingSpinner className="py-10" />
      ) : members.length === 0 ? (
        <EmptyState icon={Users} title="No people linked yet" className="py-8" />
      ) : (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200/80">
          {members.map(m => (
            <div key={m.userId} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50/70">
              <Avatar name={m.name} src={m.avatar} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-gray-900">{m.name}</p>
                  {m.role === 'OWNER' && (
                    <Badge variant="warning"><Crown className="size-3" /> Owner</Badge>
                  )}
                  {!m.isActive && <Badge>Inactive</Badge>}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="truncate">{m.email}</span>
                  {m.phone && <span className="tabular-nums">{m.phone}</span>}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeMember(m)}
                disabled={removing === m.userId}
                className="text-gray-400 hover:bg-red-50 hover:text-red-600"
                title="Remove access"
              >
                {removing === m.userId ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
