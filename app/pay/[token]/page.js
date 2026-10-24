'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { CheckCircle2, AlertCircle, Clock, Lock, ChevronDown, ShieldCheck, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { formatMoney } from '@/lib/currencies'

const fmtDay = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' }) : null
const fmtWhen = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' }) : null

function Shell({ children }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Image src="/en-logo.png" alt="Enfinito" width={112} height={26} priority className="h-6 w-auto object-contain" />
        </div>
        {children}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Payments are processed securely by Enfinito Pay
        </p>
      </div>
    </main>
  )
}

function Panel({ className, children }) {
  return <div className={cn('rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs sm:p-7', className)}>{children}</div>
}

function StateTile({ tone, icon: Icon, title, children }) {
  const tones = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warn:    'border-amber-200 bg-amber-50 text-amber-700',
    error:   'border-red-200 bg-red-50 text-red-700',
    muted:   'border-gray-200 bg-gray-50 text-gray-600',
  }
  return (
    <div className="text-center">
      <div className={cn('mx-auto flex size-11 items-center justify-center rounded-full border', tones[tone])}>
        <Icon className="size-5" />
      </div>
      <h1 className="mt-4 text-lg font-semibold tracking-tight text-gray-900">{title}</h1>
      <div className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}

export default function PayPage() {
  return (
    <Suspense fallback={<Shell><Panel><LoadingSpinner className="py-16" /></Panel></Shell>}>
      <PayContent />
    </Suspense>
  )
}

