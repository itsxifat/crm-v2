'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  Link2, Copy, Check, ExternalLink, Mail, MessageCircle, Ban, Lock, Unlock, RefreshCw, AlertTriangle, CreditCard,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '@/components/ui/Card'
import { Input, Textarea, Field } from '@/components/ui/Input'
import { usePermission } from '@/components/auth/Can'
import { formatMoney } from '@/lib/currencies'

const bdt = (n) => formatMoney(n, 'BDT')
const fmtWhen = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' }) : '—'

const PAYMENT_STATUS = {
  INITIATED: { label: 'At checkout', variant: 'default' },
  FAILED:    { label: 'Attempt failed', variant: 'warning' },
  PAID:      { label: 'Paid', variant: 'success' },
  EXPIRED:   { label: 'Expired', variant: 'default' },
  CANCELLED: { label: 'Cancelled', variant: 'default' },
  REFUNDED:  { label: 'Refunded', variant: 'danger' },
}

async function api(url, opts) {
  const res = await fetch(url, opts)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(j.error || `Request failed (${res.status})`), { data: j.data })
  return j
}

function SendModal({ invoiceId, channel, contact, onClose, onSent }) {
  const isEmail = channel === 'EMAIL'
  const prefill = isEmail ? contact?.email : contact?.phone
  const [to, setTo] = useState(contact?.masked ? '' : (prefill ?? ''))
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)

  async function send(e) {
    e.preventDefault()
    setSending(true)
    try {
      const j = await api(`/api/invoices/${invoiceId}/payment-link/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, to: to.trim() || null, note: note.trim() || null }),
      })
      toast.success(`Payment link sent to ${j.sentTo}`)
      onSent()
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSending(false) }
  }

  return (
    <Modal open onOpenChange={o => { if (!o) onClose() }}
      title={isEmail ? 'Email the payment link' : 'Send the payment link on WhatsApp'}
      description={isEmail ? 'A short email with a Pay now button and the amount due.' : 'A WhatsApp message with the link and the amount due.'}>
      <form onSubmit={send} className="space-y-4">
        <Field label={isEmail ? 'Email' : 'WhatsApp number'}
          hint={contact?.masked && prefill ? `Leave empty to use the client's ${isEmail ? 'email' : 'number'} (${prefill}).` : null}>
          <Input type={isEmail ? 'email' : 'tel'} value={to} onChange={e => setTo(e.target.value)}
            placeholder={isEmail ? 'client@company.com' : '01XXXXXXXXX'} required={!prefill} />
        </Field>
        <Field label="Message (optional)">
          <Textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Added above the link" className="min-h-0 resize-none" />
        </Field>
        <ModalFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={sending}>{!sending && (isEmail ? <Mail /> : <MessageCircle />)} Send</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

function FilesLock({ invoiceId, canConfirm, canSync }) {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = useCallback(() => {
    api(`/api/invoices/${invoiceId}/files-lock`).then(j => setS(j.data)).catch(() => setS(null))
  }, [invoiceId])
  useEffect(() => { load() }, [load])

  async function act(action) {
    setBusy(action)
    try {
      const j = await api(`/api/invoices/${invoiceId}/files-lock`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      setS(j.data)
      toast.success(action === 'unlock' ? 'Files unlocked for this invoice' : action === 'lock' ? 'Files lock again until it is paid' : 'encloud is up to date')
    } catch (err) {
      if (err.data) setS(err.data)
      toast.error(err.message)
    } finally { setBusy(null) }
  }

  if (!s?.enabled) return null
  const wanted = s.wanted?.status
  const off = s.mode === 'OFF'
  let text
  if (s.locked) text = <>The client’s files in encloud are <span className="font-medium text-gray-900">locked</span> until {bdt(s.remote?.amount ?? s.wanted?.amount ?? 0)} is paid.</>
  else if (s.remote?.status === 'paid') text = <>Paid in encloud{s.remote.paidVia === 'enfinito_pay' ? ' (online)' : ''} — the files are open.</>
  else if (off) text = <>Files are not locked for this invoice: {s.offReason ?? 'unlocked by staff'}.</>
  else if (wanted === 'open') text = <>The files will lock until {bdt(s.wanted.amount)} is paid{s.error ? ' once encloud answers' : ''}.</>
  else if (wanted === 'paid') text = <>Paid — the client’s files are open.</>
  else text = <>Files are not locked: {s.wanted?.why ?? 'nothing is due'}.</>

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-gray-200/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2.5">
        {s.locked ? <Lock className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <Unlock className="mt-0.5 size-4 shrink-0 text-gray-400" />}
        <div className="min-w-0 text-[13px] leading-relaxed text-gray-600">
          <p>{text}</p>
          {s.error && <p className="mt-0.5 text-red-600">encloud: {s.error} — retried automatically.</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {canConfirm && !off && (wanted === 'open' || s.locked) && (
          <Button variant="outline" size="sm" onClick={() => act('unlock')} loading={busy === 'unlock'}>{busy !== 'unlock' && <Unlock />} Unlock files</Button>
        )}
        {canConfirm && off && (
          <Button variant="outline" size="sm" onClick={() => act('lock')} loading={busy === 'lock'}>{busy !== 'lock' && <Lock />} Lock until paid</Button>
        )}
        {canSync && (
          <Button variant="ghost" size="sm" onClick={() => act('sync')} loading={busy === 'sync'} title="Make encloud match this invoice now">
            {busy !== 'sync' && <RefreshCw />} Sync
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Invoice page card: Enfinito Pay payment link + online payments, and whether
 * the invoice locks the client's files in encloud.
 */
export default function InvoiceOnlinePanel({ invoice }) {
  const { can, role, ready } = usePermission()
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(null)
  const [copied, setCopied] = useState(false)
  const [sendChannel, setSendChannel] = useState(null)

  const load = useCallback(() => {
    api(`/api/invoices/${invoice.id}/payment-link`).then(j => setD(j.data)).catch(() => setD(null))
  }, [invoice.id])
  useEffect(() => { load() }, [load, invoice.status, invoice.paidAmount])

  if (!ready || !d) return null
  const canSend = can('sales.invoices.send')
  const canConfirm = can('finance.payments.confirm')
  const canSync = canConfirm || can('sales.invoices.update')
  if (!d.enabled && d.payments.length === 0 && role !== 'SUPER_ADMIN') {
    return <FilesLockOnly invoiceId={invoice.id} canConfirm={canConfirm} canSync={canSync} />
  }

  async function createLink() {
    setBusy('create')
    try {
      await api(`/api/invoices/${invoice.id}/payment-link`, { method: 'POST' })
      load()
    } catch (err) { toast.error(err.message) }
    finally { setBusy(null) }
  }
  async function revoke() {
    if (!confirm('Turn this payment link off? Anyone who has it can no longer pay with it. You can make a new one.')) return
    setBusy('revoke')
    try {
      await api(`/api/invoices/${invoice.id}/payment-link`, { method: 'DELETE' })
      toast.success('Payment link turned off')
      load()
    } catch (err) { toast.error(err.message) }
    finally { setBusy(null) }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(d.link.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { toast.error('Copy failed — select the link instead') }
  }
  const waHref = d.link && d.payable && !d.contact.masked && d.contact.phone
    ? `https://wa.me/${(() => { const n = String(d.contact.phone).replace(/\D/g, ''); return /^01\d{9}$/.test(n) ? `88${n}` : n })()}?text=${encodeURIComponent(`Hi ${d.contact.name || ''}, here is the link to pay invoice ${invoice.invoiceNumber} (${bdt(d.amount)} due): ${d.link.url}`)}`
    : null
  const lastSend = d.link?.sends?.[0]

  return (
    <Card>
      {sendChannel && (
        <SendModal invoiceId={invoice.id} channel={sendChannel} contact={d.contact}
          onClose={() => setSendChannel(null)} onSent={load} />
      )}
      <CardHeader>
        <div>
          <CardTitle>Online payment</CardTitle>
          <CardDescription>Payment link with Enfinito Pay — bKash, Nagad, cards and net banking</CardDescription>
        </div>
        {d.enabled && (
          <CardAction>{d.mode === 'live' ? <Badge variant="success" dot>Live</Badge> : <Badge variant="warning" dot>Test mode</Badge>}</CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!d.enabled ? (
          <p className="text-[13px] text-muted-foreground">
            Online payment is off. {role === 'SUPER_ADMIN' && <Link href="/admin/config?tab=integrations" className="font-medium text-gray-900 underline-offset-4 hover:underline">Set up Enfinito Pay</Link>}
          </p>
        ) : !d.payable && !d.link ? (
          <p className="text-[13px] text-muted-foreground">{d.reason ?? 'Nothing is left to pay online: the rest is waiting for confirmation.'}</p>
        ) : !d.link ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-gray-600">Make a link the client can pay <span className="font-medium text-gray-900">{bdt(d.amount)}</span> with. It always charges what is still due.</p>
            {canSend && (
              <Button onClick={createLink} loading={busy === 'create'} className="shrink-0">{busy !== 'create' && <Link2 />} Create payment link</Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-800" title={d.link.url}>{d.link.url}</code>
              <Button variant="outline" size="icon-sm" onClick={copy} aria-label="Copy link" title="Copy link">
                {copied ? <Check className="text-emerald-600" /> : <Copy />}
              </Button>
              <a href={d.link.url} target="_blank" rel="noopener noreferrer" aria-label="Open the payment page" title="Open the payment page"
                className="inline-flex size-8 items-center justify-center rounded-md border border-input bg-white text-gray-900 shadow-xs hover:bg-accent">
                <ExternalLink className="size-4" />
              </a>
            </div>
            {canSend && (
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setSendChannel('EMAIL')} disabled={!d.payable}><Mail /> Email</Button>
                <Button variant="outline" size="sm" onClick={() => setSendChannel('WHATSAPP')} disabled={!d.payable}><MessageCircle /> WhatsApp</Button>
                {waHref && (
                  <a href={waHref} target="_blank" rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-gray-700 hover:bg-accent">
                    Open in WhatsApp
                  </a>
                )}
                <Button variant="ghost" size="sm" onClick={revoke} loading={busy === 'revoke'} className="ml-auto text-gray-500 hover:text-red-600">
                  {busy !== 'revoke' && <Ban />} Turn off
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {d.payable ? <>Charges <span className="font-medium text-gray-700">{bdt(d.amount)}</span> now</> : (d.reason ?? 'Nothing left to pay online')}
              {' · '}opened {d.link.views} time{d.link.views === 1 ? '' : 's'}{d.link.lastViewedAt ? ` (last ${fmtWhen(d.link.lastViewedAt)})` : ''}
              {lastSend && <> · last sent by {lastSend.channel === 'EMAIL' ? 'email' : 'WhatsApp'} to {lastSend.to} on {fmtWhen(lastSend.at)}</>}
            </p>
          </div>
        )}

        {d.enabled && !d.accountSet && role === 'SUPER_ADMIN' && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            No money account is chosen for online payments, so they wait in Payment Confirmations. <Link href="/admin/config?tab=integrations" className="font-medium underline-offset-4 hover:underline">Choose one</Link>
          </p>
        )}

        {d.payments.length > 0 && (
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
            {d.payments.map(p => {
              const st = PAYMENT_STATUS[p.status] ?? { label: p.status, variant: 'default' }
              return (
                <div key={p.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium tabular-nums text-gray-900">
                      <CreditCard className="size-3.5 text-gray-400" />
                      {bdt(p.amountPaid ?? p.amount)}
                      <span className="font-normal text-muted-foreground">
                        {p.methodLabel ? `· ${p.methodLabel} ` : ''}{p.source === 'ENCLOUD' ? '· on an encloud link' : p.startedVia === 'CLIENT_PORTAL' ? '· client portal' : '· payment link'}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {fmtWhen(p.paidAt ?? p.createdAt)}{p.transactionId ? ` · transaction ${p.transactionId}` : ''}{p.livemode === false ? ' · test' : ''}
                    </p>
                    {p.booking?.status === 'REVIEW' && <p className="mt-0.5 text-xs text-amber-700">Not booked: {p.booking.note}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge variant={st.variant}>{st.label}</Badge>
                    {p.status === 'PAID' && p.booking?.status === 'BOOKED' && <Badge variant="outline">Booked</Badge>}
                    {p.status === 'PAID' && p.booking?.status === 'REVIEW' && <Badge variant="warning">Needs a check</Badge>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <FilesLock invoiceId={invoice.id} canConfirm={canConfirm} canSync={canSync} />
      </CardContent>
    </Card>
  )
}

/** Only the encloud lock row (online payment is off and the viewer cannot set it up). */
function FilesLockOnly(props) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    api(`/api/invoices/${props.invoiceId}/files-lock`).then(j => setVisible(!!j.data?.enabled)).catch(() => {})
  }, [props.invoiceId])
  if (!visible) return null
  return (
    <Card>
      <CardHeader><CardTitle>Client files</CardTitle></CardHeader>
      <CardContent><FilesLock {...props} /></CardContent>
    </Card>
  )
}
