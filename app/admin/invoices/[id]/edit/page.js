'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import InvoiceForm from '@/components/admin/invoices/InvoiceForm'
import { AlertCircle, Lock } from 'lucide-react'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'

export default function EditInvoicePage() {
  const { id } = useParams()
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    fetch(`/api/invoices/${id}`)
      .then(r => r.json())
      .then(j => {
        if (j.data) setInvoice(j.data)
        else setError(j.error ?? 'Invoice not found')
      })
      .catch(() => setError('Failed to load invoice'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <PageLoader />

  if (error) return (
    <EmptyState
      icon={AlertCircle}
      title={error}
      action={<Button variant="outline" size="sm" href="/admin/invoices">Back to invoices</Button>}
    />
  )

  if (invoice?.status !== 'DRAFT') return (
    <EmptyState
      icon={Lock}
      title="Only draft invoices can be edited"
      action={<Button variant="outline" size="sm" href={`/admin/invoices/${id}`}>View invoice</Button>}
    />
  )

  return <InvoiceForm invoice={invoice} />
}
