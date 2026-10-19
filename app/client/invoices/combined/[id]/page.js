'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  Printer, FileText, Wallet, CheckCircle2, AlertCircle, AlertTriangle,
} from 'lucide-react'
import CombinedInvoicePrintView, { openCombinedInvoicePrint } from '@/components/shared/CombinedInvoicePrintView'
import { formatMoney } from '@/lib/currencies'
import PageHeader from '@/components/ui/PageHeader'
import Button, { buttonVariants } from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import StatsCard from '@/components/ui/StatsCard'
import { Card, CardHeader, CardTitle, CardFooter } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
// Amounts use the combined invoice's own currency (or each child's), never a fixed ৳.
const fmtAmt  = (n, cur) => formatMoney(n, cur)

const STATUS_MAP = {
  SENT:           { label: 'Awaiting payment', variant: 'primary' },
  PARTIALLY_PAID: { label: 'Partially paid',   variant: 'warning' },
  PAID:           { label: 'Paid',             variant: 'success' },
  OVERDUE:        { label: 'Overdue',          variant: 'danger'  },
  EMPTY:          { label: 'No invoices',      variant: 'default' },
}

const CHILD_BADGE = {
  SENT:           { label: 'Sent',           variant: 'primary' },
  PARTIALLY_PAID: { label: 'Partially paid', variant: 'warning' },
  PAID:           { label: 'Paid',           variant: 'success' },
  OVERDUE:        { label: 'Overdue',        variant: 'danger'  },
  CANCELLED:      { label: 'Cancelled',      variant: 'default' },
}

const PAYABLE = ['SENT', 'OVERDUE', 'PARTIALLY_PAID']

export default function ClientCombinedInvoicePage() {
  const { id }  = useParams()
  const router  = useRouter()
  const [combined, setCombined] = useState(null)
  const [company,  setCompany]  = useState({})
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/client/combined-invoices/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Not found')
      setCombined(json.data)
    } catch (err) {
      toast.error(err.message)
      router.push('/client/invoices')
    } finally {
      setLoading(false)
    }
  }, [id, router])

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

  if (loading) return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-4 w-20 rounded-md bg-gray-100" />
        <div className="h-7 w-48 rounded-md bg-gray-100" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-xl bg-gray-100" />)}
      </div>
      <div className="h-64 rounded-xl bg-gray-100" />
    </div>
  )

  if (!combined) return null

  const status     = STATUS_MAP[combined.status] ?? STATUS_MAP.SENT
  const t          = combined.totals ?? {}
  const project    = combined.projectId
  const payable    = (combined.children ?? []).filter(c => PAYABLE.includes(c.status))

  return (
    <div className="space-y-6">
      <PageHeader
        back="/client/invoices"
        backLabel="Invoices"
        title={combined.combinedNumber}
        meta={<Badge variant={status.variant}>{status.label}</Badge>}
        description={`Combined · ${project?.name ?? '—'}${project?.projectCode ? ` (${project.projectCode})` : ''}`}
        actions={
          <Button variant="outline" onClick={() => openCombinedInvoicePrint(combined.combinedNumber)}>
            <Printer /> Print / PDF
          </Button>
        }
      />

      {combined.mixedCurrency && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Mixed currencies — totals are added as-is, without conversion.
        </div>
      )}

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Invoices" value={String(t.invoiceCount ?? 0)} icon={FileText} />
        <StatsCard title="Total payable" value={fmtAmt(t.total, combined.currency)} icon={Wallet} />
        <StatsCard title="Total paid" value={fmtAmt(t.paidAmount, combined.currency)} icon={CheckCircle2} color="green" />
        <StatsCard title="Total due" value={fmtAmt(t.due, combined.currency)} icon={AlertCircle} color={t.due > 0.01 ? 'red' : 'green'} />
      </div>

      {t.total > 0 && (
        <Card className="p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-gray-900">Payment progress</span>
            <span className="text-[13px] tabular-nums text-muted-foreground">
              {fmtAmt(t.paidAmount, combined.currency)} of {fmtAmt(t.total, combined.currency)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${t.paidPct ?? 0}%` }} />
          </div>
          <p className="mt-1.5 text-xs font-medium tabular-nums text-emerald-600">{t.paidPct ?? 0}% paid</p>
        </Card>
      )}

      {/* Child invoices */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-gray-100 pb-3 pt-4">
          <CardTitle className="flex items-center gap-2">
            Invoices
            <span className="rounded-full bg-gray-100 px-1.5 text-[11px] font-medium leading-[18px] tabular-nums text-gray-600">
              {combined.children?.length ?? 0}
            </span>
          </CardTitle>
        </CardHeader>
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead className="text-right"><span className="sr-only">Action</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(combined.children ?? []).map(c => {
              const badge = CHILD_BADGE[c.status] ?? { label: c.status.replace(/_/g, ' '), variant: 'primary' }
              const canPay = PAYABLE.includes(c.status)
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <p className="font-medium text-gray-900">{c.invoiceNumber}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{fmtDate(c.issueDate)}</p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(c.dueDate)}</TableCell>
                  <TableCell><Badge variant={badge.variant}>{badge.label}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">{fmtAmt(c.total, c.currency)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-600">{fmtAmt(c.paidAmount, c.currency)}</TableCell>
                  <TableCell className={cn('whitespace-nowrap text-right font-medium tabular-nums', c.due > 0.01 ? 'text-red-600' : 'text-emerald-600')}>
                    {fmtAmt(c.due, c.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/client/invoices/${c.id}`}
                      className={buttonVariants({ variant: canPay ? 'outline' : 'ghost', size: 'xs' })}>
                      {canPay ? 'Pay' : 'View'}
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {payable.length > 0 && (
          <CardFooter className="text-xs text-muted-foreground">
            {payable.length} outstanding — payments are made per invoice.
          </CardFooter>
        )}
      </Card>

      {/* Document */}
      <Card className="overflow-hidden">
        <CombinedInvoicePrintView combined={combined} company={company} />
      </Card>
    </div>
  )
}
