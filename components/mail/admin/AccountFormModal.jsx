'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AtSign, Server, Users, Settings2, Check, Eye, EyeOff, Inbox, Send, PlugZap,
  CheckCircle2, XCircle, Loader2, AlertCircle, Power, RefreshCw, Zap, History,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Tabs from '@/components/ui/Tabs'
import Select from '@/components/ui/Select'
import { Input, Field, Label } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { ACCOUNT_COLORS, MAIL_LIMITS, MAIL_PROVIDERS, providerPreset } from '@/lib/mail/constants'
import Switch from './Switch'
import UserMultiPicker from './UserMultiPicker'
import SignatureEditor from './SignatureEditor'
import { mailApi, testDetailsOf, fieldErrorsOf } from './api'

const DEFAULT_PROVIDER = 'mailcow'
const PROVIDER_OPTIONS = Object.entries(MAIL_PROVIDERS).map(([value, p]) => ({ value, label: p.label }))
const SECURITY_OPTIONS = [
  { value: 'tls', label: 'SSL/TLS' },
  { value: 'starttls', label: 'STARTTLS' },
]
const DEFAULT_PORTS = { imap: { tls: '993', starttls: '143' }, smtp: { tls: '465', starttls: '587' } }
// Ports we may swap when the security mode changes; anything else was typed on purpose.
const STANDARD_PORTS = { imap: ['993', '143'], smtp: ['465', '587', '25'] }
const SYNC_SIZES = [100, 300, 500, 1000, 2000]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HOST_RE = /^[^\s/@]+$/ // rejects pasted URLs / addresses, allows IPs

const FIELD_TAB = {
  email: 'account', name: 'account', fromName: 'account', color: 'account',
  username: 'server', password: 'server', provider: 'server',
  imapHost: 'server', imapPort: 'server', smtpHost: 'server', smtpPort: 'server',
}
const TAB_ORDER = ['account', 'server', 'access', 'settings']

// ── form model ────────────────────────────────────────────────────────────────

function serverForm(s, kind) {
  return {
    host: s?.host ?? '',
    port: s?.port != null ? String(s.port) : DEFAULT_PORTS[kind].tls,
    security: s?.secure === false ? 'starttls' : 'tls',
  }
}

/** Provider preset in form shape. Domain templates ("mail.{domain}") stay blank until the email has a domain. */
function presetFor(provider, email) {
  const raw = MAIL_PROVIDERS[provider] ?? MAIL_PROVIDERS.custom
  const p = providerPreset(provider, email)
  const domain = String(email).split('@')[1]?.trim() || ''
  const host = (kind) => (!domain && raw[kind].host.includes('{domain}') ? '' : p[kind].host)
  return {
    imap: { host: host('imap'), port: String(p.imap.port), security: p.imap.secure ? 'tls' : 'starttls' },
    smtp: { host: host('smtp'), port: String(p.smtp.port), security: p.smtp.secure ? 'tls' : 'starttls' },
    saveSentCopy: p.saveSentCopy,
  }
}

