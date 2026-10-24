'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  CreditCard, HardDrive, Copy, Check, Save, RefreshCw, PlugZap, AlertTriangle, ExternalLink, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '@/components/ui/Card'
import { inputClass, selectClass } from '@/components/ui/Input'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import EmptyState from '@/components/ui/EmptyState'

const MASK = '••••••••'
const lc = 'mb-2 block text-sm font-medium leading-none text-gray-900'
const hc = 'mt-1.5 text-xs text-muted-foreground'

function Switch({ on }) {
  return (
    <span className={cn('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-gray-900' : 'bg-gray-200')}>
      <span className={cn('absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform', on ? 'translate-x-4' : 'translate-x-0')} />
    </span>
  )
}

function ToggleRow({ title, description, on, onChange, disabled }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{title}</p>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      <button type="button" role="switch" aria-checked={!!on} aria-label={title} disabled={disabled}
        onClick={() => onChange(!on)} className="mt-0.5 shrink-0 disabled:opacity-50">
        <Switch on={on} />
      </button>
    </div>
  )
}

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { toast.error('Copy failed — select the text instead') }
  }
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-36 shrink-0 text-[13px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-xs text-gray-800" title={value}>{value}</code>
        <Button variant="ghost" size="icon-xs" onClick={copy} aria-label={`Copy ${label}`} title="Copy">
          {copied ? <Check className="text-emerald-600" /> : <Copy />}
        </Button>
      </div>
    </div>
  )
}

/**
 * A secret field: empty means "keep the saved one" (sent as the mask), typing
 * replaces it, Remove clears it.
 */
function SecretInput({ id, label, saved, hint, placeholder, value, onChange, cleared, onClear, help }) {
  return (
    <div>
      <label htmlFor={id} className={lc}>{label}</label>
      <div className="flex items-center gap-2">
        <input id={id} type="password" autoComplete="off" spellCheck={false} value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={cleared ? 'Will be removed when you save' : saved ? `Saved (${hint ?? '••••'}) — type to replace` : placeholder}
          className={cn(inputClass, 'font-mono')} />
        {saved && !cleared && !value && (
          <Button variant="ghost" size="sm" onClick={onClear} className="shrink-0 text-gray-500">Remove</Button>
        )}
        {cleared && (
          <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Keep the saved value" title="Keep the saved value" className="shrink-0 text-gray-500"><X /></Button>
        )}
      </div>
      {help && <p className={hc}>{help}</p>}
    </div>
  )
}

const secretOut = (value, cleared) => (value ? value : cleared ? '' : MASK)

function fmtDate(d) {
  return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' }) : '—'
}

// ── Enfinito Pay card ─────────────────────────────────────────────────────────

