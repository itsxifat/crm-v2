'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, Users, Clock, CheckCircle2, FileWarning,
  Plus, Trash2, X, Loader2, Printer, Ban, ExternalLink, Banknote,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import Avatar from '@/components/ui/Avatar'
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
import { formatCurrency } from '@/lib/utils'

// ─── Period helpers ────────────────────────────────────────────────────────────

function currentPeriodKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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
  NOT_GENERATED: { label: 'Not Generated', bg: 'bg-gray-100',  text: 'text-gray-500',  dot: 'bg-gray-400'  },
  PENDING:       { label: 'Pending',       bg: 'bg-amber-50',  text: 'text-amber-700', dot: 'bg-amber-400' },
  PAID:          { label: 'Paid',          bg: 'bg-blue-50',   text: 'text-blue-700',  dot: 'bg-blue-500'  },
  AUTHORIZED:    { label: 'Authorized',    bg: 'bg-green-50',  text: 'text-green-700', dot: 'bg-green-500' },
  REJECTED:      { label: 'Rejected',      bg: 'bg-red-50',    text: 'text-red-700',   dot: 'bg-red-500'   },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.NOT_GENERATED
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium ${m.bg} ${m.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
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
  const gross = baseSalary + earningsTotal
  const net   = gross - deductionsTotal
  const isForeign = currency !== BASE_CURRENCY
  const netWords  = net > 0 ? amountToWords(isForeign ? Number(amtBDT) || 0 : net, isForeign ? BASE_CURRENCY : currency) : ''

  function addItem(type) {
    setItems(list => [...list, { key: `new-${itemKey++}`, type, label: '', amount: '' }])
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
    if (isForeign && !(Number(amtBDT) > 0)) { toast.error('Enter the BDT-equivalent for this foreign-currency salary'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/salary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: employee.id,
          period,
          items: items.map(i => ({ type: i.type, label: i.label.trim(), amount: Number(i.amount) })),
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

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'

  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} title="Generate Salary Slip" size="lg"
      description={`${employee.name} · ${periodLabel(period)}`}>
      <div className="space-y-5">
        {/* Employee summary */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={employee.name} src={employee.avatar} size="md" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{employee.name}</p>
              <p className="text-xs text-gray-500 truncate">
                {employee.employeeId ?? '—'} · {employee.designation ?? employee.position ?? '—'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-gray-400 uppercase tracking-wide">Base Salary</p>
            <p className="text-base font-bold text-gray-900">
              {baseSalary > 0 ? formatCurrency(baseSalary) : <span className="text-amber-600 font-medium text-sm">Not set</span>}
            </p>
          </div>
        </div>
        {baseSalary <= 0 && (
          <p className="text-xs text-amber-600 -mt-3">
            This employee has no base salary set on their profile. Add it as a custom earning below, or set it on their profile first.
          </p>
        )}

        {/* Earnings */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Earnings <span className="text-gray-400 normal-case">(bonus, commission, allowance…)</span></p>
            <button onClick={() => addItem('EARNING')} className="text-xs font-medium text-green-700 hover:text-green-800 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Add earning
            </button>
          </div>
          <div className="space-y-2">
            {items.filter(i => i.type === 'EARNING').length === 0 && (
              <p className="text-xs text-gray-400 italic">No extra earnings added.</p>
            )}
            {items.filter(i => i.type === 'EARNING').map(item => (
              <div key={item.key} className="flex items-center gap-2">
                <input value={item.label} onChange={e => updateItem(item.key, { label: e.target.value })}
                  placeholder="e.g. Performance Bonus" className={ic + ' flex-1'} />
                <input type="number" value={item.amount} onChange={e => updateItem(item.key, { amount: e.target.value })}
                  placeholder="Amount" className={ic + ' w-32'} />
                <button onClick={() => removeItem(item.key)} className="p-2 text-gray-400 hover:text-red-500 shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Deductions */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Deductions <span className="text-gray-400 normal-case">(advance, penalty, tax…)</span></p>
            <button onClick={() => addItem('DEDUCTION')} className="text-xs font-medium text-red-700 hover:text-red-800 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Add deduction
            </button>
          </div>
          <div className="space-y-2">
            {items.filter(i => i.type === 'DEDUCTION').length === 0 && (
              <p className="text-xs text-gray-400 italic">No deductions added.</p>
            )}
            {items.filter(i => i.type === 'DEDUCTION').map(item => (
              <div key={item.key} className="flex items-center gap-2">
                <input value={item.label} onChange={e => updateItem(item.key, { label: e.target.value })}
                  placeholder="e.g. Salary Advance" className={ic + ' flex-1'} />
                <input type="number" value={item.amount} onChange={e => updateItem(item.key, { amount: e.target.value })}
                  placeholder="Amount" className={ic + ' w-32'} />
                <button onClick={() => removeItem(item.key)} className="p-2 text-gray-400 hover:text-red-500 shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Currency */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
            <Select value={currency} onChange={v => setCurrency(v ?? BASE_CURRENCY)} options={currencyOptions} />
          </div>
          {isForeign && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Net pay in BDT <span className="text-red-500">*</span>
              </label>
              <input type="number" value={amtBDT} onChange={e => setAmtBDT(e.target.value)} placeholder="e.g. 50000" className={ic} />
            </div>
          )}
        </div>

        {/* Note */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Internal note for this payslip…" className={ic + ' resize-none'} />
        </div>

        {/* Totals */}
        <div className="rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-2.5 flex justify-between text-sm border-b border-gray-50">
            <span className="text-gray-500">Gross Earnings</span>
            <span className="font-medium text-gray-800">{formatCurrency(gross, currency)}</span>
          </div>
          <div className="px-4 py-2.5 flex justify-between text-sm border-b border-gray-50">
            <span className="text-gray-500">Total Deductions</span>
            <span className="font-medium text-red-600">−{formatCurrency(deductionsTotal, currency)}</span>
          </div>
          <div className="px-4 py-3 flex justify-between items-center bg-green-50">
            <span className="text-sm font-bold text-green-800">Net Pay</span>
            <span className="text-lg font-extrabold text-green-800">{formatCurrency(net, currency)}</span>
          </div>
          {netWords && (
            <p className="px-4 py-2 text-[11px] text-gray-500 italic bg-green-50/60 border-t border-green-100">{netWords}</p>
          )}
        </div>
      </div>

      <ModalFooter>
        <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
          Cancel
        </button>
        <button onClick={submit} disabled={saving || net <= 0}
          className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-1.5">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          <Banknote className="w-4 h-4" /> Generate Slip
        </button>
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

  const load = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams({ period, page: String(page), limit: String(limit) })
    if (search)     p.set('search', search)
    if (department) p.set('department', department)
    if (venture)    p.set('venture', venture)
    if (status)     p.set('status', status)
    fetch(`/api/salary?${p.toString()}`)
      .then(r => r.json())
      .then(j => {
        setRows(j.data ?? [])
        setMeta(j.meta ?? { total: 0, pages: 1 })
        setSummary(j.summary ?? {})
      })
      .catch(() => toast.error('Failed to load salary data'))
      .finally(() => setLoading(false))
  }, [period, search, department, venture, status, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [period, search, department, venture, status])

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
        <Link href={`/admin/employees/${row.id}`} className="flex items-center gap-3 hover:opacity-80">
          <Avatar name={row.name} src={row.avatar} size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{row.name}</p>
            <p className="text-xs text-gray-400 truncate">{row.employeeId ?? '—'}</p>
          </div>
        </Link>
      ),
    },
    {
      key: 'department', label: 'Department / Role',
      render: (row) => (
        <div>
          <p className="text-sm text-gray-700">{row.department ?? '—'}</p>
          <p className="text-xs text-gray-400">{row.designation ?? row.position ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'baseSalary', label: 'Base Salary',
      render: (row) => row.baseSalary > 0 ? <TkAmt value={row.baseSalary} /> : <span className="text-gray-300">—</span>,
    },
    {
      key: 'netPay', label: 'Net Pay',
      render: (row) => row.slip
        ? <span className="font-semibold text-gray-900">{formatCurrency(row.slip.netPay, row.slip.currency)}</span>
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
            label: 'Generate Slip', icon: Banknote, onClick: () => setGenFor(row),
          },
          row.slip && {
            label: 'View / Print Slip', icon: Printer,
            onClick: () => window.open(`/api/salary/${row.slip.id}/slip`, '_blank'),
          },
          row.salaryStatus === 'PENDING' && canPay && {
            label: 'Pay in Accounts →', icon: ExternalLink,
            href: '/admin/accounts?tab=confirmations',
          },
          row.salaryStatus === 'PENDING' && canPay && {
            label: 'Cancel Slip', icon: Ban, danger: true, onClick: () => cancelSlip(row),
          },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Salary</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage and pay employee salaries for the selected period.</p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-1 py-1">
          <button onClick={() => setPeriod(p => shiftPeriod(p, -1))} className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium text-gray-800 px-2 min-w-[130px] text-center">{periodLabel(period)}</span>
          <button onClick={() => setPeriod(p => shiftPeriod(p, 1))} disabled={period >= currentPeriodKey()}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Employees" value={summary.totalEmployees ?? 0} icon={Users} color="blue" />
        <StatsCard title="Not Generated" value={summary.notGenerated ?? 0} icon={FileWarning} color="orange" />
        <StatsCard title="Awaiting Payment" value={summary.pending ?? 0} icon={Clock} color="yellow" />
        <StatsCard title="Paid This Period" value={formatCurrency(summary.paidAmountBDT ?? 0)} changeLabel={`${summary.paidCount ?? 0} employee(s)`} icon={CheckCircle2} color="green" />
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search employee…" className="w-full sm:w-64" />
        <FilterSelect value={department} onChange={v => setDepartment(v ?? '')}
          options={departments.map(d => ({ value: d.shortCode, label: d.name }))} placeholder="All Departments" />
        <FilterSelect value={venture} onChange={v => setVenture(v ?? '')}
          options={ventureOptions} placeholder="All Ventures" />
        <FilterSelect value={status} onChange={v => setStatus(v ?? '')}
          options={Object.entries(STATUS_META).map(([value, m]) => ({ value, label: m.label }))}
          placeholder="All Statuses" />
        {(search || department || venture || status) && (
          <button onClick={() => { setSearch(''); setDepartment(''); setVenture(''); setStatus('') }}
            className="text-xs font-medium text-gray-500 hover:text-gray-800 flex items-center gap-1">
            <X className="w-3.5 h-3.5" /> Reset
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          emptyTitle="No employees found"
          emptyIcon={Banknote}
        />
        {meta.total > 0 && (
          <div className="px-4 py-3 border-t border-gray-50">
            <Pagination page={page} pages={meta.pages} total={meta.total} limit={limit} onPageChange={setPage} />
          </div>
        )}
      </div>

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
