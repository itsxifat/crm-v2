'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { AlertCircle, ArrowLeft, Ban, FileSearch, Loader2, Plus, Trash2 } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { usePermission } from '@/components/auth/Can'
import { formatDate } from '@/lib/utils'
import PurchaseBillForm from '../_components/PurchaseBillForm'
import BillDetailView from '../_components/BillDetailView'
import ReceiveDialog from '../_components/ReceiveDialog'
import CancelBillDialog from '../_components/CancelBillDialog'
import { BillStatusBadge, PaymentStatusBadge } from '../_components/badges'
import { useInventoryOptions } from '../_components/useInventoryOptions'
import { tk } from '../_components/billMath'

function PurchaseBillPage() {
  const { id } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can, canAny, ready } = usePermission()
  const { options, loading: optionsLoading, error: optionsError, reload: reloadOptions } = useInventoryOptions()

  const [bill, setBill] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [settleOpen, setSettleOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/purchases/${id}`)
      const json = await res.json().catch(() => ({}))
      if (res.status === 404) { setNotFound(true); return }
      if (!res.ok) throw new Error(json.error || 'Could not load the bill')
      setBill(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const canPurchase = can('inventory.purchase')
  const editable = bill?.status === 'DRAFT' && canPurchase

  // "Save & receive" from the new-bill page lands here with ?receive=1.
  useEffect(() => {
    if (!ready || !bill || searchParams.get('receive') !== '1') return
    if (bill.status === 'DRAFT' && canPurchase) setReceiveOpen(true)
    router.replace(`/admin/inventory/purchases/${id}`)
  }, [ready, bill, searchParams, canPurchase, router, id])

  async function deleteDraft() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/inventory/purchases/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not delete the draft')
      toast.success('Draft deleted')
      router.push('/admin/inventory/purchases')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  if (!ready || (loading && !bill) || (optionsLoading && !options)) return <PageLoader />

  if (notFound) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl">
        <EmptyState icon={FileSearch} title="Purchase bill not found" description="It may have been deleted."
          action={<Link href="/admin/inventory/purchases" className="text-sm font-medium text-gray-900 underline">Back to purchases</Link>} />
      </div>
    )
  }

  if (error || !bill) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl">
        <EmptyState icon={AlertCircle} title="Could not load the bill" description={error ?? 'Please try again.'}
          action={<button type="button" onClick={load} className="text-sm font-medium text-gray-900 underline">Try again</button>} />
      </div>
    )
  }

  const settings = options?.settings ?? {}

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Link href="/admin/inventory/purchases" className="p-2 -ml-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white" aria-label="Back to purchases">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900">{bill.billNo ?? 'Purchase bill'}</h1>
              <BillStatusBadge status={bill.status} />
              {bill.status !== 'DRAFT' && <PaymentStatusBadge bill={bill} />}
            </div>
            <p className="text-sm text-gray-500 truncate">
              {bill.vendorName ?? 'Supplier'} · {bill.billDay ? formatDate(bill.billDay) : '—'} · {tk(bill.total, 0)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPurchase && bill.vendorId && (
            <Link href={`/admin/inventory/purchases/new?vendorId=${bill.vendorId}`}
              className="inline-flex items-center gap-1.5 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium">
              <Plus className="w-4 h-4" /> New bill from this vendor
            </Link>
          )}
          {canPurchase && bill.status === 'RECEIVED' && (
            <button type="button" onClick={() => setCancelOpen(true)}
              className="inline-flex items-center gap-1.5 border border-red-200 bg-white text-red-600 hover:bg-red-50 rounded-lg px-3 py-2 text-sm font-medium">
              <Ban className="w-4 h-4" /> Cancel bill
            </button>
          )}
        </div>
      </div>

      {editable ? (
        optionsError && !options ? (
          <div className="bg-white border border-gray-100 rounded-xl">
            <EmptyState icon={AlertCircle} title="Could not load categories and locations" description={optionsError}
              action={<button type="button" onClick={reloadOptions} className="text-sm font-medium text-gray-900 underline">Try again</button>} />
          </div>
        ) : (
          <PurchaseBillForm
            key={`${bill.id}:${formKey}`}
            bill={bill}
            options={options}
            onSaved={(saved, { receive }) => {
              setBill(saved)
              setFormKey(k => k + 1)
              if (receive) setReceiveOpen(true)
            }}
            extraActions={(
              <div className="flex gap-2">
                <button type="button" onClick={() => setCancelOpen(true)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-gray-500 hover:text-gray-800 rounded-lg px-3 py-2 text-xs font-medium border border-transparent hover:border-gray-200">
                  <Ban className="w-3.5 h-3.5" /> Cancel
                </button>
                <button type="button" onClick={() => setDeleteOpen(true)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 text-red-600 hover:text-red-700 rounded-lg px-3 py-2 text-xs font-medium border border-transparent hover:border-red-200">
                  <Trash2 className="w-3.5 h-3.5" /> Delete draft
                </button>
              </div>
            )}
          />
        )
      ) : (
        <BillDetailView
          bill={bill}
          canSettle={canPurchase}
          canPayNow={can('finance.payments.confirm')}
          canViewAccounts={canAny(['finance.payments.confirm', 'finance.payments.request'])}
          onSettle={() => setSettleOpen(true)}
          onPayNow={() => setSettleOpen(true)}
        />
      )}

      <ReceiveDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        bill={bill}
        mode="receive"
        settings={settings}
        onDone={(data) => { if (data) setBill(data); else load() }}
      />
      <ReceiveDialog
        open={settleOpen}
        onOpenChange={setSettleOpen}
        bill={bill}
        mode="settle"
        settings={settings}
        onDone={(data) => { if (data) setBill(data); else load() }}
      />
      <CancelBillDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        bill={bill}
        onDone={(data) => { if (data) setBill(data); else load() }}
      />

      <Modal open={deleteOpen} onOpenChange={(v) => { if (!deleting) setDeleteOpen(v) }} title={`Delete ${bill.billNo ?? 'this draft'}?`}
        description="The draft is removed permanently. Nothing has been received or paid yet." size="sm">
        <p className="text-sm text-gray-600">Use Cancel instead if you want to keep a record of it.</p>
        <ModalFooter>
          <button type="button" onClick={() => setDeleteOpen(false)} disabled={deleting}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 bg-white">Keep</button>
          <button type="button" onClick={deleteDraft} disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5">
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Delete draft
          </button>
        </ModalFooter>
      </Modal>
    </div>
  )
}

export default function PurchaseBillPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <PurchaseBillPage />
    </Suspense>
  )
}
