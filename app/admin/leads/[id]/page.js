'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Pencil, Phone, Mail, MapPin,
  Send, Trash2, UserCheck, Calendar, Wallet, TrendingUp,
  Clock, Tag, User, Building2, PhoneCall, ExternalLink,
  MailOpen, CalendarClock, FileText, CheckSquare,
  FileEdit, Plus, RefreshCw,
} from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import Button from '@/components/ui/Button'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import EmptyState from '@/components/ui/EmptyState'
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import LeadModal from '@/components/admin/leads/LeadModal'
import ConvertLeadModal from '@/components/admin/leads/ConvertLeadModal'
import { formatCurrency, formatDate, cn } from '@/lib/utils'

// Value is a masked string ('••••••') for users without pii.financial.view
const formatValue = (v) => (typeof v === 'string' ? v : formatCurrency(v))

function refHref(type, id) {
  if (!id) return null
  if (type === 'CLIENT')   return `/admin/clients/${id}`
  if (type === 'EMPLOYEE') return `/admin/employees/${id}`
  if (type === 'LEAD')     return `/admin/leads/${id}`
  return null
}

const REF_TYPE_VARIANT = { CLIENT: 'success', EMPLOYEE: 'purple', LEAD: 'primary' }
const REF_TYPE_LABEL = { CLIENT: 'Client', EMPLOYEE: 'Employee', LEAD: 'Lead' }

const PRIORITY_VARIANT = { LOW: 'default', NORMAL: 'primary', HIGH: 'orange', URGENT: 'danger' }
const PRIORITY_LABEL   = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' }

const QUOTE_VARIANT = { ACCEPTED: 'success', REJECTED: 'danger', SENT: 'primary' }
const humanize = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '')

const ACTIVITY_ICONS = {
  call:    PhoneCall,
  email:   MailOpen,
  meeting: CalendarClock,
  note:    FileText,
  task:    CheckSquare,
  update:  RefreshCw,
}

