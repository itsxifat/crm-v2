'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, CopyPlus, Power, Trash2, AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react'
import ActionMenu from '@/components/ui/ActionMenu'
import SearchInput from '@/components/ui/SearchInput'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { VAT_SERVICE_CODES, TDS_SECTIONS, vatTreatmentMeta, tdsRateText, RATES_VERIFIED_AS_OF } from '@/lib/tax/catalog'
import { invalidateTaxCodesCache } from '@/components/tax/TaxCodeSelect'
import TaxCodeModal from './TaxCodeModal'
import { readJson, fmtDay, todayKey, btnPrimary, btnGhost } from '../../vat-return/_lib/format'

const STATE_STYLES = {
  current:  'bg-emerald-50 text-emerald-700',
  upcoming: 'bg-blue-50 text-blue-700',
  past:     'bg-gray-100 text-gray-500',
  inactive: 'bg-red-50 text-red-600',
}
const STATE_LABELS = { current: 'Current', upcoming: 'Upcoming', past: 'Past', inactive: 'Inactive' }

/** Version state of a code row on `today`. */
function versionState(row, today, currentIds) {
  if (row.isActive === false) return 'inactive'
  if (row.effectiveFromDay && row.effectiveFromDay > today) return 'upcoming'
  if (row.effectiveToDay && row.effectiveToDay < today) return 'past'
  return currentIds.has(row.id) ? 'current' : 'past'
}

/** Catalog row (source / verify flag) matching a stored code version. */
function catalogMatch(kind, row) {
  const list = kind === 'VAT_SERVICE' ? VAT_SERVICE_CODES : TDS_SECTIONS
  return list.find(c => c.code === row.code && c.effectiveFrom === row.effectiveFromDay) ?? null
}

const pct = (v) => (v === null || v === undefined || v === '' ? '—' : `${Number(v)}%`)

/**
 * Effective-dated tax code table (VAT service codes or TDS sections) with
 * add / edit / new version / (de)activate / delete via /api/tax/codes.
 */
