'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { CircleAlert, Mail } from 'lucide-react'
import { ComposerProvider } from '@/components/mail/composer/ComposerProvider'
import Mailbox, { MailboxSkeleton } from '@/components/mail/Mailbox'
import { mailApi } from '@/components/mail/mailApi'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { canDo } from '@/lib/rbac'

function MailPageInner() {
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const [accounts, setAccounts] = useState(null)
  const [error, setError] = useState(null)
  // Mailbox registers its refresh handlers here; the provider sits above it.
  const bridge = useRef({})

  const load = useCallback(async () => {
    setError(null)
    try {
      setAccounts(await mailApi.accounts())
    } catch (err) {
      setError(err.message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const onSent = useCallback((...args) => bridge.current.onSent?.(...args), [])
  const onDraftSaved = useCallback((...args) => bridge.current.onDraftSaved?.(...args), [])

  if (error && !accounts) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <EmptyState
          icon={CircleAlert}
          title="Couldn't load mailboxes"
          description={error}
          action={<Button variant="outline" size="sm" onClick={load}>Retry</Button>}
        />
      </div>
    )
  }
  if (!accounts) return <MailboxSkeleton />
  if (!accounts.length) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <EmptyState
          icon={Mail}
          title="No mailboxes"
          action={canDo(session, 'mail.manage') ? <Button href="/admin/mail/accounts">Add account</Button> : null}
        />
      </div>
    )
  }

  const accountParam = searchParams.get('account')
  const defaultAccountId = accounts.length === 1
    ? accounts[0].id
    : accounts.some(a => a.id === accountParam) ? accountParam : undefined

  return (
    <ComposerProvider accounts={accounts} defaultAccountId={defaultAccountId} onSent={onSent} onDraftSaved={onDraftSaved}>
      <Mailbox accounts={accounts} bridge={bridge} />
    </ComposerProvider>
  )
}

export default function MailPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <Suspense fallback={<MailboxSkeleton />}>
        <MailPageInner />
      </Suspense>
    </div>
  )
}
