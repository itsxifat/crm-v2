'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { History, Pencil, Paperclip, Loader2, RefreshCw } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import FileUpload from '@/components/ui/FileUpload'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'
import { fmtAmount, fmtDay, readJson, RETURN_TYPE_LABELS, inputCls, labelCls, btnPrimary, btnGhost } from '../_lib/format'

const STATUS_STYLES = {
  FILED:   'bg-emerald-50 text-emerald-700',
  AMENDED: 'bg-indigo-50 text-indigo-700',
  DRAFT:   'bg-amber-50 text-amber-700',
}

export function FilingStatusBadge({ status }) {
  if (!status) return null
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold', STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600')}>
      {status === 'FILED' ? 'Filed' : status === 'AMENDED' ? 'Amended' : status === 'DRAFT' ? 'Draft' : status}
    </span>
  )
}

/** Edit the acknowledgement no., attachment and notes of a filing (figures stay frozen). */
export function FilingEditModal({ filing, onClose, onSaved }) {
  const [ackNo, setAckNo] = useState('')
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!filing) return
    setAckNo(filing.acknowledgementNo ?? '')
    setAttachmentUrl(filing.attachmentUrl ?? '')
    setNotes(filing.notes ?? '')
    setError(null)
  }, [filing])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/tax/filings/${filing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledgementNo: ackNo.trim() || null, attachmentUrl: attachmentUrl || null, notes: notes.trim() || null }),
      })
      const json = await readJson(res)
      toast.success('Filing updated')
      onSaved?.(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!filing}
      onOpenChange={(v) => { if (!v && !saving) onClose() }}
      title="Filing details"
      description={filing ? `${filing.periodKey} · the figures stay as filed` : undefined}
    >
      <div className="space-y-4">
        <div>
          <label className={labelCls}>eVAT acknowledgement / submission no.</label>
          <input className={inputCls} value={ackNo} maxLength={80} onChange={e => setAckNo(e.target.value)} />
        </div>
        <FileUpload value={attachmentUrl} onUploaded={setAttachmentUrl} label="Return copy / acknowledgement (PDF or image)" bucket="tax" />
        <div>
          <label className={labelCls}>Notes</label>
          <textarea rows={3} className={`${inputCls} resize-none`} value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5">
        <button type="button" onClick={onClose} disabled={saving} className={btnGhost}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} className={btnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
        </button>
      </ModalFooter>
    </Modal>
  )
}

/** Table of VAT returns recorded in the system (newest period first). */
export default function FiledHistory({ refreshKey, currentKey, canFile, onSelect, onChanged }) {
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tax/filings?kind=VAT_RETURN&page=${page}&limit=12`)
      const json = await readJson(res)
      if (my !== seq.current) return
      setRows(json.data ?? [])
      setMeta(json.meta ?? null)
    } catch (err) {
      if (my === seq.current) setError(err.message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [page])

  useEffect(() => { load() }, [load, refreshKey])

  return (
    <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Returns recorded</h2>
        </div>
        <button type="button" onClick={load} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50" aria-label="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {loading && !rows.length ? (
        <LoadingSpinner className="py-10" />
      ) : error ? (
        <div className="px-4 py-8 text-center text-sm text-red-600">
          {error} <button type="button" onClick={load} className="ml-2 underline">Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-gray-500">
          No VAT returns recorded yet. After submitting a return on the eVAT portal, use <span className="font-medium">File return</span> to record it here.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <th className="text-left font-medium px-4 py-2">Period</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-left font-medium px-3 py-2">Type</th>
                  <th className="text-left font-medium px-3 py-2">Filed on</th>
                  <th className="text-left font-medium px-3 py-2">Acknowledgement</th>
                  <th className="text-right font-medium px-3 py-2">Net payable (50)</th>
                  <th className="text-right font-medium px-3 py-2">Closing (65)</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {rows.map(f => (
                  <tr
                    key={f.id}
                    className={cn('border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer', f.periodKey === currentKey && 'bg-blue-50/40')}
                    onClick={() => onSelect?.(f.periodStart, f.periodEnd)}
                  >
                    <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">{f.periodKey}</td>
                    <td className="px-3 py-2"><FilingStatusBadge status={f.status} /></td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                      {f.status === 'DRAFT' ? '—' : (RETURN_TYPE_LABELS[f.returnType] ?? f.returnType)}
                      {f.historyCount > 0 && <span className="ml-1 text-[11px] text-gray-400">({f.historyCount} earlier)</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{f.filedAt ? fmtDay(f.filedAt) : '—'}</td>
                    <td className="px-3 py-2 text-gray-600">
                      <span className="font-mono text-xs">{f.acknowledgementNo || '—'}</span>
                      {f.attachmentUrl && (
                        <a href={f.attachmentUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="ml-2 inline-flex text-gray-400 hover:text-gray-700" aria-label="Open attachment">
                          <Paperclip className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtAmount(f.netPayable)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtAmount(Math.max(0, (Number(f.closingBalance) || 0) - (Number(f.refundRequested) || 0)))}</td>
                    <td className="px-3 py-2 text-right">
                      {canFile && f.status !== 'DRAFT' && (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setEditing(f) }}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                          aria-label="Edit acknowledgement"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meta?.pages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100">
              <Pagination meta={meta} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
      <FilingEditModal
        filing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); onChanged?.() }}
      />
    </section>
  )
}
