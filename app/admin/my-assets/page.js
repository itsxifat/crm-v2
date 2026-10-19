'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  Laptop, Monitor, Printer, Router, Server, Smartphone, Camera, AirVent, Armchair, Car, AppWindow, Mouse,
  BatteryCharging, Package, TriangleAlert, Wrench, SearchX, Check, X, RefreshCw,
  Boxes, UserX, Flag, CircleAlert,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import FileUpload from '@/components/ui/FileUpload'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import Button, { buttonVariants } from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Textarea, Label, Field } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import AssetStatusBadge, { AssetConditionBadge, InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { ACK_META, safeLinkUrl } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'

const CATEGORY_ICONS = {
  LAP: Laptop, DSK: Monitor, MON: Monitor, PRN: Printer, NET: Router, SRV: Server, PHN: Smartphone,
  CAM: Camera, ACU: AirVent, FUR: Armchair, VEH: Car, SFT: AppWindow, ACC: Mouse, UPS: BatteryCharging,
}

const REPORT_TYPES = [
  { value: 'DAMAGE',      label: 'Damaged',     icon: TriangleAlert, hint: 'Cracked, dented, spilled on, dropped…', placeholder: 'What happened, and which part is damaged?' },
  { value: 'NOT_WORKING', label: 'Not working', icon: Wrench,        hint: 'Won’t turn on, keeps crashing, faulty part…', placeholder: 'What stopped working? Any error message?' },
  { value: 'LOST',        label: 'Lost / missing', icon: SearchX,    hint: 'Can’t find it, left it somewhere, stolen…', placeholder: 'Where and when did you last have it?' },
]

const REPORT_LABEL = { DAMAGE: 'damage', NOT_WORKING: 'a fault', LOST: 'it lost' }

function AssetIcon({ asset, className }) {
  const Icon = CATEGORY_ICONS[asset.category?.code] ?? Package
  if (safeLinkUrl(asset.imageUrl)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={safeLinkUrl(asset.imageUrl)} alt="" className={cn('rounded-lg border border-gray-200/80 bg-gray-50 object-cover', className)} />
    )
  }
  return (
    <span className={cn('flex items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs', className)}>
      <Icon className="size-5 text-gray-500" />
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
    if (decline && note.trim().length < 5) { toast.error('Reason must be at least 5 characters'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/my-assets/${asset.id}/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: target.decision, note: note.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.details?.fieldErrors?.note?.[0] ?? json.error ?? 'Couldn’t save')
      toast.success(decline ? 'Declined — inventory team notified' : 'Receipt acknowledged')
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
              Decline if you didn’t receive this item or it isn’t what you were promised.
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              You confirm you received this item{asset.condition ? <> in <span className="font-medium text-gray-900">{asset.condition.toLowerCase()}</span> condition</> : null} and will look after it per the handover terms.
            </p>
          )}
          <Field label={decline ? 'Reason' : 'Note (optional)'} required={decline} htmlFor="ack-note">
            <Textarea id="ack-note" rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={1000}
              placeholder={decline ? 'e.g. Screen was cracked on handover' : 'e.g. Received with charger and bag'} />
          </Field>
        </form>
      )}
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="ack-form" variant={decline ? 'destructive' : 'default'} loading={saving}>
          {decline ? 'Decline' : 'I have received it'}
        </Button>
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
    if (description.trim().length < 5) { toast.error('Details must be at least 5 characters'); return }
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
        throw new Error(fe?.description?.[0] ?? fe?.photoUrl?.[0] ?? json.error ?? 'Couldn’t send report')
      }
      toast.success('Report sent')
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
            <Label>What’s wrong?</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {REPORT_TYPES.map(t => {
                const Icon = t.icon
                const active = t.value === type
                return (
                  <button key={t.value} type="button" onClick={() => setType(t.value)} title={t.hint} aria-pressed={active}
                    className={cn('flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                      active ? 'border-gray-900 bg-gray-50 text-gray-900 ring-1 ring-gray-900' : 'border-gray-200/80 text-gray-700 hover:bg-gray-50')}>
                    <Icon className={cn('size-4 shrink-0', active ? 'text-gray-900' : 'text-gray-500')} />
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
          <Field label="Details" required htmlFor="report-details">
            <Textarea id="report-details" rows={4} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000}
              placeholder={meta.placeholder} />
          </Field>
          <FileUpload label="Photo (optional)" value={photoUrl} onUploaded={setPhotoUrl} accept="image/*" bucket="assets" />
          {type === 'LOST' && (
            <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <p>If stolen, file a General Diary (GD) at the nearest police station and keep the GD number.</p>
            </div>
          )}
        </form>
      )}
      <ModalFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="report-form" loading={saving}
          title="The item stays in your name until the inventory team reviews your report">
          Send report
        </Button>
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
    <Card id={`asset-${asset.id}`}
      className={cn('flex scroll-mt-24 flex-col p-5 transition-shadow', ack === 'PENDING' && 'border-amber-200',
        highlight && 'ring-2 ring-brand ring-offset-2')}>
      <div className="flex items-start gap-3">
        <AssetIcon asset={asset} className="size-10 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-muted-foreground">{asset.assetTag}</p>
          <p className="truncate text-sm font-semibold text-gray-900" title={asset.name}>{asset.name}</p>
          {sub && <p className="truncate text-xs text-muted-foreground" title={sub}>{sub}</p>}
        </div>
        {asset.status !== 'ASSIGNED' && <AssetStatusBadge status={asset.status} />}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Serial no.</dt>
          <dd className="truncate font-mono text-gray-900" title={asset.serialNumber ?? ''}>{asset.serialNumber ?? '—'}</dd>
        </div>
        <div>
          <dt className="mb-0.5 text-muted-foreground">Condition</dt>
          <dd><AssetConditionBadge condition={asset.condition} /></dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Issued</dt>
          <dd className="text-gray-900">{fmtDate(asset.assignedAt)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{asset.expectedReturnDate ? 'Return by' : 'Warranty until'}</dt>
          <dd className={cn('text-gray-900', overdue && 'font-medium text-red-600')}>
            {fmtDate(asset.expectedReturnDate ?? asset.warrantyExpiry)}
          </dd>
        </div>
      </dl>

      {asset.specs && <p className="mt-3 line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">{asset.specs}</p>}

      {(ack !== 'NOT_REQUIRED' || asset.lastReport) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {ack !== 'NOT_REQUIRED' && <InventoryBadge label={ACK_META[ack]?.label ?? ack} color={ACK_META[ack]?.color ?? 'gray'} />}
          {asset.lastReport && (
            <Badge variant="orange">
              <Flag className="size-3" /> You reported {REPORT_LABEL[asset.lastReport.type] ?? 'a problem'} · {fmtDate(asset.lastReport.date)}
            </Badge>
          )}
        </div>
      )}
      {ack === 'DECLINED' && asset.acknowledgement?.note && (
        <p className="mt-2 text-xs text-muted-foreground">Your reason: “{asset.acknowledgement.note}”</p>
      )}

      <div className="mt-auto pt-4">
        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4">
          {ack === 'PENDING' && (
            <>
              <Button size="xs" onClick={() => onAck(asset, 'ACCEPTED')}>
                <Check /> Accept
              </Button>
              <Button variant="outline" size="xs" onClick={() => onAck(asset, 'DECLINED')}>
                <X /> Decline
              </Button>
            </>
          )}
          {ack === 'DECLINED' && (
            <Button variant="outline" size="xs" onClick={() => onAck(asset, 'ACCEPTED')}>
              <Check /> Accept now
            </Button>
          )}
          <Button variant="outline" size="xs" onClick={() => onReport(asset)}>
            <TriangleAlert /> Report a problem
          </Button>
          <a href={`/api/my-assets/${asset.id}/handover`} target="_blank" rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'xs' })}>
            <Printer /> Handover form
          </a>
        </div>
      </div>
    </Card>
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
      if (!res.ok) throw new Error(json.error || 'Couldn’t load your assets')
      setData(json.data)
    } catch (err) {
      setError(err.message || 'Couldn’t load your assets')
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
      <PageHeader
        title="My assets"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading} aria-label="Refresh">
              <RefreshCw className={cn(loading && 'animate-spin')} /> Refresh
            </Button>
            {assets.length > 0 && (
              <a href="/api/my-assets/handover" target="_blank" rel="noreferrer"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <Printer /> Print handover form
              </a>
            )}
          </>
        }
      />

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => (
            <Card key={i} className="animate-pulse p-5">
              <div className="flex gap-3">
                <div className="size-10 rounded-lg bg-gray-100" />
                <div className="flex-1 space-y-2"><div className="h-3 w-1/3 rounded-md bg-gray-100" /><div className="h-4 w-2/3 rounded-md bg-gray-100" /></div>
              </div>
              <div className="mt-4 h-16 rounded-md bg-gray-100" />
            </Card>
          ))}
        </div>
      ) : error && !data ? (
        <Card>
          <EmptyState icon={CircleAlert} title="Couldn’t load your assets" description={error}
            action={<Button variant="outline" size="sm" onClick={() => load()}><RefreshCw /> Try again</Button>} />
        </Card>
      ) : !data?.employee ? (
        <Card>
          <EmptyState icon={UserX} title="No employee profile linked"
            description="Ask HR to link your account." />
        </Card>
      ) : (
        <>
          {focusId && !focusFound && (
            <div className="flex items-start gap-2 rounded-lg border border-gray-200/80 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-gray-500" />
              <p>The scanned item is no longer issued to you. If you still have it, return it to the inventory team.</p>
            </div>
          )}

          {pending.length > 0 && (
            <Card className="overflow-hidden border-amber-200">
              <CardHeader className="items-center pb-3">
                <CardTitle>Awaiting your acknowledgement</CardTitle>
                <Badge variant="warning">{pending.length === 1 ? '1 item' : `${pending.length} items`}</Badge>
              </CardHeader>
              <ul className="divide-y divide-gray-100 border-t border-gray-100">
                {pending.map(a => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-gray-900">
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">{a.assetTag}</span>{a.name}
                      </p>
                      <p className="text-xs text-muted-foreground">Issued {fmtDate(a.assignedAt)}{a.serialNumber ? ` · S/N ${a.serialNumber}` : ''}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="xs" onClick={() => setAckTarget({ asset: a, decision: 'ACCEPTED' })}>
                        <Check /> Accept
                      </Button>
                      <Button variant="outline" size="xs" onClick={() => setAckTarget({ asset: a, decision: 'DECLINED' })}>
                        <X /> Decline
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {assets.length === 0 ? (
            <Card>
              <EmptyState icon={Package} title="No assets assigned" />
            </Card>
          ) : (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900">
                  Equipment <span className="font-normal text-muted-foreground">({assets.length})</span>
                </h2>
                {(data.summary?.inRepair > 0 || data.summary?.damaged > 0) && (
                  <p className="text-xs text-muted-foreground">
                    {[data.summary.inRepair ? `${data.summary.inRepair} in repair` : null, data.summary.damaged ? `${data.summary.damaged} damaged` : null].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {assets.map(a => (
                  <AssetCard key={a.id} asset={a} highlight={a.id === focusId}
                    onAck={(asset, decision) => setAckTarget({ asset, decision })}
                    onReport={(asset) => setReportTarget(asset)} />
                ))}
              </div>
            </section>
          )}

          <Card as="section" className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3.5">
              <h2 className="text-sm font-semibold text-gray-900">Supplies issued to you</h2>
              <span className="text-xs text-muted-foreground">Last {Math.min(consumables.length, 50)}</span>
            </div>
            {consumables.length === 0 ? (
              <EmptyState icon={Boxes} title="No supplies yet" className="py-10" />
            ) : (
              <Table className="min-w-[520px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Purpose</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consumables.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(m.date)}</TableCell>
                      <TableCell>
                        <p className="text-gray-900">{m.item?.name ?? '—'}</p>
                        {m.item?.sku && <p className="font-mono text-xs text-muted-foreground">{m.item.sku}</p>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-900">{m.qty} {m.unit}</TableCell>
                      <TableCell className="text-muted-foreground">{[m.reason, m.reference].filter(Boolean).join(' · ') || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
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
    <Suspense fallback={<PageLoader />}>
      <MyAssetsPage />
    </Suspense>
  )
}
