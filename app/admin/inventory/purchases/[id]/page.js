'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { AlertCircle, Ban, FileSearch, Plus, Trash2 } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
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
      <Card>
        <EmptyState icon={FileSearch} title="Purchase bill not found" description="It may have been deleted."
          action={<Button variant="outline" size="sm" href="/admin/inventory/purchases">Back to purchases</Button>} />
      </Card>
    )
  }

  if (error || !bill) {
    return (
      <Card>
        <EmptyState icon={AlertCircle} title="Couldn't load the bill" description={error ?? 'Please try again.'}
          action={<Button variant="outline" size="sm" onClick={load}>Try again</Button>} />
      </Card>
    )
  }

  const settings = options?.settings ?? {}

  return (
    <div className="space-y-6">
      <PageHeader
        back="/admin/inventory/purchases"
        backLabel="Purchases"
        title={bill.billNo ?? 'Purchase bill'}
        meta={(
          <>
            <BillStatusBadge status={bill.status} />
            {bill.status !== 'DRAFT' && <PaymentStatusBadge bill={bill} />}
          </>
        )}
        description={`${bill.vendorName ?? 'Supplier'} · ${bill.billDay ? formatDate(bill.billDay) : '—'} · ${tk(bill.total, 0)}`}
        actions={canPurchase && (bill.vendorId || bill.status === 'RECEIVED') ? (
          <>
            {bill.vendorId && (
              <Button variant="outline" href={`/admin/inventory/purchases/new?vendorId=${bill.vendorId}`}>
                <Plus /> New bill from vendor
              </Button>
            )}
            {bill.status === 'RECEIVED' && (
              <Button variant="outline" onClick={() => setCancelOpen(true)} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                <Ban /> Cancel bill
              </Button>
            )}
          </>
        ) : null}
      />

      {editable ? (
        optionsError && !options ? (
          <Card>
            <EmptyState icon={AlertCircle} title="Couldn't load categories and locations" description={optionsError}
              action={<Button variant="outline" size="sm" onClick={reloadOptions}>Try again</Button>} />
          </Card>
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
                <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)} className="flex-1 text-gray-600">
                  <Ban /> Cancel bill
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteOpen(true)} className="flex-1 text-red-600 hover:bg-red-50 hover:text-red-700">
                  <Trash2 /> Delete draft
                </Button>
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
        description="This can't be undone. Cancel the bill instead to keep a record." size="sm">
        <ModalFooter>
          <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Keep</Button>
          <Button variant="destructive" onClick={deleteDraft} loading={deleting}>
            {!deleting && <Trash2 />} Delete draft
          </Button>
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