function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function LeadDetailPage() {
  const { id }    = useParams()
  const router    = useRouter()
  const { data: session } = useSession()

  const [lead,        setLead]        = useState(null)
  const [activities,  setActivities]  = useState([])
  const [quotations,  setQuotations]  = useState([])
  const [loading,     setLoading]     = useState(true)
  const [modalOpen,   setModalOpen]   = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)

  // Activity log form
  const [actType,    setActType]    = useState('note')
  const [actNote,    setActNote]    = useState('')
  const [actLoading, setActLoading] = useState(false)

  // Comment form
  const [comment,    setComment]    = useState('')
  const [cmtLoading, setCmtLoading] = useState(false)

  const commentInputRef = useRef(null)

  const fetchLead = useCallback(async () => {
    try {
      const [leadRes, quotRes] = await Promise.all([
        fetch(`/api/leads/${id}`),
        fetch(`/api/quotations?leadId=${id}&limit=50`),
      ])
      const leadData = await leadRes.json()
      if (!leadRes.ok) throw new Error(leadData.error ?? 'Failed to load lead')
      setLead(leadData.data)
      setActivities(leadData.data.activities ?? [])
      if (quotRes.ok) {
        const quotData = await quotRes.json()
        setQuotations(quotData.data ?? [])
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchLead() }, [fetchLead])

  const handleDelete = async () => {
    if (!confirm(`Delete lead "${lead?.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete lead')
      toast.success('Lead deleted')
      router.push('/admin/leads')
    } catch {
      toast.error('Failed to delete lead')
    }
  }

  const handleConvert = () => setConvertOpen(true)

  const handleAddActivity = async (e) => {
    e.preventDefault()
    if (!actNote.trim()) return
    setActLoading(true)
    try {
      const res  = await fetch(`/api/leads/${id}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: actType, note: actNote.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to log activity')
      setActivities((prev) => [data.data, ...prev])
      setActNote('')
      toast.success('Activity logged')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setActLoading(false)
    }
  }

  const handleAddComment = async (e) => {
    e.preventDefault()
    if (!comment.trim()) return
    setCmtLoading(true)
    try {
      const res  = await fetch(`/api/leads/${id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: comment.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to add comment')
      setLead((prev) => ({ ...prev, comments: [...(prev.comments ?? []), data.data] }))
      setComment('')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCmtLoading(false)
    }
  }

  const handleDeleteComment = async (commentId) => {
    if (!confirm('Delete this comment?')) return
    try {
      const res = await fetch(`/api/leads/${id}/comments?commentId=${commentId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete comment')
      setLead((prev) => ({ ...prev, comments: prev.comments.filter((c) => c.id !== commentId) }))
    } catch {
      toast.error('Failed to delete comment')
    }
  }

  const isAdmin = ['SUPER_ADMIN', 'MANAGER'].includes(session?.user?.role)

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded-md bg-gray-100" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="h-64 animate-pulse rounded-xl bg-gray-100 lg:col-span-2" />
          <div className="h-64 animate-pulse rounded-xl bg-gray-100" />
        </div>
      </div>
    )
  }

  if (!lead) {
    return (
      <Card>
        <EmptyState
          title="Lead not found"
          action={<Button variant="outline" href="/admin/leads"><ArrowLeft /> Back to leads</Button>}
        />
      </Card>
    )
  }

  const assignee = lead.assignedToId?.userId
  const refLink  = refHref(lead.referenceType, lead.referenceId)
  const overdue  = lead.followUpDate && new Date(lead.followUpDate) < new Date()

  return (
    <div className="space-y-6">
      <PageHeader
        title={lead.name}
        back="/admin/leads"
        backLabel="Leads"
        description={[lead.designation, lead.company].filter(Boolean).join(' · ') || undefined}
        meta={
          <>
            <Badge status={lead.status} />
            {lead.priority && (
              <Badge variant={PRIORITY_VARIANT[lead.priority] ?? 'default'}>
                {PRIORITY_LABEL[lead.priority] ?? lead.priority}
              </Badge>
            )}
            {lead.convertedAt && (
              <Badge variant="success">
                <UserCheck className="size-3" /> Converted {formatDate(lead.convertedAt)}
              </Badge>
            )}
          </>
        }
        actions={
          <>
            {isAdmin && (
              <Button variant="outline" onClick={handleDelete} className="text-red-600 hover:text-red-700">
                <Trash2 /> Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => setModalOpen(true)}>
              <Pencil /> Edit
            </Button>
            {lead.status === 'WON' && !lead.convertedAt && (
              <Button onClick={handleConvert}>
                <UserCheck /> Convert to client
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column — details */}
        <div className="space-y-6 lg:col-span-2">

          {/* Overview card */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
                {lead.email && (
                  <div className="flex min-w-0 items-center gap-2 text-gray-700">
                    <Mail className="size-4 shrink-0 text-gray-400" />
                    <a href={`mailto:${lead.email}`} className="truncate hover:text-gray-900 hover:underline underline-offset-4">{lead.email}</a>
                  </div>
                )}
                {lead.phone && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <Phone className="size-4 shrink-0 text-gray-400" />
                    <a href={`tel:${lead.phone}`} className="hover:text-gray-900 hover:underline underline-offset-4">{lead.phone}</a>
                  </div>
                )}
                {lead.alternativePhone && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <Phone className="size-4 shrink-0 text-gray-400" />
                    <a href={`tel:${lead.alternativePhone}`} className="hover:text-gray-900 hover:underline underline-offset-4">{lead.alternativePhone}</a>
                    <span className="text-xs text-muted-foreground">(alt)</span>
                  </div>
                )}
                {lead.company && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <Building2 className="size-4 shrink-0 text-gray-400" />
                    {lead.company}
                  </div>
                )}
                {lead.location && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <MapPin className="size-4 shrink-0 text-gray-400" />
                    {lead.location}
                  </div>
                )}
                {lead.source && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <TrendingUp className="size-4 shrink-0 text-gray-400" />
                    {lead.source}
                    {lead.platform && <span className="text-muted-foreground">· {lead.platform}</span>}
                  </div>
                )}
                {lead.reference && (
                  <div className="flex min-w-0 items-center gap-2 text-gray-700">
                    <User className="size-4 shrink-0 text-gray-400" />
                    <span className="shrink-0 text-muted-foreground">Ref</span>
                    {refLink ? (
                      <Link href={refLink} className="group flex min-w-0 items-center gap-1.5 hover:text-gray-900">
                        <Badge variant={REF_TYPE_VARIANT[lead.referenceType] ?? 'default'} className="shrink-0">
                          {REF_TYPE_LABEL[lead.referenceType] ?? lead.referenceType}
                        </Badge>
                        <span className="truncate group-hover:underline underline-offset-4">{lead.reference}</span>
                        <ExternalLink className="size-3 shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
                      </Link>
                    ) : (
                      <span className="truncate">{lead.reference}</span>
                    )}
                  </div>
                )}
                {lead.category && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <Tag className="size-4 shrink-0 text-gray-400" />
                    {lead.category}
                    {lead.service && <span className="text-muted-foreground">· {lead.service}</span>}
                  </div>
                )}
                {lead.value && (
                  <div className="flex items-center gap-2 font-medium tabular-nums text-gray-900">
                    <Wallet className="size-4 shrink-0 text-gray-400" />
                    {formatValue(lead.value)}
                  </div>
                )}
                {lead.sendingDate && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <Calendar className="size-4 shrink-0 text-gray-400" />
                    <span className="text-muted-foreground">Sent</span> {formatDate(lead.sendingDate)}
                  </div>
                )}
                {lead.followUpDate && (
                  <div className={`flex items-center gap-2 font-medium ${overdue ? 'text-red-600' : 'text-gray-700'}`}>
                    <Clock className={`size-4 shrink-0 ${overdue ? '' : 'text-gray-400'}`} />
                    <span className="font-normal text-muted-foreground">Follow-up</span> {formatDate(lead.followUpDate)}
                  </div>
                )}
              </div>

              {/* Links */}
              {lead.links?.length > 0 && (
                <div className="border-t border-gray-100 pt-4">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Links</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {lead.links.map((url, i) => (
                      <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[13px] text-gray-900 underline-offset-4 hover:underline"
                      >
                        <ExternalLink className="size-3 text-gray-400" />
                        {url.length > 40 ? url.slice(0, 40) + '…' : url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes */}
              {lead.notes && (
                <div className="border-t border-gray-100 pt-4">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Notes</p>
                  <p className="whitespace-pre-wrap text-sm text-gray-700">{lead.notes}</p>
                </div>
              )}

              {/* Lost reason */}
              {lead.status === 'LOST' && lead.lostReason && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                  <span className="font-medium">Lost reason · </span>{lead.lostReason}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quotations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Quotations
                {quotations.length > 0 && <Badge>{quotations.length}</Badge>}
              </CardTitle>
              <CardAction>
                <Button variant="outline" size="sm" href={`/admin/quotations/new?sourceType=LEAD&leadId=${id}`}>
                  <Plus /> New quotation
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {quotations.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No quotations yet</p>
              ) : (
                <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
                  {quotations.map((q) => (
                    <Link
                      key={q.id}
                      href={`/admin/quotations/${q.id}`}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-gray-50"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <FileEdit className="size-4 shrink-0 text-gray-400" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{q.quotationNumber}</p>
                          {q.recipientName && <p className="truncate text-xs text-muted-foreground">{q.recipientName}{q.recipientCompany ? ` · ${q.recipientCompany}` : ''}</p>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-medium tabular-nums text-gray-900">
                          {q.currency === 'BDT' ? '৳' : q.currency} {(q.total ?? 0).toLocaleString()}
                        </span>
                        <Badge variant={QUOTE_VARIANT[q.status] ?? 'default'}>{humanize(q.status)}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity log */}
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Add activity form */}
              <form onSubmit={handleAddActivity} className="mb-5 space-y-2">
                <Tabs
                  size="sm"
                  value={actType}
                  onChange={setActType}
                  tabs={['call', 'email', 'meeting', 'note', 'task'].map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
                />
                <div className="flex gap-2">
                  <Input
                    value={actNote}
                    onChange={(e) => setActNote(e.target.value)}
                    placeholder={`Log a ${actType}…`}
                  />
                  <Button type="submit" variant="outline" disabled={actLoading || !actNote.trim()}>
                    Log
                  </Button>
                </div>
              </form>

              {/* Activity list */}
              {activities.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {activities.map((act) => {
                    const Icon = ACTIVITY_ICONS[act.type] ?? FileText
                    return (
                      <div key={act.id} className="flex gap-3">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-gray-200/80 bg-white shadow-xs">
                          <Icon className="size-3.5 text-gray-500" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900">{act.note}</p>
                          <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                            {act.type}
                            {act.createdByName && <span className="font-medium text-gray-600"> · {act.createdByName}</span>}
                            {' · '}{fmtDateTime(act.createdAt)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comments */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Comments
                {lead.comments?.length > 0 && <Badge>{lead.comments.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Comment list */}
              {lead.comments?.length > 0 ? (
                <div className="mb-4 space-y-3">
                  {[...lead.comments].reverse().map((c) => (
                    <div key={c.id} className="group flex gap-3">
                      <Avatar name={c.authorName} size="xs" />
                      <div className="flex-1 rounded-lg bg-gray-50 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-gray-900">{c.authorName}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{fmtDateTime(c.createdAt)}</span>
                            {(isAdmin || c.authorId === session?.user?.id) && (
                              <button
                                onClick={() => handleDeleteComment(c.id)}
                                className="text-gray-400 opacity-0 transition-all hover:text-red-600 group-hover:opacity-100"
                                aria-label="Delete comment"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700">{c.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mb-4 py-4 text-center text-sm text-muted-foreground">No comments yet</p>
              )}

              {/* Add comment */}
              <form onSubmit={handleAddComment} className="flex gap-2">
                <Input
                  ref={commentInputRef}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment…"
                />
                <Button type="submit" variant="outline" size="icon" disabled={cmtLoading || !comment.trim()} aria-label="Send comment">
                  <Send />
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right column — meta */}
        <div className="space-y-4">
          {/* Assigned to */}
          <Card className="p-5">
            <p className="mb-3 text-sm font-semibold text-gray-900">Assignee</p>
            {assignee ? (
              <div className="flex items-center gap-3">
                <Avatar name={assignee.name} src={assignee.avatar} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{assignee.name}</p>
                  {assignee.email && <p className="truncate text-xs text-muted-foreground">{assignee.email}</p>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Unassigned</p>
            )}
          </Card>

          {/* Value */}
          {lead.value && (
            <Card className="p-5">
              <p className="text-[13px] font-medium text-muted-foreground">Deal value</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-gray-900">{formatValue(lead.value)}</p>
            </Card>
          )}

          {/* Key dates */}
          <Card className="p-5">
            <p className="mb-3 text-sm font-semibold text-gray-900">Timeline</p>
            <dl className="space-y-2 text-sm">
              <MetaRow label="Created">{formatDate(lead.createdAt)}</MetaRow>
              <MetaRow label="Updated">{formatDate(lead.updatedAt)}</MetaRow>
              {lead.sendingDate && <MetaRow label="Proposal sent">{formatDate(lead.sendingDate)}</MetaRow>}
              {lead.followUpDate && (
                <MetaRow label="Follow-up" className={overdue ? 'text-red-600' : undefined}>
                  {formatDate(lead.followUpDate)}
                </MetaRow>
              )}
            </dl>
          </Card>

          {/* Classification */}
          <Card className="p-5">
            <p className="mb-3 text-sm font-semibold text-gray-900">Classification</p>
            <dl className="space-y-2 text-sm">
              {lead.businessCategory && <MetaRow label="Business">{lead.businessCategory}</MetaRow>}
              {lead.category && <MetaRow label="Category">{lead.category}</MetaRow>}
              {lead.service && <MetaRow label="Service">{lead.service}</MetaRow>}
              {lead.source && <MetaRow label="Source">{lead.source}</MetaRow>}
              {lead.platform && <MetaRow label="Platform">{lead.platform}</MetaRow>}
              {lead.reference && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">Reference</dt>
                  <dd className="min-w-0">
                    {refLink ? (
                      <Link href={refLink} className="group flex min-w-0 items-center gap-1.5">
                        <Badge variant={REF_TYPE_VARIANT[lead.referenceType] ?? 'default'} className="shrink-0">
                          {REF_TYPE_LABEL[lead.referenceType] ?? lead.referenceType}
                        </Badge>
                        <span className="truncate font-medium text-gray-900 underline-offset-4 group-hover:underline">{lead.reference}</span>
                      </Link>
                    ) : (
                      <span className="block truncate font-medium text-gray-900">{lead.reference}</span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>

      {/* Edit modal */}
      <LeadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        lead={lead}
        onSuccess={() => { setModalOpen(false); fetchLead() }}
      />

      {/* Convert to client modal */}
      <ConvertLeadModal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        lead={lead}
        onSuccess={() => fetchLead()}
      />
    </div>
  )
}

function MetaRow({ label, className, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn('truncate text-right font-medium text-gray-900', className)}>{children}</dd>
    </div>
  )
}
