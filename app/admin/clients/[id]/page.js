'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, FolderOpen, FileText, FileCheck,
  Pencil, ShieldCheck, ExternalLink, Link2,
  FileEdit, Plus, Ban, RotateCcw, AlertTriangle, ChevronRight,
} from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/Card'
import Tabs from '@/components/ui/Tabs'
import StatsCard from '@/components/ui/StatsCard'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import ClientModal from '@/components/admin/clients/ClientModal'
import { usePermission } from '@/components/auth/Can'
import ClientMembersPanel from '@/components/admin/clients/ClientMembersPanel'
import CustomerCompaniesPanel from '@/components/admin/clients/CustomerCompaniesPanel'
import { BIN_REGEX, normalizeBin } from '@/lib/tax/catalog'
import { isVatQuotation } from '@/lib/quotation'

const VAT_REG_LABELS = {
  REGISTERED:   'VAT registered',
  TURNOVER:     'Turnover tax enlisted',
  UNREGISTERED: 'Not VAT registered',
  FOREIGN:      'Foreign / overseas',
}

function TaxItem({ label, value, mono = false, hint = null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-medium break-all ${value ? 'text-gray-900' : 'text-gray-300'} ${mono && value ? 'font-mono' : ''}`}>
        {value || '—'}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-amber-600">{hint}</p>}
    </div>
  )
}

// Tax identity of the client: BIN / e-TIN / VAT status and the tax the client
// withholds from our payments (VDS / TDS).
function TaxIdentityCard({ data, tdsLabel, onEdit }) {
  // Legacy records kept the BIN in vatNumber — show it as the BIN.
  const legacyDigits = data.vatNumber ? String(data.vatNumber).replace(/\s+/g, '') : ''
  const legacyIsBin  = !!legacyDigits && BIN_REGEX.test(legacyDigits)
  const legacyBin    = !data.bin && legacyIsBin ? (normalizeBin(legacyDigits) || legacyDigits) : null
  const bin          = data.bin || legacyBin
  // The old VAT number is only a separate ID when it is not this BIN (after a
  // legacy BIN is saved as `bin`, vatNumber still holds the same number).
  const otherTaxId = legacyBin || (legacyIsBin && normalizeBin(legacyDigits) === normalizeBin(data.bin))
    ? null : data.vatNumber
  const hasAny = !!(bin || data.tin || data.vatRegistrationType || data.isVdsEntity || data.isTdsEntity || otherTaxId || data.taxNotes)
  const binMissing = !bin && ['REGISTERED', 'TURNOVER'].includes(data.vatRegistrationType)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tax &amp; VAT</CardTitle>
        <CardAction>
          <Button variant="outline" size="xs" onClick={onEdit}>
            {hasAny ? <Pencil /> : <Plus />}
            {hasAny ? 'Edit' : 'Add'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <p className="text-sm text-muted-foreground" title="Add the BIN so VAT invoices (Mushak-6.3) show it and the client can claim input VAT.">
            No BIN or TIN yet.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TaxItem label="BIN" value={bin} mono hint={legacyBin ? 'From the old VAT number field' : null} />
              <TaxItem label="TIN (e-TIN)" value={data.tin} mono />
              <TaxItem label="VAT status" value={VAT_REG_LABELS[data.vatRegistrationType] ?? null} />
              {otherTaxId && <TaxItem label="Foreign VAT / tax ID" value={otherTaxId} mono />}
            </div>

            <div className="flex flex-wrap gap-2">
              {data.isVdsEntity && (
                <Badge variant="warning">Withholds VAT at source (VDS)</Badge>
              )}
              {data.isTdsEntity && (
                <Badge variant="indigo">
                  Deducts TDS{data.defaultTdsSection ? ` · ${tdsLabel || data.defaultTdsSection}` : ''}
                </Badge>
              )}
              {!data.isVdsEntity && !data.isTdsEntity && (
                <span className="text-xs text-muted-foreground">No VDS or TDS withheld from our payments</span>
              )}
            </div>

            {binMissing && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <AlertTriangle className="size-4 shrink-0" />
                Marked VAT registered but no BIN on file.
              </div>
            )}

            {data.taxNotes && (
              <p className="whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">{data.taxNotes}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const TABS = ['Overview', 'People', 'Companies', 'Projects', 'Invoices', 'Proposals', 'Agreements', 'Documents', 'KYC']

const KYC_STATUS_META = {
  NOT_SUBMITTED: { label: 'Not submitted',  variant: 'default' },
  PENDING:       { label: 'Pending review', variant: 'warning' },
  VERIFIED:      { label: 'Verified',       variant: 'success' },
  REJECTED:      { label: 'Rejected',       variant: 'danger'  },
}

const QUOTATION_VARIANT = { ACCEPTED: 'success', REJECTED: 'danger', SENT: 'primary' }

function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-gray-900">{value}</dd>
    </div>
  )
}

/** Bordered list wrapper used by the list-style tabs. */
function ListBox({ children }) {
  return <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200/80">{children}</div>
}

const listRow = 'flex items-center gap-3 transition-colors hover:bg-gray-50/70'

export default function ClientDetailPage() {
  const { id }   = useParams()
  const router   = useRouter()
  const [data,        setData]        = useState(null)
  const [quotations,  setQuotations]  = useState([])
  const [loading,     setLoading]     = useState(true)
  const [tab,         setTab]         = useState('Overview')
  const [editOpen,    setEditOpen]    = useState(false)
  const [editTab,     setEditTab]     = useState('basic')
  const [tdsLabel,    setTdsLabel]    = useState(null)
  // PATCH /api/clients/[id]/status is SUPER_ADMIN-only
  const { role } = usePermission()
  const canToggleStatus = role === 'SUPER_ADMIN'

  async function load() {
    try {
      const [clientRes, quotRes] = await Promise.all([
        fetch(`/api/clients/${id}`),
        fetch(`/api/quotations?clientId=${id}&limit=50`),
      ])
      const json = await clientRes.json()
      if (!clientRes.ok) throw new Error(json.error)
      setData(json.data)
      if (quotRes.ok) {
        const quotJson = await quotRes.json()
        setQuotations(quotJson.data ?? [])
      }
    } catch (err) {
      toast.error(err.message ?? 'Failed to load client')
    } finally {
      setLoading(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [id])

  // Human label for the client's default TDS section (falls back to the code).
  const tdsCode = data?.defaultTdsSection ?? null
  useEffect(() => {
    if (!tdsCode) { setTdsLabel(null); return }
    let alive = true
    fetch('/api/tax/codes?kind=TDS_SECTION')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!alive) return
        const hit = (Array.isArray(j?.data) ? j.data : []).find(c => c.code === tdsCode)
        setTdsLabel(hit ? `${hit.code} — ${hit.label}` : tdsCode)
      })
      .catch(() => { if (alive) setTdsLabel(tdsCode) })
    return () => { alive = false }
  }, [tdsCode])

  function openEdit(tabId = 'basic') {
    setEditTab(tabId)
    setEditOpen(true)
  }

  function handleSaved() {
    toast.success('Client updated')
    load()
  }

  async function toggleActive(isActive) {
    const verb = isActive ? 'Reactivate' : 'Deactivate'
    if (!confirm(`${verb} this client? ${isActive ? 'They will regain portal access.' : 'They will lose portal access.'}`)) return
    try {
      const res = await fetch(`/api/clients/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success(isActive ? 'Client reactivated' : 'Client deactivated')
      load()
    } catch (err) {
      toast.error(err.message ?? `Failed to ${verb.toLowerCase()}`)
    }
  }

  if (loading) {
    return <PageLoader />
  }

  if (!data) {
    return (
      <EmptyState
        title="Client not found"
        action={<Button variant="outline" href="/admin/clients"><ArrowLeft /> Back to clients</Button>}
      />
    )
  }

  const { userId: user, projects = [], invoices = [], documents = [], agreements = [], linkedClients = [], totalRevenue, outstandingBalance, activeProjectCount, kyc } = data
  const kycStatus = kyc?.status ?? 'NOT_SUBMITTED'
  const isActive  = data.isActive !== false && user?.isActive !== false
  const kycMeta = KYC_STATUS_META[kycStatus] ?? KYC_STATUS_META.NOT_SUBMITTED

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <button
            onClick={() => router.back()}
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-gray-900"
          >
            <ArrowLeft className="size-3.5" /> Back
          </button>
          <div className="flex items-center gap-4">
            <Avatar name={user?.name} src={user?.avatar} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-gray-900">{user?.name}</h1>
                {data.clientCode && (
                  <Badge variant="outline" className="font-mono">{data.clientCode}</Badge>
                )}
                <Badge variant={data.clientType === 'COMPANY' ? 'purple' : 'default'}>
                  {data.clientType === 'COMPANY' ? 'Company' : 'Individual'}
                </Badge>
                <Badge variant={isActive ? 'success' : 'default'} dot>
                  {isActive ? 'Active' : 'Inactive'}
                </Badge>
                <Badge variant={kycMeta.variant}>KYC: {kycMeta.label}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                {data.company && <span className="text-gray-700">{data.company}</span>}
                <span>
                  Client since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'}
                </span>
                {data.parentClientId && (
                  <Link href={`/admin/clients/${data.parentClientId._id ?? data.parentClientId.id}`}
                    className="inline-flex items-center gap-1 font-medium text-gray-900 hover:underline underline-offset-4">
                    <Link2 className="size-3.5 text-gray-400" />
                    Linked to {data.parentClientId.company || data.parentClientId.userId?.name || 'parent'}
                  </Link>
                )}
                {linkedClients.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Link2 className="size-3.5 text-gray-400" />
                    {linkedClients.length} linked {linkedClients.length === 1 ? 'company' : 'companies'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!canToggleStatus ? null : isActive ? (
            <Button variant="outline" onClick={() => toggleActive(false)} className="text-red-600 hover:text-red-700">
              <Ban /> Deactivate
            </Button>
          ) : (
            <Button variant="outline" onClick={() => toggleActive(true)}>
              <RotateCcw /> Reactivate
            </Button>
          )}
          <Button variant="outline" onClick={() => openEdit('basic')}>
            <Pencil /> Edit
          </Button>
          <Button href={`/admin/projects/new?clientId=${id}`}>
            <FolderOpen /> New project
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard title="Active projects" value={activeProjectCount} />
        <StatsCard title="Total revenue"   value={`৳ ${(totalRevenue ?? 0).toLocaleString()}`} />
        <StatsCard title="Outstanding"     value={`৳ ${(outstandingBalance ?? 0).toLocaleString()}`} />
        <StatsCard title="Total invoices"  value={invoices.length} />
      </div>

      {/* Tabs */}
      <Tabs
        variant="underline"
        value={tab}
        onChange={setTab}
        tabs={TABS.map(t => ({ value: t, label: t }))}
      />

      {/* OVERVIEW */}
      {tab === 'Overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Contact info</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y divide-gray-100">
                  <InfoRow label="Email"    value={user?.email} />
                  <InfoRow label="Phone"    value={user?.phone} />
                  <InfoRow label="Client type" value={data.clientType === 'COMPANY' ? 'Company' : 'Individual'} />
                  {data.clientType === 'COMPANY' && <InfoRow label="Contact person" value={data.contactPerson} />}
                  <InfoRow label="Website"  value={data.website} />
                  <InfoRow label="Industry" value={data.industry} />
                  <InfoRow label="Location" value={[data.address, data.city, data.country].filter(Boolean).join(', ')} />
                  {data.timezone && <InfoRow label="Timezone" value={data.timezone} />}
                </dl>
              </CardContent>
            </Card>
            <TaxIdentityCard data={data} tdsLabel={tdsLabel} onEdit={() => openEdit('tax')} />
          </div>
          <div className="space-y-6">
            {/* Portfolio / Linked companies */}
            {linkedClients.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>
                    Portfolio · {linkedClients.length} linked {linkedClients.length === 1 ? 'company' : 'companies'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ListBox>
                    {linkedClients.map(lc => (
                      <Link key={lc.id ?? lc._id} href={`/admin/clients/${lc.id ?? lc._id}`} className={`${listRow} group px-4 py-3`}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {lc.company || '(Individual)'}
                          </p>
                          <p className="text-xs text-muted-foreground">{lc.clientCode} · {lc.industry || lc.clientType}</p>
                        </div>
                        <ExternalLink className="size-4 shrink-0 text-gray-300 group-hover:text-gray-600" />
                      </Link>
                    ))}
                  </ListBox>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Recent projects</CardTitle>
              </CardHeader>
              <CardContent>
                {projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No projects yet</p>
                ) : (
                  <ListBox>
                    {projects.slice(0, 3).map((p) => (
                      <Link key={p.id ?? p._id} href={`/admin/projects/${p.id ?? p._id}`} className={`${listRow} px-4 py-3`}>
                        <FolderOpen className="size-4 shrink-0 text-gray-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
                          {p.deadline && <p className="text-xs text-muted-foreground">Due {new Date(p.deadline).toLocaleDateString()}</p>}
                        </div>
                        <Badge status={p.status} />
                      </Link>
                    ))}
                  </ListBox>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* PEOPLE — customers who can access THIS company */}
      {tab === 'People' && (
        <Card className="p-5">
          <ClientMembersPanel clientId={id} />
        </Card>
      )}

      {/* COMPANIES — companies THIS customer can access */}
      {tab === 'Companies' && (
        <Card className="p-5">
          <CustomerCompaniesPanel clientId={id} />
        </Card>
      )}

      {/* PROJECTS */}
      {tab === 'Projects' && (
        <Card className="overflow-hidden">
          {projects.length === 0 ? (
            <EmptyState icon={FolderOpen} title="No projects yet" />
          ) : (
            <div className="divide-y divide-gray-100">
              {projects.map((p) => (
                <Link key={p.id ?? p._id} href={`/admin/projects/${p.id ?? p._id}`} className={`${listRow} px-5 py-3.5`}>
                  <FolderOpen className="size-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
                    {p.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {p.deadline && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {new Date(p.deadline).toLocaleDateString()}
                      </span>
                    )}
                    <Badge status={p.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* INVOICES */}
      {tab === 'Invoices' && (
        <Card className="overflow-hidden">
          {invoices.length === 0 ? (
            <EmptyState icon={FileText} title="No invoices yet" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pl-6">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id ?? inv._id}>
                    <TableCell>
                      <Link href={`/admin/invoices/${inv.id ?? inv._id}`} className="font-medium text-gray-900 hover:underline underline-offset-4">
                        {inv.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{new Date(inv.issueDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</TableCell>
                    <TableCell className="text-right font-medium text-gray-900 tabular-nums">{inv.currency && inv.currency !== 'BDT' ? `${inv.currency} ` : '৳'}{Number(inv.total ?? 0).toLocaleString()}</TableCell>
                    <TableCell className="pl-6"><Badge status={inv.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* PROPOSALS */}
      {tab === 'Proposals' && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
            <p className="text-[13px] text-muted-foreground">{quotations.length} proposal{quotations.length !== 1 ? 's' : ''}</p>
            <Link
              href={`/admin/quotations/new?sourceType=CLIENT&clientId=${id}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Plus />
              New proposal
            </Link>
          </div>
          {quotations.length === 0 ? (
            <EmptyState icon={FileEdit} title="No proposals yet" />
          ) : (
            <div className="divide-y divide-gray-100">
              {quotations.map((q) => (
                <Link
                  key={q.id}
                  href={`/admin/quotations/${q.id}`}
                  className={`${listRow} justify-between px-5 py-3.5`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <FileEdit className="size-4 shrink-0 text-gray-400" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{q.quotationNumber}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {q.issueDate ? new Date(q.issueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        {q.validUntil ? ` · valid until ${new Date(q.validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-right">
                      <span className="block text-sm font-medium text-gray-900 tabular-nums">
                        {q.currency === 'BDT' ? '৳' : q.currency} {(q.total ?? 0).toLocaleString()}
                      </span>
                      {isVatQuotation(q) && (
                        <span className="block text-[11px] text-muted-foreground">
                          {Number(q.vatAmount) > 0 ? 'incl. VAT'
                            : q.vatTreatment === 'ZERO_RATED' ? 'Zero-rated'
                            : q.vatTreatment === 'EXEMPT' ? 'VAT exempt' : 'No VAT charged'}
                        </span>
                      )}
                    </span>
                    <Badge variant={QUOTATION_VARIANT[q.status] ?? 'default'}>{q.status}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* AGREEMENTS */}
      {tab === 'Agreements' && (
        <Card className="overflow-hidden">
          {agreements.length === 0 ? (
            <EmptyState icon={FileCheck} title="No agreements yet" />
          ) : (
            <div className="divide-y divide-gray-100">
              {agreements.map((a) => (
                <div key={a.id ?? a._id} className="flex items-center gap-3 px-5 py-3.5">
                  <FileCheck className="size-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{a.title}</p>
                    {a.createdAt && <p className="mt-0.5 text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleDateString()}</p>}
                  </div>
                  <Badge status={a.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* KYC */}
      {tab === 'KYC' && (() => {
        const kyc = data.kyc ?? {}
        const status = kyc.status ?? 'NOT_SUBMITTED'
        const meta = KYC_STATUS_META[status] ?? KYC_STATUS_META.NOT_SUBMITTED
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>KYC verification</CardTitle>
                <Badge variant={meta.variant}>{meta.label}</Badge>
              </div>
              <CardAction>
                <Link
                  href={`/admin/clients/${id}/kyc`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <ShieldCheck />
                  Manage KYC
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              {status === 'NOT_SUBMITTED' ? (
                <EmptyState
                  icon={ShieldCheck}
                  title="No KYC documents yet"
                  className="rounded-lg bg-gray-50 py-10"
                  action={
                    <Link href={`/admin/clients/${id}/kyc`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                      Go to KYC page <ChevronRight />
                    </Link>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {(kyc.documentType || kyc.primaryDoc || kyc.additionalDocs?.length > 0) && (
                    <ListBox>
                      {kyc.documentType && (
                        <div className="flex items-start gap-3 px-4 py-3">
                          <FileText className="mt-0.5 size-4 shrink-0 text-gray-400" />
                          <div>
                            <p className="text-xs text-muted-foreground">Document type</p>
                            <p className="text-sm font-medium text-gray-900">{kyc.documentType?.replace('_', ' ')}</p>
                            {kyc.documentNumber && <p className="mt-0.5 text-xs text-muted-foreground">#{kyc.documentNumber}</p>}
                          </div>
                        </div>
                      )}
                      {kyc.primaryDoc && (
                        <div className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="flex items-center gap-3">
                            <FileCheck className="size-4 shrink-0 text-emerald-600" />
                            <p className="text-sm font-medium text-gray-900">Primary document</p>
                          </div>
                          <a href={kyc.primaryDoc} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-gray-900 hover:underline underline-offset-4">View</a>
                        </div>
                      )}
                      {kyc.additionalDocs?.length > 0 && (
                        <div className="space-y-2 px-4 py-3">
                          <p className="text-xs font-medium text-muted-foreground">Additional documents ({kyc.additionalDocs.length})</p>
                          {kyc.additionalDocs.map((doc, i) => (
                            <div key={i} className="flex items-center justify-between gap-3">
                              <p className="text-sm text-gray-700">{doc.name || `Document ${i + 1}`}</p>
                              <a href={doc.url} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-gray-900 hover:underline underline-offset-4">View</a>
                            </div>
                          ))}
                        </div>
                      )}
                    </ListBox>
                  )}
                  {kyc.remarks && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                      <p className="mb-0.5 text-xs font-medium">Admin remarks</p>
                      <p>{kyc.remarks}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })()}

      {/* DOCUMENTS */}
      {tab === 'Documents' && (
        <Card className="overflow-hidden">
          {documents.length === 0 ? (
            <EmptyState icon={FileText} title="No documents yet" />
          ) : (
            <div className="divide-y divide-gray-100">
              {documents.map((d) => (
                <div key={d.id ?? d._id} className="flex items-center gap-3 px-5 py-3.5">
                  <FileText className="size-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{d.title ?? d.name}</p>
                    {d.createdAt && <p className="mt-0.5 text-xs text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</p>}
                  </div>
                  {d.fileUrl && /^(\/|https?:\/\/)/i.test(d.fileUrl) && (
                    <a href={d.fileUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'ghost', size: 'xs' })}>
                      Open <ExternalLink />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <ClientModal
        open={editOpen}
        onOpenChange={setEditOpen}
        client={data}
        initialTab={editTab}
        onSaved={handleSaved}
      />
    </div>
  )
}
