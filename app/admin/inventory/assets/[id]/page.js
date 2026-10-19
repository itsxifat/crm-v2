'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Copy, Pencil, Printer, Tag, Trash2, AlertTriangle, Clock, ShieldCheck, ShieldAlert,
  RefreshCw, UserRound, Building2, CalendarClock, FileText,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ActionMenu from '@/components/ui/ActionMenu'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import AssetStatusBadge, { AssetConditionBadge, InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { usePermission } from '@/components/auth/Can'
import { cn } from '@/lib/utils'
import { ACK_META } from '@/lib/inventory/constants'
import { TAX_DEPRECIATION_CLASSES } from '@/lib/tax/catalog'
import {
  availableAssetActions, primaryActionKeys, returnActionLabel, hasHolder,
} from '@/lib/inventory/actions'
import AssetActionModal from '../_components/AssetActionModal'
import AssetFormModal from '../_components/AssetFormModal'
import {
  AssetTimeline, FinancialsPanel, DamagePanel, DocumentsPanel, PurchasePanel, DisposalSummary,
} from '../_components/AssetDetailPanels'
import {
  ACTION_ICONS, Section, InfoRow, tk, fmtDay, todayKey, dayKeyOf,
  holderName, openPrint, labelsUrl, apiJson,
} from '../_components/shared'

function Banner({ tone, icon: Icon, children, action }) {
  const cls = {
    red: 'border-red-200 bg-red-50 text-red-800',
    orange: 'border-orange-200 bg-orange-50 text-orange-800',
    yellow: 'border-amber-200 bg-amber-50 text-amber-800',
    blue: 'border-blue-200 bg-blue-50 text-blue-800',
  }[tone] ?? 'border-gray-200 bg-gray-50 text-gray-700'
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3', cls)}>
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
        <div className="min-w-0">{children}</div>
      </div>
      {action}
    </div>
  )
}

function Figure({ label, children, className }) {
  return (
    <Card className="min-w-0 px-4 py-3.5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 truncate text-lg font-semibold tracking-tight text-gray-900 tabular-nums', className)}>{children}</p>
    </Card>
  )
}

