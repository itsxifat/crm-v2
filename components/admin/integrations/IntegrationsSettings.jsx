'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  CreditCard, HardDrive, Copy, Check, Save, RefreshCw, PlugZap, AlertTriangle, ExternalLink, X, PhoneCall, KeyRound,
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

const VAT_OPTIONS = [
  { value: '',           label: 'Company default (Tax settings)' },
  { value: 'STANDARD',   label: 'Standard, 15%' },
  { value: 'REDUCED',    label: 'Reduced rate' },
  { value: 'ZERO_RATED', label: 'Zero-rated' },
  { value: 'EXEMPT',     label: 'Exempt' },
  { value: 'NONE',       label: 'No VAT' },
]
const MANUAL_CHANNELS = [['bkash', 'bKash'], ['nagad', 'Nagad'], ['rocket', 'Rocket'], ['bank', 'Bank transfer'], ['cash', 'Cash'], ['other', 'Anything else']]

function AccountSelect({ id, value, onChange, accounts, empty = 'Not chosen' }) {
  return (
    <select id={id} className={selectClass} value={value || ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">{empty}</option>
      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  )
}

function makeSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `whsec_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
}

function EnvoCard({ data, onSaved }) {
  const envo = data.envo
  const status = data.status?.envo ?? {}
  const rec = status.reconcile
  const [form, setForm] = useState(() => ({ ...envo, webhookSecret: '' }))
  const [cleared, setCleared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [shown, setShown] = useState(null)   // a secret just made: shown once
  const set = (patch) => setForm(f => ({ ...f, ...patch }))

  useEffect(() => { setForm({ ...envo, webhookSecret: '' }); setCleared(false) }, [envo])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/integrations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          envo: {
            enabled:            !!form.enabled,
            webhookSecret:      secretOut(form.webhookSecret, cleared),
            onlineAccountId:    form.onlineAccountId || null,
            manualAccounts:     form.manualAccounts,
            vatTreatment:       form.vatTreatment || null,
            vatRate:            form.vatTreatment ? Number(form.vatRate) || 0 : null,
            sdRate:             Number(form.sdRate) || 0,
            serviceCode:        form.serviceCode || null,
            pricesIncludeVat:   !!form.pricesIncludeVat,
            topupVat:           form.topupVat,
            bookTestPayments:   !!form.bookTestPayments,
            gatewayFeeMode:     form.gatewayFeeMode,
            gatewayFeePercent:  Number(form.gatewayFeePercent) || 0,
            gatewayFeeCategory: form.gatewayFeeCategory,
            incomeCategory:     form.incomeCategory,
          },
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Could not save')
      onSaved(j.data)
      toast.success('Envo settings saved')
    } catch (err) { toast.error(err.message) } finally { setSaving(false) }
  }

  const policy = data.envoPolicy
  const taxSummary = policy?.vatTreatment === 'NONE'
    ? 'No VAT on Envo invoices.'
    : `${policy?.vatTreatment} ${policy?.vatRate}% VAT${policy?.sdRate ? `, ${policy.sdRate}% SD` : ''}, ${policy?.pricesIncludeVat ? 'included in the package price' : 'added on top of the package price'}.`
  const accounts = data.accounts ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-600">
            <PhoneCall className="size-4" />
          </span>
          <div className="min-w-0">
            <CardTitle>Envo</CardTitle>
            <CardDescription>Every Envo invoice and payment comes here by itself and counts under the Envo product. Tax and costs are decided here; Envo follows.</CardDescription>
          </div>
        </div>
        <CardAction>{envo.enabled ? <Badge variant="success" dot>Connected</Badge> : <Badge variant="default">Off</Badge>}</CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <ToggleRow title="Connect Envo" description="Off: Envo's calls are refused and pile up safely in Envo until it is on again." on={form.enabled} onChange={v => set({ enabled: v })} />

        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <CopyRow label="CRM_BASE_URL" value={data.urls?.app ?? ''} />
          {shown && <CopyRow label="CRM_API_SECRET" value={shown} />}
          <p className={hc}>Set both on the Envo server, then restart it.{shown ? ' Copy the secret now: it is not shown again. Press Save to keep it.' : ''}</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <SecretInput id="envo-secret" label="Shared secret" saved={!!envo.webhookSecret} hint={envo.webhookSecretHint} placeholder="whsec_…"
              value={form.webhookSecret} onChange={v => { set({ webhookSecret: v }); setCleared(false) }}
              cleared={cleared} onClear={() => setCleared(c => !c)} />
          </div>
          <Button variant="outline" onClick={() => { const s = makeSecret(); set({ webhookSecret: s }); setShown(s); setCleared(false) }}>
            <KeyRound /> Make secret
          </Button>
        </div>

        <div className="border-t border-gray-100 pt-5">
          <p className="text-sm font-medium text-gray-900">VAT and supplementary duty</p>
          <p className={hc}>Right now: {taxSummary} A change applies to invoices Envo raises from then on.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="envo-treatment" className={lc}>VAT on Envo invoices</label>
              <select id="envo-treatment" className={selectClass} value={form.vatTreatment || ''}
                onChange={e => { const t = e.target.value; set({ vatTreatment: t || null, vatRate: t === 'STANDARD' ? 15 : ['', 'REDUCED'].includes(t) ? form.vatRate : 0 }) }}>
                {VAT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {form.vatTreatment === 'REDUCED' && (
              <div>
                <label htmlFor="envo-rate" className={lc}>VAT rate (%)</label>
                <input id="envo-rate" type="number" min="0" max="15" step="0.01" className={inputClass} value={form.vatRate ?? ''} onChange={e => set({ vatRate: e.target.value })} />
              </div>
            )}
            <div>
              <label htmlFor="envo-sd" className={lc}>Supplementary duty (%)</label>
              <input id="envo-sd" type="number" min="0" max="500" step="0.01" className={inputClass} value={form.sdRate ?? 0} onChange={e => set({ sdRate: e.target.value })} />
            </div>
            <div>
              <label htmlFor="envo-code" className={lc}>VAT service code</label>
              <input id="envo-code" className={inputClass} placeholder="Company default" value={form.serviceCode ?? ''} onChange={e => set({ serviceCode: e.target.value })} />
            </div>
          </div>
          <ToggleRow title="Package prices include VAT" description="On: customers pay the price on the pricing page and the VAT is inside it. Off: VAT is added on top at checkout."
            on={form.pricesIncludeVat} onChange={v => set({ pricesIncludeVat: v })} />
          <ToggleRow title="VAT inside recharges and top-ups" description="Envo Phone recharges and number top-ups go on a balance as they stand. On: their VAT is inside the amount. Off: they carry no VAT. Never added on top."
            on={form.topupVat === 'INCLUDED'} onChange={v => set({ topupVat: v ? 'INCLUDED' : 'NONE' })} />
          <p className={hc}>A customer marked Foreign on their client profile is billed at zero rate.</p>
        </div>

        <div className="border-t border-gray-100 pt-5">
          <p className="text-sm font-medium text-gray-900">Costs</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="envo-fee" className={lc}>Online payment charge</label>
              <select id="envo-fee" className={selectClass} value={form.gatewayFeeMode} onChange={e => set({ gatewayFeeMode: e.target.value })}>
                <option value="ACTUAL">What the gateway reports, else the percentage</option>
                <option value="PERCENT">A fixed percentage</option>
                <option value="NONE">Don't book it</option>
              </select>
              <p className={hc}>Booked as an Envo expense on the money account the payment went to.</p>
              {form.gatewayFeeMode !== 'NONE' && !(Number(form.gatewayFeePercent) > 0) && (
                <p className="mt-1.5 text-xs text-amber-700">Enfinito Pay does not report its charge, so at 0% nothing is booked for its payments. Enter the percentage it keeps.</p>
              )}
            </div>
            {form.gatewayFeeMode !== 'NONE' && (
              <div>
                <label htmlFor="envo-pct" className={lc}>Percentage</label>
                <input id="envo-pct" type="number" min="0" max="100" step="0.01" className={inputClass} value={form.gatewayFeePercent ?? 0} onChange={e => set({ gatewayFeePercent: e.target.value })} />
              </div>
            )}
            <div>
              <label htmlFor="envo-feecat" className={lc}>Expense category</label>
              <input id="envo-feecat" className={inputClass} value={form.gatewayFeeCategory ?? ''} onChange={e => set({ gatewayFeeCategory: e.target.value })} />
            </div>
            <div>
              <label htmlFor="envo-inccat" className={lc}>Income category</label>
              <input id="envo-inccat" className={inputClass} value={form.incomeCategory ?? ''} onChange={e => set({ incomeCategory: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-5">
          <p className="text-sm font-medium text-gray-900">Money accounts</p>
          <p className={hc}>Where receipts are booked. A payment with no account chosen waits in Payment Confirmations.</p>
          <ToggleRow title="Book test payments" description="Only for a demo CRM. Payments made with an Enfinito Pay test key move no money, so leave this off on the real books."
            on={form.bookTestPayments} onChange={v => set({ bookTestPayments: v })} />
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="envo-online" className={lc}>Online (Enfinito Pay)</label>
              <AccountSelect id="envo-online" accounts={accounts} value={form.onlineAccountId} onChange={v => set({ onlineAccountId: v })} empty="Same as Enfinito Pay above" />
            </div>
            {MANUAL_CHANNELS.map(([key, label]) => (
              <div key={key}>
                <label htmlFor={`envo-${key}`} className={lc}>{label}</label>
                <AccountSelect id={`envo-${key}`} accounts={accounts} value={form.manualAccounts?.[key]} onChange={v => set({ manualAccounts: { ...form.manualAccounts, [key]: v } })} />
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-5">
          <p className="text-sm font-medium text-gray-900">Status</p>
          <p className={hc}>
            {status.ok ?? 0} invoices in step, {status.paid ?? 0} paid and booked{status.lastSyncedAt ? `, last received ${fmtDate(status.lastSyncedAt)}` : ''}.
            {rec ? ` Last comparison ${fmtDate(rec.at)}: ${rec.diffCount === 0 ? 'both sides agree' : `${rec.diffCount} difference${rec.diffCount === 1 ? '' : 's'}`} across ${rec.crm?.count ?? 0} invoices.` : ''}
          </p>
          <div className="mt-2">
            <Link href="/admin/accounts?tab=units" className="inline-flex items-center gap-1 text-[13px] font-medium text-gray-900 underline-offset-2 hover:underline">
              Envo's income, expenses and margin <ExternalLink className="size-3.5" />
            </Link>
          </div>
          {!!status.problems?.length && (
            <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-amber-200 bg-amber-50/50">
              {status.problems.map(p => (
                <li key={p.envoId} className="px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    {p.invoiceId
                      ? <Link href={`/admin/invoices/${p.invoiceId}`} className="font-mono text-xs font-medium text-gray-900 underline-offset-2 hover:underline">{p.number}</Link>
                      : <span className="font-mono text-xs font-medium text-gray-900">{p.number}</span>}
                    <Badge variant={p.state === 'REJECTED' ? 'destructive' : 'warning'}>{p.state === 'REJECTED' ? 'Refused' : 'Needs a check'}</Badge>
                  </div>
                  <p className="mt-1 text-gray-600">{p.note}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button onClick={save} loading={saving}>{!saving && <Save />} Save</Button>
      </CardFooter>
    </Card>
  )
}

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
      <EnvoCard data={data} onSaved={setData} />
    </div>
  )
}
