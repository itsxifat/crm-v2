'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, Lock } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { usePermission } from '@/components/auth/Can'
import PurchaseBillForm from '../_components/PurchaseBillForm'
import { pickVendorFields } from '../_components/VendorPicker'
import { useInventoryOptions } from '../_components/useInventoryOptions'

function NewPurchaseBill() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const vendorId = searchParams.get('vendorId')
  const { can, ready } = usePermission()
  const { options, loading, error, reload } = useInventoryOptions()
  const [vendor, setVendor] = useState(null)
  const [vendorLoading, setVendorLoading] = useState(Boolean(vendorId))

  useEffect(() => {
    if (!vendorId) { setVendorLoading(false); return undefined }
    let alive = true
    setVendorLoading(true)
    fetch(`/api/vendors/${vendorId}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (alive && res.ok && json.data) setVendor(pickVendorFields(json.data))
      })
      .catch(() => {})
      .finally(() => { if (alive) setVendorLoading(false) })
    return () => { alive = false }
  }, [vendorId])

  if (!ready || loading || vendorLoading) return <PageLoader />

  if (!can('inventory.purchase')) {
    return (
      <Card>
        <EmptyState icon={Lock} title="You can't record purchase bills"
          description="Needs the “Record purchase bills” permission." />
      </Card>
    )
  }

  if (error || !options) {
    return (
      <Card>
        <EmptyState icon={AlertCircle} title="Couldn't load the form" description={error ?? 'Please try again.'}
          action={<Button variant="outline" size="sm" onClick={reload}>Try again</Button>} />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="New purchase bill" back="/admin/inventory/purchases" backLabel="Purchases" />
      <PurchaseBillForm
        options={options}
        presetVendor={vendor}
        onSaved={(bill, { receive }) => {
          router.replace(`/admin/inventory/purchases/${bill.id}${receive ? '?receive=1' : ''}`)
        }}
      />
    </div>
  )
}

export default function NewPurchaseBillPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <NewPurchaseBill />
    </Suspense>
  )
}