function EnfinitoPayCard({ data, onSaved }) {
  const pay = data.pay
  const [enabled, setEnabled] = useState(pay.enabled)
  const [accountId, setAccountId] = useState(pay.accountId ?? '')
  const [secretKey, setSecretKey] = useState('')
  const [keyCleared, setKeyCleared] = useState(false)
  const [whsec, setWhsec] = useState('')
  const [whsecCleared, setWhsecCleared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    setEnabled(pay.enabled); setAccountId(pay.accountId ?? '')
    setSecretKey(''); setKeyCleared(false); setWhsec(''); setWhsecCleared(false)
  }, [pay])

  const typedMode = secretKey.startsWith('sk_live_') ? 'live' : secretKey.startsWith('sk_test_') ? 'test' : null
  const mode = typedMode ?? (keyCleared ? null : pay.mode)

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/integrations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pay: {
          enabled, accountId: accountId || null,
          secretKey: secretOut(secretKey.trim(), keyCleared),
          webhookSecret: secretOut(whsec.trim(), whsecCleared),
        } }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not save')
      toast.success('Enfinito Pay settings saved')
      onSaved(j.data)
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  async function test() {
    setTesting(true)
    try {
      const res = await fetch('/api/settings/integrations/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'pay', secretKey: secretKey.trim() || undefined }),
      })
      const j = await res.json()
      if (j.ok) toast.success(`${j.message}${j.mode ? ` (${j.mode} mode)` : ''}`)
      else toast.error(j.message || j.error || 'The key did not work')
    } catch { toast.error('Could not reach the server') }
    finally { setTesting(false) }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
            <CreditCard className="size-4 text-gray-700" />
          </div>
          <div className="min-w-0">
            <CardTitle>Enfinito Pay</CardTitle>
            <CardDescription>Clients pay invoices online — bKash, Nagad, cards, net banking — from a payment link or the client portal.</CardDescription>
          </div>
        </div>
        <CardAction>
          {!pay.enabled ? <Badge variant="default">Off</Badge> : pay.mode === 'live' ? <Badge variant="success" dot>Live</Badge> : <Badge variant="warning" dot>Test mode</Badge>}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {data.payApiOverride && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>Talking to a stand-in at <code className="font-mono text-xs">{data.payApiOverride}</code> (ENFINITO_PAY_API_URL), not pay.enfinito.com.</span>
          </div>
        )}
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80 px-4">
          <ToggleRow title="Take payments online" on={enabled} onChange={setEnabled}
            description={enabled ? 'Invoices show a Pay online button, and staff can send payment links.' : 'No online payment anywhere in the CRM.'} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SecretInput id="pay-key" label="Secret key" saved={!!pay.secretKey} hint={pay.secretKeyHint}
              placeholder="sk_live_… or sk_test_…" value={secretKey} onChange={v => { setSecretKey(v); setKeyCleared(false) }}
              cleared={keyCleared} onClear={() => setKeyCleared(c => !c)}
              help={<>From the Enfinito Pay admin → your product → API keys (shown once). {mode === 'test' && <span className="font-medium text-amber-700">Test keys move no money; their payments wait in Payment Confirmations instead of being booked.</span>}</>} />
          </div>
          <div className="sm:col-span-2">
            <SecretInput id="pay-whsec" label="Webhook signing secret" saved={!!pay.webhookSecret} hint={pay.webhookSecretHint}
              placeholder="whsec_…" value={whsec} onChange={v => { setWhsec(v); setWhsecCleared(false) }}
              cleared={whsecCleared} onClear={() => setWhsecCleared(c => !c)}
              help="Proves payment events really come from Enfinito Pay. Without it, payments are still confirmed when the customer returns and by a check every minute." />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="pay-account" className={lc}>Money account for online payments</label>
            {data.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active BDT money account yet. <Link href="/admin/finance/accounts" className="font-medium text-gray-900 underline-offset-4 hover:underline">Add one</Link> (type “Payment gateway”, e.g. “Enfinito Pay”).
              </p>
            ) : (
              <select id="pay-account" value={accountId} onChange={e => setAccountId(e.target.value)} className={selectClass}>
                <option value="">Not chosen — payments wait for confirmation</option>
                {data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.type === 'GATEWAY' ? ' (gateway)' : ''}</option>)}
              </select>
            )}
            <p className={hc}>Paid invoices are booked here automatically, like a confirmed payment. Also used for payments made on encloud links.</p>
          </div>
        </div>

        <div className="space-y-2.5 rounded-lg bg-gray-50 p-4">
          <p className="text-[13px] font-medium text-gray-900">In the Enfinito Pay admin, for this product</p>
          <CopyRow label="Webhook URL" value={data.urls.payWebhook} />
          <CopyRow label="Return domain" value={data.urls.returnDomain} />
        </div>

        {data.status.payments.review > 0 && (
          <Link href="/admin/accounts?tab=confirmations"
            className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 hover:bg-amber-100/60">
            <span className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" />
              {data.status.payments.review} online payment{data.status.payments.review === 1 ? '' : 's'} could not be booked automatically</span>
            <span className="inline-flex items-center gap-1 font-medium">Payment Confirmations <ExternalLink className="size-3.5" /></span>
          </Link>
        )}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" onClick={test} loading={testing}>{!testing && <PlugZap />} Test key</Button>
        <Button onClick={save} loading={saving}>{!saving && <Save />} Save</Button>
      </CardFooter>
    </Card>
  )
}