function suggestName(email) {
  const local = String(email).split('@')[0].trim()
  return local
    .split(/[._+-]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const asUser = (u) => (typeof u === 'string' ? { id: u, name: u, email: '' } : u)

function initialForm(account) {
  if (account) {
    return {
      email: account.email ?? '',
      name: account.name ?? '',
      fromName: account.fromName ?? '',
      color: account.color || ACCOUNT_COLORS[0],
      provider: MAIL_PROVIDERS[account.provider] ? account.provider : 'custom',
      username: account.username ?? '',
      password: '',
      imap: serverForm(account.imap, 'imap'),
      smtp: serverForm(account.smtp, 'smtp'),
      assignedUsers: (account.assignedUsers ?? []).map(asUser),
      signature: account.signature ?? '',
      isActive: account.isActive !== false,
      syncEnabled: account.syncEnabled !== false,
      options: {
        realtime: account.options?.realtime !== false,
        saveSentCopy: account.options?.saveSentCopy !== false,
        initialSyncLimit: Number(account.options?.initialSyncLimit) || MAIL_LIMITS.defaultInitialSync,
      },
    }
  }
  const preset = presetFor(DEFAULT_PROVIDER, '')
  return {
    email: '',
    name: '',
    fromName: '',
    color: ACCOUNT_COLORS[0],
    provider: DEFAULT_PROVIDER,
    username: '',
    password: '',
    imap: preset.imap,
    smtp: preset.smtp,
    assignedUsers: [],
    signature: '',
    isActive: true,
    syncEnabled: true,
    options: { realtime: true, saveSentCopy: preset.saveSentCopy, initialSyncLimit: MAIL_LIMITS.defaultInitialSync },
  }
}

const toServer = (s) => ({ host: s.host.trim(), port: Number(s.port), secure: s.security === 'tls' })

function buildPayload(f) {
  const p = {
    name: f.name.trim(),
    email: f.email.trim().toLowerCase(),
    fromName: f.fromName.trim(),
    username: f.username.trim(),
    provider: f.provider,
    imap: toServer(f.imap),
    smtp: toServer(f.smtp),
    signature: f.signature,
    color: f.color,
    assignedUsers: f.assignedUsers.map(u => u.id),
    isActive: f.isActive,
    syncEnabled: f.syncEnabled,
    options: {
      saveSentCopy: f.options.saveSentCopy,
      realtime: f.options.realtime,
      initialSyncLimit: Number(f.options.initialSyncLimit),
    },
  }
  if (f.password) p.password = f.password
  return p
}

/** Only the top-level keys that changed — so PATCH re-tests credentials only when they actually changed. */
function diffPayload(next, prev) {
  const out = {}
  for (const [k, v] of Object.entries(next)) {
    if (JSON.stringify(v) !== JSON.stringify(prev[k])) out[k] = v
  }
  return out
}

function validate(f, isEdit) {
  const e = {}
  const email = f.email.trim()
  if (!email) e.email = 'Required'
  else if (!EMAIL_RE.test(email)) e.email = 'Enter a valid email'
  if (!f.name.trim()) e.name = 'Required'
  if (!f.username.trim()) e.username = 'Required'
  if (!isEdit && !f.password) e.password = 'Required'
  for (const kind of ['imap', 'smtp']) {
    const host = f[kind].host.trim()
    if (!host) e[`${kind}Host`] = 'Required'
    else if (!HOST_RE.test(host)) e[`${kind}Host`] = 'Enter a host name'
    const port = Number(f[kind].port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) e[`${kind}Port`] = 'Invalid port'
  }
  return e
}

const firstErrorTab = (errs) => TAB_ORDER.find(t => Object.keys(errs).some(k => FIELD_TAB[k] === t)) ?? null

// ── pieces ────────────────────────────────────────────────────────────────────

function TabLabel({ text, alert }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      {alert && <span className="size-1.5 rounded-full bg-red-500" />}
    </span>
  )
}

function ErrorAlert({ message }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  )
}

function ServerBox({ kind, title, icon: Icon, value, errors, onChange, onSecurity }) {
  const hostKey = `${kind}Host`
  const portKey = `${kind}Port`
  return (
    <div className="rounded-xl border border-gray-200/80 bg-gray-50/40 p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-900">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </div>
      <div className="space-y-4">
        <Field label="Host" htmlFor={`mail-acc-${kind}-host`} required error={errors[hostKey]}>
          <Input
            id={`mail-acc-${kind}-host`}
            value={value.host}
            onChange={e => onChange(kind, { host: e.target.value })}
            invalid={!!errors[hostKey]}
            placeholder={kind === 'imap' ? 'imap.company.com' : 'smtp.company.com'}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
          <Field label="Port" htmlFor={`mail-acc-${kind}-port`} error={errors[portKey]}>
            <Input
              id={`mail-acc-${kind}-port`}
              inputMode="numeric"
              value={value.port}
              onChange={e => onChange(kind, { port: e.target.value.replace(/\D/g, '').slice(0, 5) })}
              invalid={!!errors[portKey]}
              className="tabular-nums"
            />
          </Field>
          <Field label="Security">
            <Select value={value.security} onChange={v => onSecurity(kind, v)} options={SECURITY_OPTIONS} />
          </Field>
        </div>
      </div>
    </div>
  )
}

function TestResults({ result, testing }) {
  if (result?.error) return <ErrorAlert message={result.error} />
  return (
    <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
      {[['imap', 'IMAP'], ['smtp', 'SMTP']].map(([key, label]) => {
        const r = result?.[key]
        const failed = !testing && r && !r.ok
        let text = '—'
        if (testing) text = 'Testing…'
        else if (r?.ok) text = key === 'imap' && r.folders != null ? `Connected · ${r.folders} folders` : 'Connected'
        else if (r) text = r.error || 'Connection failed'
        return (
          <div key={key} className="flex items-start gap-2.5 px-3 py-2.5 text-sm">
            {testing || !r
              ? <Loader2 className={cn('mt-0.5 size-4 shrink-0 text-gray-400', testing && 'animate-spin')} />
              : r.ok
                ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                : <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />}
            <span className="w-11 shrink-0 font-medium text-gray-900">{label}</span>
            <span className={cn('min-w-0 flex-1 break-words', failed ? 'text-red-600' : 'text-muted-foreground')}>{text}</span>
          </div>
        )
      })}
    </div>
  )
}

