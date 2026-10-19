'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft, Copy, Laptop, Pencil, Printer, Tag, Trash2, AlertTriangle, Clock, ShieldCheck, ShieldAlert, Loader2,
  RefreshCw, MapPin, UserRound, Building2, CalendarClock, FileText,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ActionMenu from '@/components/ui/ActionMenu'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import AssetStatusBadge, { AssetConditionBadge, InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { usePermission } from '@/components/auth/Can'
import { cn } from '@/lib/utils'
import { ACK_META, safeLinkUrl } from '@/lib/inventory/constants'
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
  ACTION_ICONS, Section, InfoRow, btnPrimary, btnSecondary, btnDanger, cardCls, tk, fmtDay, todayKey, dayKeyOf,
  holderName, openPrint, labelsUrl, apiJson,
} from '../_components/shared'

function Banner({ tone, icon: Icon, children, action }) {
  const cls = {
    red: 'bg-red-50 text-red-800 border-red-100',
    orange: 'bg-orange-50 text-orange-800 border-orange-100',
    yellow: 'bg-amber-50 text-amber-800 border-amber-100',
    blue: 'bg-blue-50 text-blue-800 border-blue-100',
  }[tone] ?? 'bg-gray-50 text-gray-700 border-gray-100'
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-xl border px-4 py-3 text-sm', cls)}>
      <div className="flex items-start gap-2 flex-1 min-w-0">
        {Icon && <Icon className="w-4 h-4 mt-0.5 shrink-0" />}
        <div className="min-w-0">{children}</div>
      </div>
      {action}
    </div>
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
      <div className="max-w-xl mx-auto">
        <EmptyState
          icon={error.status === 404 ? Tag : AlertTriangle}
          title={error.status === 404 ? 'Asset not found' : 'Could not load the asset'}
          description={error.status === 404 ? 'It may have been deleted, or the link is wrong.' : error.message}
          action={(
            <div className="flex gap-2 justify-center">
              <Link href="/admin/inventory/assets" className={btnSecondary}><ArrowLeft className="w-4 h-4" /> All assets</Link>
              {error.status !== 404 && <button type="button" className={btnPrimary} onClick={() => load()}><RefreshCw className="w-4 h-4" /> Retry</button>}
            </div>
          )}
        />
      </div>
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

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <Link href="/admin/inventory/assets" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" /> Assets
      </Link>

      {/* ── Header ── */}
      <div className={cn(cardCls, 'p-4 sm:p-6')}>
        <div className="flex flex-col lg:flex-row gap-5 lg:items-start lg:justify-between">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
              {safeLinkUrl(asset.imageUrl)
                ? <Image src={safeLinkUrl(asset.imageUrl)} alt={asset.name} width={80} height={80} unoptimized className="w-full h-full object-cover" />
                : <Laptop className="w-8 h-8 text-gray-400" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold tracking-wide bg-gray-900 text-white px-2 py-0.5 rounded">{asset.assetTag}</span>
                <button type="button" className="p-1 text-gray-400 hover:text-gray-700" aria-label="Copy tag"
                  onClick={() => navigator.clipboard?.writeText(asset.assetTag).then(() => toast.success('Tag copied')).catch(() => {})}>
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <AssetStatusBadge status={asset.status} />
                <AssetConditionBadge condition={asset.condition} />
                {ack.status && ack.status !== 'NOT_REQUIRED' && (
                  <InventoryBadge label={ACK_META[ack.status]?.label ?? ack.status} color={ACK_META[ack.status]?.color} />
                )}
                {asset.isCapitalized === false && <InventoryBadge label="Expensed" color="gray" dot={false} />}
                {asset.opening?.isExisting && <InventoryBadge label="Opening register" color="indigo" dot={false} />}
              </div>
              <h1 className="text-xl font-semibold text-gray-900 mt-2 break-words">{asset.name}</h1>
              <p className="text-sm text-gray-500 mt-0.5 break-words">
                {[asset.brand, asset.model, asset.serialNumber ? `S/N ${asset.serialNumber}` : null].filter(Boolean).join(' · ') || 'No brand / model recorded'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {[asset.categoryId?.name, asset.locationId?.name, `Added ${fmtDay(asset.createdAt)}`].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end lg:max-w-md">
            {primary.map((a, i) => {
              const Icon = ACTION_ICONS[a.icon]
              return (
                <button key={a.key} type="button" onClick={() => openAction(a.key)}
                  className={i === 0 ? (a.tone === 'danger' ? btnDanger : btnPrimary) : btnSecondary}>
                  {Icon && <Icon className="w-4 h-4" />} {actionLabel(a)}
                </button>
              )
            })}
            <button type="button" className={btnSecondary} onClick={() => openPrint(labelsUrl([asset.id], { size: 'small' }))}>
              <Printer className="w-4 h-4" /> Label
            </button>
            <div className="flex items-center rounded-lg border border-gray-200 bg-white px-0.5" title="More actions">
              <ActionMenu items={moreItems} />
            </div>
          </div>
        </div>

        {/* key figures */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5">
          <div className="rounded-lg border border-gray-100 px-3 py-2.5">
            <p className="text-xs text-gray-500">Cost</p>
            <p className="text-lg font-semibold text-gray-900">{tk(asset.cost)}</p>
          </div>
          <div className="rounded-lg border border-gray-100 px-3 py-2.5">
            <p className="text-xs text-gray-500">Net book value</p>
            <p className="text-lg font-semibold text-gray-900">{asset.isCapitalized === false ? tk(0) : tk(asset.bookValue)}</p>
          </div>
          <div className="rounded-lg border border-gray-100 px-3 py-2.5 min-w-0">
            <p className="text-xs text-gray-500">{terminal ? 'Last holder' : 'With'}</p>
            <p className="text-sm font-semibold text-gray-900 truncate mt-1">{holder ?? (terminal ? '—' : 'In store')}</p>
          </div>
          <div className="rounded-lg border border-gray-100 px-3 py-2.5 min-w-0">
            <p className="text-xs text-gray-500">Location</p>
            <p className="text-sm font-semibold text-gray-900 truncate mt-1">{asset.locationId?.name ?? '—'}</p>
          </div>
        </div>
      </div>

      {/* ── Banners ── */}
      {terminal && <DisposalSummary asset={asset} />}
      {asset.status === 'LOST' || asset.status === 'STOLEN' ? (
        <Banner tone="red" icon={ShieldAlert}
          action={actions.some(a => a.key === 'found') && <button type="button" className={btnSecondary} onClick={() => openAction('found')}>Mark found</button>}>
          Reported {asset.status === 'STOLEN' ? 'stolen' : 'lost'}. If it is not recovered, write it off so the register and books stay correct.
        </Banner>
      ) : null}
      {asset.status === 'DAMAGED' && (
        <Banner tone="orange" icon={AlertTriangle}>
          Damaged — send it for repair, put it back in stock after assessment, or dispose of it.
        </Banner>
      )}
      {asset.status === 'IN_REPAIR' && repairSent && (
        <Banner tone="yellow" icon={Clock}
          action={actions.some(a => a.key === 'repair_complete') && <button type="button" className={btnSecondary} onClick={() => openAction('repair_complete')}>Complete repair</button>}>
          In repair{repairSent.vendorName ? ` with ${repairSent.vendorName}` : ''} since {fmtDay(repairSent.date)}
          {repairSent.expectedDate ? ` · expected back ${fmtDay(repairSent.expectedDate)}` : ''}
          {repairSent.expectedDate && dayKeyOf(repairSent.expectedDate) < today ? ' (overdue)' : ''}.
        </Banner>
      )}
      {ack.status === 'PENDING' && emp && (
        <Banner tone="yellow" icon={Clock}>
          Waiting for {emp.name ?? 'the employee'} to confirm receipt in My Assets{asset.assignedAt ? ` (assigned ${fmtDay(asset.assignedAt)})` : ''}.
        </Banner>
      )}
      {ack.status === 'DECLINED' && (
        <Banner tone="red" icon={AlertTriangle}>
          {emp?.name ?? 'The employee'} declined the hand-over{ack.at ? ` on ${fmtDay(ack.at)}` : ''}{ack.note ? `: “${ack.note}”` : ''}. Check with them and reassign or return the asset.
        </Banner>
      )}
      {overdue && (
        <Banner tone="orange" icon={CalendarClock}>Return was expected on {fmtDay(asset.expectedReturnDate)}.</Banner>
      )}
      {unassessed.length > 0 && (
        <Banner tone="orange" icon={AlertTriangle}
          action={canReport && <button type="button" className={btnSecondary} onClick={() => openAction('report_damage', { damageCase: unassessed[0] })}>Assess</button>}>
          {unassessed.length === 1 ? 'The employee reported a problem' : `${unassessed.length} problems reported by the employee`}: “{unassessed[0].description}”
        </Banner>
      )}
      {!terminal && warrantyDays !== null && warrantyDays <= 30 && (
        <Banner tone={warrantyDays < 0 ? 'blue' : 'yellow'} icon={warrantyDays < 0 ? ShieldAlert : ShieldCheck}>
          {warrantyDays < 0 ? `Warranty ended on ${fmtDay(asset.warrantyExpiry)}.` : `Warranty ends in ${warrantyDays} day${warrantyDays === 1 ? '' : 's'} (${fmtDay(asset.warrantyExpiry)}).`}
        </Banner>
      )}

      {/* ── Body ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        <div className="xl:col-span-2 space-y-4 min-w-0">
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

        <div className="space-y-4 min-w-0">
          <Section title="Custody"
            actions={lastAssigned && (
              <button type="button" className={cn(btnSecondary, 'py-1.5 text-xs')} onClick={() => openPrint(`/api/inventory/assets/${asset.id}/handover${asset.status === 'ASSIGNED' ? '' : `?eventId=${lastAssigned.id}`}`)}>
                <Printer className="w-3.5 h-3.5" /> Hand-over form
              </button>
            )}>
            {hasHolder(asset) ? (
              <div className="flex items-start gap-3 mb-2">
                <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  {emp ? <UserRound className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{holder}</p>
                  <p className="text-xs text-gray-500 truncate">{[emp?.employeeId, emp?.designation, asset.assignedDepartmentId?.name].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500 mb-2">{terminal ? 'No longer held — disposed of.' : 'Not assigned — in store.'}</p>
            )}
            <InfoRow label="Since">{asset.assignedAt ? fmtDay(asset.assignedAt) : null}</InfoRow>
            <InfoRow label="Expected return">{asset.expectedReturnDate ? fmtDay(asset.expectedReturnDate) : null}</InfoRow>
            <InfoRow label="Acknowledgement">{ack.status && ack.status !== 'NOT_REQUIRED' ? `${ACK_META[ack.status]?.label}${ack.at ? ` · ${fmtDay(ack.at)}` : ''}` : null}</InfoRow>
            <InfoRow label={<span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Location</span>}>{asset.locationId?.name}</InfoRow>
            <InfoRow label="Last audit">{asset.lastAuditAt ? `${fmtDay(asset.lastAuditAt)}${asset.lastAuditResult ? ` · ${asset.lastAuditResult.toLowerCase().replace(/_/g, ' ')}` : ''}` : null}</InfoRow>
          </Section>

          <Section title="Details" actions={canManage && !asset.isArchived && (
            <button type="button" className={cn(btnSecondary, 'py-1.5 text-xs')} onClick={() => setEditOpen(true)}><Pencil className="w-3.5 h-3.5" /> Edit</button>
          )}>
            <InfoRow label="Category">{asset.categoryId?.name ? `${asset.categoryId.name} (${asset.categoryId.code})` : null}</InfoRow>
            <InfoRow label="Brand">{asset.brand}</InfoRow>
            <InfoRow label="Model">{asset.model}</InfoRow>
            <InfoRow label="Serial number" mono>{asset.serialNumber}</InfoRow>
            <InfoRow label="Tax class">{cls ? `${cls.label} · ${asset.taxRatePct ?? cls.rate}%` : asset.taxClass}</InfoRow>
            <InfoRow label="Warranty">{asset.warrantyExpiry ? `until ${fmtDay(asset.warrantyExpiry)}` : null}</InfoRow>
            {asset.warrantyNotes && <p className="text-xs text-gray-500 -mt-1 mb-1 text-right">{asset.warrantyNotes}</p>}
            {asset.insurance && (asset.insurance.provider || asset.insurance.policyNo) && (
              <InfoRow label="Insurance">{[asset.insurance.provider, asset.insurance.policyNo, asset.insurance.expiry ? `to ${fmtDay(asset.insurance.expiry)}` : null, asset.insurance.insuredValue ? tk(asset.insurance.insuredValue) : null].filter(Boolean).join(' · ')}</InfoRow>
            )}
            <InfoRow label="Added by">{asset.createdBy?.name}</InfoRow>
            {asset.specs && <div className="mt-2"><p className="text-xs text-gray-500">Specifications</p><p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{asset.specs}</p></div>}
            {asset.description && <div className="mt-2"><p className="text-xs text-gray-500">Description</p><p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{asset.description}</p></div>}
            {asset.notes && <div className="mt-2"><p className="text-xs text-gray-500">Notes</p><p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{asset.notes}</p></div>}
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
        <p className="text-sm text-gray-600">To take a real asset out of use, sell, scrap, donate or write it off instead — that keeps the audit trail.</p>
        <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5">
          <button type="button" className={btnSecondary} onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</button>
          <button type="button" className={btnDanger} onClick={onDelete} disabled={deleting}>
            {deleting && <Loader2 className="w-4 h-4 animate-spin" />} Delete
          </button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