// ── encloud card ──────────────────────────────────────────────────────────────

function EncloudCard({ data, onSaved, reload }) {
  const enc = data.encloud
  const st = data.status.encloud
  const [form, setForm] = useState(enc)
  const [apiKey, setApiKey] = useState('')
  const [keyCleared, setKeyCleared] = useState(false)
  const [whsec, setWhsec] = useState('')
  const [whsecCleared, setWhsecCleared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    setForm(enc); setApiKey(''); setKeyCleared(false); setWhsec(''); setWhsecCleared(false)
  }, [enc])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/integrations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encloud: {
          enabled: form.enabled, baseUrl: form.baseUrl, autoFolders: form.autoFolders,
          lockDues: form.lockDues, lockWhen: form.lockWhen, bookPayments: form.bookPayments,
          apiKey: secretOut(apiKey.trim(), keyCleared), webhookSecret: secretOut(whsec.trim(), whsecCleared),
        } }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not save')
      toast.success('encloud settings saved')
      onSaved(j.data)
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  async function test() {
    setTesting(true)
    try {
      const res = await fetch('/api/settings/integrations/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'encloud', apiKey: apiKey.trim() || undefined, baseUrl: form.baseUrl || undefined }),
      })
      const j = await res.json()
      if (j.ok) toast.success(j.message)
      else toast.error(j.message || j.error || 'Could not connect')
    } catch { toast.error('Could not reach the server') }
    finally { setTesting(false) }
  }

  async function syncAll() {
    setSyncing(true)
    try {
      const res = await fetch('/api/settings/integrations/sync', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Could not start the sync')
      toast.success(j.running ? 'A sync is already running' : 'Sync started — folders and dues update in the background')
      setTimeout(reload, 4000)
    } catch (err) { toast.error(err.message) }
    finally { setSyncing(false) }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
            <HardDrive className="size-4 text-gray-700" />
          </div>
          <div className="min-w-0">
            <CardTitle>encloud</CardTitle>
            <CardDescription>The client file drive: a folder per client and project, shared links for delivery, and files that stay locked until invoices are paid.</CardDescription>
          </div>
        </div>
        <CardAction>{enc.enabled ? <Badge variant="success" dot>Connected</Badge> : <Badge variant="default">Off</Badge>}</CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80 px-4">
          <ToggleRow title="Connect encloud" on={form.enabled} onChange={v => set('enabled', v)}
            description={form.enabled ? 'Clients, projects and unpaid invoices are kept in step with encloud.' : 'Nothing is sent to encloud.'} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="enc-url" className={lc}>encloud address</label>
            <input id="enc-url" value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} placeholder="https://enfinito.cloud" className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <SecretInput id="enc-key" label="API key" saved={!!enc.apiKey} hint={enc.apiKeyHint}
              placeholder="enc_…" value={apiKey} onChange={v => { setApiKey(v); setKeyCleared(false) }}
              cleared={keyCleared} onClear={() => setKeyCleared(c => !c)}
              help="encloud → Admin → CRM & API → New API key (read & write). You can limit it to this server’s address there." />
          </div>
          <div className="sm:col-span-2">
            <SecretInput id="enc-whsec" label="Events secret" saved={!!enc.webhookSecret} hint={enc.webhookSecretHint}
              placeholder="whsec_…" value={whsec} onChange={v => { setWhsec(v); setWhsecCleared(false) }}
              cleared={whsecCleared} onClear={() => setWhsecCleared(c => !c)}
              help="So the CRM hears when a client pays on an encloud link. Set the address below in encloud first, then Make secret and paste it here." />
          </div>
        </div>

        <div className="space-y-2.5 rounded-lg bg-gray-50 p-4">
          <p className="text-[13px] font-medium text-gray-900">In encloud → Admin → CRM &amp; API → Events to the CRM</p>
          <CopyRow label="Address" value={data.urls.encloudWebhook} />
        </div>

        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80 px-4">
          <ToggleRow title="Create folders automatically" on={form.autoFolders} onChange={v => set('autoFolders', v)}
            description={form.autoFolders ? 'Every active client and project gets its folder in encloud, existing ones included.' : 'Folders are made only when you share a project or press Sync on it.'} />
          <ToggleRow title="Lock files while an invoice is unpaid" on={form.lockDues} onChange={v => set('lockDues', v)}
            description={form.lockDues ? 'The client pays the balance through Enfinito Pay on the shared link before the files open.' : 'Shared links always open, paid or not.'} />
          {form.lockDues && (
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Start locking</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Only taka invoices lock files. You can unlock any invoice by hand.</p>
              </div>
              <select value={form.lockWhen} onChange={e => set('lockWhen', e.target.value)} className={cn(selectClass, 'sm:w-56')}>
                <option value="ISSUED">When the invoice is sent</option>
                <option value="OVERDUE">After its due date</option>
              </select>
            </div>
          )}
          <ToggleRow title="Book payments made on encloud links" on={form.bookPayments} onChange={v => set('bookPayments', v)}
            description={form.bookPayments ? 'Booked to the online payments account automatically.' : 'They wait in Payment Confirmations (use this while encloud runs on a test key).'} />
        </div>

        {enc.enabled && (
          <div className="rounded-lg border border-gray-200/80 px-4 py-3 text-[13px]">
            <p className="text-gray-700">
              <span className="font-medium text-gray-900">{st.clients}</span> clients · <span className="font-medium text-gray-900">{st.projects}</span> projects · <span className="font-medium text-gray-900">{st.dues}</span> invoices in encloud
              <span className="text-muted-foreground"> · last synced {fmtDate(st.lastSyncedAt)}</span>
              {st.fullSyncRunning && <span className="ml-1 text-amber-700">· syncing now…</span>}
            </p>
            {st.errors.length > 0 && (
              <ul className="mt-2 space-y-1">
                {st.errors.map((e, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-red-700">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span><span className="font-medium">{e.kind === 'DUE' ? 'Invoice' : e.kind === 'PROJECT' ? 'Project' : 'Client'}</span>: {e.error} <span className="text-red-500/80">({fmtDate(e.at)}, retried automatically)</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-2">
        {enc.enabled && <Button variant="ghost" onClick={syncAll} loading={syncing}>{!syncing && <RefreshCw />} Sync everything now</Button>}
        <Button variant="outline" onClick={test} loading={testing}>{!testing && <PlugZap />} Test connection</Button>
        <Button onClick={save} loading={saving}>{!saving && <Save />} Save</Button>
      </CardFooter>
    </Card>
  )
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export default function IntegrationsSettings() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/integrations')
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)
      setData(j.data)
      setError(null)
    } catch (err) { setError(err.message) }
  }, [])

  useEffect(() => { load() }, [load])

  if (error) {
    return (
      <Card>
        <EmptyState icon={AlertTriangle} title="Couldn't load integrations" description={error}
          action={<Button variant="outline" onClick={load}>Retry</Button>} />
      </Card>
    )
  }
  if (!data) return <LoadingSpinner className="py-20" />

  return (
    <div className="space-y-6">
      {!data.canSaveSecrets && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>Keys are stored encrypted. Set <code className="font-mono text-xs">ENCRYPTION_MASTER_KEY</code> on the server before saving them.</span>
        </div>
      )}
      <EnfinitoPayCard data={data} onSaved={setData} />
      <EncloudCard data={data} onSaved={setData} reload={load} />
    </div>
  )
}
