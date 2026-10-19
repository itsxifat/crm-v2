'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  Laptop, Monitor, Printer, Router, Server, Smartphone, Camera, AirVent, Armchair, Car, AppWindow, Mouse,
  BatteryCharging, Package, PackageCheck, TriangleAlert, Wrench, SearchX, Check, X, Loader2, RefreshCw,
  Boxes, CalendarClock, UserX, Flag, CircleAlert,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import FileUpload from '@/components/ui/FileUpload'
import EmptyState from '@/components/ui/EmptyState'
import AssetStatusBadge, { AssetConditionBadge, InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { ACK_META, safeLinkUrl } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'
const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'
const lc = 'block text-xs font-medium text-gray-600 mb-1'
const btnPrimary = 'inline-flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50'
const btnGhost = 'inline-flex items-center justify-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50'

const CATEGORY_ICONS = {
  LAP: Laptop, DSK: Monitor, MON: Monitor, PRN: Printer, NET: Router, SRV: Server, PHN: Smartphone,
  CAM: Camera, ACU: AirVent, FUR: Armchair, VEH: Car, SFT: AppWindow, ACC: Mouse, UPS: BatteryCharging,
}

const REPORT_TYPES = [
  { value: 'DAMAGE',      label: 'Damaged',     icon: TriangleAlert, hint: 'Cracked, dented, spilled on, dropped…', placeholder: 'What happened and when? Which part is damaged?' },
  { value: 'NOT_WORKING', label: 'Not working', icon: Wrench,        hint: 'Won’t turn on, keeps crashing, faulty part…', placeholder: 'What stopped working? Any error message?' },
  { value: 'LOST',        label: 'Lost / missing', icon: SearchX,    hint: 'Can’t find it, left it somewhere, stolen…', placeholder: 'Where and when did you last have it?' },
]

const REPORT_LABEL = { DAMAGE: 'damage', NOT_WORKING: 'a fault', LOST: 'it lost' }

function AssetIcon({ asset, className }) {
  const Icon = CATEGORY_ICONS[asset.category?.code] ?? Package
  if (safeLinkUrl(asset.imageUrl)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={safeLinkUrl(asset.imageUrl)} alt="" className={cn('object-cover rounded-xl bg-gray-50', className)} />
    )
  }
  return (
    <span className={cn('flex items-center justify-center rounded-xl bg-gray-50 text-gray-500', className)}>
      <Icon className="w-6 h-6" />
    </span>
  )
}

// ─── Acknowledge / decline ────────────────────────────────────────────────────

