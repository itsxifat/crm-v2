'use client'

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Eye, Pencil, Trash2, UserCheck, Phone, Mail, MapPin, MessageSquare, ChevronDown, Check, Users, Link as LinkIcon } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import ConvertLeadModal from '@/components/admin/leads/ConvertLeadModal'
import { formatCurrency, formatDate } from '@/lib/utils'

// Value is a masked string ('••••••') for users without pii.financial.view
const formatValue = (v) => (typeof v === 'string' ? v : formatCurrency(v))

const PRIORITY_VARIANT = { LOW: 'default', NORMAL: 'primary', HIGH: 'orange', URGENT: 'danger' }
const PRIORITY_LABEL   = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' }

const STATUS_OPTIONS = [
  { value: 'NEW',           label: 'New' },
  { value: 'CONTACTED',     label: 'Contacted' },
  { value: 'PROPOSAL_SENT', label: 'Proposal sent' },
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
        className="group flex items-center gap-1 disabled:opacity-60"
      >
        <Badge status={lead.status} />
        <ChevronDown className="size-3 text-gray-400 transition-colors group-hover:text-gray-700" />
      </button>
      {anchor && (
        <PortalDropdown anchor={anchor} onClose={() => setAnchor(null)} align="left">
          <div className="w-44 overflow-hidden rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s.value}
                onClick={(e) => { e.stopPropagation(); changeStatus(s.value) }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-gray-100"
              >
                <Badge status={s.value} />
                {s.value === lead.status && (
                  <Check className="ml-auto size-4 shrink-0 text-gray-900" />
                )}
              </button>
            ))}
          </div>
        </PortalDropdown>
      )}
    </>
  )
}

