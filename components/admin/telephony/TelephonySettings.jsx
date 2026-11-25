'use client'

/**
 * Configuration → Calling: the CRM's connection to Envo (address + API key) and which
 * extension each staff member calls from. Super Admin only (the key is a secret).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { PhoneCall, PlugZap, Save, AlertTriangle, X, Search, CheckCircle2, Headset } from 'lucide-react'
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
const ROLE = { SUPER_ADMIN: 'Super Admin', MANAGER: 'Manager', EMPLOYEE: 'Employee' }

function Switch({ on }) {
  return (
    <span className={cn('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-gray-900' : 'bg-gray-200')}>
      <span className={cn('absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform', on ? 'translate-x-4' : 'translate-x-0')} />
    </span>
  )
}

async function send(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)
  return j
}

// ── Connection ───────────────────────────────────────────────────────────────

function ConnectionCard({ data, onSaved }) {
  const s = data.settings
  const [enabled, setEnabled] = useState(s.enabled)
  const [baseUrl, setBaseUrl] = useState(s.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [keyCleared, setKeyCleared] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => { setEnabled(s.enabled); setBaseUrl(s.baseUrl); setApiKey(''); setKeyCleared(false) }, [s])

  async function save() {
    setSaving(true)
    try {
      const j = await send('PUT', '/api/settings/telephony', {
        enabled, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() ? apiKey.trim() : keyCleared ? '' : MASK,
      })
      toast.success('Calling settings saved')
      onSaved(j.data)
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  async function test() {
    setTesting(true)
    try {
      const j = await send('POST', '/api/settings/telephony/test', { baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined })
      if (j.ok) toast.success(j.message)
      else toast.error(j.message || 'The key did not work')
    } catch (err) { toast.error(err.message) }
    finally { setTesting(false) }
  }

  const envo = data.envo
  const status = !s.enabled ? <Badge>Off</Badge>
    : envo?.ok ? <Badge variant="success" dot>Connected</Badge>
      : <Badge variant="warning" dot>Needs a look</Badge>

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
            <PhoneCall className="size-4 text-gray-700" />
          </div>
          <div className="min-w-0">
            <CardTitle>Connection to Envo</CardTitle>
            <CardDescription>Envo’s address and the API key the CRM calls through.</CardDescription>
          </div>
        </div>
        <CardAction>{status}</CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-gray-200/80 px-4">
          <div className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Phone in the CRM</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {enabled ? 'Everyone with an extension below gets the phone in the top bar.' : 'No phone anywhere in the CRM.'}
              </p>
            </div>
            <button type="button" role="switch" aria-checked={enabled} aria-label="Phone in the CRM" onClick={() => setEnabled(v => !v)} className="mt-0.5 shrink-0">
              <Switch on={enabled} />
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="envo-url" className={lc}>Envo’s address</label>
            <input id="envo-url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://envo.enfinito.cloud"
              className={inputClass} spellCheck={false} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="envo-key" className={lc}>API key</label>
            <div className="flex items-center gap-2">
              <input id="envo-key" type="password" autoComplete="off" spellCheck={false} value={apiKey}
                onChange={e => { setApiKey(e.target.value); setKeyCleared(false) }}
                placeholder={keyCleared ? 'Will be removed when you save' : s.apiKey ? `Saved (${s.apiKeyHint ?? '••••'}) — type to replace` : 'envo_live_…'}
                className={cn(inputClass, 'font-mono')} />
              {s.apiKey && !keyCleared && !apiKey && (
                <Button variant="ghost" size="sm" onClick={() => setKeyCleared(true)} className="shrink-0 text-gray-500">Remove</Button>
              )}
              {keyCleared && (
                <Button variant="ghost" size="icon-sm" onClick={() => setKeyCleared(false)} aria-label="Keep the saved key" title="Keep the saved key" className="shrink-0 text-gray-500"><X /></Button>
              )}
            </div>
            <p className={hc}>
              In Envo, on the SIP server your team’s extensions are on: Integrations → API keys → New key, with <b>Read</b>, <b>Calls</b> and <b>Web phone</b>.
              Allowed origins can stay empty: the CRM talks to Envo from its own server.
            </p>
          </div>
        </div>

        {envo && (envo.ok ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>
              Envo: SIP server <b>{envo.sipServer?.name ?? '—'}</b>, key “{envo.key}”, {envo.extensions.length} extension{envo.extensions.length === 1 ? '' : 's'}.
              {['read', 'calls', 'webphone'].filter(x => !envo.scopes.includes(x)).length > 0 && (
                <span className="font-medium text-amber-700"> The key lacks: {['read', 'calls', 'webphone'].filter(x => !envo.scopes.includes(x)).join(', ')}.</span>
              )}
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>{envo.error}</span>
          </div>
        ))}

        <p className="text-xs text-muted-foreground">
          Browsers open the phone’s connection to {data.wsOrigins.length ? data.wsOrigins.map(o => <code key={o} className="mx-0.5 rounded bg-gray-100 px-1 font-mono">{o}</code>) : 'nowhere'} (set by <code className="font-mono">ENVO_PHONE_WS</code> on the server).
          Calls work best in Chrome or Edge; the microphone is asked for once.
        </p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" onClick={test} loading={testing}>{!testing && <PlugZap />} Test key</Button>
        <Button onClick={save} loading={saving}>{!saving && <Save />} Save</Button>
      </CardFooter>
    </Card>
  )
}

// ── Extensions ───────────────────────────────────────────────────────────────

function ExtensionsCard({ data, onSaved }) {
  const saved = data.settings.extensions
  const [map, setMap] = useState(saved)
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setMap(saved) }, [saved])

  const envoExts = data.envo?.ok ? data.envo.extensions : null
  const byNumber = useMemo(() => new Map((envoExts ?? []).map(e => [String(e.extension), e])), [envoExts])
  const uses = useMemo(() => {
    const m = new Map()
    for (const ext of Object.values(map)) if (ext) m.set(ext, (m.get(ext) ?? 0) + 1)
    return m
  }, [map])
  const dirty = JSON.stringify(Object.entries(map).filter(([, v]) => v).sort()) !== JSON.stringify(Object.entries(saved).filter(([, v]) => v).sort())
  const assignedCount = Object.values(map).filter(Boolean).length

  const staff = data.staff.filter(u => {
    const q = filter.trim().toLowerCase()
    return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || String(map[u.id] ?? '').includes(q)
  })

  async function save() {
    setSaving(true)
    try {
      const j = await send('PUT', '/api/settings/telephony', { extensions: Object.fromEntries(Object.entries(map).filter(([, v]) => v)) })
      toast.success('Extensions saved. People see the change when they next open the CRM.')
      onSaved(j.data)
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Who calls from which extension</CardTitle>
          <CardDescription>
            Giving someone an extension gives them the phone: they call from it in the browser, and its calls ring in their CRM.
            {assignedCount > 0 && ` ${assignedCount} ${assignedCount === 1 ? 'person has' : 'people have'} one.`}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!envoExts && (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-[13px] text-muted-foreground">
            Connect Envo above to pick from its extensions. Until then, type the extension numbers.
          </p>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a person or extension" className={cn(inputClass, 'pl-9')} />
        </div>
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200/80">
          {staff.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nobody matches.</p>}
          {staff.map(u => {
            const ext = map[u.id] ?? ''
            const info = ext ? byNumber.get(ext) : null
            const problems = [
              ext && envoExts && !info && 'Envo has no such extension',
              info && !info.enabled && 'Disabled in Envo',
              info && !info.webPhone && 'Web phone is off for it in Envo',
            ].filter(Boolean)
            return (
              <div key={u.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {u.name}{!u.isActive && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(deactivated)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{[u.designation, ROLE[u.role] ?? u.role, u.email].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-1 sm:w-64">
                  {envoExts ? (
                    <select value={ext} onChange={e => setMap(m => ({ ...m, [u.id]: e.target.value }))} className={selectClass} aria-label={`Extension for ${u.name}`}>
                      <option value="">No phone</option>
                      {ext && !info && <option value={ext}>{ext} (not in Envo)</option>}
                      {envoExts.map(e => (
                        <option key={e.extension} value={String(e.extension)}>
                          {e.extension} · {e.name}{!e.webPhone ? ' (web phone off)' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input value={ext} onChange={e => setMap(m => ({ ...m, [u.id]: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                      placeholder="No phone" inputMode="numeric" className={inputClass} aria-label={`Extension for ${u.name}`} />
                  )}
                  {(problems.length > 0 || (ext && uses.get(ext) > 1) || info) && (
                    <p className={cn('text-xs', problems.length ? 'text-amber-700' : 'text-muted-foreground')}>
                      {problems.length ? problems.join(' · ')
                        : [info && (info.online ? 'Online now' : 'Not signed in on a phone'), uses.get(ext) > 1 && `Shared by ${uses.get(ext)} people`].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        {dirty && <span className="mr-auto text-xs text-amber-700">Unsaved changes</span>}
        <Button onClick={save} loading={saving} disabled={!dirty}>{!saving && <Save />} Save extensions</Button>
      </CardFooter>
    </Card>
  )
}

export default function TelephonySettings() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/telephony')
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
        <EmptyState icon={AlertTriangle} title="Couldn't load the calling settings" description={error}
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
          <span>Keys are stored encrypted. Set <code className="font-mono text-xs">ENCRYPTION_MASTER_KEY</code> on the server before saving the API key.</span>
        </div>
      )}
      <ConnectionCard data={data} onSaved={setData} />
      <ExtensionsCard data={data} onSaved={setData} />
      <div className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
        <Headset className="mt-0.5 size-3.5 shrink-0" />
        <span>Each extension needs its web phone turned on in Envo (Extensions → the extension → Web phone). Calls to the office’s numbers ring the people Envo routes them to, as before; those with the CRM open see who is calling.</span>
      </div>
    </div>
  )
}