export default function AssetDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const { can, ready } = usePermission()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState(null) // { action, damageCase? }
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const seq = useRef(0)

  const load = useCallback(async ({ quiet = false } = {}) => {
    const mine = ++seq.current
    if (!quiet) setLoading(true)
    try {
      const json = await apiJson(`/api/inventory/assets/${id}`)
      if (mine !== seq.current) return
      setData(json.data)
      setError(null)
    } catch (err) {
      if (mine !== seq.current) return
      setError({ message: err.message, status: err.status })
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const asset = data?.asset ?? null
  const actions = asset && ready ? availableAssetActions(asset, can) : []
  const visible = actions.filter(a => !a.hidden)
  const primaryKeys = asset ? primaryActionKeys(asset.status) : []
  const primary = primaryKeys.map(k => visible.find(a => a.key === k)).filter(Boolean)
  const more = visible.filter(a => !primary.includes(a))
  const lastAssigned = data?.events?.find(e => e.type === 'ASSIGNED' && e.toEmployee)
  const repairSentEvent = data?.events?.find(e => e.type === 'REPAIR_SENT')
  const repairSent = repairSentEvent ? {
    date: repairSentEvent.date,
    vendorId: repairSentEvent.vendorId?.id ?? '',
    vendorName: repairSentEvent.details?.vendorName ?? repairSentEvent.vendorId?.company ?? '',
    repairRef: repairSentEvent.details?.repairRef ?? '',
    expectedDate: repairSentEvent.details?.expectedDate ?? null,
  } : null

  const openAction = (key, extra = {}) => setModal({ action: key, ...extra })
  const actionLabel = (a) => (a.key === 'return' ? returnActionLabel(asset) : a.label)

  async function onDelete() {
    setDeleting(true)
    try {
      await apiJson(`/api/inventory/assets/${id}`, { method: 'DELETE' })
      toast.success(`${asset.assetTag} deleted`)
      router.push('/admin/inventory/assets')
    } catch (err) {
      toast.error(err.message)
      setDeleting(false)
    }
  }

  if (loading && !data) return <PageLoader />
  if (error && !data) {
    return (
      <Card className="mx-auto max-w-xl">
        <EmptyState
          icon={error.status === 404 ? Tag : AlertTriangle}
          title={error.status === 404 ? 'Asset not found' : "Couldn't load the asset"}
          description={error.status === 404 ? 'It may have been deleted.' : error.message}
          action={(
            <div className="flex justify-center gap-2">
              <Button variant="outline" href="/admin/inventory/assets"><ArrowLeft /> All assets</Button>
              {error.status !== 404 && <Button onClick={() => load()}><RefreshCw /> Retry</Button>}
            </div>
          )}
        />
      </Card>
    )
  }
  if (!asset) return null

  const today = todayKey()
  const terminal = Boolean(asset.disposal?.type) || ['SOLD', 'SCRAPPED', 'WRITTEN_OFF', 'DONATED'].includes(asset.status)
  const ack = asset.acknowledgement ?? {}
  const holder = holderName(asset)
  const emp = asset.assignedEmployeeId && typeof asset.assignedEmployeeId === 'object' ? asset.assignedEmployeeId : null
  const warrantyDay = dayKeyOf(asset.warrantyExpiry)
  const warrantyDays = warrantyDay ? Math.round((new Date(warrantyDay) - new Date(today)) / 86400000) : null
  const overdue = asset.status === 'ASSIGNED' && asset.expectedReturnDate && dayKeyOf(asset.expectedReturnDate) < today
  const unassessed = (data.damageCases ?? []).filter(c => c.reportedByEmployee && !c.assessed)
  const canReport = actions.some(a => a.key === 'report_damage')
  const cls = TAX_DEPRECIATION_CLASSES[asset.taxClass]
  const canManage = can('inventory.manage')

  const moreItems = [
    ...more.map(a => {
      const Icon = ACTION_ICONS[a.icon]
      return { label: actionLabel(a), icon: Icon, danger: a.tone === 'danger', onClick: () => openAction(a.key) }
    }),
    { label: 'Print small label', icon: Printer, onClick: () => openPrint(labelsUrl([asset.id], { size: 'small' })) },
    { label: 'Print large label', icon: Printer, onClick: () => openPrint(labelsUrl([asset.id], { size: 'large' })) },
    lastAssigned && { label: 'Hand-over form', icon: FileText, onClick: () => openPrint(`/api/inventory/assets/${asset.id}/handover${asset.status === 'ASSIGNED' ? '' : `?eventId=${lastAssigned.id}`}`) },
    canManage && { label: 'Edit details', icon: Pencil, onClick: () => setEditOpen(true) },
    canManage && {
      label: 'Delete', icon: Trash2, danger: true, disabled: !data.deletable?.ok,
      hint: data.deletable?.ok ? null : 'has history',
      onClick: () => setDeleteOpen(true),
    },
  ].filter(Boolean)

  const subline = [asset.brand, asset.model, asset.serialNumber ? `S/N ${asset.serialNumber}` : null].filter(Boolean).join(' · ')

  return (
    <div className="space-y-6">
      <PageHeader
        back="/admin/inventory/assets"
        backLabel="Assets"
        title={asset.name}
        meta={(
          <>
            <AssetStatusBadge status={asset.status} />
            <AssetConditionBadge condition={asset.condition} />
            {ack.status && ack.status !== 'NOT_REQUIRED' && (
              <InventoryBadge label={ACK_META[ack.status]?.label ?? ack.status} color={ACK_META[ack.status]?.color} />
            )}
            {asset.isCapitalized === false && <InventoryBadge label="Expensed" color="gray" dot={false} />}
            {asset.opening?.isExisting && <InventoryBadge label="Opening register" color="indigo" dot={false} />}
          </>
        )}
        actions={(
          <>
            {primary.map((a, i) => {
              const Icon = ACTION_ICONS[a.icon]
              return (
                <Button key={a.key} onClick={() => openAction(a.key)}
                  variant={i === 0 ? (a.tone === 'danger' ? 'destructive' : 'default') : 'outline'}>
                  {Icon && <Icon />} {actionLabel(a)}
                </Button>
              )
            })}
            <Button variant="outline" onClick={() => openPrint(labelsUrl([asset.id], { size: 'small' }))}>
              <Printer /> Label
            </Button>
            <div className="flex size-9 items-center justify-center rounded-lg border border-input bg-white shadow-xs" title="More actions">
              <ActionMenu items={moreItems} />
            </div>
          </>
        )}
      >
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-0.5">
            <span className="font-mono text-[13px] font-medium text-gray-900">{asset.assetTag}</span>
            <Button variant="ghost" size="icon-xs" className="text-gray-400" aria-label="Copy tag"
              onClick={() => navigator.clipboard?.writeText(asset.assetTag).then(() => toast.success('Tag copied')).catch(() => {})}>
              <Copy className="size-3.5" />
            </Button>
          </span>
          <span className="break-words">{subline || 'No brand / model'}</span>
          <span className="text-gray-300">·</span>
          <span>{[asset.categoryId?.name, `Added ${fmtDay(asset.createdAt)}`].filter(Boolean).join(' · ')}</span>
        </div>
      </PageHeader>

      {/* ── Key figures ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Figure label="Cost">{tk(asset.cost)}</Figure>
        <Figure label="Net book value">{asset.isCapitalized === false ? tk(0) : tk(asset.bookValue)}</Figure>
        <Figure label={terminal ? 'Last holder' : 'With'} className="text-base">{holder ?? (terminal ? '—' : 'In store')}</Figure>
        <Figure label="Location" className="text-base">{asset.locationId?.name ?? '—'}</Figure>
      </div>

      {/* ── Banners ── */}
      {terminal && <DisposalSummary asset={asset} />}
      {asset.status === 'LOST' || asset.status === 'STOLEN' ? (
        <Banner tone="red" icon={ShieldAlert}
          action={actions.some(a => a.key === 'found') && <Button variant="outline" size="sm" onClick={() => openAction('found')}>Mark found</Button>}>
          Reported {asset.status === 'STOLEN' ? 'stolen' : 'lost'}. Write it off if it isn&apos;t recovered.
        </Banner>
      ) : null}
      {asset.status === 'DAMAGED' && (
        <Banner tone="orange" icon={AlertTriangle}>
          Damaged — repair, restock after assessment, or dispose.
        </Banner>
      )}
      {asset.status === 'IN_REPAIR' && repairSent && (
        <Banner tone="yellow" icon={Clock}
          action={actions.some(a => a.key === 'repair_complete') && <Button variant="outline" size="sm" onClick={() => openAction('repair_complete')}>Complete repair</Button>}>
          In repair{repairSent.vendorName ? ` with ${repairSent.vendorName}` : ''} since {fmtDay(repairSent.date)}
          {repairSent.expectedDate ? ` · expected back ${fmtDay(repairSent.expectedDate)}` : ''}
          {repairSent.expectedDate && dayKeyOf(repairSent.expectedDate) < today ? ' (overdue)' : ''}.
        </Banner>
      )}
      {ack.status === 'PENDING' && emp && (
        <Banner tone="yellow" icon={Clock}>
          Awaiting receipt confirmation from {emp.name ?? 'the employee'}{asset.assignedAt ? ` (assigned ${fmtDay(asset.assignedAt)})` : ''}.
        </Banner>
      )}
      {ack.status === 'DECLINED' && (
        <Banner tone="red" icon={AlertTriangle}>
          {emp?.name ?? 'The employee'} declined the hand-over{ack.at ? ` on ${fmtDay(ack.at)}` : ''}{ack.note ? `: “${ack.note}”` : '.'}
        </Banner>
      )}
      {overdue && (
        <Banner tone="orange" icon={CalendarClock}>Return overdue — expected {fmtDay(asset.expectedReturnDate)}.</Banner>
      )}
      {unassessed.length > 0 && (
        <Banner tone="orange" icon={AlertTriangle}
          action={canReport && <Button variant="outline" size="sm" onClick={() => openAction('report_damage', { damageCase: unassessed[0] })}>Assess</Button>}>
          {unassessed.length === 1 ? 'Problem reported by the employee' : `${unassessed.length} problems reported by the employee`}: “{unassessed[0].description}”
        </Banner>
      )}
      {!terminal && warrantyDays !== null && warrantyDays <= 30 && (
        <Banner tone={warrantyDays < 0 ? 'blue' : 'yellow'} icon={warrantyDays < 0 ? ShieldAlert : ShieldCheck}>
          {warrantyDays < 0 ? `Warranty ended on ${fmtDay(asset.warrantyExpiry)}.` : `Warranty ends in ${warrantyDays} day${warrantyDays === 1 ? '' : 's'} (${fmtDay(asset.warrantyExpiry)}).`}
        </Banner>
      )}

      {/* ── Body ── */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <FinancialsPanel asset={asset} book={data.book} tax={data.tax} ledger={data.ledger} taxEntries={data.taxEntries} />
          <DamagePanel
            cases={data.damageCases ?? []}
            canResolve={can('inventory.dispose')}
            canAssess={canReport}
            onResolve={(c) => openAction('update_recovery', { damageCase: c })}
            onAssess={(c) => openAction('report_damage', { damageCase: c })}
          />
          <AssetTimeline events={data.events ?? []} assetId={asset.id} />
        </div>

        <div className="min-w-0 space-y-6">
          <Section title="Custody"
            actions={lastAssigned && (
              <Button variant="outline" size="xs" onClick={() => openPrint(`/api/inventory/assets/${asset.id}/handover${asset.status === 'ASSIGNED' ? '' : `?eventId=${lastAssigned.id}`}`)}>
                <Printer className="size-3.5" /> Hand-over form
              </Button>
            )}>
            {hasHolder(asset) ? (
              <div className="mb-2 flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                  {emp ? <UserRound className="size-4" /> : <Building2 className="size-4" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{holder}</p>
                  <p className="truncate text-xs text-muted-foreground">{[emp?.employeeId, emp?.designation, asset.assignedDepartmentId?.name].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
            ) : (
              <p className="mb-2 text-sm text-muted-foreground">{terminal ? 'Disposed — no longer held' : 'In store — not assigned'}</p>
            )}
            <InfoRow label="Since">{asset.assignedAt ? fmtDay(asset.assignedAt) : null}</InfoRow>
            <InfoRow label="Expected return">{asset.expectedReturnDate ? fmtDay(asset.expectedReturnDate) : null}</InfoRow>
            <InfoRow label="Acknowledgement">{ack.status && ack.status !== 'NOT_REQUIRED' ? `${ACK_META[ack.status]?.label}${ack.at ? ` · ${fmtDay(ack.at)}` : ''}` : null}</InfoRow>
            <InfoRow label="Location">{asset.locationId?.name}</InfoRow>
            <InfoRow label="Last audit">{asset.lastAuditAt ? `${fmtDay(asset.lastAuditAt)}${asset.lastAuditResult ? ` · ${asset.lastAuditResult.toLowerCase().replace(/_/g, ' ')}` : ''}` : null}</InfoRow>
          </Section>

          <Section title="Details" actions={canManage && !asset.isArchived && (
            <Button variant="outline" size="xs" onClick={() => setEditOpen(true)}><Pencil className="size-3.5" /> Edit</Button>
          )}>
            <InfoRow label="Category">{asset.categoryId?.name ? `${asset.categoryId.name} (${asset.categoryId.code})` : null}</InfoRow>
            <InfoRow label="Brand">{asset.brand}</InfoRow>
            <InfoRow label="Model">{asset.model}</InfoRow>
            <InfoRow label="Serial number" mono>{asset.serialNumber}</InfoRow>
            <InfoRow label="Tax class">{cls ? `${cls.label} · ${asset.taxRatePct ?? cls.rate}%` : asset.taxClass}</InfoRow>
            <InfoRow label="Warranty">{asset.warrantyExpiry ? `until ${fmtDay(asset.warrantyExpiry)}` : null}</InfoRow>
            {asset.warrantyNotes && <p className="-mt-1 mb-1 text-right text-xs text-muted-foreground">{asset.warrantyNotes}</p>}
            {asset.insurance && (asset.insurance.provider || asset.insurance.policyNo) && (
              <InfoRow label="Insurance">{[asset.insurance.provider, asset.insurance.policyNo, asset.insurance.expiry ? `to ${fmtDay(asset.insurance.expiry)}` : null, asset.insurance.insuredValue ? tk(asset.insurance.insuredValue) : null].filter(Boolean).join(' · ')}</InfoRow>
            )}
            <InfoRow label="Added by">{asset.createdBy?.name}</InfoRow>
            {asset.specs && <div className="mt-3 border-t border-gray-100 pt-3"><p className="text-[13px] text-muted-foreground">Specifications</p><p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-800">{asset.specs}</p></div>}
            {asset.description && <div className="mt-3 border-t border-gray-100 pt-3"><p className="text-[13px] text-muted-foreground">Description</p><p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-800">{asset.description}</p></div>}
            {asset.notes && <div className="mt-3 border-t border-gray-100 pt-3"><p className="text-[13px] text-muted-foreground">Notes</p><p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-800">{asset.notes}</p></div>}
          </Section>

          <PurchasePanel asset={asset} />
          <DocumentsPanel asset={asset} canManage={canManage} onSaved={() => load({ quiet: true })} />
        </div>
      </div>

      {/* ── Modals ── */}
      {modal && (
        <AssetActionModal
          open={Boolean(modal)}
          onOpenChange={(v) => { if (!v) setModal(null) }}
          action={modal.action}
          asset={asset}
          settings={data.settings}
          damageCase={modal.damageCase ?? null}
          repairSent={repairSent}
          canCapitalize={can('inventory.manage') || can('inventory.dispose')}
          onDone={() => load({ quiet: true })}
        />
      )}
      {editOpen && (
        <AssetFormModal open={editOpen} onOpenChange={setEditOpen} mode="edit" asset={asset} financials={data.financials}
          onSaved={() => load({ quiet: true })} />
      )}
      <Modal open={deleteOpen} onOpenChange={(v) => !deleting && setDeleteOpen(v)} size="sm" title={`Delete ${asset.assetTag}?`}
        description="Only for an asset added by mistake. Its history is removed and the tag is never reused.">
        <p className="text-sm text-muted-foreground">For a real asset, sell, scrap, donate or write it off instead.</p>
        <ModalFooter>
          <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" onClick={onDelete} loading={deleting}>Delete</Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