function AckModal({ target, onClose, onDone }) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const asset = target?.asset
  const decline = target?.decision === 'DECLINED'

  useEffect(() => { setNote('') }, [target])

  async function submit(e) {
    e?.preventDefault()
    if (decline && note.trim().length < 5) { toast.error('Tell us why you are declining (at least 5 characters)'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/my-assets/${asset.id}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: target.decision, note: note.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.details?.fieldErrors?.note?.[0] ?? json.error ?? 'Failed')
      toast.success(decline ? 'Declined — the inventory team has been told' : 'Thanks — receipt acknowledged')
      onDone(json.data)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!target} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="sm"
      title={decline ? 'Decline this item?' : 'Acknowledge receipt'}
      description={asset ? `${asset.assetTag} · ${asset.name}` : undefined}>
      {asset && (
        <form id="ack-form" onSubmit={submit} className="space-y-4">
          {decline ? (
            <p className="text-sm text-gray-600">
              Decline if you did not receive this item, or it is not what you were told you would get. The inventory team will follow up.
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              You confirm you have received this item{asset.condition ? <> in <strong>{asset.condition.toLowerCase()}</strong> condition</> : null} and will look after it as set out in the handover terms.
            </p>
          )}
          <div>
            <label className={lc}>{decline ? 'Reason' : 'Note (optional)'}{decline && <span className="text-red-500"> *</span>}</label>
            <textarea rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} className={ic}
              placeholder={decline ? 'e.g. I never received it / the screen was cracked when handed over' : 'e.g. Received with charger and bag'} />
          </div>
        </form>
      )}
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
        <button type="submit" form="ack-form" disabled={saving}
          className={decline ? 'inline-flex items-center gap-2 bg-red-600 text-white hover:bg-red-700 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50' : btnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {decline ? 'Decline' : 'I have received it'}
        </button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Report a problem ─────────────────────────────────────────────────────────

function ReportModal({ asset, onClose, onDone }) {
  const [type, setType] = useState('DAMAGE')
  const [description, setDescription] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setType('DAMAGE'); setDescription(''); setPhotoUrl('') }, [asset])

  const meta = REPORT_TYPES.find(t => t.value === type) ?? REPORT_TYPES[0]

  async function submit(e) {
    e?.preventDefault()
    if (description.trim().length < 5) { toast.error('Describe the problem (at least 5 characters)'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/my-assets/${asset.id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, description: description.trim(), photoUrl: photoUrl || null }),
      })
      const json = await res.json()
      if (!res.ok) {
        const fe = json.details?.fieldErrors
        throw new Error(fe?.description?.[0] ?? fe?.photoUrl?.[0] ?? json.error ?? 'Failed')
      }
      toast.success('Reported — the inventory team has been told')
      onDone(json.data.asset)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!asset} onOpenChange={(o) => { if (!o && !saving) onClose() }} size="md"
      title="Report a problem" description={asset ? `${asset.assetTag} · ${asset.name}` : undefined}>
      {asset && (
        <form id="report-form" onSubmit={submit} className="space-y-4">
          <div>
            <label className={lc}>What is wrong?</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {REPORT_TYPES.map(t => {
                const Icon = t.icon
                const active = t.value === type
                return (
                  <button key={t.value} type="button" onClick={() => setType(t.value)}
                    className={cn('flex sm:flex-col items-center sm:items-start gap-2 sm:gap-1 text-left rounded-xl border px-3 py-2.5 transition-colors',
                      active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 hover:bg-gray-50 text-gray-700')}>
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium">{t.label}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">{meta.hint}</p>
          </div>
          <div>
            <label className={lc}>Details <span className="text-red-500">*</span></label>
            <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000}
              className={ic} placeholder={meta.placeholder} />
          </div>
          <FileUpload label="Photo (optional)" value={photoUrl} onUploaded={setPhotoUrl} accept="image/*" bucket="assets" />
          {type === 'LOST' && (
            <div className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
              <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <p>If it was stolen, file a General Diary (GD) at the nearest police station and keep the GD number — the inventory team will ask for it.</p>
            </div>
          )}
          <p className="text-xs text-gray-400">The item stays in your name until the inventory team reviews your report.</p>
        </form>
      )}
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
        <button type="submit" form="report-form" disabled={saving} className={btnPrimary}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Send report
        </button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Asset card ───────────────────────────────────────────────────────────────

function AssetCard({ asset, onAck, onReport, highlight = false }) {
  const ack = asset.acknowledgement?.status ?? 'NOT_REQUIRED'
  const sub = [asset.category?.name, [asset.brand, asset.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  // Due on the return day itself (stored as Dhaka midnight) — overdue only from the next day.
  const overdue = asset.expectedReturnDate && new Date(asset.expectedReturnDate).getTime() + 24 * 60 * 60 * 1000 <= Date.now()

  return (
    <div id={`asset-${asset.id}`}
      className={cn('bg-white border rounded-xl p-4 flex flex-col scroll-mt-24 transition-shadow', ack === 'PENDING' ? 'border-amber-200' : 'border-gray-100',
        highlight && 'ring-2 ring-blue-500 ring-offset-2')}>
      <div className="flex items-start gap-3">
        <AssetIcon asset={asset} className="w-12 h-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-gray-500">{asset.assetTag}</p>
          <p className="text-sm font-semibold text-gray-900 truncate" title={asset.name}>{asset.name}</p>
          {sub && <p className="text-xs text-gray-500 truncate" title={sub}>{sub}</p>}
        </div>
        {asset.status !== 'ASSIGNED' && <AssetStatusBadge status={asset.status} />}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div className="min-w-0">
          <dt className="text-gray-400">Serial no.</dt>
          <dd className="font-mono text-gray-700 truncate" title={asset.serialNumber ?? ''}>{asset.serialNumber ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-400 mb-0.5">Condition</dt>
          <dd><AssetConditionBadge condition={asset.condition} /></dd>
        </div>
        <div>
          <dt className="text-gray-400">Issued</dt>
          <dd className="text-gray-700">{fmtDate(asset.assignedAt)}</dd>
        </div>
        <div>
          <dt className="text-gray-400">{asset.expectedReturnDate ? 'Return by' : 'Warranty until'}</dt>
          <dd className={cn('text-gray-700', overdue && 'text-red-600 font-medium')}>
            {fmtDate(asset.expectedReturnDate ?? asset.warrantyExpiry)}
          </dd>
        </div>
      </dl>

      {asset.specs && <p className="mt-2 text-xs text-gray-500 line-clamp-2 whitespace-pre-line">{asset.specs}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ack !== 'NOT_REQUIRED' && <InventoryBadge label={ACK_META[ack]?.label ?? ack} color={ACK_META[ack]?.color ?? 'gray'} />}
        {asset.lastReport && (
          <span className="inline-flex items-center gap-1 text-xs text-orange-700 bg-orange-50 px-2 py-1 rounded-md">
            <Flag className="w-3 h-3" /> You reported {REPORT_LABEL[asset.lastReport.type] ?? 'a problem'} · {fmtDate(asset.lastReport.date)}
          </span>
        )}
      </div>
      {ack === 'DECLINED' && asset.acknowledgement?.note && (
        <p className="mt-2 text-xs text-gray-500">Your reason: “{asset.acknowledgement.note}”</p>
      )}

      <div className="mt-auto pt-3">
        <div className="pt-3 border-t border-gray-100 flex flex-wrap gap-2">
          {ack === 'PENDING' && (
            <>
              <button type="button" onClick={() => onAck(asset, 'ACCEPTED')}
                className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-3 py-1.5 text-xs font-medium">
                <Check className="w-3.5 h-3.5" /> Accept
              </button>
              <button type="button" onClick={() => onAck(asset, 'DECLINED')} className={btnGhost}>
                <X className="w-3.5 h-3.5" /> Decline
              </button>
            </>
          )}
          {ack === 'DECLINED' && (
            <button type="button" onClick={() => onAck(asset, 'ACCEPTED')} className={btnGhost}>
              <Check className="w-3.5 h-3.5" /> Accept now
            </button>
          )}
          <button type="button" onClick={() => onReport(asset)} className={btnGhost}>
            <TriangleAlert className="w-3.5 h-3.5" /> Report a problem
          </button>
          <a href={`/api/my-assets/${asset.id}/handover`} target="_blank" rel="noreferrer" className={btnGhost}>
            <Printer className="w-3.5 h-3.5" /> Handover form
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function MyAssetsPage() {
  const focusId = useSearchParams().get('asset')
  const scrolledTo = useRef(null)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [ackTarget, setAckTarget]       = useState(null)   // { asset, decision }
  const [reportTarget, setReportTarget] = useState(null)   // asset

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/my-assets')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load your assets')
      setData(json.data)
    } catch (err) {
      setError(err.message || 'Failed to load your assets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Replace one asset in place after an action, then refresh counts quietly.
  function replaceAsset(updated) {
    if (!updated) return
    setData(d => d ? { ...d, assets: d.assets.map(a => (a.id === updated.id ? { ...a, ...updated, lastReport: updated.lastReport ?? a.lastReport } : a)) } : d)
    load(true)
  }

  const assets = data?.assets ?? []
  const pending = assets.filter(a => a.acknowledgement?.status === 'PENDING')
  const consumables = data?.consumables ?? []
  const focusFound = Boolean(focusId && assets.some(a => a.id === focusId))

  // Opened from a scanned label (/admin/my-assets?asset={id}): bring that card into view once.
  useEffect(() => {
    if (!focusFound || scrolledTo.current === focusId) return
    scrolledTo.current = focusId
    const t = setTimeout(() => {
      document.getElementById(`asset-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
    return () => clearTimeout(t)
  }, [focusFound, focusId])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">My Assets</h1>
          <p className="text-sm text-gray-500 mt-0.5">Equipment the company has issued to you</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => load()} disabled={loading} className={btnGhost} aria-label="Refresh">
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
          </button>
          {assets.length > 0 && (
            <a href="/api/my-assets/handover" target="_blank" rel="noreferrer" className={btnPrimary}>
              <Printer className="w-4 h-4" /> Print handover form
            </a>
          )}
        </div>
      </div>

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-xl bg-gray-100" />
                <div className="flex-1 space-y-2"><div className="h-3 bg-gray-100 rounded w-1/3" /><div className="h-4 bg-gray-100 rounded w-2/3" /></div>
              </div>
              <div className="h-16 bg-gray-50 rounded-lg mt-4" />
            </div>
          ))}
        </div>
      ) : error && !data ? (
        <div className="bg-white border border-gray-100 rounded-xl">
          <EmptyState icon={CircleAlert} title="Couldn’t load your assets" description={error}
            action={<button type="button" onClick={() => load()} className={btnPrimary}><RefreshCw className="w-4 h-4" /> Try again</button>} />
        </div>
      ) : !data?.employee ? (
        <div className="bg-white border border-gray-100 rounded-xl">
          <EmptyState icon={UserX} title="No employee profile linked"
            description="Your login is not linked to an employee record, so no equipment can be issued to you. Ask HR to link your account." />
        </div>
      ) : (
        <>
          {focusId && !focusFound && (
            <div className="flex items-start gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              <CircleAlert className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
              <p>The item you scanned is no longer issued to you. If you still have it, hand it to the inventory team.</p>
            </div>
          )}

          {pending.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <PackageCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-900">
                    {pending.length === 1 ? '1 item is' : `${pending.length} items are`} waiting for your acknowledgement
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">Check you have received each item, then accept it. Decline if something is wrong.</p>
                  <ul className="mt-3 space-y-2">
                    {pending.map(a => (
                      <li key={a.id} className="flex flex-wrap items-center gap-2 bg-white/70 border border-amber-100 rounded-lg px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 truncate">
                            <span className="font-mono text-xs text-gray-500 mr-1.5">{a.assetTag}</span>{a.name}
                          </p>
                          <p className="text-xs text-gray-500">Issued {fmtDate(a.assignedAt)}{a.serialNumber ? ` · S/N ${a.serialNumber}` : ''}</p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setAckTarget({ asset: a, decision: 'ACCEPTED' })}
                            className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-3 py-1.5 text-xs font-medium">
                            <Check className="w-3.5 h-3.5" /> Accept
                          </button>
                          <button type="button" onClick={() => setAckTarget({ asset: a, decision: 'DECLINED' })} className={cn(btnGhost, 'bg-white')}>
                            <X className="w-3.5 h-3.5" /> Decline
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {assets.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-xl">
              <EmptyState icon={Package} title="No equipment issued to you"
                description="When the company issues you a laptop, phone or other equipment it will appear here for you to acknowledge." />
            </div>
          ) : (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  Equipment <span className="font-normal text-gray-400">({assets.length})</span>
                </h2>
                {(data.summary?.inRepair > 0 || data.summary?.damaged > 0) && (
                  <p className="text-xs text-gray-400">
                    {[data.summary.inRepair ? `${data.summary.inRepair} in repair` : null, data.summary.damaged ? `${data.summary.damaged} damaged` : null].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {assets.map(a => (
                  <AssetCard key={a.id} asset={a} highlight={a.id === focusId}
                    onAck={(asset, decision) => setAckTarget({ asset, decision })}
                    onReport={(asset) => setReportTarget(asset)} />
                ))}
              </div>
            </section>
          )}

          <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <Boxes className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-700">Supplies issued to you</h2>
              <span className="text-xs text-gray-400">last {Math.min(consumables.length, 50)}</span>
            </div>
            {consumables.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">No stationery or other supplies have been issued to you yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Item</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Qty</th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Purpose</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {consumables.map(m => (
                      <tr key={m.id}>
                        <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1"><CalendarClock className="w-3 h-3" />{fmtDate(m.date)}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="text-gray-900">{m.item?.name ?? '—'}</p>
                          {m.item?.sku && <p className="text-xs text-gray-400 font-mono">{m.item.sku}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-800 whitespace-nowrap">{m.qty} {m.unit}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500">{[m.reason, m.reference].filter(Boolean).join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      <AckModal target={ackTarget} onClose={() => setAckTarget(null)}
        onDone={(asset) => { setAckTarget(null); replaceAsset(asset) }} />
      <ReportModal asset={reportTarget} onClose={() => setReportTarget(null)}
        onDone={(asset) => { setReportTarget(null); replaceAsset(asset) }} />
    </div>
  )
}

export default function MyAssetsPageWrapper() {
  return (
    <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}>
      <MyAssetsPage />
    </Suspense>
  )
}
