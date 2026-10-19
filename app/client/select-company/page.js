'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import Image from 'next/image'
import { Building2, ChevronRight, Loader2, LogOut } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Image src="/en-logo.png" alt="Enfinito" width={112} height={26} className="mx-auto mb-8 h-[22px] w-auto object-contain" priority />
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">Choose a company</h1>
        </div>

        <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-xs">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-gray-400" />
            </div>
          ) : companies.length === 0 ? (
            <EmptyState icon={Building2} title="No company linked to your account" description="Contact us to get access." />
          ) : (
            <div className="divide-y divide-gray-100">
              {companies.map(c => (
                <button
                  key={c.id}
                  onClick={() => choose(c.id)}
                  disabled={!!switching}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50/70 disabled:opacity-60"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200/80 bg-white shadow-xs">
                    {c.logo
                      ? <Image src={c.logo} alt="" width={36} height={36} className="size-9 object-cover" />
                      : <Building2 className="size-4 text-gray-600" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{c.company || c.clientCode || 'Company'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.clientCode}{c.role === 'OWNER' ? ' · Owner' : ''}
                    </p>
                  </div>
                  {switching === c.id
                    ? <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" />
                    : <ChevronRight className="size-4 shrink-0 text-gray-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: '/login' })} className="text-muted-foreground">
            <LogOut /> Sign out
          </Button>
        </div>
      </div>
    </div>
  )
}
