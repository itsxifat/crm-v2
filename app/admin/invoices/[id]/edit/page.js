'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import InvoiceForm from '@/components/admin/invoices/InvoiceForm'
import { Loader2 } from 'lucide-react'

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

  if (loading) return (
    <div className="flex items-center justify-center h-60">
      <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
    </div>
  )

  if (error) return (
    <div className="text-center py-20 text-red-500">{error}</div>
  )

  if (invoice?.status !== 'DRAFT') return (
    <div className="text-center py-20 text-gray-500">Only DRAFT invoices can be edited.</div>
  )

  return <InvoiceForm invoice={invoice} />
}