function PayContent() {
  const { token } = useParams()
  const search = useSearchParams()
  const sessionId = search.get('session_id')
  const { data: session } = useSession()

  const [view, setView] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [error, setError] = useState(null)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState(null)
  const [showItems, setShowItems] = useState(false)
  const polls = useRef(0)

  const load = useCallback(async (withSession) => {
    try {
      const qs = withSession && sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}${qs}`, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'This payment link could not be opened.')
      setView(j.data)
      setOutcome(j.outcome ?? null)
      setError(null)
      return j.outcome ?? null
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [token, sessionId])

  // First load; on the way back from the checkout, keep asking while the result is pending.
  useEffect(() => {
    let timer
    const run = async () => {
      const o = await load(true)
      if (sessionId && o?.status === 'pending' && polls.current < 15) {
        polls.current += 1
        timer = setTimeout(run, 3000)
      }
    }
    run()
    return () => clearTimeout(timer)
  }, [load, sessionId])

  async function pay() {
    setPaying(true)
    setPayError(null)
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(token)}/checkout`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.url) throw new Error(j.error || 'Online payment is not available right now.')
      window.location.assign(j.url)
    } catch (err) {
      setPayError(err.message)
      setPaying(false)
      load(false)
    }
  }

  function tryAgain() {
    setOutcome(null)
    window.history.replaceState(null, '', `/pay/${encodeURIComponent(token)}`)
  }

  if (error) {
    return (
      <Shell>
        <Panel><StateTile tone="muted" icon={AlertCircle} title="Payment link not available">{error}</StateTile></Panel>
      </Shell>
    )
  }
  if (!view) return <Shell><Panel><LoadingSpinner className="py-16" /></Panel></Shell>

  const { invoice, project, client, company, payment } = view
  const cur = invoice.currency
  const money = (n) => formatMoney(n, cur)
  const clientLink = session?.user?.role === 'CLIENT'

  // ── After the checkout ──
  if (outcome?.status === 'paid') {
    return (
      <Shell>
        <Panel>
          <StateTile tone="success" icon={CheckCircle2} title="Payment received — thank you!">
            {outcome.amount != null && <>We received <span className="font-medium text-gray-900">{money(outcome.amount)}</span> for invoice {invoice.number}.</>}
          </StateTile>
          <dl className="mt-6 space-y-2 rounded-xl bg-gray-50 px-4 py-3 text-sm">
            {outcome.method && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Paid with</dt><dd className="font-medium text-gray-900">{outcome.method}</dd></div>}
            {outcome.transactionId && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Transaction</dt><dd className="font-mono text-xs text-gray-900">{outcome.transactionId}</dd></div>}
            {outcome.paidAt && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Date</dt><dd className="text-gray-900">{fmtWhen(outcome.paidAt)}</dd></div>}
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Still due</dt><dd className="font-medium text-gray-900">{money(invoice.due)}</dd></div>
          </dl>
          {clientLink && <Button href="/client/invoices" variant="outline" className="mt-5 w-full">Back to your invoices</Button>}
        </Panel>
      </Shell>
    )
  }
  if (outcome?.status === 'pending') {
    return (
      <Shell>
        <Panel>
          <StateTile tone="warn" icon={Clock} title="Confirming your payment…">
            This usually takes a few seconds. If you paid, you don’t need to pay again: we’ll confirm it and update the invoice.
          </StateTile>
          {polls.current >= 15 && <Button variant="outline" className="mt-5 w-full" onClick={() => { polls.current = 0; load(true) }}><RotateCcw /> Check again</Button>}
        </Panel>
      </Shell>
    )
  }
  if (outcome && ['failed', 'cancelled', 'expired'].includes(outcome.status)) {
    return (
      <Shell>
        <Panel>
          <StateTile tone="error" icon={AlertCircle} title="The payment was not completed">
            {outcome.status === 'failed' ? 'The payment did not go through. No money was taken.' : 'The checkout was closed before paying. No money was taken.'}
          </StateTile>
          {payment.payable && <Button className="mt-5 w-full" onClick={tryAgain}><RotateCcw /> Try again</Button>}
        </Panel>
      </Shell>
    )
  }

  // ── The invoice ──
  const paid = invoice.status === 'PAID' || (invoice.due <= 0.005 && invoice.total > 0)
  const overdue = invoice.status === 'OVERDUE'
  return (
    <Shell>
      <Panel>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-muted-foreground">{company.name}</p>
            <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-gray-900">Invoice {invoice.number}</h1>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{[client.name, project?.name].filter(Boolean).join(' · ')}</p>
          </div>
          {payment.testMode && !paid && <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Test mode</span>}
        </div>

        {paid ? (
          <div className="mt-6">
            <StateTile tone="success" icon={CheckCircle2} title="This invoice is paid">
              Thank you! Nothing is left to pay on {invoice.number}.
            </StateTile>
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-xl bg-gray-50 px-5 py-4">
              <p className="text-[13px] text-muted-foreground">Amount due</p>
              <p className="mt-0.5 text-3xl font-semibold tracking-tight tabular-nums text-gray-900">{money(payment.payable ? payment.amount : invoice.due)}</p>
              {invoice.dueDate && (
                <p className={cn('mt-1 text-[13px]', overdue ? 'font-medium text-red-600' : 'text-muted-foreground')}>
                  {overdue ? 'Overdue since' : 'Due by'} {fmtDay(invoice.dueDate)}
                </p>
              )}
            </div>
            {payment.pending > 0 && (
              <p className="mt-3 text-[13px] text-muted-foreground">{money(payment.pending)} you reported paying is waiting for our confirmation, so it is not charged again.</p>
            )}
          </>
        )}

        <dl className="mt-5 space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Invoice total</dt><dd className="tabular-nums text-gray-900">{money(invoice.total)}</dd></div>
          {invoice.paid > 0 && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Paid so far</dt><dd className="tabular-nums text-emerald-700">{money(invoice.paid)}</dd></div>}
          {invoice.issueDate && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Issued</dt><dd className="text-gray-900">{fmtDay(invoice.issueDate)}</dd></div>}
        </dl>

        {invoice.items.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <button type="button" onClick={() => setShowItems(s => !s)} className="flex w-full items-center justify-between text-[13px] font-medium text-gray-700">
              What this invoice is for
              <ChevronDown className={cn('size-4 text-gray-400 transition-transform', showItems && 'rotate-180')} />
            </button>
            {showItems && (
              <ul className="mt-2.5 space-y-2">
                {invoice.items.map((it, i) => (
                  <li key={i} className="flex justify-between gap-4 text-[13px]">
                    <span className="min-w-0 text-gray-700">{it.description || 'Item'}{it.quantity > 1 ? ` × ${it.quantity}` : ''}</span>
                    <span className="shrink-0 tabular-nums text-gray-900">{money(it.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!paid && (
          <div className="mt-6">
            {payment.payable ? (
              <>
                <Button size="lg" className="h-12 w-full text-[15px]" onClick={pay} loading={paying}>
                  {!paying && <Lock className="size-4" />} Pay {money(payment.amount)}
                </Button>
                <p className="mt-2.5 text-center text-xs text-muted-foreground">bKash · Nagad · Rocket · Upay · Visa · Mastercard · Net banking</p>
              </>
            ) : (
              <p className="rounded-xl bg-gray-50 px-4 py-3 text-center text-sm text-muted-foreground">
                {payment.reason || 'Nothing is left to pay online right now.'}
              </p>
            )}
            {payError && <p className="mt-3 text-center text-sm text-red-600">{payError}</p>}
          </div>
        )}

        {(company.email || company.phone) && (
          <p className="mt-6 border-t border-gray-100 pt-4 text-center text-xs text-muted-foreground">
            Questions? {company.email && <a href={`mailto:${company.email}`} className="font-medium text-gray-700 hover:underline">{company.email}</a>}
            {company.email && company.phone && ' · '}
            {company.phone && <a href={`tel:${company.phone}`} className="font-medium text-gray-700 hover:underline">{company.phone}</a>}
          </p>
        )}
        {clientLink && (
          <p className="mt-3 text-center text-xs"><Link href="/client/invoices" className="text-muted-foreground hover:text-gray-900 hover:underline">Back to your invoices</Link></p>
        )}
      </Panel>
    </Shell>
  )
}
