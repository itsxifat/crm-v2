'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Printer, RefreshCw, Layers, ExternalLink, Trash2,
  AlertTriangle, Save,
} from 'lucide-react'
import TkAmt from '@/components/ui/TkAmt'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Field, Textarea } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import CombinedInvoicePrintView, { openCombinedInvoicePrint } from '@/components/shared/CombinedInvoicePrintView'
import { usePermission } from '@/components/auth/Can'
import { cn } from '@/lib/utils'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_STYLES = {
  SENT:           { variant: 'primary', label: 'Awaiting payment' },
  PARTIALLY_PAID: { variant: 'warning', label: 'Partially paid' },
  PAID:           { variant: 'success', label: 'Paid' },
  OVERDUE:        { variant: 'danger',  label: 'Overdue' },
  EMPTY:          { variant: 'default', label: 'No issued invoices' },
}

const CHILD_BADGE = {
  DRAFT:          'default',
  SENT:           'primary',
  PARTIALLY_PAID: 'warning',
  PAID:           'success',
  OVERDUE:        'danger',
  CANCELLED:      'outline',
}

export default function CombinedInvoiceDetailPage() {
  const { id }   = useParams()
  const router   = useRouter()
  const { can }  = usePermission()

  const [combined, setCombined] = useState(null)
  const [company,  setCompany]  = useState({})
  const [loading,  setLoading]  = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [printMode,  setPrintMode]  = useState(false)
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [savingText, setSavingText] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    try {
      const res  = await fetch(`/api/combined-invoices/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setCombined(json.data)
      setNotes(json.data.notes ?? '')
      setTerms(json.data.terms ?? '')
    } catch (err) {
      toast.error(err.message ?? 'Failed to load')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/settings?group=company')
      .then(r => r.json())
      .then(j => {
        const d = j.data ?? {}
        setCompany({
          name:    d.company_name    ?? '',
          address: d.company_address ?? '',
          phone:   d.company_phone   ?? '',
          email:   d.company_email   ?? '',
          website: d.company_website ?? '',
          bin:     d.company_bin     ?? '',
          tin:     d.company_tin     ?? '',
        })
      })
      .catch(() => {})
  }, [])

  async function saveText() {
    setSavingText(true)
    try {
      const res  = await fetch(`/api/combined-invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, terms }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setCombined(json.data)
      toast.success('Saved')
    } catch (err) { toast.error(err.message) }
    finally { setSavingText(false) }
  }

  async function handleDelete() {
    if (!confirm(`Remove combined invoice ${combined?.combinedNumber}? The individual invoices are not affected.`)) return
    try {
      const res = await fetch(`/api/combined-invoices/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Combined invoice removed')
      router.push('/admin/invoices')
    } catch (err) { toast.error(err.message) }
  }

  if (loading) return <PageLoader />

  if (!combined) return (
    <EmptyState
      icon={Layers}
      title="Combined invoice not found"
      action={<Button variant="outline" size="sm" href="/admin/invoices">Back to invoices</Button>}
    />
  )

  const s = STATUS_STYLES[combined.status] ?? STATUS_STYLES.SENT
  const t = combined.totals ?? {}
  const project = combined.projectId

  if (printMode) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="outline" onClick={() => setPrintMode(false)}>
            <ArrowLeft /> Back
          </Button>
          <Button onClick={() => openCombinedInvoicePrint(combined.combinedNumber)}>
            <Printer /> Print / save PDF
          </Button>
        </div>
        <CombinedInvoicePrintView combined={combined} company={company} />
      </div>
    )
  }

  const childCount = combined.children?.length ?? 0

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        back={project?.id ? `/admin/projects/${project.id}` : '/admin/invoices'}
        backLabel={project?.id ? 'Project' : 'Invoices'}
        title={combined.combinedNumber}
        meta={
          <>
            <Badge variant={s.variant} dot>{s.label}</Badge>
            <Badge variant="outline"><Layers className="size-3" /> Combined · {childCount} invoices</Badge>
          </>
        }
        description={
          <>
            {project?.projectCode ? `${project.projectCode} · ` : ''}{project?.name ?? '—'}
            {combined.clientId?.company ? ` · ${combined.clientId.company}` : ''}
          </>
        }
        actions={
          <>
            {can('sales.invoices.delete') && (
              <Button variant="ghost" onClick={handleDelete} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                <Trash2 /> Remove
              </Button>
            )}
            <Button variant="outline" onClick={() => load(true)} disabled={refreshing}
              title="Figures are recalculated from the child invoices on every load.">
              <RefreshCw className={cn(refreshing && 'animate-spin')} /> Refresh
            </Button>
            <Button variant="outline" onClick={() => setPrintMode(true)}>
              <Printer /> Print / PDF
            </Button>
          </>
        }
      />

      {combined.mixedCurrency && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Invoices use more than one currency — amounts are summed with no FX conversion.
        </div>
      )}

      {/* Totals + collection progress */}
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: 'Invoices',      node: <span className="text-gray-900">{t.invoiceCount ?? 0}</span> },
            { label: 'Total payable', node: <TkAmt value={t.total} decimals={2} />, cls: 'text-gray-900' },
            { label: 'Total paid',    node: <TkAmt value={t.paidAmount} decimals={2} />, cls: 'text-emerald-600' },
            { label: 'Total due',     node: <TkAmt value={t.due} decimals={2} />, cls: t.due > 0.01 ? 'text-red-600' : 'text-emerald-600' },
          ].map(c => (
            <div key={c.label}>
              <p className="text-[13px] font-medium text-muted-foreground">{c.label}</p>
              <p className={cn('mt-1 text-2xl font-semibold tracking-tight tabular-nums', c.cls ?? 'text-gray-900')}>{c.node}</p>
            </div>
          ))}
        </div>

        {t.total > 0 && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${t.paidPct ?? 0}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-xs">
              <span className="font-medium text-emerald-600">{t.paidPct ?? 0}% collected</span>
              {t.due > 0.01 && <span className="font-medium text-amber-700">Outstanding <TkAmt value={t.due} decimals={2} /></span>}
            </div>
          </div>
        )}
      </Card>

      {/* Child invoices */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-gray-100 pb-4">
          <div>
            <CardTitle>Included invoices ({childCount})</CardTitle>
            {combined.excludedCount > 0 && (
              <CardDescription>
                {combined.excludedCount} draft or cancelled invoice{combined.excludedCount === 1 ? '' : 's'} excluded from totals
              </CardDescription>
            )}
          </div>
        </CardHeader>
        {childCount === 0 ? (
          <EmptyState icon={Layers} title="No issued invoices yet" className="py-10" />
        ) : (
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                {['Invoice no.', 'Issued', 'Due date', 'Status', 'Amount', 'Paid', 'Due', ''].map((h, i) => (
                  <TableHead key={h + i} className={i >= 4 && i <= 6 ? 'text-right' : 'text-left'}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {combined.children.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-mono text-[13px] font-medium text-gray-900">{c.invoiceNumber}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(c.issueDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(c.dueDate)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={CHILD_BADGE[c.status] ?? CHILD_BADGE.DRAFT}>
                      {c.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium text-gray-900"><TkAmt value={c.total} decimals={2} /></TableCell>
                  <TableCell className="whitespace-nowrap text-right text-emerald-600"><TkAmt value={c.paidAmount} decimals={2} /></TableCell>
                  <TableCell className={cn('whitespace-nowrap text-right font-medium', c.due > 0.01 ? 'text-red-600' : 'text-emerald-600')}>
                    <TkAmt value={c.due} decimals={2} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="xs" href={`/admin/invoices/${c.id}`}>
                      Open <ExternalLink />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Notes & terms */}
      {can('sales.invoices.update') && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Notes & terms</CardTitle>
              <CardDescription>Shown on the combined document only</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Notes (visible to client)">
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="resize-none" />
              </Field>
              <Field label="Payment terms">
                <Textarea value={terms} onChange={e => setTerms(e.target.value)} rows={3} className="resize-none" />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button onClick={saveText} loading={savingText}>
                {!savingText && <Save />} Save
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Document preview */}
      <Card className="overflow-hidden">
        <CombinedInvoicePrintView combined={combined} company={company} />
      </Card>
    </div>
  )
}
