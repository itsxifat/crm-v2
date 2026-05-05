'use client'

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Eye, Pencil, Trash2, UserCheck, MoreHorizontal, Phone, Mail, MapPin, MessageSquare, ChevronDown, Check } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { formatCurrency, formatDate } from '@/lib/utils'

const PRIORITY_STYLES = {
  LOW:    'bg-gray-100 text-gray-500',
  NORMAL: 'bg-blue-50 text-blue-600',
  HIGH:   'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

const STATUS_OPTIONS = [
  { value: 'NEW',           label: 'New' },
  { value: 'CONTACTED',     label: 'Contacted' },
  { value: 'PROPOSAL_SENT', label: 'Proposal Sent' },
  { value: 'NEGOTIATION',   label: 'Negotiation' },
  { value: 'WON',           label: 'Won' },
  { value: 'LOST',          label: 'Lost' },
]

function PortalDropdown({ anchor, onClose, children, align = 'right' }) {
  if (!anchor) return null
  const style = {
    position: 'fixed',
    top:  anchor.bottom + 4,
    zIndex: 9999,
  }
  if (align === 'right') {
    style.right = window.innerWidth - anchor.right
  } else {
    style.left = anchor.left
  }
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div style={style}>
        {children}
      </div>
    </>,
    document.body
  )
}

function StatusPill({ lead, onStatusChange }) {
  const [anchor, setAnchor] = useState(null)
  const [updating, setUpdating] = useState(false)
  const btnRef = useRef(null)

  function toggle(e) {
    e.stopPropagation()
    if (anchor) { setAnchor(null); return }
    setAnchor(btnRef.current.getBoundingClientRect())
  }

  async function changeStatus(newStatus) {
    setAnchor(null)
    if (newStatus === lead.status) return
    setUpdating(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed')
      onStatusChange?.(lead.id, newStatus)
      toast.success('Status updated')
    } catch {
      toast.error('Failed to update status')
    } finally {
      setUpdating(false)
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        disabled={updating}
        className="flex items-center gap-1 group disabled:opacity-60"
      >
        <Badge status={lead.status} />
        <ChevronDown className="w-3 h-3 text-gray-400 group-hover:text-gray-600 transition-colors" />
      </button>
      {anchor && (
        <PortalDropdown anchor={anchor} onClose={() => setAnchor(null)} align="left">
          <div className="w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 overflow-hidden">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s.value}
                onClick={(e) => { e.stopPropagation(); changeStatus(s.value) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors"
              >
                <Badge status={s.value} />
                {s.value === lead.status && (
                  <Check className="w-3 h-3 text-blue-600 ml-auto shrink-0" />
                )}
              </button>
            ))}
          </div>
        </PortalDropdown>
      )}
    </>
  )
}

