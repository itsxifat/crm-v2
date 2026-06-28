'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import Image from 'next/image'
import { Building2, ChevronRight, Loader2, LogOut } from 'lucide-react'
import toast from 'react-hot-toast'

export default function SelectCompanyPage() {
  const router = useRouter()
  const { update } = useSession()
  const [companies, setCompanies] = useState([])
  const [loading, setLoading]     = useState(true)
  const [switching, setSwitching] = useState(null) // id being selected

  const choose = useCallback(async (id) => {
    setSwitching(id)
    try {
      await update({ activeClientId: id })
      router.replace('/client')
    } catch {
      toast.error('Could not open that company')
      setSwitching(null)
    }
  }, [router, update])

  useEffect(() => {
    fetch('/api/client/companies')
      .then(r => r.json())
      .then(d => {
        const list = d.companies ?? []
        setCompanies(list)
        // Exactly one company → skip the chooser entirely.
        if (list.length === 1) choose(list[0].id)
      })
      .catch(() => setCompanies([]))
      .finally(() => setLoading(false))
  }, [choose])

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={32} className="h-8 w-auto object-contain mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-gray-900">Choose a company</h1>
          <p className="text-sm text-gray-500 mt-0.5">Select the company workspace you want to open.</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : companies.length === 0 ? (
            <div className="text-center py-14 px-6">
              <Building2 className="w-9 h-9 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-600">No company linked to your account</p>
              <p className="text-xs text-gray-400 mt-1">Please contact us so we can give you access.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {companies.map(c => (
                <button
                  key={c.id}
                  onClick={() => choose(c.id)}
                  disabled={!!switching}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left disabled:opacity-60"
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 overflow-hidden">
                    {c.logo
                      ? <Image src={c.logo} alt="" width={40} height={40} className="w-10 h-10 object-cover" />
                      : <Building2 className="w-5 h-5 text-blue-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{c.company || c.clientCode || 'Company'}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {c.clientCode}{c.role === 'OWNER' ? ' · Owner' : ''}
                    </p>
                  </div>
                  {switching === c.id
                    ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="mt-4 mx-auto flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
    </div>
  )
}
