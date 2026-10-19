'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import toast, { Toaster } from 'react-hot-toast'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Tabs from '@/components/ui/Tabs'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Card, CardFooter } from '@/components/ui/Card'
import { Input, NativeSelect, Field } from '@/components/ui/Input'

const ACCOUNT_TYPES = ['Personal', 'Agent', 'Merchant']
const AGENCY_TYPES  = ['Production House', 'Design Studio', 'Marketing Agency', 'IT Company', 'Other']

export default function FreelancerSetupPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [freelancerId, setFreelancerId] = useState(null)
  const [loadingProfile, setLoadingProfile] = useState(true)

  const [method, setMethod] = useState('BANK')

  const [bank, setBank] = useState({
    bankName: '', accountNumber: '', accountName: '',
    routingNumber: '', swiftCode: '', branch: '', division: '',
  })

  const [bkash, setBkash] = useState({
    accountType: 'Personal', accountName: '', accountNumber: '',
  })

  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login')
      return
    }
    if (status === 'authenticated' && session?.user?.role !== 'FREELANCER') {
      router.replace('/admin')
      return
    }
    if (status === 'authenticated') {
      fetch('/api/freelancers/profile')
        .then(r => r.json())
        .then(json => {
          if (json.data?.id) {
            setFreelancerId(json.data.id)
            const pm = json.data.paymentMethod
            if (pm?.method) setMethod(pm.method)
            if (pm?.bank?.bankName) setBank({ ...bank, ...pm.bank })
            if (pm?.bkash?.accountNumber) setBkash({ ...bkash, ...pm.bkash })
          }
        })
        .catch(() => {})
        .finally(() => setLoadingProfile(false))
    }
  // Depend on primitives only: SessionProvider re-polls and hands back a new
  // `session` object every 20s, which would reload the profile and clobber edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session?.user?.role])

  async function handleSubmit(e) {
    e.preventDefault()

    if (!freelancerId) {
      toast.error('Could not find your freelancer profile')
      return
    }

    if (method === 'BANK') {
      if (!bank.bankName || !bank.accountNumber || !bank.accountName) {
        toast.error('Bank name, account number and account name are required')
        return
      }
    } else {
      if (!bkash.accountNumber) {
        toast.error('bKash account number is required')
        return
      }
    }

    setSubmitting(true)
    try {
      const body = { method }
      if (method === 'BANK')  body.bank  = bank
      if (method === 'BKASH') body.bkash = bkash

      const res  = await fetch(`/api/freelancers/${freelancerId}/payment`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save')
      toast.success('Payment method saved')
      router.push('/freelancer')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading' || loadingProfile) {
    return <PageLoader />
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Toaster position="top-center" />
      <PageHeader title="Payment method" />

      <Card as="form" onSubmit={handleSubmit}>
        <div className="space-y-6 p-6">
          {/* Method Selector */}
          <Tabs
            value={method}
            onChange={setMethod}
            tabs={[
              { value: 'BANK',  label: 'Bank transfer' },
              { value: 'BKASH', label: 'bKash' },
            ]}
          />

          {/* BANK Fields */}
          {method === 'BANK' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { label: 'Bank name',      key: 'bankName',      placeholder: 'e.g. Dutch-Bangla Bank', required: true },
                { label: 'Account number', key: 'accountNumber', placeholder: '0000000000',             required: true },
                { label: 'Account name',   key: 'accountName',   placeholder: 'Full name',              required: true },
                { label: 'Routing number', key: 'routingNumber', placeholder: '090000000' },
                { label: 'SWIFT code',     key: 'swiftCode',     placeholder: 'DBBLBDDH' },
                { label: 'Branch',         key: 'branch',        placeholder: 'e.g. Gulshan' },
              ].map(({ label, key, placeholder, required }) => (
                <Field key={key} label={label} htmlFor={`bank-${key}`} required={required}>
                  <Input
                    id={`bank-${key}`}
                    type="text"
                    value={bank[key]}
                    onChange={e => setBank(b => ({ ...b, [key]: e.target.value }))}
                    placeholder={placeholder}
                  />
                </Field>
              ))}
              <Field label="Division" htmlFor="bank-division" className="sm:col-span-2">
                <Input
                  id="bank-division"
                  type="text"
                  value={bank.division}
                  onChange={e => setBank(b => ({ ...b, division: e.target.value }))}
                  placeholder="e.g. Dhaka"
                />
              </Field>
            </div>
          )}

          {/* bKash Fields */}
          {method === 'BKASH' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Account type" htmlFor="bkash-type">
                <NativeSelect
                  id="bkash-type"
                  value={bkash.accountType}
                  onChange={e => setBkash(b => ({ ...b, accountType: e.target.value }))}
                >
                  {ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Account name" htmlFor="bkash-name">
                <Input
                  id="bkash-name"
                  type="text"
                  value={bkash.accountName}
                  onChange={e => setBkash(b => ({ ...b, accountName: e.target.value }))}
                  placeholder="Account holder"
                />
              </Field>
              <Field label="Account number" htmlFor="bkash-number" required className="sm:col-span-2">
                <Input
                  id="bkash-number"
                  type="text"
                  value={bkash.accountNumber}
                  onChange={e => setBkash(b => ({ ...b, accountNumber: e.target.value }))}
                  placeholder="01XXXXXXXXX"
                />
              </Field>
            </div>
          )}
        </div>

        <CardFooter className="justify-end px-6">
          <Button type="submit" loading={submitting}>
            {submitting ? 'Saving…' : 'Save payment method'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
