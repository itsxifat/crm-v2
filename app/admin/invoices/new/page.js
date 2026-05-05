'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import InvoiceForm from '@/components/admin/invoices/InvoiceForm'

function NewInvoiceInner() {
  const sp = useSearchParams()
  return (
    <InvoiceForm
      defaultProjectId={sp.get('projectId') ?? ''}
      defaultClientId={sp.get('clientId') ?? ''}
    />
  )
}

export default function NewInvoicePage() {
  return (
    <Suspense>
      <NewInvoiceInner />
    </Suspense>
  )
}
