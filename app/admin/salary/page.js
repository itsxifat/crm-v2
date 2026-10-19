'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, Users, Clock, CheckCircle2, FileWarning,
  Plus, Trash2, X, Printer, Ban, ExternalLink, Banknote, AlertTriangle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import { Input, Label, Textarea, inputClass } from '@/components/ui/Input'
import TkAmt from '@/components/ui/TkAmt'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import SearchInput from '@/components/ui/SearchInput'
import FilterSelect from '@/components/ui/FilterSelect'
import Select from '@/components/ui/Select'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import StatsCard from '@/components/ui/StatsCard'
import ActionMenu from '@/components/ui/ActionMenu'
import { Can, usePermission } from '@/components/auth/Can'
import { useConfig } from '@/lib/useConfig'
import { currencyOptions, BASE_CURRENCY } from '@/lib/currencies'
import { amountToWords } from '@/lib/numberToWords'
import { cn, formatCurrency } from '@/lib/utils'
import { dhakaDayKey } from '@/lib/dhakaTime'

// ─── Period helpers ────────────────────────────────────────────────────────────

// Payroll periods follow the business timezone (Asia/Dhaka), like the API —
// not the browser's clock, which may sit in another month at a month boundary.
function currentPeriodKey() {
  return dhakaDayKey().slice(0, 7)
}
function periodLabel(period) {
  const [y, m] = String(period).split('-').map(Number)
  if (!y || !m) return period
  return new Date(y, m - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })
}
function shiftPeriod(period, delta) {
  const [y, m] = String(period).split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META = {
  NOT_GENERATED: { label: 'Not generated', variant: 'default' },
  PENDING:       { label: 'Pending',       variant: 'warning' },
  PAID:          { label: 'Paid',          variant: 'primary' },
  AUTHORIZED:    { label: 'Authorized',    variant: 'success' },
  REJECTED:      { label: 'Rejected',      variant: 'danger'  },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.NOT_GENERATED
  return <Badge variant={m.variant} dot>{m.label}</Badge>
}

// ─── Generate Salary Modal ────────────────────────────────────────────────────

let itemKey = 0

function GenerateSalaryModal({ open, onClose, employee, period, onGenerated }) {
  const [items,    setItems]    = useState([])
  const [currency, setCurrency] = useState(BASE_CURRENCY)
  const [amtBDT,   setAmtBDT]   = useState('')
  const [note,     setNote]     = useState('')
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    if (open) {
      setItems([])
      setCurrency(BASE_CURRENCY)
      setAmtBDT('')
      setNote('')
    }
  }, [open, employee])

  if (!employee) return null

  const baseSalary      = Number(employee.baseSalary) || 0
  const earningsTotal   = items.filter(i => i.type === 'EARNING').reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const deductionsTotal = items.filter(i => i.type === 'DEDUCTION').reduce((s, i) => s + (Number(i.amount) || 0), 0)
  // Income tax withheld at source on salary (ITA 2023 s.86) — part of the deductions.
  const taxTotal        = items.filter(i => i.type === 'DEDUCTION' && i.isTax).reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const gross = baseSalary + earningsTotal
  const net   = gross - deductionsTotal
  const isForeign = currency !== BASE_CURRENCY
  const netWords  = net > 0 ? amountToWords(isForeign ? Number(amtBDT) || 0 : net, isForeign ? BASE_CURRENCY : currency) : ''
  const missingTin = taxTotal > 0 && employee.hasTin === false

  function addItem(type) {
    setItems(list => [...list, { key: `new-${itemKey++}`, type, label: '', amount: '', isTax: false }])
  }
  function addTaxItem() {
    setItems(list => [...list, { key: `new-${itemKey++}`, type: 'DEDUCTION', label: 'Income tax (TDS)', amount: '', isTax: true }])
  }
  function updateItem(key, patch) {
    setItems(list => list.map(i => i.key === key ? { ...i, ...patch } : i))
  }
  function removeItem(key) {
    setItems(list => list.filter(i => i.key !== key))
  }

  async function submit() {
    if (net <= 0) { toast.error('Net pay must be greater than zero'); return }
    const invalid = items.some(i => !i.label.trim() || !(Number(i.amount) > 0))
    if (invalid) { toast.error('Every line needs a label and an amount greater than zero'); return }
    if (isForeign && baseSalary > 0) { toast.error("This employee's base salary is in BDT — generate the slip in BDT"); return }
    if (isForeign && !(Number(amtBDT) > 0)) { toast.error('Enter the BDT-equivalent for this foreign-currency salary'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/salary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: employee.id,
          period,
          items: items.map(i => ({
            type: i.type, label: i.label.trim(), amount: Number(i.amount),
            ...(i.type === 'DEDUCTION' && { isTax: !!i.isTax }),
          })),
          currency,
          amountBDT: isForeign ? Number(amtBDT) : undefined,
          note: note.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Salary slip generated')
      onGenerated(json.data)
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Row inputs sit side by side in a flex row; cn() lets the width override inputClass's w-full.
  const icRow = (extra) => cn(inputClass, extra)

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} title="Generate salary slip" size="lg"
      description={`${employee.name} · ${periodLabel(period)}`}>
      <div className="space-y-5">
        {/* Employee summary */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-gray-50 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={employee.name} src={employee.avatar} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{employee.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {employee.employeeId ?? '—'} · {employee.designation ?? employee.position ?? '—'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Base salary</p>
            <p className="text-base font-semibold tabular-nums text-gray-900">
              {baseSalary > 0 ? formatCurrency(baseSalary) : <span className="text-sm font-medium text-amber-700">Not set</span>}
            </p>
          </div>
        </div>
        {baseSalary <= 0 && (
          <p className="-mt-3 text-xs text-amber-700">
            No base salary on their profile — add it as an earning below or set it on the profile first.
          </p>
        )}

        {/* Earnings */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-900">Earnings</p>
            <Button variant="ghost" size="xs" onClick={() => addItem('EARNING')}>
              <Plus /> Add earning
            </Button>
          </div>
          <div className="space-y-2">
            {items.filter(i => i.type === 'EARNING').length === 0 && (
              <p className="text-xs text-muted-foreground">No earnings added</p>
            )}
            {items.filter(i => i.type === 'EARNING').map(item => (
              <div key={item.key} className="flex items-center gap-2">
                <input value={item.label} onChange={e => updateItem(item.key, { label: e.target.value })}
                  placeholder="e.g. Performance bonus" className={icRow('min-w-0 flex-1')} />
                <input type="number" value={item.amount} onChange={e => updateItem(item.key, { amount: e.target.value })}
                  placeholder="0.00" className={icRow('w-32 shrink-0')} />
                <Button variant="ghost" size="icon-sm" onClick={() => removeItem(item.key)} aria-label="Remove earning" className="text-gray-400 hover:text-red-600">
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Deductions */}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-900">Deductions</p>
            <div className="flex items-center gap-1">
              {!items.some(i => i.type === 'DEDUCTION' && i.isTax) && (
                <Button variant="ghost" size="xs" onClick={addTaxItem}>
                  <Plus /> Income tax
                </Button>
              )}
              <Button variant="ghost" size="xs" onClick={() => addItem('DEDUCTION')}>
                <Plus /> Add deduction
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {items.filter(i => i.type === 'DEDUCTION').length === 0 && (
              <p className="text-xs text-muted-foreground">No deductions added</p>
            )}
            {items.filter(i => i.type === 'DEDUCTION').map(item => (
              <div key={item.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                <input value={item.label} onChange={e => updateItem(item.key, { label: e.target.value })}
                  placeholder="e.g. Salary advance" aria-label="Deduction label"
                  className={icRow('w-full min-w-0 sm:w-auto sm:flex-1')} />
                <input type="number" min="0" step="0.01" value={item.amount} onChange={e => updateItem(item.key, { amount: e.target.value })}
                  placeholder="0.00" aria-label="Deduction amount" className={icRow('w-32 shrink-0')} />
                <label className={cn(
                  'flex h-9 shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
                  item.isTax ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-input text-gray-600 hover:bg-gray-50',
                )}
                  title="Income tax deducted at source on salary (ITA 2023 s.86) — recorded as TDS payable to the government">
                  <input type="checkbox" checked={!!item.isTax} onChange={e => updateItem(item.key, { isTax: e.target.checked })}
                    className="size-3.5 rounded" />
                  Income tax (TDS)
                </label>
                <Button variant="ghost" size="icon-sm" onClick={() => removeItem(item.key)} aria-label="Remove deduction"
                  className="ml-auto text-gray-400 hover:text-red-600 sm:ml-0">
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
          {taxTotal > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Recorded as TDS payable (ITA 2023 s.86) when paid — deposit it from Tax &amp; VAT → Withholding.
            </p>
          )}
          {missingTin && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              No e-TIN on file — add it to their profile so the Tofsil-1 certificate can be issued.
            </p>
          )}
        </div>

        {/* Currency */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Currency</Label>
            <Select value={currency} onChange={v => setCurrency(v ?? BASE_CURRENCY)} options={currencyOptions} />
          </div>
          {isForeign && baseSalary > 0 && (
            <p className="text-xs text-red-600 sm:col-span-2">
              Base salary is in BDT — generate this slip in BDT.
            </p>
          )}
          {isForeign && (
            <div>
              <Label required>Net pay in BDT</Label>
              <Input type="number" value={amtBDT} onChange={e => setAmtBDT(e.target.value)} placeholder="0.00" />
            </div>
          )}
        </div>

        {/* Note */}
        <div>
          <Label>Note</Label>
          <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Internal note…" className="min-h-0 resize-none" />
        </div>

        {/* Totals */}
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200/80">
          <div className="flex justify-between px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">Gross earnings</span>
            <span className="font-medium tabular-nums text-gray-900">{formatCurrency(gross, currency)}</span>
          </div>
          <div className="flex justify-between px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">Total deductions</span>
            <span className="font-medium tabular-nums text-red-600">−{formatCurrency(deductionsTotal, currency)}</span>
          </div>
          {taxTotal > 0 && (
            <div className="flex justify-between gap-3 bg-amber-50/50 px-4 py-2 text-xs">
              <span className="text-amber-800">of which income tax (TDS, s.86)</span>
              <span className="font-medium tabular-nums text-amber-800">{formatCurrency(taxTotal, currency)}</span>
            </div>
          )}
          <div className="flex items-center justify-between bg-gray-50 px-4 py-3">
            <span className="text-sm font-semibold text-gray-900">Net pay</span>
            <span className="text-lg font-semibold tabular-nums text-gray-900">{formatCurrency(net, currency)}</span>
          </div>
          {netWords && (
            <p className="bg-gray-50 px-4 py-2 text-xs italic text-muted-foreground">{netWords}</p>
          )}
        </div>
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} loading={saving} disabled={net <= 0 || (isForeign && baseSalary > 0)}>
          {!saving && <Banknote />} Generate slip
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SalaryPage() {
  const { can } = usePermission()
  const { ventureOptions } = useConfig()

  const [period,     setPeriod]     = useState(currentPeriodKey())
  const [search,     setSearch]     = useState('')
  const [department, setDepartment] = useState('')
  const [venture,    setVenture]    = useState('')
  const [status,     setStatus]     = useState('')
  const [page,       setPage]       = useState(1)
  const limit = 20

  const [departments, setDepartments] = useState([])
  const [rows,     setRows]     = useState([])
  const [meta,     setMeta]     = useState({ total: 0, pages: 1 })
  const [summary,  setSummary]  = useState({ totalEmployees: 0, notGenerated: 0, pending: 0, paidCount: 0, paidAmountBDT: 0 })
  const [loading,  setLoading]  = useState(true)
  const [genFor,   setGenFor]   = useState(null) // employee row → GenerateSalaryModal

  useEffect(() => {
    fetch('/api/departments').then(r => r.json()).then(j => setDepartments(j.data ?? [])).catch(() => {})
  }, [])

  // Only the latest request may update the table (filters/period can change
  // while an earlier fetch is still in flight).
  const loadSeq = useRef(0)
  const load = useCallback(() => {
    const seq = ++loadSeq.current
    setLoading(true)
    const p = new URLSearchParams({ period, page: String(page), limit: String(limit) })
    if (search)     p.set('search', search)
    if (department) p.set('department', department)
    if (venture)    p.set('venture', venture)
    if (status)     p.set('status', status)
    fetch(`/api/salary?${p.toString()}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Failed to load salary data')
        return j
      })
      .then(j => {
        if (seq !== loadSeq.current) return
        setRows(j.data ?? [])
        setMeta(j.meta ?? { total: 0, pages: 1 })
        setSummary(j.summary ?? {})
      })
      .catch(err => { if (seq === loadSeq.current) toast.error(err.message || 'Failed to load salary data') })
      .finally(() => { if (seq === loadSeq.current) setLoading(false) })
  }, [period, search, department, venture, status, page])

  // Reset to page 1 when a filter changes. Skip the fetch for the stale
  // (old page) combination in that same render; the page-1 fetch follows.
  const filterKey = [period, search, department, venture, status].join('|')
  const lastFilterKey = useRef(filterKey)
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey
      if (page !== 1) { setPage(1); return }
    }
    load()
  }, [load, filterKey, page])

  async function cancelSlip(row) {
    if (!confirm(`Cancel the salary slip for ${row.name} (${periodLabel(period)})? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/salary/${row.slip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Salary slip cancelled')
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const canPay = can('finance.salary.pay')

  const columns = [
    {
      key: 'name', label: 'Employee',
      render: (row) => (
        <Link href={`/admin/employees/${row.id}`} className="group/emp flex items-center gap-3">
          <Avatar name={row.name} src={row.avatar} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-gray-900 underline-offset-4 group-hover/emp:underline">{row.name}</p>
            <p className="truncate text-xs text-muted-foreground">{row.employeeId ?? '—'}</p>
          </div>
        </Link>
      ),
    },
    {
      key: 'department', label: 'Department / role',
      render: (row) => (
        <div>
          <p className="text-sm text-gray-700">{row.department ?? '—'}</p>
          <p className="text-xs text-muted-foreground">{row.designation ?? row.position ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'baseSalary', label: 'Base salary',
      className: 'text-right [&>div]:justify-end', cellClassName: 'text-right tabular-nums',
      render: (row) => typeof row.baseSalary === 'string'
        ? <span className="text-gray-400">{row.baseSalary}</span>
        : row.baseSalary > 0 ? <TkAmt value={row.baseSalary} /> : <span className="text-gray-300">—</span>,
    },
    {
      key: 'netPay', label: 'Net pay',
      className: 'text-right [&>div]:justify-end', cellClassName: 'text-right tabular-nums',
      render: (row) => row.slip
        ? (
          <div>
            <span className="font-semibold text-gray-900">{formatCurrency(row.slip.netPay, row.slip.currency)}</span>
            {Number(row.slip.taxDeduction) > 0 && (
              <p className="text-xs text-amber-700" title="Income tax deducted at source (ITA 2023 s.86)">
                TDS {formatCurrency(row.slip.taxDeduction, row.slip.currency)}
              </p>
            )}
          </div>
        )
        : <span className="text-gray-300">—</span>,
    },
    {
      key: 'salaryStatus', label: 'Status',
      render: (row) => <StatusBadge status={row.salaryStatus} />,
    },
    {
      key: 'actions', label: '', className: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <ActionMenu items={[
          row.salaryStatus === 'NOT_GENERATED' && canPay && {
            label: 'Generate slip', icon: Banknote, onClick: () => setGenFor(row),
          },
          row.slip && {
            label: 'View / print slip', icon: Printer,
            onClick: () => window.open(`/api/salary/${row.slip.id}/slip`, '_blank'),
          },
          row.salaryStatus === 'PENDING' && canPay && {
            label: 'Pay in accounts', icon: ExternalLink,
            href: '/admin/accounts?tab=requests',
          },
          row.salaryStatus === 'PENDING' && canPay && {
            label: 'Cancel slip', icon: Ban, danger: true, onClick: () => cancelSlip(row),
          },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary"
        actions={
          <div className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-input bg-white px-0.5 shadow-xs">
            <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => setPeriod(p => shiftPeriod(p, -1))} aria-label="Previous month">
              <ChevronLeft />
            </Button>
            <span className="min-w-[130px] px-2 text-center text-sm font-medium text-gray-900">{periodLabel(period)}</span>
            <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => setPeriod(p => shiftPeriod(p, 1))} disabled={period >= currentPeriodKey()} aria-label="Next month">
              <ChevronRight />
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Employees" value={summary.totalEmployees ?? 0} icon={Users} color="blue" />
        <StatsCard title="Not generated" value={summary.notGenerated ?? 0} icon={FileWarning} color="orange" />
        <StatsCard title="Awaiting payment" value={summary.pending ?? 0} icon={Clock} color="yellow" />
        <StatsCard title="Paid this period" value={formatCurrency(summary.paidAmountBDT ?? 0)}
          changeLabel={`${summary.paidCount ?? 0} employee(s)${Number(summary.taxDeductedBDT) > 0 ? ` · TDS ${formatCurrency(summary.taxDeductedBDT)}` : ''}`}
          icon={CheckCircle2} color="green" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="w-full sm:w-64" />
        <FilterSelect value={department} onChange={v => setDepartment(v ?? '')}
          options={departments.map(d => ({ value: d.shortCode, label: d.name }))} placeholder="All departments" />
        <FilterSelect value={venture} onChange={v => setVenture(v ?? '')}
          options={ventureOptions} placeholder="All ventures" />
        <FilterSelect value={status} onChange={v => setStatus(v ?? '')}
          options={Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }))}
          placeholder="All statuses" />
        {(search || department || venture || status) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setDepartment(''); setVenture(''); setStatus('') }}>
            <X /> Reset
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          emptyTitle="No employees found"
          emptyIcon={Banknote}
        />
        {meta.total > 0 && (
          <div className="border-t border-gray-100 px-4 py-3">
            <Pagination page={page} pages={meta.pages} total={meta.total} limit={limit} onPageChange={setPage} />
          </div>
        )}
      </Card>

      <Can perm="finance.salary.pay">
        <GenerateSalaryModal
          open={!!genFor}
          employee={genFor}
          period={period}
          onClose={() => setGenFor(null)}
          onGenerated={() => load()}
        />
      </Can>
    </div>
  )
}