function ActionMenu({ lead, onEdit, onDelete, onConvert }) {
  const [anchor, setAnchor] = useState(null)
  const btnRef = useRef(null)

  function toggle(e) {
    e.stopPropagation()
    if (anchor) { setAnchor(null); return }
    setAnchor(btnRef.current.getBoundingClientRect())
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {anchor && (
        <PortalDropdown anchor={anchor} onClose={() => setAnchor(null)} align="right">
          <div className="w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 overflow-hidden">
            <Link
              href={`/admin/leads/${lead.id}`}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              onClick={() => setAnchor(null)}
            >
              <Eye className="w-3.5 h-3.5 text-gray-400" />
              View Details
            </Link>
            <button
              onClick={() => { setAnchor(null); onEdit(lead) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-gray-400" />
              Edit Lead
            </button>
            {lead.status === 'WON' && !lead.convertedAt && (
              <button
                onClick={() => { setAnchor(null); onConvert(lead) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-green-700 hover:bg-green-50 transition-colors"
              >
                <UserCheck className="w-3.5 h-3.5 text-green-500" />
                Convert to Client
              </button>
            )}
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => { setAnchor(null); onDelete(lead) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </PortalDropdown>
      )}
    </>
  )
}

export default function LeadsTable({ leads = [], onEdit, onRefresh, onStatusChange }) {
  const router = useRouter()

  const handleDelete = async (lead) => {
    if (!confirm(`Delete lead "${lead.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete lead')
      toast.success('Lead deleted')
      onRefresh?.()
    } catch {
      toast.error('Failed to delete lead')
    }
  }

  const handleConvert = async (lead) => {
    if (!confirm(`Convert "${lead.name}" to a client? This will create a new user account.`)) return
    try {
      const res  = await fetch(`/api/leads/${lead.id}/convert`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Conversion failed')
      toast.success(`Lead converted! Temp password: ${data.data?.tempPassword ?? '—'}`)
      onRefresh?.()
      router.push(`/clients/${data.data?.clientId}`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (!leads.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <p className="text-gray-500 font-medium">No leads found</p>
        <p className="text-sm text-gray-400 mt-1">Try adjusting your filters or add a new lead</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/60">
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
              Name / Company
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap hidden sm:table-cell">
              Contact
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap hidden lg:table-cell">
              Source / Platform
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap hidden md:table-cell">
              Value
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap hidden xl:table-cell">
              Assigned To
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap hidden lg:table-cell">
              Follow-up
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap hidden xl:table-cell">
              Notes
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {leads.map((lead) => (
            <tr
              key={lead.id}
              className="group hover:bg-blue-50/30 transition-colors cursor-pointer"
              onClick={() => router.push(`/admin/leads/${lead.id}`)}
            >
              {/* Name / Company */}
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={lead.name} size="sm" />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate max-w-[160px] sm:max-w-[200px]">{lead.name}</p>
                    {lead.designation && (
                      <p className="text-xs text-gray-500 truncate max-w-[160px]">{lead.designation}</p>
                    )}
                    {lead.company && (
                      <p className="text-xs text-gray-400 truncate max-w-[160px]">{lead.company}</p>
                    )}
                    {lead.location && (
                      <p className="hidden sm:flex items-center gap-1 text-xs text-gray-400 truncate max-w-[160px]">
                        <MapPin className="w-2.5 h-2.5 shrink-0" />{lead.location}
                      </p>
                    )}
                    {lead.convertedAt && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                        <UserCheck className="w-3 h-3" /> Converted
                      </span>
                    )}
                    {/* Mobile-only: show value + priority inline */}
                    <div className="flex items-center gap-1.5 mt-1 md:hidden">
                      {lead.value && (
                        <span className="text-xs font-semibold text-gray-700">{formatCurrency(lead.value)}</span>
                      )}
                      {lead.priority && lead.priority !== 'NORMAL' && (
                        <span className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium ${PRIORITY_STYLES[lead.priority] ?? ''}`}>
                          {lead.priority}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </td>

              {/* Contact */}
              <td className="px-4 py-3 hidden sm:table-cell">
                <div className="space-y-0.5">
                  {lead.email && (
                    <a
                      href={`mailto:${lead.email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
                    >
                      <Mail className="w-3 h-3 shrink-0" />
                      <span className="truncate max-w-[140px]">{lead.email}</span>
                    </a>
                  )}
                  {lead.phone && (
                    <a
                      href={`tel:${lead.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
                    >
                      <Phone className="w-3 h-3 shrink-0" />
                      {lead.phone}
                    </a>
                  )}
                </div>
              </td>

              {/* Source / Platform */}
              <td className="px-4 py-3 hidden lg:table-cell">
                <div className="space-y-0.5">
                  {lead.source && <p className="text-xs text-gray-600">{lead.source}</p>}
                  {lead.platform && <p className="text-xs text-gray-400">{lead.platform}</p>}
                  {lead.businessCategory && (
                    <p className="text-xs text-indigo-500">{lead.businessCategory}</p>
                  )}
                  {!lead.source && !lead.platform && !lead.businessCategory && (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
              </td>

              {/* Status + Priority */}
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <div className="space-y-1">
                  <StatusPill lead={lead} onStatusChange={onStatusChange} />
                  {lead.priority && lead.priority !== 'NORMAL' && (
                    <span className={`hidden md:inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${PRIORITY_STYLES[lead.priority] ?? ''}`}>
                      {lead.priority}
                    </span>
                  )}
                </div>
              </td>

              {/* Value */}
              <td className="px-4 py-3 hidden md:table-cell">
                <span className="text-sm font-semibold text-gray-800">
                  {lead.value ? formatCurrency(lead.value) : '—'}
                </span>
              </td>

              {/* Assigned To */}
              <td className="px-4 py-3 hidden xl:table-cell">
                {lead.assignedToId ? (
                  <div className="flex items-center gap-2">
                    <Avatar name={lead.assignedToId.userId?.name ?? ''} size="xs" src={lead.assignedToId.userId?.avatar} />
                    <span className="text-xs text-gray-600 truncate max-w-[100px]">
                      {lead.assignedToId.userId?.name ?? '—'}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">Unassigned</span>
                )}
              </td>

              {/* Follow-up */}
              <td className="px-4 py-3 whitespace-nowrap hidden lg:table-cell">
                {lead.followUpDate ? (
                  <span className={`text-xs font-medium ${new Date(lead.followUpDate) < new Date() ? 'text-red-500' : 'text-gray-500'}`}>
                    {formatDate(lead.followUpDate)}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </td>

              {/* Notes / Comments */}
              <td className="px-4 py-3 hidden xl:table-cell">
                <div className="flex items-center gap-2">
                  {lead.comments?.length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <MessageSquare className="w-3 h-3" />{lead.comments.length}
                    </span>
                  )}
                  {lead.links?.length > 0 && (
                    <span className="text-xs text-blue-400">{lead.links.length} link{lead.links.length > 1 ? 's' : ''}</span>
                  )}
                  {!lead.comments?.length && !lead.links?.length && (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
              </td>

              {/* Actions */}
              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                <ActionMenu
                  lead={lead}
                  onEdit={onEdit}
                  onDelete={handleDelete}
                  onConvert={handleConvert}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
