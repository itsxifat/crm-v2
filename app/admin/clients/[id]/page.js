'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Mail, Phone, Globe, MapPin, Building2,
  FolderOpen, FileText, FileCheck, DollarSign, Calendar,
  Pencil, CheckCircle, Clock, ShieldCheck, ExternalLink, Link2
} from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import ClientModal from '@/components/admin/clients/ClientModal'

const TABS = ['Overview', 'Projects', 'Invoices', 'Agreements', 'Documents', 'KYC']

const KYC_STATUS_META = {
  NOT_SUBMITTED: { label: 'Not Submitted', color: 'bg-gray-100 text-gray-500' },
  PENDING:       { label: 'Pending Review', color: 'bg-yellow-100 text-yellow-700' },
  VERIFIED:      { label: 'Verified',       color: 'bg-green-100 text-green-700' },
  REJECTED:      { label: 'Rejected',       color: 'bg-red-100 text-red-600' },
}

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-900">{value}</p>
      </div>
    </div>
  )
}

function StatBox({ label, value, sub, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-700',
    green:  'bg-green-50 text-green-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    purple: 'bg-purple-50 text-purple-700',
  }
  return (
    <div className={`rounded-xl p-4 ${colors[color]}`}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function ClientDetailPage() {
  const { id }   = useParams()
  const router   = useRouter()
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState('Overview')
  const [editOpen,   setEditOpen]   = useState(false)

  async function load() {
    try {
      const res  = await fetch(`/api/clients/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setData(json.data)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load client')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [id])

  function handleSaved() {
    toast.success('Client updated')
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Client not found.</p>
        <Link href="/admin/clients" className="text-blue-600 text-sm mt-2 inline-block hover:underline">Back to Clients</Link>
      </div>
    )
  }

  const { userId: user, projects = [], invoices = [], documents = [], agreements = [], linkedClients = [], totalRevenue, outstandingBalance, activeProjectCount, kyc } = data
  const kycStatus = kyc?.status ?? 'NOT_SUBMITTED'
  const kycMeta = KYC_STATUS_META[kycStatus] ?? KYC_STATUS_META.NOT_SUBMITTED

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4">
            <Avatar name={user?.name} src={user?.avatar} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900">{user?.name}</h1>
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${user?.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {user?.isActive ? 'Active' : 'Inactive'}
                </span>
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${kycMeta.color}`}>
                  KYC: {kycMeta.label}
                </span>
              </div>
              {data.company && <p className="text-sm text-gray-500">{data.company}</p>}
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                <p className="text-xs text-gray-400">
                  Client since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'}
                </p>
                {data.parentClientId && (
                  <Link href={`/admin/clients/${data.parentClientId._id ?? data.parentClientId.id}`}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                    <Link2 className="w-3 h-3" />
                    Linked to {data.parentClientId.company || data.parentClientId.userId?.name || 'parent'}
                  </Link>
                )}
                {linkedClients.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                    <Link2 className="w-3 h-3" />
                    {linkedClients.length} linked {linkedClients.length === 1 ? 'company' : 'companies'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <button
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Pencil className="w-4 h-4" /> Edit
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBox label="Active Projects"     value={activeProjectCount}                           color="blue"   />
        <StatBox label="Total Revenue"       value={`$${(totalRevenue ?? 0).toLocaleString()}`}   color="green"  />
        <StatBox label="Outstanding"         value={`$${(outstandingBalance ?? 0).toLocaleString()}`} color="yellow" />
        <StatBox label="Total Invoices"      value={invoices.length}                              color="purple" />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors ${
                tab === t
                  ? 'text-blue-600 border-b-2 border-blue-600 -mb-px'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* OVERVIEW */}
          {tab === 'Overview' && (
            <div className="grid lg:grid-cols-2 gap-8">
              <div className="space-y-5">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Contact Info</h3>
                <div className="space-y-4">
                  <InfoRow icon={Mail}     label="Email"    value={user?.email} />
                  <InfoRow icon={Phone}    label="Phone"    value={user?.phone} />
                  <InfoRow icon={Building2} label="Client Type" value={data.clientType === 'COMPANY' ? 'Company' : 'Individual'} />
                  {data.clientType === 'COMPANY' && <InfoRow icon={Building2} label="Contact Person" value={data.contactPerson} />}
                  <InfoRow icon={Globe}    label="Website"  value={data.website} />
                  <InfoRow icon={Building2} label="Industry" value={data.industry} />
                  <InfoRow icon={MapPin}   label="Location" value={[data.address, data.city, data.country].filter(Boolean).join(', ')} />
                  {data.vatNumber && <InfoRow icon={FileText} label="VAT Number" value={data.vatNumber} />}
                  {data.timezone  && <InfoRow icon={Clock}    label="Timezone"   value={data.timezone} />}
                </div>
              </div>
              <div className="space-y-5">
                {/* Portfolio / Linked companies */}
                {linkedClients.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
                      Portfolio — {linkedClients.length} linked {linkedClients.length === 1 ? 'company' : 'companies'}
                    </h3>
                    <div className="space-y-2">
                      {linkedClients.map(lc => (
                        <Link key={lc.id ?? lc._id} href={`/admin/clients/${lc.id ?? lc._id}`}
                          className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-violet-200 hover:bg-violet-50/40 transition-all group">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${lc.clientType === 'COMPANY' ? 'bg-violet-500' : 'bg-blue-500'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate group-hover:text-violet-700">
                              {lc.company || '(Individual)'}
                            </p>
                            <p className="text-xs text-gray-400">{lc.clientCode} · {lc.industry || lc.clientType}</p>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 text-gray-300 group-hover:text-violet-500 shrink-0" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Recent Activity</h3>
                {projects.slice(0, 3).map((p) => (
                  <Link key={p.id ?? p._id} href={`/admin/projects/${p.id ?? p._id}`} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                    <FolderOpen className="w-4 h-4 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                      {p.dueDate && <p className="text-xs text-gray-400">Due {new Date(p.dueDate).toLocaleDateString()}</p>}
                    </div>
                    <Badge status={p.status} />
                  </Link>
                ))}
                {projects.length === 0 && <p className="text-sm text-gray-400">No projects yet</p>}
              </div>
            </div>
          )}

          {/* PROJECTS */}
          {tab === 'Projects' && (
            projects.length === 0 ? (
              <div className="text-center py-12">
                <FolderOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500">No projects yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((p) => (
                  <Link key={p.id ?? p._id} href={`/admin/projects/${p.id ?? p._id}`} className="flex items-center gap-4 p-4 rounded-xl border border-gray-100 hover:border-blue-100 hover:bg-blue-50/30 transition-all">
                    <FolderOpen className="w-5 h-5 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{p.name}</p>
                      {p.description && <p className="text-xs text-gray-400 truncate mt-0.5">{p.description}</p>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {p.dueDate && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(p.dueDate).toLocaleDateString()}
                        </span>
                      )}
                      <Badge status={p.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )
          )}

          {/* INVOICES */}
          {tab === 'Invoices' && (
            invoices.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500">No invoices yet</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="pb-3 text-left text-xs font-semibold text-gray-500 uppercase">Invoice</th>
                    <th className="pb-3 text-left text-xs font-semibold text-gray-500 uppercase">Issued</th>
                    <th className="pb-3 text-left text-xs font-semibold text-gray-500 uppercase">Due</th>
                    <th className="pb-3 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
                    <th className="pb-3 text-left text-xs font-semibold text-gray-500 uppercase pl-6">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {invoices.map((inv) => (
                    <tr key={inv.id ?? inv._id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 text-sm font-medium text-blue-600">
                        <Link href={`/admin/invoices/${inv.id ?? inv._id}`}>{inv.invoiceNumber}</Link>
                      </td>
                      <td className="py-3 text-sm text-gray-500">{new Date(inv.issueDate).toLocaleDateString()}</td>
                      <td className="py-3 text-sm text-gray-500">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</td>
                      <td className="py-3 text-sm font-semibold text-gray-900 text-right">${inv.total.toLocaleString()}</td>
                      <td className="py-3 pl-6"><Badge status={inv.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {/* AGREEMENTS */}
          {tab === 'Agreements' && (
            agreements.length === 0 ? (
              <div className="text-center py-12">
                <FileCheck className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500">No agreements yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {agreements.map((a) => (
                  <div key={a.id ?? a._id} className="flex items-center gap-4 p-4 rounded-xl border border-gray-100">
                    <FileCheck className="w-5 h-5 text-purple-500 shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{a.title}</p>
                      {a.createdAt && <p className="text-xs text-gray-400 mt-0.5">{new Date(a.createdAt).toLocaleDateString()}</p>}
                    </div>
                    <Badge status={a.status} />
                  </div>
                ))}
              </div>
            )
          )}

          {/* KYC */}
          {tab === 'KYC' && (() => {
            const kyc = data.kyc ?? {}
            const status = kyc.status ?? 'NOT_SUBMITTED'
            const meta = KYC_STATUS_META[status] ?? KYC_STATUS_META.NOT_SUBMITTED
            return (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">KYC Verification</p>
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 ${meta.color}`}>{meta.label}</span>
                    </div>
                  </div>
                  <Link
                    href={`/admin/clients/${id}/kyc`}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Manage KYC
                  </Link>
                </div>

                {status === 'NOT_SUBMITTED' ? (
                  <div className="text-center py-10 bg-gray-50 rounded-xl">
                    <ShieldCheck className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">No KYC documents submitted yet.</p>
                    <Link href={`/admin/clients/${id}/kyc`} className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                      Go to KYC page →
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {kyc.documentType && (
                      <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-xl">
                        <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs text-gray-400">Document Type</p>
                          <p className="text-sm font-medium text-gray-900">{kyc.documentType?.replace('_', ' ')}</p>
                          {kyc.documentNumber && <p className="text-xs text-gray-500 mt-0.5">#{kyc.documentNumber}</p>}
                        </div>
                      </div>
                    )}
                    {kyc.primaryDoc && (
                      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                        <div className="flex items-center gap-3">
                          <FileCheck className="w-4 h-4 text-green-500 shrink-0" />
                          <p className="text-sm font-medium text-gray-900">Primary Document</p>
                        </div>
                        <a href={kyc.primaryDoc} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">View</a>
                      </div>
                    )}
                    {kyc.additionalDocs?.length > 0 && (
                      <div className="p-4 bg-gray-50 rounded-xl space-y-2">
                        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Additional Documents ({kyc.additionalDocs.length})</p>
                        {kyc.additionalDocs.map((doc, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <p className="text-sm text-gray-700">{doc.name || `Document ${i + 1}`}</p>
                            <a href={doc.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">View</a>
                          </div>
                        ))}
                      </div>
                    )}
                    {kyc.remarks && (
                      <div className="p-4 bg-yellow-50 rounded-xl">
                        <p className="text-xs font-medium text-yellow-700 mb-1">Admin Remarks</p>
                        <p className="text-sm text-gray-700">{kyc.remarks}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* DOCUMENTS */}
          {tab === 'Documents' && (
            documents.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-500">No documents yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {documents.map((d) => (
                  <div key={d.id ?? d._id} className="flex items-center gap-4 p-4 rounded-xl border border-gray-100">
                    <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{d.title ?? d.name}</p>
                      {d.createdAt && <p className="text-xs text-gray-400 mt-0.5">{new Date(d.createdAt).toLocaleDateString()}</p>}
                    </div>
                    {d.url && (
                      <a href={d.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">Open</a>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      <ClientModal
        open={editOpen}
        onOpenChange={setEditOpen}
        client={data}
        onSaved={handleSaved}
      />
    </div>
  )
}
