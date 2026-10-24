'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FolderOpen, Share2, Copy, Check, ExternalLink, Ban, Lock, RefreshCw, Pencil, Users, Globe, AlertTriangle } from 'lucide-react'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input'
import { formatMoney } from '@/lib/currencies'

const fmtBytes = (n) => {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = b / 1024, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}
const fmtDay = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : null

async function api(url, opts) {
  const res = await fetch(url, opts)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)
  return j
}

function CopyButton({ value, label = 'Copy link' }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button variant="ghost" size="icon-xs" aria-label={label} title={label} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }
      catch { toast.error('Copy failed — select the link instead') }
    }}>
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
    </Button>
  )
}

function ShareModal({ projectId, onClose, onShared }) {
  const [form, setForm] = useState({ toClient: true, emails: '', access: 'restricted', expires: '30', allowDownload: true, notify: true, message: '', setAsClientLink: true })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function submit(e) {
    e.preventDefault()
    const emails = form.emails.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
    setSaving(true)
    try {
      await api(`/api/projects/${projectId}/drive/shares`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toClient: form.access === 'restricted' && form.toClient,
          emails: form.access === 'restricted' ? emails : [],
          access: form.access,
          expiresInDays: form.expires === 'never' ? null : Number(form.expires),
          allowDownload: form.allowDownload,
          notify: form.access === 'restricted' && form.notify,
          message: form.message,
          setAsClientLink: form.setAsClientLink,
        }),
      })
      toast.success(form.access === 'restricted' && form.notify ? 'Shared — encloud emailed the link' : 'Shared link ready')
      onShared()
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const restricted = form.access === 'restricted'
  return (
    <Modal open onOpenChange={o => { if (!o) onClose() }} title="Share the project files"
      description="A link to this project’s folder in encloud. While an invoice of the project is unpaid, the client pays it on the link before the files open.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Who can open it">
          <NativeSelect value={form.access} onChange={e => set('access', e.target.value)}>
            <option value="restricted">Only the people I add — they confirm their email with a code</option>
            <option value="public">Anyone with the link</option>
          </NativeSelect>
        </Field>
        {restricted && (
          <>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={form.toClient} onChange={e => set('toClient', e.target.checked)} className="size-4 rounded border-gray-300" />
              The client (their company email and every person on the account)
            </label>
            <Field label={form.toClient ? 'Anyone else (optional)' : 'Email addresses'} hint="Separate several with commas.">
              <Input value={form.emails} onChange={e => set('emails', e.target.value)} placeholder="name@company.com" />
            </Field>
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Link expires">
            <NativeSelect value={form.expires} onChange={e => set('expires', e.target.value)}>
              <option value="7">In 7 days</option>
              <option value="30">In 30 days</option>
              <option value="90">In 90 days</option>
              <option value="365">In a year</option>
              <option value="never">Never</option>
            </NativeSelect>
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input type="checkbox" checked={form.allowDownload} onChange={e => set('allowDownload', e.target.checked)} className="size-4 rounded border-gray-300" />
              Allow downloads
            </label>
            {restricted && (
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input type="checkbox" checked={form.notify} onChange={e => set('notify', e.target.checked)} className="size-4 rounded border-gray-300" />
                Email them the link
              </label>
            )}
          </div>
        </div>
        {restricted && form.notify && (
          <Field label="Message (optional)">
            <Textarea rows={2} value={form.message} onChange={e => set('message', e.target.value)} placeholder="e.g. Final cut is up" className="min-h-0 resize-none" />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input type="checkbox" checked={form.setAsClientLink} onChange={e => set('setAsClientLink', e.target.checked)} className="size-4 rounded border-gray-300" />
          Show it to the client in their portal as the project’s files
        </label>
        <ModalFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{!saving && <Share2 />} Share</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

/** Project overview card: the project's files (encloud folder, shared links) and the client's link. */
export default function ProjectFilesCard({ projectId, canUpdate }) {
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(null)
  const [sharing, setSharing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')

  const load = useCallback(() => {
    api(`/api/projects/${projectId}/drive`).then(j => setD(j.data)).catch(() => setD(null))
  }, [projectId])
  useEffect(() => { load() }, [load])

  async function sync() {
    setBusy('sync')
    try { const j = await api(`/api/projects/${projectId}/drive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setD(j.data); toast.success('Folder ready in encloud') }
    catch (err) { toast.error(err.message) }
    finally { setBusy(null) }
  }
  async function revoke(share) {
    if (!confirm('Turn this link off? Everyone who has it loses access at once.')) return
    setBusy(`revoke:${share.id}`)
    try { await api(`/api/projects/${projectId}/drive/shares/${share.id}`, { method: 'DELETE' }); toast.success('Link turned off'); load() }
    catch (err) { toast.error(err.message) }
    finally { setBusy(null) }
  }
  async function saveLink(e) {
    e?.preventDefault()
    setBusy('link')
    try {
      const j = await api(`/api/projects/${projectId}/drive`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ driveLink: linkDraft.trim() || null }) })
      setD(prev => ({ ...prev, driveLink: j.data.driveLink }))
      setEditing(false)
      toast.success(linkDraft.trim() ? 'Client link saved' : 'Client link removed')
    } catch (err) { toast.error(err.message) }
    finally { setBusy(null) }
  }

  if (!d) return null
  if (!d.enabled && !d.driveLink && !canUpdate) return null
  const activeShares = (d.shares ?? []).filter(s => s.status === 'active')

  return (
    <Card>
      {sharing && <ShareModal projectId={projectId} onClose={() => setSharing(false)} onShared={load} />}
      <CardHeader>
        <CardTitle>Files</CardTitle>
        {d.folder?.url && (
          <CardAction>
            <a href={d.folder.url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[13px] font-medium text-gray-700 underline-offset-4 hover:text-gray-900 hover:underline">
              Open in encloud <ExternalLink className="size-3.5" />
            </a>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {d.enabled && (
          d.folder ? (
            <div className="flex items-start gap-2.5">
              <FolderOpen className="mt-0.5 size-4 shrink-0 text-gray-400" />
              <div className="min-w-0 text-[13px] text-gray-600">
                <p>{d.stats ? <><span className="font-medium text-gray-900">{d.stats.files}</span> file{d.stats.files === 1 ? '' : 's'} · {fmtBytes(d.stats.bytes)}</> : 'Folder in encloud'}</p>
                {d.stats?.openDue > 0 && (
                  <p className="mt-0.5 flex items-center gap-1 text-amber-700"><Lock className="size-3" /> {formatMoney(d.stats.openDue, 'BDT')} due — the client pays before the files open</p>
                )}
                {(d.liveError || d.error) && <p className="mt-0.5 text-red-600">{d.liveError || d.error}</p>}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-muted-foreground">{d.error ? <span className="text-red-600">{d.error}</span> : d.autoFolders ? 'The folder is being made in encloud…' : 'No folder in encloud yet.'}</p>
              {canUpdate && <Button variant="outline" size="sm" onClick={sync} loading={busy === 'sync'}>{busy !== 'sync' && <RefreshCw />} {d.error ? 'Retry' : 'Create folder'}</Button>}
            </div>
          )
        )}

        {/* The client's link */}
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-gray-900">Client link</p>
          {editing ? (
            <form onSubmit={saveLink} className="flex items-center gap-1.5">
              <Input autoFocus value={linkDraft} onChange={e => setLinkDraft(e.target.value)} placeholder="https://…" className="h-8 flex-1 text-[13px]" />
              <Button type="submit" size="sm" loading={busy === 'link'}>Save</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            </form>
          ) : d.driveLink ? (
            <div className="flex items-center gap-1">
              <a href={d.driveLink} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700 underline-offset-4 hover:underline" title={d.driveLink}>{d.driveLink}</a>
              <CopyButton value={d.driveLink} />
              {canUpdate && <Button variant="ghost" size="icon-xs" aria-label="Change link" title="Change link" onClick={() => { setLinkDraft(d.driveLink); setEditing(true) }}><Pencil /></Button>}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{d.enabled ? 'Share the folder and the link shows in the client’s portal.' : 'Paste where the client gets the files (Google Drive, Dropbox…).'}</p>
              {canUpdate && <Button variant="ghost" size="xs" onClick={() => { setLinkDraft(''); setEditing(true) }}><Pencil /> Add</Button>}
            </div>
          )}
        </div>

        {/* Shared links in encloud */}
        {d.enabled && activeShares.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium text-gray-900">Shared links</p>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
              {activeShares.map(s => (
                <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                  {s.access === 'public' ? <Globe className="size-3.5 shrink-0 text-gray-400" /> : <Users className="size-3.5 shrink-0 text-gray-400" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-gray-800" title={s.recipients?.join(', ')}>
                      {s.access === 'public' ? 'Anyone with the link' : (s.recipients?.length ? s.recipients.join(', ') : 'No one yet')}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.views} view{s.views === 1 ? '' : 's'} · {s.downloads} download{s.downloads === 1 ? '' : 's'}
                      {s.expires_at ? ` · until ${fmtDay(s.expires_at)}` : ''}
                    </p>
                  </div>
                  {s.locked_by_due && <Badge variant="warning" className="shrink-0"><Lock className="size-3" /> Pay first</Badge>}
                  <CopyButton value={s.url} />
                  {canUpdate && (
                    <Button variant="ghost" size="icon-xs" aria-label="Turn this link off" title="Turn off" onClick={() => revoke(s)}
                      loading={busy === `revoke:${s.id}`} className="text-gray-400 hover:text-red-600">
                      {busy !== `revoke:${s.id}` && <Ban />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {d.enabled && canUpdate && (
          <Button variant="outline" className="w-full" onClick={() => setSharing(true)}>
            <Share2 /> Share with client
          </Button>
        )}
        {!d.enabled && d.error && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="mt-px size-3.5 shrink-0" /> {d.error}</p>
        )}
      </CardContent>
    </Card>
  )
}