function ToggleRow({ id, icon: Icon, label, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <label
        htmlFor={id}
        className={cn('flex cursor-pointer select-none items-center gap-2.5 text-sm font-medium text-gray-900', disabled && 'cursor-not-allowed opacity-50')}
      >
        <Icon className="size-4 text-muted-foreground" />
        {label}
      </label>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

// ── modal ─────────────────────────────────────────────────────────────────────

/**
 * Add / edit a mail account.
 * Props: open, onOpenChange, account (accountItem with manage fields; null = create), onSaved(accountItem)
 */
export default function AccountFormModal({ open, onOpenChange, account = null, onSaved }) {
  const isEdit = !!account
  const [form, setForm] = useState(() => initialForm(account))
  const [tab, setTab] = useState('account')
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState(null)           // { imap, smtp } | { error }
  const [saving, setSaving] = useState(null)       // null | 'save' | 'skip'
  const [saveError, setSaveError] = useState(null) // { message, canSkip }
  const initialRef = useRef(null)
  const touched = useRef({})
  const testSeq = useRef(0)

  // Re-init only when the dialog opens or switches account — list polling must not reset edits.
  useEffect(() => {
    if (!open) return
    const f = initialForm(account)
    setForm(f)
    initialRef.current = f
    touched.current = {
      hosts: !!account,
      name: !!account,
      saveSent: !!account,
      username: !!account && account.username !== account.email,
    }
    testSeq.current++
    setTab('account')
    setErrors({})
    setShowPassword(false)
    setTesting(false)
    setTest(null)
    setSaving(null)
    setSaveError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id])

  const clearErrors = (...keys) => setErrors(prev => {
    if (!keys.some(k => prev[k])) return prev
    const next = { ...prev }
    keys.forEach(k => delete next[k])
    return next
  })

  const update = (patch, ...errorKeys) => {
    setForm(f => ({ ...f, ...patch }))
    if (errorKeys.length) clearErrors(...errorKeys)
  }

  const setOption = (patch) => setForm(f => ({ ...f, options: { ...f.options, ...patch } }))

  const resetTest = () => { testSeq.current++; setTesting(false); setTest(null) }

  const onEmail = (email) => {
    setForm(f => {
      const next = { ...f, email }
      if (!touched.current.username) next.username = email.trim()
      if (!touched.current.name) next.name = suggestName(email)
      if (!touched.current.hosts && f.provider !== 'custom') {
        const p = presetFor(f.provider, email)
        next.imap = p.imap
        next.smtp = p.smtp
      }
      return next
    })
    clearErrors('email', 'username', 'name')
    if (!touched.current.hosts) resetTest()
  }

  // An explicit provider pick replaces the server settings; later email edits keep them in sync again.
  const onProvider = (provider) => {
    if (!provider) return
    setForm(f => {
      const next = { ...f, provider }
      if (provider !== 'custom') {
        const p = presetFor(provider, f.email)
        next.imap = p.imap
        next.smtp = p.smtp
        if (!touched.current.saveSent) next.options = { ...f.options, saveSentCopy: p.saveSentCopy }
      }
      return next
    })
    if (provider !== 'custom') {
      touched.current.hosts = false
      clearErrors('imapHost', 'imapPort', 'smtpHost', 'smtpPort')
    }
    resetTest()
  }

  const onServer = (kind, patch) => {
    touched.current.hosts = true
    setForm(f => ({ ...f, [kind]: { ...f[kind], ...patch } }))
    clearErrors(...Object.keys(patch).map(k => `${kind}${k === 'host' ? 'Host' : 'Port'}`))
    resetTest()
  }

  const onSecurity = (kind, security) => {
    if (!security) return
    touched.current.hosts = true
    setForm(f => {
      const cur = f[kind]
      const port = !cur.port || STANDARD_PORTS[kind].includes(cur.port) ? DEFAULT_PORTS[kind][security] : cur.port
      return { ...f, [kind]: { ...cur, security, port } }
    })
    clearErrors(`${kind}Port`)
    resetTest()
  }

  const runTest = async () => {
    const errs = Object.fromEntries(
      Object.entries(validate(form, isEdit)).filter(([k]) => k === 'email' || FIELD_TAB[k] === 'server')
    )
    if (Object.keys(errs).length) {
      setErrors(prev => ({ ...prev, ...errs }))
      if (Object.keys(errs).every(k => k === 'email')) setTab('account')
      return
    }
    const id = ++testSeq.current
    setTesting(true)
    setTest(null)
    try {
      const json = await mailApi('/api/mail/accounts/test', {
        method: 'POST',
        body: {
          email: form.email.trim().toLowerCase(),
          provider: form.provider,
          username: form.username.trim(),
          password: form.password,
          imap: toServer(form.imap),
          smtp: toServer(form.smtp),
          accountId: account?.id,
        },
      })
      if (id === testSeq.current) setTest(json.data ?? { error: 'No result' })
    } catch (err) {
      if (id === testSeq.current) setTest({ error: err.message })
    } finally {
      if (id === testSeq.current) setTesting(false)
    }
  }

  const save = async (skipTest = false) => {
    const errs = validate(form, isEdit)
    setErrors(errs)
    if (Object.keys(errs).length) {
      setTab(firstErrorTab(errs) ?? tab)
      return
    }
    const payload = buildPayload(form)
    const body = isEdit ? diffPayload(payload, buildPayload(initialRef.current)) : payload
    if (isEdit && !Object.keys(body).length) {
      onOpenChange(false)
      return
    }
    if (skipTest) body.skipTest = true

    setSaving(skipTest ? 'skip' : 'save')
    setSaveError(null)
    try {
      const json = await mailApi(isEdit ? `/api/mail/accounts/${account.id}` : '/api/mail/accounts', {
        method: isEdit ? 'PATCH' : 'POST',
        body,
      })
      toast.success(isEdit ? 'Account updated' : 'Account added')
      onSaved?.(json.data ?? null)
      onOpenChange(false)
    } catch (err) {
      if (err.status === 409) {
        setErrors({ email: err.message })
        setTab('account')
        return
      }
      const fields = fieldErrorsOf(err.body)
      if (fields) {
        setErrors(fields)
        const t = firstErrorTab(fields)
        if (t) setTab(t)
        else setSaveError({ message: Object.values(fields)[0] || err.message, canSkip: false })
        return
      }
      // 422 with test results = the server's credential check failed; offer to store the account anyway.
      const details = testDetailsOf(err.body)
      if (details) {
        testSeq.current++
        setTesting(false)
        setTest(details)
        setTab('server')
      }
      setSaveError({ message: err.message, canSkip: !!details })
    } finally {
      setSaving(null)
    }
  }

  const errorTabs = new Set(Object.keys(errors).map(k => FIELD_TAB[k]).filter(Boolean))
  const testFailed = !!test && !test.error && (test.imap?.ok === false || test.smtp?.ok === false)

  const syncSizeOptions = useMemo(() => {
    const sizes = new Set(SYNC_SIZES)
    if (form.options.initialSyncLimit) sizes.add(Number(form.options.initialSyncLimit))
    return [...sizes].sort((a, b) => a - b).map(n => ({ value: String(n), label: `${n.toLocaleString()} messages` }))
  }, [form.options.initialSyncLimit])

  const tabs = [
    { value: 'account', icon: AtSign, label: <TabLabel text="Account" alert={errorTabs.has('account')} /> },
    { value: 'server', icon: Server, label: <TabLabel text="Server" alert={errorTabs.has('server') || testFailed} /> },
    { value: 'access', icon: Users, label: 'Access', count: form.assignedUsers.length || null },
    { value: 'settings', icon: Settings2, label: 'Settings' },
  ]

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !saving && onOpenChange(v)}
      title={isEdit ? 'Edit account' : 'Add account'}
      size="lg"
    >
      <div className="sticky top-0 z-10 -mx-1 bg-white px-1 pb-4">
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
      </div>

      {saveError && <div className="mb-4"><ErrorAlert message={saveError.message} /></div>}

      <div className="min-h-[25rem]">
        {tab === 'account' && (
          <div className="space-y-5">
            <Field label="Email" htmlFor="mail-acc-email" required error={errors.email}>
              <Input
                id="mail-acc-email"
                type="email"
                value={form.email}
                onChange={e => onEmail(e.target.value)}
                invalid={!!errors.email}
                placeholder="sales@company.com"
                autoComplete="off"
                spellCheck={false}
                autoFocus={!isEdit}
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Display name" htmlFor="mail-acc-name" required error={errors.name}>
                <Input
                  id="mail-acc-name"
                  value={form.name}
                  onChange={e => { touched.current.name = e.target.value !== ''; update({ name: e.target.value }, 'name') }}
                  invalid={!!errors.name}
                  placeholder="Sales"
                  autoComplete="off"
                />
              </Field>
              <Field label="From name" htmlFor="mail-acc-from" error={errors.fromName}>
                <Input
                  id="mail-acc-from"
                  value={form.fromName}
                  onChange={e => update({ fromName: e.target.value }, 'fromName')}
                  placeholder={form.name || 'Company'}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex flex-wrap items-center gap-2.5">
                {ACCOUNT_COLORS.map(c => {
                  const selected = (form.color || '').toLowerCase() === c.toLowerCase()
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => update({ color: c })}
                      aria-label={`Color ${c}`}
                      aria-pressed={selected}
                      className="flex size-7 items-center justify-center rounded-full outline-none transition-transform hover:scale-110 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      style={{ backgroundColor: c, boxShadow: selected ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : undefined }}
                    >
                      {selected && <Check className="size-3.5 text-white" strokeWidth={3} />}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {tab === 'server' && (
          <div className="space-y-5">
            <Field label="Provider">
              <Select value={form.provider} onChange={onProvider} options={PROVIDER_OPTIONS} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Username" htmlFor="mail-acc-user" required error={errors.username}>
                <Input
                  id="mail-acc-user"
                  value={form.username}
                  onChange={e => {
                    touched.current.username = e.target.value !== ''
                    update({ username: e.target.value }, 'username')
                    resetTest()
                  }}
                  invalid={!!errors.username}
                  placeholder={form.email || 'sales@company.com'}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field label="Password" htmlFor="mail-acc-pass" required={!isEdit} error={errors.password}>
                <div className="relative">
                  <Input
                    id="mail-acc-pass"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => { update({ password: e.target.value }, 'password'); resetTest() }}
                    invalid={!!errors.password}
                    placeholder={isEdit ? 'Unchanged' : ''}
                    autoComplete="new-password"
                    spellCheck={false}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ServerBox kind="imap" title="IMAP" icon={Inbox} value={form.imap} errors={errors} onChange={onServer} onSecurity={onSecurity} />
              <ServerBox kind="smtp" title="SMTP" icon={Send} value={form.smtp} errors={errors} onChange={onServer} onSecurity={onSecurity} />
            </div>
            <div className="space-y-3">
              <Button variant="outline" onClick={runTest} loading={testing} disabled={!!saving}>
                {!testing && <PlugZap />}
                Test connection
              </Button>
              {(testing || test) && <TestResults result={test} testing={testing} />}
            </div>
          </div>
        )}

        {tab === 'access' && (
          <UserMultiPicker value={form.assignedUsers} onChange={users => update({ assignedUsers: users })} />
        )}

        {tab === 'settings' && (
          <div className="space-y-5">
            <div>
              <Label>Signature</Label>
              <SignatureEditor value={form.signature} onChange={signature => update({ signature })} />
            </div>
            <div className="divide-y divide-gray-100 rounded-xl border border-gray-200/80">
              <ToggleRow id="mail-acc-active" icon={Power} label="Active" checked={form.isActive} onChange={v => update({ isActive: v })} />
              <ToggleRow id="mail-acc-sync" icon={RefreshCw} label="Sync enabled" checked={form.syncEnabled} onChange={v => update({ syncEnabled: v })} />
              <ToggleRow
                id="mail-acc-realtime"
                icon={Zap}
                label="Real-time sync"
                checked={form.options.realtime}
                onChange={v => setOption({ realtime: v })}
                disabled={!form.syncEnabled}
              />
              <ToggleRow
                id="mail-acc-sent-copy"
                icon={Send}
                label="Save copy to Sent"
                checked={form.options.saveSentCopy}
                onChange={v => { touched.current.saveSent = true; setOption({ saveSentCopy: v }) }}
              />
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="flex items-center gap-2.5 text-sm font-medium text-gray-900">
                  <History className="size-4 text-muted-foreground" />
                  Initial sync size
                </span>
                <Select
                  size="sm"
                  className="w-40"
                  value={String(form.options.initialSyncLimit)}
                  onChange={v => v && setOption({ initialSyncLimit: Number(v) })}
                  options={syncSizeOptions}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <ModalFooter className="sticky -bottom-4 z-10 mt-6 bg-gray-50">
        {saveError?.canSkip && (
          <Button variant="outline" className="sm:mr-auto" onClick={() => save(true)} loading={saving === 'skip'} disabled={!!saving}>
            Save anyway
          </Button>
        )}
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!saving}>Cancel</Button>
        <Button onClick={() => save(false)} loading={saving === 'save'} disabled={!!saving}>
          {isEdit ? 'Save changes' : 'Add account'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
