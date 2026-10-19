'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, CopyPlus, Power, Trash2, AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react'
import ActionMenu from '@/components/ui/ActionMenu'
import SearchInput from '@/components/ui/SearchInput'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardTitle } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'
import { VAT_SERVICE_CODES, TDS_SECTIONS, vatTreatmentMeta, tdsRateText, RATES_VERIFIED_AS_OF } from '@/lib/tax/catalog'
import { invalidateTaxCodesCache } from '@/components/tax/TaxCodeSelect'
import TaxCodeModal from './TaxCodeModal'
import { readJson, fmtDay, todayKey } from '../../vat-return/_lib/format'

const STATE_VARIANTS = {
  current:  'success',
  upcoming: 'primary',
  past:     'default',
  inactive: 'danger',
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
    <Card as="section" className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-3 pl-5 md:flex-row md:items-center">
        <CardTitle as="h2" className="flex-1">{isVat ? 'VAT service codes' : 'TDS sections'}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="w-full sm:w-56" />
          <label className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] text-gray-600">
            <input type="checkbox" checked={showHistory} onChange={e => setShowHistory(e.target.checked)} />
            Past &amp; inactive{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
          </label>
          <Button variant="ghost" size="icon-sm" onClick={load} aria-label="Refresh" className="text-gray-500">
            <RefreshCw className={cn(loading && 'animate-spin')} />
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setModal({ mode: 'create', row: null })}>
              <Plus /> {isVat ? 'Add code' : 'Add section'}
            </Button>
          )}
        </div>
      </div>

      {loading && !rows.length ? (
        <LoadingSpinner className="py-12" />
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="Couldn’t load tax codes" description={error}
          action={<Button variant="outline" onClick={load}>Try again</Button>} />
      ) : visible.length === 0 ? (
        <EmptyState icon={ShieldCheck} title={search ? 'No results' : 'No current codes'} description={search ? undefined : 'Show past & inactive to see older versions.'} />
      ) : (
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              {!isVat && <TableHead>Section</TableHead>}
              <TableHead>Description</TableHead>
              {isVat ? (
                <>
                  <TableHead className="text-right">VAT</TableHead>
                  <TableHead className="text-right">VDS</TableHead>
                  <TableHead>Treatment</TableHead>
                </>
              ) : (
                <>
                  <TableHead className="text-right">Company</TableHead>
                  <TableHead className="text-right">Individual</TableHead>
                  <TableHead>Basis</TableHead>
                </>
              )}
              <TableHead>Effective</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Source · last verified</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map(r => {
              const muted = r.state === 'past' || r.state === 'inactive'
              return (
                <TableRow key={r.id ?? `${r.code}-${r.effectiveFromDay}`} className={cn('align-top', muted && '[&_td]:text-gray-400')}>
                  <TableCell>
                    <p className="font-mono text-xs font-semibold text-gray-900">{r.code}</p>
                    {(r.isSystem || r.catalog?.verify) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.isSystem && <Badge variant="outline">Built-in</Badge>}
                        {r.catalog?.verify && (
                          <span title="Flagged for professional confirmation"><Badge variant="warning">Verify</Badge></span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  {!isVat && <TableCell className="whitespace-nowrap">s.{r.section}</TableCell>}
                  <TableCell className="max-w-[320px]">
                    <p className={cn('text-gray-900', muted && 'text-gray-400')}>{r.label}</p>
                    {r.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>}
                  </TableCell>
                  {isVat ? (
                    <>
                      <TableCell className="text-right tabular-nums">{pct(r.vatRate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(r.vdsRate)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{vatTreatmentMeta(r.treatment)?.label ?? '—'}</TableCell>
                    </>
                  ) : r.basis === 'COMMISSION_OR_GROSS' ? (
                    <TableCell colSpan={3} className="text-xs">{tdsRateText(r)}</TableCell>
                  ) : (
                    <>
                      <TableCell className="text-right tabular-nums">{r.code === '86-SALARY' ? 'avg' : pct(r.rateCompany)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.code === '86-SALARY' ? 'avg' : pct(r.rateIndividual)}</TableCell>
                      <TableCell className="text-xs">Gross</TableCell>
                    </>
                  )}
                  <TableCell className="whitespace-nowrap text-xs">
                    {fmtDay(r.effectiveFromDay)}
                    <span className="text-gray-400"> → {r.effectiveToDay ? fmtDay(r.effectiveToDay) : 'open'}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATE_VARIANTS[r.state]}>{STATE_LABELS[r.state]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <p className="line-clamp-2 text-xs text-muted-foreground" title={r.notes || ''}>{r.notes || '—'}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {r.isSystem && r.createdAt && r.updatedAt && Math.abs(new Date(r.updatedAt) - new Date(r.createdAt)) < 1000
                        ? `Built-in rate · verified ${fmtDay(RATES_VERIFIED_AS_OF)}`
                        : r.updatedAt ? `Changed ${fmtDay(r.updatedAt)}` : ''}
                    </p>
                  </TableCell>
                  <TableCell className="px-2 text-right">
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
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
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
            ? 'This version is removed. If tax entries already use it, it’s deactivated instead.'
            : confirm?.action === 'activate'
              ? 'It will be offered in forms again.'
              : 'It won’t be offered in forms. Existing entries are unchanged.'}
        </p>
        <ModalFooter>
          <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
          <Button
            variant={confirm?.action === 'delete' ? 'destructive' : 'default'}
            onClick={runConfirm}
            loading={busy}
          >
            {confirm?.action === 'delete' ? 'Delete' : confirm?.action === 'activate' ? 'Activate' : 'Deactivate'}
          </Button>
        </ModalFooter>
      </Modal>
    </Card>
  )
}
