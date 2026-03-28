'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import toast, { Toaster } from 'react-hot-toast'

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session])

  async function handleSubmit(e) {
    e.preventDefault()

    if (!freelancerId) {
      toast.error('Could not find your freelancer profile')
      return
    }

    if (method === 'BANK') {
      if (!bank.bankName || !bank.accountNumber || !bank.accountName) {
        toast.error('Bank Name, Account Number and Account Name are required')
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
      toast.success('Payment method saved!')
      router.push('/freelancer')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading' || loadingProfile) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <Toaster position="top-center" />
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-6">
          <h1 className="text-xl font-bold text-white">Set Up Payment Method</h1>
          <p className="text-blue-200 text-sm mt-1">Choose how you want to receive payments</p>
        </div>

        <form onSubmit={handleSubmit} className="px-8 py-8 space-y-6">
          {/* Method Selector */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">Payment Method</label>
            <div className="flex gap-3">
              {['BANK', 'BKASH'].map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-semibold transition-colors ${
                    method === m
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {m === 'BKASH' ? 'bKash' : 'Bank Transfer'}
                </button>
              ))}
            </div>
          </div>

          {/* BANK Fields */}
          {method === 'BANK' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Bank Name *',      key: 'bankName',      placeholder: 'e.g. Dutch-Bangla Bank' },
                  { label: 'Account Number *', key: 'accountNumber', placeholder: '0000000000' },
                  { label: 'Account Name *',   key: 'accountName',   placeholder: 'Your full name' },
                  { label: 'Routing Number',   key: 'routingNumber', placeholder: '090000000' },
                  { label: 'Swift Code',       key: 'swiftCode',     placeholder: 'DBBLBDDH' },
                  { label: 'Branch',           key: 'branch',        placeholder: 'Gulshan Branch' },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                    <input
                      type="text"
                      value={bank[key]}
                      onChange={e => setBank(b => ({ ...b, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Division</label>
                <input
                  type="text"
                  value={bank.division}
                  onChange={e => setBank(b => ({ ...b, division: e.target.value }))}
                  placeholder="e.g. Dhaka"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
            </div>
          )}

          {/* bKash Fields */}
          {method === 'BKASH' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Type</label>
                <select
                  value={bkash.accountType}
                  onChange={e => setBkash(b => ({ ...b, accountType: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                >
                  {ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                <input
                  type="text"
                  value={bkash.accountName}
                  onChange={e => setBkash(b => ({ ...b, accountName: e.target.value }))}
                  placeholder="Name on bKash account"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Number *</label>
                <input
                  type="text"
                  value={bkash.accountNumber}
                  onChange={e => setBkash(b => ({ ...b, accountNumber: e.target.value }))}
                  placeholder="01XXXXXXXXX"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-60 transition-colors text-sm flex items-center justify-center gap-2"
          >
            {submitting && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {submitting ? 'Saving…' : 'Save Payment Method'}
          </button>
        </form>
      </div>
    </div>
  )
}
