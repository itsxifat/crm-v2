'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Eye, Pencil, Trash2, UserCheck, MoreHorizontal, Phone, Mail, MapPin, MessageSquare } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { formatCurrency, formatDate, truncateText } from '@/lib/utils'

const PRIORITY_STYLES = {
  LOW:    'bg-gray-100 text-gray-500',
  NORMAL: 'bg-blue-50 text-blue-600',
  HIGH:   'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

function ActionMenu({ lead, onEdit, onDelete, onConvert }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 overflow-hidden">
            <Link
              href={`/leads/${lead.id}`}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              onClick={() => setOpen(false)}
            >
              <Eye className="w-3.5 h-3.5 text-gray-400" />
              View Details
            </Link>
            <button
              onClick={() => { setOpen(false); onEdit(lead) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5 text-gray-400" />
              Edit Lead
            </button>
            {lead.status === 'WON' && !lead.convertedAt && (
              <button
                onClick={() => { setOpen(false); onConvert(lead) }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-green-700 hover:bg-green-50 transition-colors"
              >
                <UserCheck className="w-3.5 h-3.5 text-green-500" />
                Convert to Client
              </button>
            )}
            <div className="border-t border-gray-100 my-1" />
            <button
              onClick={() => { setOpen(false); onDelete(lead) }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default function LeadsTable({ leads = [], onEdit, onRefresh }) {
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
            {['Name / Company', 'Contact', 'Source / Platform', 'Status', 'Value', 'Assigned To', 'Follow-up', 'Notes', 'Actions'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {leads.map((lead) => (
            <tr
              key={lead.id}
              className="group hover:bg-blue-50/30 transition-colors cursor-pointer"
              onClick={() => router.push(`/leads/${lead.id}`)}
            >
              {/* Name / Company */}
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Avatar name={lead.name} size="sm" />
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{lead.name}</p>
                    {lead.designation && (
                      <p className="text-xs text-gray-500 truncate">{lead.designation}</p>
                    )}
                    {lead.company && (
                      <p className="text-xs text-gray-400 truncate">{lead.company}</p>
                    )}
                    {lead.location && (
                      <p className="flex items-center gap-1 text-xs text-gray-400 truncate">
                        <MapPin className="w-2.5 h-2.5 shrink-0" />{lead.location}
                      </p>
                    )}
                    {lead.convertedAt && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                        <UserCheck className="w-3 h-3" /> Converted
                      </span>
                    )}
                  </div>
                </div>
              </td>

              {/* Contact */}
              <td className="px-4 py-3">
                <div className="space-y-0.5">
                  {lead.email && (
                    <a
                      href={`mailto:${lead.email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
                    >
                      <Mail className="w-3 h-3" />
                      <span className="truncate max-w-[140px]">{lead.email}</span>
                    </a>
                  )}
                  {lead.phone && (
                    <a
                      href={`tel:${lead.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
                    >
                      <Phone className="w-3 h-3" />
                      {lead.phone}
                    </a>
                  )}
                  {lead.alternativePhone && (
                    <a
                      href={`tel:${lead.alternativePhone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 transition-colors"
                    >
                      <Phone className="w-3 h-3" />
                      {lead.alternativePhone}
                    </a>
                  )}
                </div>
              </td>

              {/* Source / Platform */}
              <td className="px-4 py-3">
                <div className="space-y-0.5">
                  {lead.source && (
                    <p className="text-xs text-gray-600">{lead.source}</p>
                  )}
                  {lead.platform && (
                    <p className="text-xs text-gray-400">{lead.platform}</p>
                  )}
                  {!lead.source && !lead.platform && (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
              </td>

              {/* Status + Priority */}
              <td className="px-4 py-3">
                <div className="space-y-1">
                  <Badge status={lead.status} />
                  {lead.priority && lead.priority !== 'NORMAL' && (
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${PRIORITY_STYLES[lead.priority] ?? ''}`}>
                      {lead.priority}
                    </span>
                  )}
                </div>
              </td>

              {/* Value */}
              <td className="px-4 py-3">
                <span className="text-sm font-semibold text-gray-800">
                  {lead.value ? formatCurrency(lead.value) : '—'}
                </span>
              </td>

              {/* Assigned To */}
              <td className="px-4 py-3">
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
              <td className="px-4 py-3 whitespace-nowrap">
                {lead.followUpDate ? (
                  <span className={`text-xs font-medium ${new Date(lead.followUpDate) < new Date() ? 'text-red-500' : 'text-gray-500'}`}>
                    {formatDate(lead.followUpDate)}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </td>

              {/* Notes / Comments / Links */}
              <td className="px-4 py-3">
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
