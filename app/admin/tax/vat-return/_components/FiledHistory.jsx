'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FileSpreadsheet, Pencil, Paperclip, RefreshCw, AlertTriangle } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import FileUpload from '@/components/ui/FileUpload'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardAction } from '@/components/ui/Card'
import { Input, Textarea, Field } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'
import { fmtAmount, fmtDay, readJson, RETURN_TYPE_LABELS } from '../_lib/format'

const STATUS_VARIANTS = {
  FILED:   'success',
  AMENDED: 'indigo',
  DRAFT:   'warning',
}

export function FilingStatusBadge({ status }) {
  if (!status) return null
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? 'default'}>
      {status === 'FILED' ? 'Filed' : status === 'AMENDED' ? 'Amended' : status === 'DRAFT' ? 'Draft' : status}
    </Badge>
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
      description={filing ? `${filing.periodKey} · figures stay as filed` : undefined}
    >
      <div className="space-y-4">
        <Field label="eVAT acknowledgement / submission no.">
          <Input value={ackNo} maxLength={80} onChange={e => setAckNo(e.target.value)} />
        </Field>
        <FileUpload value={attachmentUrl} onUploaded={setAttachmentUrl} label="Return copy / acknowledgement (PDF or image)" bucket="tax" />
        <Field label="Notes">
          <Textarea rows={3} className="resize-none" value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} />
        </Field>
        {error && (
          <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
            <p>{error}</p>
          </div>
        )}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={save} loading={saving}>Save</Button>
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
    <Card as="section" className="overflow-hidden">
      <CardHeader className="items-center pb-4">
        <CardTitle as="h2">Returns recorded</CardTitle>
        <CardAction>
          <Button variant="ghost" size="icon-sm" onClick={load} className="text-gray-500" aria-label="Refresh" title="Refresh">
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          </Button>
        </CardAction>
      </CardHeader>
      {loading && !rows.length ? (
        <LoadingSpinner className="border-t border-gray-100 py-10" />
      ) : error ? (
        <div className="border-t border-gray-100 px-5 py-8 text-center text-sm text-red-600">
          {error} <button type="button" onClick={load} className="ml-2 font-medium text-gray-900 underline underline-offset-4">Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileSpreadsheet}
          title="No returns recorded yet"
          description="Use File return after submitting on eVAT."
          className="border-t border-gray-100"
        />
      ) : (
        <>
          <Table className="min-w-[720px]" wrapperClassName="border-t border-gray-100">
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Filed on</TableHead>
                <TableHead>Acknowledgement</TableHead>
                <TableHead className="text-right">Net payable (50)</TableHead>
                <TableHead className="text-right">Closing (65)</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(f => (
                <TableRow
                  key={f.id}
                  className={cn('cursor-pointer', f.periodKey === currentKey && 'bg-gray-50')}
                  onClick={() => onSelect?.(f.periodStart, f.periodEnd)}
                >
                  <TableCell className="whitespace-nowrap font-medium text-gray-900">{f.periodKey}</TableCell>
                  <TableCell><FilingStatusBadge status={f.status} /></TableCell>
                  <TableCell className="whitespace-nowrap text-gray-600">
                    {f.status === 'DRAFT' ? '—' : (RETURN_TYPE_LABELS[f.returnType] ?? f.returnType)}
                    {f.historyCount > 0 && <span className="ml-1 text-xs text-muted-foreground">({f.historyCount} earlier)</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-gray-600">{f.filedAt ? fmtDay(f.filedAt) : '—'}</TableCell>
                  <TableCell className="text-gray-600">
                    <span className="font-mono text-xs">{f.acknowledgementNo || '—'}</span>
                    {f.attachmentUrl && (
                      <a href={f.attachmentUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="ml-2 inline-flex align-middle text-gray-400 hover:text-gray-900" aria-label="Open attachment">
                        <Paperclip className="size-3.5" />
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-gray-900">{fmtAmount(f.netPayable)}</TableCell>
                  <TableCell className="text-right tabular-nums text-gray-900">{fmtAmount(Math.max(0, (Number(f.closingBalance) || 0) - (Number(f.refundRequested) || 0)))}</TableCell>
                  <TableCell className="py-2 text-right">
                    {canFile && f.status !== 'DRAFT' && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={e => { e.stopPropagation(); setEditing(f) }}
                        className="text-gray-500"
                        aria-label="Edit acknowledgement"
                        title="Edit acknowledgement"
                      >
                        <Pencil />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {meta?.pages > 1 && (
            <div className="border-t border-gray-100 px-4 py-3">
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
    </Card>
  )
}