export default function LeadsTable({ leads = [], onEdit, onRefresh, onStatusChange }) {
  const router = useRouter()
  const [convertLead, setConvertLead] = useState(null)
  // Refresh only after the convert modal closes: refreshing immediately swaps the
  // table for a loading skeleton, unmounting the modal and its one-time password.
  const [converted,   setConverted]   = useState(false)

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

  const handleConvert = (lead) => setConvertLead(lead)

  if (!leads.length) {
    return <EmptyState icon={Users} title="No leads found" description="Try adjusting your filters." />
  }

  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="hidden sm:table-cell">Contact</TableHead>
          <TableHead className="hidden lg:table-cell">Source</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden text-right md:table-cell">Value</TableHead>
          <TableHead className="hidden xl:table-cell">Assignee</TableHead>
          <TableHead className="hidden lg:table-cell">Follow-up</TableHead>
          <TableHead className="hidden xl:table-cell">Notes</TableHead>
          <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
          {leads.map((lead) => (
            <TableRow
              key={lead.id}
              className="group cursor-pointer"
              onClick={() => router.push(`/admin/leads/${lead.id}`)}
            >
              {/* Name / Company */}
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar name={lead.name} size="sm" />
                  <div className="min-w-0">
                    <p className="max-w-[160px] truncate font-medium text-gray-900 sm:max-w-[200px]">{lead.name}</p>
                    {lead.designation && (
                      <p className="max-w-[160px] truncate text-xs text-muted-foreground">{lead.designation}</p>
                    )}
                    {lead.company && (
                      <p className="max-w-[160px] truncate text-xs text-muted-foreground">{lead.company}</p>
                    )}
                    {lead.location && (
                      <p className="hidden max-w-[160px] items-center gap-1 truncate text-xs text-gray-400 sm:flex">
                        <MapPin className="size-3 shrink-0" />{lead.location}
                      </p>
                    )}
                    {lead.convertedAt && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                        <UserCheck className="size-3" /> Converted
                      </span>
                    )}
                    {/* Mobile-only: show value + priority inline */}
                    <div className="mt-1 flex items-center gap-1.5 md:hidden">
                      {lead.value && (
                        <span className="text-xs font-medium tabular-nums text-gray-700">{formatValue(lead.value)}</span>
                      )}
                      {lead.priority && lead.priority !== 'NORMAL' && (
                        <Badge variant={PRIORITY_VARIANT[lead.priority] ?? 'default'}>{PRIORITY_LABEL[lead.priority] ?? lead.priority}</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </TableCell>

              {/* Contact */}
              <TableCell className="hidden sm:table-cell">
                <div className="space-y-0.5">
                  {lead.email && (
                    <a
                      href={`mailto:${lead.email}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-gray-900"
                    >
                      <Mail className="size-3 shrink-0" />
                      <span className="max-w-[140px] truncate">{lead.email}</span>
                    </a>
                  )}
                  {lead.phone && (
                    <a
                      href={`tel:${lead.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-gray-900"
                    >
                      <Phone className="size-3 shrink-0" />
                      {lead.phone}
                    </a>
                  )}
                </div>
              </TableCell>

              {/* Source / Platform */}
              <TableCell className="hidden lg:table-cell">
                <div className="space-y-0.5">
                  {lead.source && <p className="text-xs text-gray-700">{lead.source}</p>}
                  {lead.platform && <p className="text-xs text-muted-foreground">{lead.platform}</p>}
                  {lead.businessCategory && (
                    <p className="text-xs text-muted-foreground">{lead.businessCategory}</p>
                  )}
                  {!lead.source && !lead.platform && !lead.businessCategory && (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
              </TableCell>

              {/* Status + Priority */}
              <TableCell onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-col items-start gap-1">
                  <StatusPill lead={lead} onStatusChange={onStatusChange} />
                  {lead.priority && lead.priority !== 'NORMAL' && (
                    <Badge variant={PRIORITY_VARIANT[lead.priority] ?? 'default'} className="hidden md:inline-flex">
                      {PRIORITY_LABEL[lead.priority] ?? lead.priority}
                    </Badge>
                  )}
                </div>
              </TableCell>

              {/* Value */}
              <TableCell className="hidden text-right tabular-nums md:table-cell">
                <span className="font-medium text-gray-900">
                  {lead.value ? formatValue(lead.value) : '—'}
                </span>
              </TableCell>

              {/* Assigned To */}
              <TableCell className="hidden xl:table-cell">
                {lead.assignedToId ? (
                  <div className="flex items-center gap-2">
                    <Avatar name={lead.assignedToId.userId?.name ?? ''} size="xs" src={lead.assignedToId.userId?.avatar} />
                    <span className="max-w-[100px] truncate text-xs text-gray-700">
                      {lead.assignedToId.userId?.name ?? '—'}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">Unassigned</span>
                )}
              </TableCell>

              {/* Follow-up */}
              <TableCell className="hidden whitespace-nowrap lg:table-cell">
                {lead.followUpDate ? (
                  <span className={`text-xs font-medium ${new Date(lead.followUpDate) < new Date() ? 'text-red-600' : 'text-muted-foreground'}`}>
                    {formatDate(lead.followUpDate)}
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">—</span>
                )}
              </TableCell>

              {/* Notes / Comments */}
              <TableCell className="hidden xl:table-cell">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {lead.comments?.length > 0 && (
                    <span className="flex items-center gap-1">
                      <MessageSquare className="size-3" />{lead.comments.length}
                    </span>
                  )}
                  {lead.links?.length > 0 && (
                    <span className="flex items-center gap-1">
                      <LinkIcon className="size-3" />{lead.links.length}
                    </span>
                  )}
                  {!lead.comments?.length && !lead.links?.length && (
                    <span className="text-gray-300">—</span>
                  )}
                </div>
              </TableCell>

              {/* Actions */}
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <ActionMenu
                  items={[
                    { label: 'View details', icon: Eye, href: `/admin/leads/${lead.id}` },
                    { label: 'Edit', icon: Pencil, onClick: () => onEdit(lead) },
                    lead.status === 'WON' && !lead.convertedAt && { label: 'Convert to client', icon: UserCheck, onClick: () => handleConvert(lead) },
                    { label: 'Delete', icon: Trash2, danger: true, onClick: () => handleDelete(lead) },
                  ]}
                />
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>

    <ConvertLeadModal
      open={!!convertLead}
      onClose={() => {
        setConvertLead(null)
        if (converted) { setConverted(false); onRefresh?.() }
      }}
      lead={convertLead}
      onSuccess={() => setConverted(true)}
    />
    </>
  )
}