export default function TaxCodesTable({ kind, canEdit }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [modal, setModal] = useState(null) // { mode, row }
  const [confirm, setConfirm] = useState(null) // { action, row }
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const isVat = kind === 'VAT_SERVICE'
  const today = todayKey()

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tax/codes?kind=${kind}&all=1`)
      const json = await readJson(res)
      if (my === seq.current) setRows(Array.isArray(json.data) ? json.data : [])
    } catch (err) {
      if (my === seq.current) setError(err.message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [kind])

  useEffect(() => { load() }, [load])

  // The version effective today per code (active first, latest effectiveFrom wins).
  const currentIds = useMemo(() => {
    const byCode = new Map()
    for (const r of rows) {
      if (r.isActive === false) continue
      if (r.effectiveFromDay && r.effectiveFromDay > today) continue
      if (r.effectiveToDay && r.effectiveToDay < today) continue
      const prev = byCode.get(r.code)
      if (!prev || (r.effectiveFromDay ?? '') > (prev.effectiveFromDay ?? '')) byCode.set(r.code, r)
    }
    return new Set([...byCode.values()].map(r => r.id))
  }, [rows, today])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .map(r => ({ ...r, state: versionState(r, today, currentIds), catalog: catalogMatch(kind, r) }))
      .filter(r => showHistory || r.state === 'current' || r.state === 'upcoming')
      .filter(r => !q || [r.code, r.label, r.description, r.section].some(v => String(v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => (Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)) || a.code.localeCompare(b.code) ||
        String(b.effectiveFromDay ?? '').localeCompare(String(a.effectiveFromDay ?? '')))
  }, [rows, search, showHistory, today, currentIds, kind])

  const hiddenCount = rows.length - rows.filter(r => {
    const s = versionState(r, today, currentIds)
    return s === 'current' || s === 'upcoming'
  }).length

  async function runConfirm() {
    if (!confirm) return
    const { action, row } = confirm
    setBusy(true)
    try {
      if (action === 'delete') {
        const res = await fetch(`/api/tax/codes/${row.id}`, { method: 'DELETE' })
        const json = await readJson(res)
        toast.success(json.deactivated ? (json.message || 'Code deactivated') : 'Code deleted')
      } else {
        const res = await fetch(`/api/tax/codes/${row.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: action === 'activate' }),
        })
        await readJson(res)
        toast.success(action === 'activate' ? 'Code activated' : 'Code deactivated')
      }
      invalidateTaxCodesCache()
      setConfirm(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">{isVat ? 'VAT service codes' : 'TDS sections'}</h2>
          <p className="text-xs text-gray-500">
            {isVat
              ? 'VAT rate charged and VDS rate deducted at source, by service code (VAT & SD Act 2012, VDS Rules 2025).'
              : 'Income-tax withholding rates by section of the Income Tax Act 2023 (Withholding Tax Rules).'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search code or label" className="w-full sm:w-56" />
          <label className="inline-flex items-center gap-2 text-xs text-gray-600 whitespace-nowrap">
            <input type="checkbox" className="rounded border-gray-300" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} />
            Past &amp; inactive{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
          </label>
          <button type="button" onClick={load} className="p-2 rounded-lg text-gray-400 hover:text-gray-700" aria-label="Refresh">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
          {canEdit && (
            <button type="button" onClick={() => setModal({ mode: 'create', row: null })} className={btnPrimary}>
              <Plus className="w-4 h-4" /> Add
            </button>
          )}
        </div>
      </div>

      {loading && !rows.length ? (
        <LoadingSpinner className="py-12" />
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="Could not load tax codes" description={error}
          action={<button type="button" onClick={load} className={btnGhost}>Try again</button>} />
      ) : visible.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No codes match" description={search ? 'Try another search.' : 'Add a code, or show past and inactive versions.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100 bg-gray-50/60">
                <th className="text-left font-medium px-4 py-2">Code</th>
                {!isVat && <th className="text-left font-medium px-3 py-2">Section</th>}
                <th className="text-left font-medium px-3 py-2">Description</th>
                {isVat ? (
                  <>
                    <th className="text-right font-medium px-3 py-2">VAT</th>
                    <th className="text-right font-medium px-3 py-2">VDS</th>
                    <th className="text-left font-medium px-3 py-2">Treatment</th>
                  </>
                ) : (
                  <>
                    <th className="text-right font-medium px-3 py-2">Company</th>
                    <th className="text-right font-medium px-3 py-2">Individual</th>
                    <th className="text-left font-medium px-3 py-2">Basis</th>
                  </>
                )}
                <th className="text-left font-medium px-3 py-2">Effective</th>
                <th className="text-left font-medium px-3 py-2">Status</th>
                <th className="text-left font-medium px-3 py-2">Source · last verified</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.id ?? `${r.code}-${r.effectiveFromDay}`} className={cn('border-b border-gray-50 align-top', (r.state === 'past' || r.state === 'inactive') && 'text-gray-400')}>
                  <td className="px-4 py-2.5">
                    <p className="font-mono text-xs font-semibold text-gray-900">{r.code}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {r.isSystem && <span className="px-1.5 py-0.5 rounded bg-gray-100 text-[10px] text-gray-500">Built-in</span>}
                      {r.catalog?.verify && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-[10px] text-amber-800" title="Flagged for professional confirmation">Verify</span>
                      )}
                    </div>
                  </td>
                  {!isVat && <td className="px-3 py-2.5 whitespace-nowrap">s.{r.section}</td>}
                  <td className="px-3 py-2.5 max-w-[320px]">
                    <p className={cn('text-gray-800', (r.state === 'past' || r.state === 'inactive') && 'text-gray-400')}>{r.label}</p>
                    {r.description && <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{r.description}</p>}
                  </td>
                  {isVat ? (
                    <>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.vatRate)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{pct(r.vdsRate)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs">{vatTreatmentMeta(r.treatment)?.label ?? '—'}</td>
                    </>
                  ) : r.basis === 'COMMISSION_OR_GROSS' ? (
                    <td colSpan={3} className="px-3 py-2.5 text-xs">{tdsRateText(r)}</td>
                  ) : (
                    <>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.code === '86-SALARY' ? 'avg' : pct(r.rateCompany)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.code === '86-SALARY' ? 'avg' : pct(r.rateIndividual)}</td>
                      <td className="px-3 py-2.5 text-xs">Gross</td>
                    </>
                  )}
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                    {fmtDay(r.effectiveFromDay)}
                    <span className="text-gray-400"> → {r.effectiveToDay ? fmtDay(r.effectiveToDay) : 'open'}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold', STATE_STYLES[r.state])}>{STATE_LABELS[r.state]}</span>
                  </td>
                  <td className="px-3 py-2.5 max-w-[260px]">
                    <p className="text-[11px] text-gray-500 line-clamp-2" title={r.notes || ''}>{r.notes || '—'}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {r.isSystem && r.createdAt && r.updatedAt && Math.abs(new Date(r.updatedAt) - new Date(r.createdAt)) < 1000
                        ? `Built-in rate · verified ${fmtDay(RATES_VERIFIED_AS_OF)}`
                        : r.updatedAt ? `Changed ${fmtDay(r.updatedAt)}` : ''}
                    </p>
                  </td>
                  <td className="px-2 py-2.5">
                    {canEdit && r.id && (
                      <ActionMenu items={[
                        { label: 'Edit', icon: Pencil, onClick: () => setModal({ mode: 'edit', row: r }) },
                        { label: 'New rate version', icon: CopyPlus, onClick: () => setModal({ mode: 'version', row: r }) },
                        r.isActive === false
                          ? { label: 'Activate', icon: Power, onClick: () => setConfirm({ action: 'activate', row: r }) }
                          : { label: 'Deactivate', icon: Power, onClick: () => setConfirm({ action: 'deactivate', row: r }) },
                        !r.isSystem && { label: 'Delete', icon: Trash2, danger: true, onClick: () => setConfirm({ action: 'delete', row: r }) },
                      ].filter(Boolean)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TaxCodeModal
        open={!!modal}
        mode={modal?.mode ?? 'create'}
        kind={kind}
        row={modal?.row ?? null}
        onClose={() => setModal(null)}
        onSaved={() => { setModal(null); load() }}
      />

      <Modal
        open={!!confirm}
        onOpenChange={(v) => { if (!v && !busy) setConfirm(null) }}
        title={confirm?.action === 'delete' ? `Delete ${confirm?.row?.code}?` : confirm?.action === 'activate' ? `Activate ${confirm?.row?.code}?` : `Deactivate ${confirm?.row?.code}?`}
        size="sm"
      >
        <p className="text-sm text-gray-600">
          {confirm?.action === 'delete'
            ? 'The code version is removed. If it is already used on tax entries it is deactivated instead.'
            : confirm?.action === 'activate'
              ? 'The code will be offered again in invoice, expense and purchase forms.'
              : 'The code is no longer offered in forms. Entries that already use it are not changed.'}
        </p>
        <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5">
          <button type="button" onClick={() => setConfirm(null)} disabled={busy} className={btnGhost}>Cancel</button>
          <button
            type="button"
            onClick={runConfirm}
            disabled={busy}
            className={cn(btnPrimary, confirm?.action === 'delete' && 'bg-red-600 hover:bg-red-700')}
          >
            {confirm?.action === 'delete' ? 'Delete' : confirm?.action === 'activate' ? 'Activate' : 'Deactivate'}
          </button>
        </ModalFooter>
      </Modal>
    </section>
  )
}
