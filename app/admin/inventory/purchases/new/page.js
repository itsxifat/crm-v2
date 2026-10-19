'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowLeft, Lock } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
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
      <div className="bg-white border border-gray-100 rounded-xl">
        <EmptyState icon={Lock} title="You cannot record purchase bills"
          description="Ask an administrator for the “Record purchase bills” permission." />
      </div>
    )
  }

  if (error || !options) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl">
        <EmptyState icon={AlertCircle} title="Could not load the form" description={error ?? 'Please try again.'}
          action={<button type="button" onClick={reload} className="text-sm font-medium text-gray-900 underline">Try again</button>} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Link href="/admin/inventory/purchases" className="p-2 -ml-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white" aria-label="Back to purchases">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">New purchase bill</h1>
          <p className="text-sm text-gray-500">Enter the supplier&apos;s bill as printed on the Mushak-6.3. Totals, VAT credit and withholding update as you type.</p>
        </div>
      </div>
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
