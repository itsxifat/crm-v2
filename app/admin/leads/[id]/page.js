'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Pencil, Phone, Mail, MapPin, Globe, MessageSquare,
  Send, Trash2, UserCheck, Calendar, DollarSign, TrendingUp,
  Clock, Tag, User, Building2, PhoneCall, AtSign, ExternalLink,
  Activity, PhoneIncoming, MailOpen, CalendarClock, FileText, CheckSquare,
  FileEdit, Plus, RefreshCw,
} from 'lucide-react'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import LeadModal from '@/components/admin/leads/LeadModal'
import { formatCurrency, formatDate } from '@/lib/utils'

function refHref(type, id) {
  if (!id) return null
  if (type === 'CLIENT')   return `/admin/clients/${id}`
  if (type === 'EMPLOYEE') return `/admin/employees/${id}`
  if (type === 'LEAD')     return `/admin/leads/${id}`
  return null
}

const REF_TYPE_STYLE = {
  CLIENT:   'bg-green-100 text-green-700',
  EMPLOYEE: 'bg-purple-100 text-purple-700',
  LEAD:     'bg-blue-100 text-blue-700',
}
const REF_TYPE_LABEL = { CLIENT: 'Client', EMPLOYEE: 'Employee', LEAD: 'Lead' }

const PRIORITY_STYLES = {
  LOW:    'bg-gray-100 text-gray-500',
  NORMAL: 'bg-blue-50 text-blue-600',
  HIGH:   'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}

const ACTIVITY_ICONS = {
  call:    PhoneCall,
  email:   MailOpen,
  meeting: CalendarClock,
  note:    FileText,
  task:    CheckSquare,
  update:  RefreshCw,
}

const ACTIVITY_COLORS = {
  call:    'bg-blue-50 text-blue-600',
  email:   'bg-purple-50 text-purple-600',
  meeting: 'bg-green-50 text-green-600',
  note:    'bg-yellow-50 text-yellow-600',
  task:    'bg-orange-50 text-orange-600',
  update:  'bg-gray-100 text-gray-500',
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

  const handleConvert = async () => {
    if (!confirm(`Convert "${lead?.name}" to a client? This will create a new user account.`)) return
    try {
      const res  = await fetch(`/api/leads/${id}/convert`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Conversion failed')
      toast.success(`Lead converted! Temp password: ${data.data?.tempPassword ?? '—'}`)
      router.push(`/admin/clients/${data.data?.clientId}`)
    } catch (err) {
      toast.error(err.message)
    }
  }

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
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-gray-200 rounded" />
        <div className="h-48 bg-gray-100 rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1,2,3].map((i) => <div key={i} className="h-32 bg-gray-100 rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Lead not found.</p>
        <Link href="/admin/leads" className="text-blue-600 text-sm mt-2 inline-block">Back to Leads</Link>
      </div>
    )
  }

  const assignee = lead.assignedToId?.userId

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/leads"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{lead.name}</h1>
            {lead.company && <p className="text-sm text-gray-500">{lead.company}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lead.status === 'WON' && !lead.convertedAt && (
            <button
              onClick={handleConvert}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-colors"
            >
              <UserCheck className="w-4 h-4" />
              Convert to Client
            </button>
          )}
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Pencil className="w-4 h-4" />
            Edit
          </button>
          {isAdmin && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-3 py-2 text-red-600 text-sm font-semibold rounded-lg hover:bg-red-50 border border-red-200 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — details */}
        <div className="lg:col-span-2 space-y-6">

          {/* Overview card */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Avatar name={lead.name} size="lg" />
                <div>
                  <h2 className="font-semibold text-gray-900 text-lg">{lead.name}</h2>
                  {lead.designation && <p className="text-sm text-gray-500">{lead.designation}</p>}
                  {lead.convertedAt && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium mt-1">
                      <UserCheck className="w-3 h-3" /> Converted {formatDate(lead.convertedAt)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge status={lead.status} />
                {lead.priority && (
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_STYLES[lead.priority]}`}>
                    {lead.priority}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {lead.email && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <a href={`mailto:${lead.email}`} className="hover:text-blue-600 truncate">{lead.email}</a>
                </div>
              )}
              {lead.phone && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <a href={`tel:${lead.phone}`} className="hover:text-blue-600">{lead.phone}</a>
                </div>
              )}
              {lead.alternativePhone && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <a href={`tel:${lead.alternativePhone}`} className="hover:text-blue-600">{lead.alternativePhone}</a>
                  <span className="text-xs text-gray-400">(alt)</span>
                </div>
              )}
              {lead.company && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Building2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  {lead.company}
                </div>
              )}
              {lead.location && (
                <div className="flex items-center gap-2 text-gray-600">
                  <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  {lead.location}
                </div>
              )}
              {lead.source && (
                <div className="flex items-center gap-2 text-gray-600">
                  <TrendingUp className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  {lead.source}
                  {lead.platform && <span className="text-gray-400">· {lead.platform}</span>}
                </div>
              )}
              {lead.reference && (
                <div className="flex items-center gap-2 text-gray-600 col-span-2 sm:col-span-1">
                  <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="text-gray-500 shrink-0">Ref:</span>
                  {refHref(lead.referenceType, lead.referenceId) ? (
                    <Link
                      href={refHref(lead.referenceType, lead.referenceId)}
                      className="flex items-center gap-1.5 hover:text-blue-600 transition-colors group min-w-0"
                    >
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${REF_TYPE_STYLE[lead.referenceType] ?? 'bg-gray-100 text-gray-600'}`}>
                        {REF_TYPE_LABEL[lead.referenceType] ?? lead.referenceType}
                      </span>
                      <span className="truncate">{lead.reference}</span>
                      <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" />
                    </Link>
                  ) : (
                    <span className="truncate">{lead.reference}</span>
                  )}
                </div>
              )}
              {lead.category && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Tag className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  {lead.category}
                  {lead.service && <span className="text-gray-400">· {lead.service}</span>}
                </div>
              )}
              {lead.value && (
                <div className="flex items-center gap-2 text-gray-800 font-semibold">
                  <DollarSign className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  {formatCurrency(lead.value)}
                </div>
              )}
              {lead.sendingDate && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="text-gray-500">Sent:</span> {formatDate(lead.sendingDate)}
                </div>
              )}
              {lead.followUpDate && (
                <div className={`flex items-center gap-2 font-medium ${new Date(lead.followUpDate) < new Date() ? 'text-red-500' : 'text-gray-600'}`}>
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-gray-500 font-normal">Follow-up:</span> {formatDate(lead.followUpDate)}
                </div>
              )}
            </div>

            {/* Links */}
            {lead.links?.length > 0 && (
              <div className="pt-2 border-t border-gray-50">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Links</p>
                <div className="flex flex-wrap gap-2">
                  {lead.links.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {url.length > 40 ? url.slice(0, 40) + '…' : url}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {lead.notes && (
              <div className="pt-2 border-t border-gray-50">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Notes</p>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{lead.notes}</p>
              </div>
            )}

            {/* Lost reason */}
            {lead.status === 'LOST' && lead.lostReason && (
              <div className="pt-2 border-t border-gray-50">
                <p className="text-xs font-medium text-red-400 uppercase tracking-wider mb-1">Lost Reason</p>
                <p className="text-sm text-red-600">{lead.lostReason}</p>
              </div>
            )}
          </div>

          {/* Quotations */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <FileEdit className="w-4 h-4 text-gray-400" />
                Quotations
                {quotations.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">{quotations.length}</span>
                )}
              </h3>
              <Link
                href={`/admin/quotations/new?sourceType=LEAD&leadId=${id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New Quotation
              </Link>
            </div>
            {quotations.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No quotations yet.</p>
            ) : (
              <div className="space-y-2">
                {quotations.map((q) => (
                  <Link
                    key={q.id}
                    href={`/admin/quotations/${q.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-blue-100 hover:bg-blue-50/30 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <FileEdit className="w-4 h-4 text-blue-400 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700">{q.quotationNumber}</p>
                        {q.recipientName && <p className="text-xs text-gray-400">{q.recipientName}{q.recipientCompany ? ` · ${q.recipientCompany}` : ''}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-semibold text-gray-700">
                        {q.currency === 'BDT' ? '৳' : q.currency} {(q.total ?? 0).toLocaleString()}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        q.status === 'ACCEPTED' ? 'bg-green-100 text-green-700' :
                        q.status === 'REJECTED' ? 'bg-red-100 text-red-600' :
                        q.status === 'SENT'     ? 'bg-blue-100 text-blue-700' :
                                                  'bg-gray-100 text-gray-500'
                      }`}>{q.status}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Activity log */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-gray-400" />
              Activity Log
            </h3>

            {/* Add activity form */}
            <form onSubmit={handleAddActivity} className="mb-5">
              <div className="flex gap-2 mb-2">
                {['call', 'email', 'meeting', 'note', 'task'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setActType(t)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                      actType === t
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={actNote}
                  onChange={(e) => setActNote(e.target.value)}
                  placeholder={`Log a ${actType}…`}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={actLoading || !actNote.trim()}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  Log
                </button>
              </div>
            </form>

            {/* Activity list */}
            {activities.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No activities logged yet.</p>
            ) : (
              <div className="space-y-3">
                {activities.map((act) => {
                  const Icon = ACTIVITY_ICONS[act.type] ?? FileText
                  const colorClass = ACTIVITY_COLORS[act.type] ?? 'bg-gray-50 text-gray-600'
                  return (
                    <div key={act.id} className="flex gap-3">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${colorClass}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700">{act.note}</p>
                        <p className="text-xs text-gray-400 mt-0.5 capitalize">
                          {act.type}
                          {act.createdByName && <span className="font-medium text-gray-500"> · {act.createdByName}</span>}
                          {' · '}{fmtDateTime(act.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Comments */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-gray-400" />
              Comments
              {lead.comments?.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">{lead.comments.length}</span>
              )}
            </h3>

            {/* Comment list */}
            {lead.comments?.length > 0 ? (
              <div className="space-y-3 mb-4">
                {[...lead.comments].reverse().map((c) => (
                  <div key={c.id} className="flex gap-3 group">
                    <Avatar name={c.authorName} size="xs" />
                    <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-gray-700">{c.authorName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400">{fmtDateTime(c.createdAt)}</span>
                          {(isAdmin || c.authorId === session?.user?.id) && (
                            <button
                              onClick={() => handleDeleteComment(c.id)}
                              className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap">{c.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-4 mb-4">No comments yet.</p>
            )}

            {/* Add comment */}
            <form onSubmit={handleAddComment} className="flex gap-2">
              <input
                ref={commentInputRef}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment…"
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={cmtLoading || !comment.trim()}
                className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>

        {/* Right column — meta */}
        <div className="space-y-4">
          {/* Assigned to */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Assigned To</p>
            {assignee ? (
              <div className="flex items-center gap-3">
                <Avatar name={assignee.name} src={assignee.avatar} size="sm" />
                <div>
                  <p className="text-sm font-medium text-gray-800">{assignee.name}</p>
                  {assignee.email && <p className="text-xs text-gray-400">{assignee.email}</p>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Unassigned</p>
            )}
          </div>

          {/* Key dates */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Timeline</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Created</span>
                <span className="text-gray-700 font-medium">{formatDate(lead.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Updated</span>
                <span className="text-gray-700 font-medium">{formatDate(lead.updatedAt)}</span>
              </div>
              {lead.sendingDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Proposal Sent</span>
                  <span className="text-gray-700 font-medium">{formatDate(lead.sendingDate)}</span>
                </div>
              )}
              {lead.followUpDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Follow-up</span>
                  <span className={`font-medium ${new Date(lead.followUpDate) < new Date() ? 'text-red-500' : 'text-gray-700'}`}>
                    {formatDate(lead.followUpDate)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Value */}
          {lead.value && (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Deal Value</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(lead.value)}</p>
            </div>
          )}

          {/* Classification */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-2 text-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Classification</p>
            {lead.businessCategory && (
              <div className="flex justify-between">
                <span className="text-gray-500">Business</span>
                <span className="text-gray-700 font-medium">{lead.businessCategory}</span>
              </div>
            )}
            {lead.category && (
              <div className="flex justify-between">
                <span className="text-gray-500">Category</span>
                <span className="text-gray-700 font-medium">{lead.category}</span>
              </div>
            )}
            {lead.service && (
              <div className="flex justify-between">
                <span className="text-gray-500">Service</span>
                <span className="text-gray-700 font-medium">{lead.service}</span>
              </div>
            )}
            {lead.source && (
              <div className="flex justify-between">
                <span className="text-gray-500">Source</span>
                <span className="text-gray-700 font-medium">{lead.source}</span>
              </div>
            )}
            {lead.platform && (
              <div className="flex justify-between">
                <span className="text-gray-500">Platform</span>
                <span className="text-gray-700 font-medium">{lead.platform}</span>
              </div>
            )}
            {lead.reference && (
              <div className="flex justify-between items-center gap-2">
                <span className="text-gray-500 shrink-0">Reference</span>
                {refHref(lead.referenceType, lead.referenceId) ? (
                  <Link
                    href={refHref(lead.referenceType, lead.referenceId)}
                    className="flex items-center gap-1.5 min-w-0 hover:text-blue-600 transition-colors group"
                  >
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${REF_TYPE_STYLE[lead.referenceType] ?? 'bg-gray-100 text-gray-600'}`}>
                      {REF_TYPE_LABEL[lead.referenceType] ?? lead.referenceType}
                    </span>
                    <span className="text-gray-700 font-medium truncate">{lead.reference}</span>
                    <ExternalLink className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" />
                  </Link>
                ) : (
                  <span className="text-gray-700 font-medium truncate">{lead.reference}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      <LeadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        lead={lead}
        onSuccess={() => { setModalOpen(false); fetchLead() }}
      />
    </div>
  )
}
