'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import {
  Mail, Plus, Trash2, Pencil, Save, X, Check,
  Eye, EyeOff, Send, ChevronDown, ChevronUp, ShieldCheck,
  MessageCircle, ExternalLink, Building2, Users,
  CreditCard, ChevronRight, AlertTriangle, Layers, Target,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { invalidateConfigCache, normalizeCategories } from '@/lib/useConfig'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '@/components/ui/Card'
import { inputClass } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

// ── Constants ──────────────────────────────────────────────────────────────────

// Build a unique id from a label. Labels written only in non-Latin script (e.g.
// Bengali) or symbols slug to '' — fall back to a random suffix so every item
// gets a distinct, non-empty id.
function uniqueId(label, taken, { upper = false } = {}) {
  let slug = upper
    ? label.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
    : label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  if (!slug || taken.includes(slug)) {
    const suffix = crypto.randomUUID().slice(0, 8)
    if (upper) slug = slug ? `${slug}_${suffix.toUpperCase()}` : `METHOD_${suffix.toUpperCase()}`
    else       slug = slug ? `${slug}-${suffix}` : `item-${suffix}`
  }
  return slug
}

const PURPOSES = [
  { id: 'general',      label: 'General',            description: 'Default fallback for all emails' },
  { id: 'invoice',      label: 'Invoices',           description: 'Invoice delivery to clients' },
  { id: 'client',       label: 'Client welcome',     description: 'New client account credentials' },
  { id: 'freelancer',   label: 'Freelancer invites', description: 'Freelancer/agency panel invites' },
  { id: 'notification', label: 'Notifications',      description: 'System alerts and reminders' },
]

const WA_PURPOSES = [
  { id: 'general',      label: 'General',            description: 'Default fallback for all messages' },
  { id: 'client',       label: 'Client welcome',     description: 'New client account credentials' },
  { id: 'freelancer',   label: 'Freelancer invites', description: 'Freelancer/agency panel invites' },
  { id: 'onboarding',   label: 'Onboarding',         description: 'Employee onboarding invitations' },
  { id: 'notification', label: 'Notifications',      description: 'System alerts and reminders' },
]

// ── Shared design tokens ───────────────────────────────────────────────────────

const ic = inputClass
const lc = 'mb-2 block text-sm font-medium leading-none text-gray-900'

function Req() {
  return <span className="ml-0.5 text-red-500">*</span>
}

// Small on/off switch (presentational).
function Switch({ on }) {
  return (
    <span className={cn('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-gray-900' : 'bg-gray-200')}>
      <span className={cn('absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform', on ? 'translate-x-4' : 'translate-x-0')} />
    </span>
  )
}

// ── ConfirmModal ───────────────────────────────────────────────────────────────

function ConfirmModal({ title, message, confirmLabel = 'Remove', onConfirm, onCancel, danger = true }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200/80 bg-white shadow-2xl">
        <div className="px-6 pb-4 pt-5">
          <p className="text-base font-semibold text-gray-900">{title ?? 'Are you sure?'}</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
        <div className="flex justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'destructive' : 'default'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

// ── Email sub-components ───────────────────────────────────────────────────────

function emptyAccount() {
  return { id: crypto.randomUUID(), label: '', fromName: '', host: '', port: '587', secure: false, user: '', password: '', purposes: [] }
}

function PurposeChip({ label, title, selected, onClick }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={cn('rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50')}>
      {label}
    </button>
  )
}

function PurposeBadge({ id, selected, onClick }) {
  const p = PURPOSES.find(x => x.id === id)
  return <PurposeChip label={p?.label ?? id} title={p?.description} selected={selected} onClick={() => onClick(id)} />
}

function AccountForm({ initial, onSave, onCancel, isSaving }) {
  const [form, setForm]     = useState(initial ?? emptyAccount())
  const [showPass, setShowPass] = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [testTo,   setTestTo]   = useState('')
  const [showTest, setShowTest] = useState(false)

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }
  function togglePurpose(id) {
    setForm(f => ({ ...f, purposes: f.purposes.includes(id) ? f.purposes.filter(p => p !== id) : [...f.purposes, id] }))
  }
  async function testConnection() {
    if (!form.host || !form.user || !form.password) { toast.error('Fill in host, username, and password first'); return }
    setTesting(true)
    try {
      const res = await fetch('/api/settings/email/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: form, sendTo: testTo || undefined }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      toast.success(j.message || 'Connection successful')
      setShowTest(false)
    } catch (err) { toast.error(err.message || 'Connection failed') }
    finally { setTesting(false) }
  }
  function validate() {
    if (!form.label.trim())    { toast.error('Label is required'); return false }
    if (!form.host.trim())     { toast.error('SMTP host is required'); return false }
    if (!form.user.trim())     { toast.error('Username / email is required'); return false }
    if (!form.password.trim()) { toast.error('Password is required'); return false }
    if (form.purposes.length === 0) { toast.error('Select at least one purpose'); return false }
    return true
  }
  return (
    <Card className="space-y-5 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={lc}>Account label<Req /></label>
          <input value={form.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Invoice mailer" className={ic} />
        </div>
        <div>
          <label className={lc}>Sender name</label>
          <input value={form.fromName} onChange={e => set('fromName', e.target.value)} placeholder="e.g. Enfinito" className={ic} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className={lc}>SMTP host<Req /></label>
          <input value={form.host} onChange={e => set('host', e.target.value)} placeholder="smtp.gmail.com" className={ic} />
        </div>
        <div>
          <label className={lc}>Port</label>
          <input value={form.port} onChange={e => set('port', e.target.value)} placeholder="587" className={ic} />
        </div>
      </div>
      <label className="flex w-fit cursor-pointer items-center gap-2.5">
        <div onClick={() => set('secure', !form.secure)} className="cursor-pointer">
          <Switch on={form.secure} />
        </div>
        <span className="text-sm text-gray-700">Use SSL/TLS (port 465)</span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={lc}>Username / email<Req /></label>
          <input value={form.user} onChange={e => set('user', e.target.value)} placeholder="invoices@yourdomain.com" className={ic} />
        </div>
        <div>
          <label className={lc}>Password / app password<Req /></label>
          <div className="relative">
            <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)} placeholder="••••••••" className={`${ic} pr-10`} />
            <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label={showPass ? 'Hide password' : 'Show password'}>
              {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
      </div>
      <div>
        <label className={lc} title="Which emails go through this account">Used for<Req /></label>
        <div className="flex flex-wrap gap-2">{PURPOSES.map(p => <PurposeBadge key={p.id} id={p.id} selected={form.purposes.includes(p.id)} onClick={togglePurpose} />)}</div>
      </div>
      <div className="border-t border-gray-100 pt-4">
        <button type="button" onClick={() => setShowTest(v => !v)} className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-gray-600 transition-colors hover:text-gray-900">
          <Send className="size-3.5" /> Test connection {showTest ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        {showTest && (
          <div className="flex items-center gap-2">
            <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send test to (optional)" className={cn(ic, 'flex-1')} />
            <Button variant="outline" onClick={testConnection} loading={testing}>
              {!testing && <Send />} Send test
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => validate() && onSave(form)} loading={isSaving}>
          {!isSaving && <Check />} Save account
        </Button>
      </div>
    </Card>
  )
}

function AccountRowActions({ account, onEdit, onDelete }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="icon-sm" onClick={() => onEdit(account)} title="Edit" aria-label="Edit"><Pencil /></Button>
      <Button variant="ghost" size="icon-sm" onClick={() => onDelete(account.id)} title="Remove" aria-label="Remove" className="hover:bg-red-50 hover:text-red-600"><Trash2 /></Button>
    </div>
  )
}

function AccountCard({ account, onEdit, onDelete }) {
  return (
    <Card className="flex items-start gap-4 p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
        <Mail className="size-4 text-gray-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-gray-900">{account.label}</p>
          {account.purposes.includes('general') && <Badge variant="success">Default</Badge>}
        </div>
        <p className="mb-2 truncate text-xs text-muted-foreground">{account.user} · {account.host}:{account.port}</p>
        <div className="flex flex-wrap gap-1.5">
          {account.purposes.map(pid => { const p = PURPOSES.find(x => x.id === pid); return <Badge key={pid} variant="default">{p?.label ?? pid}</Badge> })}
        </div>
      </div>
      <AccountRowActions account={account} onEdit={onEdit} onDelete={onDelete} />
    </Card>
  )
}

// ── WhatsApp sub-components ────────────────────────────────────────────────────

function emptyWAAccount() {
  return { id: crypto.randomUUID(), label: '', apiKey: '', purposes: [] }
}

function WAPurposeBadge({ id, selected, onClick }) {
  const p = WA_PURPOSES.find(x => x.id === id)
  return <PurposeChip label={p?.label ?? id} title={p?.description} selected={selected} onClick={() => onClick(id)} />
}

function WAAccountForm({ initial, onSave, onCancel, isSaving }) {
  const [form,     setForm]     = useState(initial ?? emptyWAAccount())
  const [showKey,  setShowKey]  = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [testTo,   setTestTo]   = useState('')
  const [showTest, setShowTest] = useState(false)

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }
  function togglePurpose(id) {
    setForm(f => ({ ...f, purposes: f.purposes.includes(id) ? f.purposes.filter(p => p !== id) : [...f.purposes, id] }))
  }
  async function testConnection() {
    if (!form.apiKey) { toast.error('Enter an API key first'); return }
    if (!testTo)      { toast.error('Enter a phone number to send the test to'); return }
    setTesting(true)
    try {
      const res = await fetch('/api/settings/whatsapp/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: form, sendTo: testTo }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      toast.success(j.message || 'Test message sent')
      setShowTest(false)
    } catch (err) { toast.error(err.message || 'Test failed') }
    finally { setTesting(false) }
  }
  function validate() {
    if (!form.label.trim())  { toast.error('Label is required'); return false }
    if (!form.apiKey.trim()) { toast.error('API key is required'); return false }
    if (form.purposes.length === 0) { toast.error('Select at least one purpose'); return false }
    return true
  }
  return (
    <Card className="space-y-5 p-5">
      <div>
        <label className={lc}>Account label<Req /></label>
        <input value={form.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Main WhatsApp" className={ic} />
      </div>
      <div>
        <label className={lc}>API key<Req /></label>
        <div className="relative">
          <input type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={e => set('apiKey', e.target.value)} placeholder="enf_live_…" className={`${ic} pr-10 font-mono`} />
          <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" aria-label={showKey ? 'Hide key' : 'Show key'}>
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      <div>
        <label className={lc} title="Which notifications go through this account">Used for<Req /></label>
        <div className="flex flex-wrap gap-2">{WA_PURPOSES.map(p => <WAPurposeBadge key={p.id} id={p.id} selected={form.purposes.includes(p.id)} onClick={togglePurpose} />)}</div>
      </div>
      <div className="border-t border-gray-100 pt-4">
        <button type="button" onClick={() => setShowTest(v => !v)} className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-gray-600 transition-colors hover:text-gray-900">
          <Send className="size-3.5" /> Send test message {showTest ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
        {showTest && (
          <div className="flex items-center gap-2">
            <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="+8801XXXXXXXXX" className={cn(ic, 'flex-1')} />
            <Button variant="outline" onClick={testConnection} loading={testing}>
              {!testing && <Send />} Send test
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => validate() && onSave(form)} loading={isSaving}>
          {!isSaving && <Check />} Save account
        </Button>
      </div>
    </Card>
  )
}

function WAAccountCard({ account, onEdit, onDelete }) {
  return (
    <Card className="flex items-start gap-4 p-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
        <MessageCircle className="size-4 text-gray-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-gray-900">{account.label}</p>
          {account.purposes.includes('general') && <Badge variant="success">Default</Badge>}
        </div>
        <p className="mb-2 font-mono text-xs text-muted-foreground">{account.apiKey ? `${account.apiKey.slice(0, 12)}••••••••` : 'No key'}</p>
        <div className="flex flex-wrap gap-1.5">
          {account.purposes.map(pid => { const p = WA_PURPOSES.find(x => x.id === pid); return <Badge key={pid} variant="default">{p?.label ?? pid}</Badge> })}
        </div>
      </div>
      <AccountRowActions account={account} onEdit={onEdit} onDelete={onDelete} />
    </Card>
  )
}

// ── Ventures/config sub-components ─────────────────────────────────────────────

function autoShortCode(name) {
  if (!name) return ''
  const words = name.trim().split(/[\s&/\-_]+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join('').toUpperCase()
}

function CfgTag({ label, onDelete, onRename }) {
  const [editing, setEditing] = useState(false)
  const [val,     setVal]     = useState(label)
  function commit() {
    const trimmed = val.trim()
    if (!trimmed) { setVal(label); setEditing(false); return }
    if (trimmed !== label) onRename(label, trimmed)
    setEditing(false)
  }
  if (editing) {
    return (
      <span className="inline-flex items-center rounded-md border border-ring bg-white px-2 py-0.5 ring-[3px] ring-ring/30">
        <input autoFocus value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(label); setEditing(false) } }}
          onBlur={commit} className="w-28 bg-transparent text-xs text-gray-900 outline-none" />
      </span>
    )
  }
  return (
    <span className="group/tag inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700">
      <span className="cursor-pointer hover:text-gray-900" onClick={() => setEditing(true)} title="Click to rename">{label}</span>
      <button type="button" onClick={() => onDelete(label)} aria-label={`Remove ${label}`}
        className="ml-0.5 text-gray-400 transition-colors hover:text-red-600 sm:opacity-0 sm:group-hover/tag:opacity-100">
        <X className="size-3" />
      </button>
    </span>
  )
}

function AddInput({ placeholder, onAdd }) {
  const [val, setVal] = useState('')
  function submit() { const t = val.trim(); if (!t) return; onAdd(t); setVal('') }
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }}
        placeholder={placeholder} className={cn(ic, 'h-8 flex-1 text-[13px]')} />
      <Button variant="outline" size="icon-sm" onClick={submit} aria-label="Add"><Plus /></Button>
    </div>
  )
}

function ServiceSection({ service, onUpdate, onDelete, noun = 'service' }) {
  const [expanded,  setExpanded]  = useState(false)
  const [renaming,  setRenaming]  = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [confirmDel,setConfirmDel]= useState(false)
  const renameRef = useRef(null)

  function startRename() { setRenameVal(service.label); setRenaming(true); setTimeout(() => renameRef.current?.select(), 0) }
  function commitRename() {
    const t = renameVal.trim()
    if (t && t !== service.label) onUpdate({ ...service, label: t })
    setRenaming(false)
  }
  const subs = service.subcategories ?? []
  function addSubcat(name) {
    if (subs.includes(name)) { toast.error('Already exists'); return }
    onUpdate({ ...service, subcategories: [...subs, name] })
  }
  function deleteSubcat(name)        { onUpdate({ ...service, subcategories: subs.filter(s => s !== name) }) }
  function renameSubcat(old, next)   { onUpdate({ ...service, subcategories: subs.map(s => s === old ? next : s) }) }

  return (
    <>
      {confirmDel && (
        <ConfirmModal
          title={`Delete ${noun}?`}
          message={`"${service.label}" and its subcategories will be removed. This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { setConfirmDel(false); onDelete(service.id) }}
          onCancel={() => setConfirmDel(false)}
        />
      )}
      <div className="overflow-hidden rounded-lg border border-gray-200/80">
        <div className="flex cursor-pointer items-center justify-between px-3 py-2 transition-colors hover:bg-gray-50" onClick={() => !renaming && setExpanded(e => !e)}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ChevronRight className={`size-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            {renaming ? (
              <input
                ref={renameRef}
                value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
                onBlur={commitRename}
                onClick={e => e.stopPropagation()}
                className={cn(ic, 'h-7 min-w-0 flex-1 px-2.5')}
              />
            ) : (
              <span className="truncate text-sm font-medium text-gray-900">{service.label}</span>
            )}
            <span className="shrink-0 rounded-full bg-gray-100 px-2 text-xs leading-5 tabular-nums text-gray-600">{subs.length}</span>
          </div>
          <div className="ml-2 flex shrink-0 items-center gap-0.5" onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="icon-xs" onClick={startRename} title="Rename" aria-label="Rename" className="text-gray-400"><Pencil className="size-3.5" /></Button>
            <Button variant="ghost" size="icon-xs" onClick={() => setConfirmDel(true)} title="Delete" aria-label="Delete" className="text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-3.5" /></Button>
          </div>
        </div>
        {expanded && (
          <div className="space-y-2 border-t border-gray-100 px-3 py-3">
            <div className="flex flex-wrap gap-1.5">
              {subs.map(sub => <CfgTag key={sub} label={sub} onDelete={deleteSubcat} onRename={renameSubcat} />)}
              {subs.length === 0 && <p className="text-xs text-muted-foreground">No subcategories yet</p>}
            </div>
            <AddInput placeholder="Add subcategory…" onAdd={addSubcat} />
          </div>
        )}
      </div>
    </>
  )
}

function CategoryGroupManager({ items, onChange }) {
  // Coerce any legacy shape (flat strings / objects missing subcategories) to the nested form
  const list = normalizeCategories(items)
  function addCategory(label) {
    if (list.some(c => c.label.toLowerCase() === label.toLowerCase())) { toast.error('Category already exists'); return }
    const id = uniqueId(label, list.map(c => c.id))
    onChange([...list, { id, label, subcategories: [] }])
  }
  function updateCategory(updated) { onChange(list.map(c => c.id === updated.id ? updated : c)) }
  function deleteCategory(id)      { onChange(list.filter(c => c.id !== id)) }
  return (
    <div className="space-y-2">
      {list.map(c => <ServiceSection key={c.id} service={c} onUpdate={updateCategory} onDelete={deleteCategory} noun="category" />)}
      {list.length === 0 && <p className="py-2 text-xs text-muted-foreground">No categories yet</p>}
      <div className="pt-1"><AddInput placeholder="Add category…" onAdd={addCategory} /></div>
    </div>
  )
}

function VenturePanel({ ventureId, services, config, onChange }) {
  const venture = config.ventures?.find(v => v.id === ventureId)
  function addService(label) {
    if (services.some(s => s.label.toLowerCase() === label.toLowerCase())) { toast.error('Service already exists'); return }
    const id = uniqueId(label, services.map(s => s.id))
    onChange([...services, { id, label, subcategories: [] }])
  }
  function updateService(updated) { onChange(services.map(s => s.id === updated.id ? updated : s)) }
  function deleteService(id)      { onChange(services.filter(s => s.id !== id)) }
  return (
    <div className="space-y-2">
      <h4 className="mb-3 text-sm font-semibold text-gray-900" title={`Services & subcategories for ${venture?.label ?? ventureId}, used by the new project form`}>
        Services
      </h4>
      {services.map(svc => <ServiceSection key={svc.id} service={svc} onUpdate={updateService} onDelete={deleteService} />)}
      {services.length === 0 && <p className="py-2 text-xs text-muted-foreground">No services yet</p>}
      <div className="pt-1"><AddInput placeholder="Add service…" onAdd={addService} /></div>
    </div>
  )
}

function LeadOptionList({ label, description, items, onChange }) {
  function add(val) { if (items.includes(val)) { toast.error('Already exists'); return }; onChange([...items, val]) }
  function remove(val) { onChange(items.filter(i => i !== val)) }
  function rename(old, next) { onChange(items.map(i => i === old ? next : i)) }
  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-gray-900">{label}</p>
      {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      <div className="mt-3">
        {items.length === 0
          ? <p className="mb-2 text-xs text-muted-foreground">No options yet</p>
          : <div className="mb-1 flex flex-wrap gap-1.5">{items.map(item => <CfgTag key={item} label={item} onDelete={remove} onRename={rename} />)}</div>
        }
        <AddInput placeholder={`Add ${label.toLowerCase()}…`} onAdd={add} />
      </div>
    </Card>
  )
}

function DepartmentsSection() {
  const [departments, setDepartments] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [deleting,    setDeleting]    = useState(null)
  const [editing,     setEditing]     = useState(null)
  const [form,        setForm]        = useState({ name: '', shortCode: '', description: '' })
  const [codeManual,  setCodeManual]  = useState(false)
  const [confirmDel,  setConfirmDel]  = useState(null) // { id, name }

  function loadDepts() {
    setLoading(true)
    fetch('/api/departments').then(r => r.json()).then(j => setDepartments(j.data ?? [])).catch(() => toast.error('Failed to load departments')).finally(() => setLoading(false))
  }
  useEffect(() => { loadDepts() }, [])

  function handleNameChange(v) { setForm(f => ({ ...f, name: v, shortCode: codeManual ? f.shortCode : autoShortCode(v) })) }
  function handleCodeChange(v) { setCodeManual(true); setForm(f => ({ ...f, shortCode: v.toUpperCase() })) }
  function startEdit(dept)     { setEditing(dept); setForm({ name: dept.name, shortCode: dept.shortCode, description: dept.description ?? '' }); setCodeManual(true) }
  function cancelEdit()        { setEditing(null); setForm({ name: '', shortCode: '', description: '' }); setCodeManual(false) }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const isEdit = !!editing
      const res = await fetch(isEdit ? `/api/departments/${editing.id}` : '/api/departments', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, shortCode: form.shortCode, description: form.description }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(isEdit ? 'Department updated' : 'Department added')
      cancelEdit(); loadDepts()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  async function confirmDelete() {
    const { id } = confirmDel
    setConfirmDel(null)
    setDeleting(id)
    try {
      const res = await fetch(`/api/departments/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success('Department deactivated'); loadDepts()
    } catch (err) { toast.error(err.message) }
    finally { setDeleting(null) }
  }

  return (
    <>
      {confirmDel && (
        <ConfirmModal
          title="Deactivate department?"
          message={`"${confirmDel.name}" will be deactivated. Employees keep their current code.`}
          confirmLabel="Deactivate"
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDel(null)}
          danger={false}
        />
      )}
      <div className="space-y-4">
        <Card as="form" onSubmit={handleSave}>
          <CardHeader>
            <div>
              <CardTitle>{editing ? `Edit ${editing.name}` : 'New department'}</CardTitle>
              <CardDescription>Short codes appear in employee IDs</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className={lc}>Department name<Req /></label>
                <input required value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="e.g. Human Resources" className={ic} />
              </div>
              <div>
                <label className={lc}>Short code<Req /></label>
                <input required value={form.shortCode} onChange={e => handleCodeChange(e.target.value)} placeholder="e.g. HR" maxLength={6} className={`${ic} font-mono uppercase tracking-widest`} />
                <p className="mt-1.5 text-xs text-muted-foreground">Auto-generated, editable</p>
              </div>
              <div>
                <label className={lc}>Description</label>
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" className={ic} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" loading={saving}>
                {!saving && (editing ? <Check /> : <Plus />)}
                {editing ? 'Save' : 'Add department'}
              </Button>
              {editing && <Button variant="outline" onClick={cancelEdit}>Cancel</Button>}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle>Active departments</CardTitle>
          </CardHeader>
          {loading ? (
            <LoadingSpinner className="py-8" />
          ) : departments.length === 0 ? (
            <EmptyState icon={Users} title="No departments yet" className="py-8" />
          ) : (
            <div className="divide-y divide-gray-100 border-t border-gray-100">
              {departments.map(dept => (
                <div key={dept.id} className={`flex items-center justify-between px-5 py-3 transition-colors ${editing?.id === dept.id ? 'bg-gray-50' : 'hover:bg-gray-50/70'}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="min-w-[40px] shrink-0 rounded-md bg-gray-100 px-2 py-0.5 text-center font-mono text-xs font-medium text-gray-700">{dept.shortCode}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{dept.name}</p>
                      {dept.description && <p className="truncate text-xs text-muted-foreground">{dept.description}</p>}
                    </div>
                  </div>
                  <div className="ml-3 flex shrink-0 items-center gap-0.5">
                    <Button variant="ghost" size="icon-sm" onClick={() => startEdit(dept)} title="Edit" aria-label="Edit" className="text-gray-400"><Pencil className="size-3.5" /></Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDel({ id: dept.id, name: dept.name })} loading={deleting === dept.id}
                      title="Deactivate" aria-label="Deactivate" className="text-gray-400 hover:bg-red-50 hover:text-red-600">
                      {deleting !== dept.id && <Trash2 className="size-3.5" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

// ── Tab definitions ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'ventures',     label: 'Ventures & services', icon: Layers },
  { id: 'leads',        label: 'Lead options',        icon: Target },
  { id: 'departments',  label: 'Departments',         icon: Users },
  { id: 'company',      label: 'Company info',        icon: Building2 },
  { id: 'verification', label: 'Verification',        icon: ShieldCheck },
  { id: 'payment',      label: 'Finance',             icon: CreditCard },
  { id: 'email',        label: 'Email',               icon: Mail },
  { id: 'whatsapp',     label: 'WhatsApp',            icon: MessageCircle },
]

const DEFAULT_PM = [
  { value: 'CASH',          label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CARD',          label: 'Card' },
  { value: 'CHEQUE',        label: 'Cheque' },
  { value: 'BKASH',         label: 'bKash' },
  { value: 'NAGAD',         label: 'Nagad' },
  { value: 'ROCKET',        label: 'Rocket' },
  { value: 'ONLINE',        label: 'Online Transfer' },
  { value: 'OTHER',         label: 'Other' },
]

// ── Modal: Add / Edit Venture ──────────────────────────────────────────────────

function VentureModal({ mode, initial, existingIds, onSubmit, onClose }) {
  const isAdd = mode === 'add'

  function _autoPrefix(label) {
    const words = label.trim().split(/\s+/).filter(Boolean)
    if (!words.length) return ''
    let p = words[0].slice(0, 2)
    for (let i = 1; i < words.length && p.length < 3; i++) p += words[i][0]
    return p.toUpperCase().slice(0, 3)
  }
  function _autoId(label) {
    return label.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  }

  const [form,       setForm]       = useState(initial ?? { id: '', label: '', prefix: '', description: '' })
  const [pfxManual,  setPfxManual]  = useState(!isAdd)
  const [idManual,   setIdManual]   = useState(!isAdd)

  function onLabelChange(val) {
    setForm(f => ({
      ...f,
      label:  val,
      id:     idManual  ? f.id     : _autoId(val),
      prefix: pfxManual ? f.prefix : _autoPrefix(val),
    }))
  }

  function handleSubmit() {
    const { id, label, prefix } = form
    if (!label.trim())  { toast.error('Label is required'); return }
    if (!prefix.trim()) { toast.error('Prefix is required'); return }
    if (isAdd) {
      if (!id.trim()) { toast.error('Venture ID is required'); return }
      if (existingIds?.includes(id)) { toast.error('Venture ID already exists'); return }
    }
    onSubmit({ ...form, prefix: form.prefix.toUpperCase() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl border border-gray-200/80 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
          <h3 className="text-base font-semibold text-gray-900">{isAdd ? 'New venture' : `Edit ${initial?.label}`}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="-mr-1.5 -mt-0.5 text-gray-400" aria-label="Close"><X /></Button>
        </div>

        {/* Fields */}
        <div className="space-y-4 px-6 pb-5">
          <div>
            <label className={lc}>Display label<Req /></label>
            <input autoFocus value={form.label} onChange={e => onLabelChange(e.target.value)}
              placeholder="e.g. Enfinito Studio"
              className={ic} />
          </div>

          <div className={`grid gap-4 ${isAdd ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {isAdd && (
              <div>
                <label className={lc}>
                  Venture ID<Req />
                  {!idManual && <span className="ml-1 font-normal text-gray-400">· auto</span>}
                </label>
                <input value={form.id}
                  onChange={e => { setIdManual(true); setForm(f => ({ ...f, id: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) })) }}
                  placeholder="ENSTUDIO"
                  className={`${ic} font-mono uppercase`} />
              </div>
            )}
            <div>
              <label className={lc}>
                Project prefix<Req />
                {!pfxManual && <span className="ml-1 font-normal text-gray-400">· auto</span>}
              </label>
              <input value={form.prefix}
                onChange={e => { setPfxManual(true); setForm(f => ({ ...f, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) })) }}
                placeholder="ENS"
                maxLength={4}
                className={`${ic} font-mono uppercase`} />
            </div>
          </div>

          {form.prefix && (
            <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5">
              <span className="text-xs text-muted-foreground">Project IDs look like</span>
              <span className="font-mono text-sm font-semibold text-gray-900">{form.prefix}P-2604A01</span>
            </div>
          )}

          <div>
            <label className={lc}>Description</label>
            <input value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Short description…"
              className={ic} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>
            {isAdd ? <Plus /> : <Check />}
            {isAdd ? 'Add venture' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main content ───────────────────────────────────────────────────────────────

function ConfigContent() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const activeTab    = searchParams.get('tab') ?? 'ventures'
  const { data: session } = useSession()
  // Email/WhatsApp hold credentials — their APIs are SUPER_ADMIN-only.
  const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

  // Per-section load failures. A failed load must not look like an empty list
  // (a later full-replace save would wipe real data), and must not auto-retry
  // in a loop — the user retries explicitly.
  const [loadErrors, setLoadErrors] = useState({}) // { config?, company?, email?, whatsapp? }
  function setLoadError(key, msg) { setLoadErrors(e => ({ ...e, [key]: msg || 'Request failed' })) }
  function retryLoad(key)          { setLoadErrors(e => { const n = { ...e }; delete n[key]; return n }) }
  async function fetchJson(url) {
    const res = await fetch(url)
    const j   = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)
    return j
  }

  // ── Config state ──────────────────────────────────────────────────────────────
  const [config,       setConfig]       = useState(null)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [configLoading,setConfigLoading]= useState(false)
  const [saving,       setSaving]       = useState(false)
  const [dirty,        setDirty]        = useState(false)
  const [ventureTab,   setVentureTab]   = useState(null)

  // ── Venture modal ─────────────────────────────────────────────────────────────
  const [ventureModalMode,    setVentureModalMode]    = useState(null)  // 'add' | 'edit' | null
  const [ventureModalInitial, setVentureModalInitial] = useState(null)

  // ── Confirm state (payment / email / wa deletes) ───────────────────────────────
  const [confirmState, setConfirmState] = useState(null) // { title, message, onConfirm }

  // ── Verification ──────────────────────────────────────────────────────────────
  const [verification,       setVerification]       = useState({ freelancer: true, clientKyc: true, employeeOnboarding: true })
  const [verificationSaving, setVerificationSaving] = useState(false)

  // ── Payment methods ───────────────────────────────────────────────────────────
  const [paymentMethods, setPaymentMethods] = useState(DEFAULT_PM)
  const [pmSaving,       setPmSaving]       = useState(false)
  const [pmNewLabel,     setPmNewLabel]     = useState('')
  const [pmEditingIdx,   setPmEditingIdx]   = useState(null)
  const [pmEditingLabel, setPmEditingLabel] = useState('')

  // ── Company ───────────────────────────────────────────────────────────────────
  const [company,        setCompany]        = useState({ name: '', address: '', phone: '', email: '', website: '' })
  // Read-only: BIN/TIN are edited in Tax & VAT → Tax Settings (company_bin / company_tin).
  const [companyTax,     setCompanyTax]     = useState({ bin: '', tin: '' })
  const [companyLoaded,  setCompanyLoaded]  = useState(false)
  const [companyLoading, setCompanyLoading] = useState(false)
  const [companySaving,  setCompanySaving]  = useState(false)

  // ── Email ─────────────────────────────────────────────────────────────────────
  const [accounts,     setAccounts]     = useState([])
  const [emailLoaded,  setEmailLoaded]  = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailSaving,  setEmailSaving]  = useState(false)
  const [emailMode,    setEmailMode]    = useState('list')
  const [emailEditing, setEmailEditing] = useState(null)

  // ── WhatsApp ──────────────────────────────────────────────────────────────────
  const [waAccounts, setWaAccounts] = useState([])
  const [waLoaded,   setWaLoaded]   = useState(false)
  const [waLoading,  setWaLoading]  = useState(false)
  const [waSaving,   setWaSaving]   = useState(false)
  const [waMode,     setWaMode]     = useState('list')
  const [waEditing,  setWaEditing]  = useState(null)

  // ── Lazy loaders ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const needsConfig = ['ventures', 'leads', 'verification', 'payment'].includes(activeTab)
    if (!needsConfig || configLoaded || configLoading || loadErrors.config) return
    setConfigLoading(true)
    fetchJson('/api/config')
      .then(j => {
        const data = j.data ?? {}
        setConfig(data)
        setVentureTab(data.ventures?.[0]?.id ?? null)
        const v = data.verification ?? {}
        setVerification({ freelancer: v.freelancer !== false, clientKyc: v.clientKyc !== false, employeeOnboarding: v.employeeOnboarding !== false })
        if (Array.isArray(data.paymentMethods) && data.paymentMethods.length > 0) setPaymentMethods(data.paymentMethods)
        setConfigLoaded(true)
        setConfigLoading(false)
      })
      .catch(err => { toast.error('Failed to load configuration'); setLoadError('config', err.message); setConfigLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, configLoaded, configLoading, loadErrors.config])

  useEffect(() => {
    if (activeTab !== 'company' || companyLoaded || companyLoading || loadErrors.company) return
    setCompanyLoading(true)
    fetchJson('/api/settings?group=company')
      .then(j => {
        const d = j.data ?? {}
        setCompany({ name: d.company_name ?? '', address: d.company_address ?? '', phone: d.company_phone ?? '', email: d.company_email ?? '', website: d.company_website ?? '' })
        setCompanyTax({ bin: d.company_bin ?? '', tin: d.company_tin ?? '' })
        setCompanyLoaded(true)
        setCompanyLoading(false)
      })
      .catch(err => { setLoadError('company', err.message); setCompanyLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, companyLoaded, companyLoading, loadErrors.company])

  useEffect(() => {
    if (activeTab !== 'email' || !isSuperAdmin || emailLoaded || emailLoading || loadErrors.email) return
    setEmailLoading(true)
    fetchJson('/api/settings/email')
      .then(j => { setAccounts(j.data ?? []); setEmailLoaded(true); setEmailLoading(false) })
      .catch(err => { toast.error('Failed to load email settings'); setLoadError('email', err.message); setEmailLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isSuperAdmin, emailLoaded, emailLoading, loadErrors.email])

  useEffect(() => {
    if (activeTab !== 'whatsapp' || !isSuperAdmin || waLoaded || waLoading || loadErrors.whatsapp) return
    setWaLoading(true)
    fetchJson('/api/settings/whatsapp')
      .then(j => { setWaAccounts(j.data ?? []); setWaLoaded(true); setWaLoading(false) })
      .catch(err => { toast.error('Failed to load WhatsApp settings'); setLoadError('whatsapp', err.message); setWaLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isSuperAdmin, waLoaded, waLoading, loadErrors.whatsapp])

  // ── Config (ventures/leads) handlers ─────────────────────────────────────────

  function updateLeadOption(key, values) { setConfig(c => ({ ...c, [key]: values })); setDirty(true) }
  function updateServices(ventureId, services) { setConfig(c => ({ ...c, services: { ...c.services, [ventureId]: services } })); setDirty(true) }

  function openAddVenture() {
    setVentureModalInitial(null)
    setVentureModalMode('add')
  }
  function openEditVenture(v) {
    setVentureModalInitial({ id: v.id, label: v.label, prefix: v.prefix ?? '', description: v.description ?? '' })
    setVentureModalMode('edit')
  }
  function handleVentureSubmit(data) {
    if (ventureModalMode === 'add') {
      setConfig(c => ({ ...c, ventures: [...c.ventures, { id: data.id, label: data.label, description: data.description, active: true, prefix: data.prefix }], services: { ...c.services, [data.id]: [] } }))
      setVentureTab(data.id)
    } else {
      setConfig(c => ({ ...c, ventures: c.ventures.map(x => x.id === data.id ? { ...x, label: data.label, prefix: data.prefix, description: data.description } : x) }))
    }
    setDirty(true)
    setVentureModalMode(null)
  }

  async function saveConfig() {
    setSaving(true)
    try {
      // Verification and payment methods are saved on their own (PATCH) — never
      // send the page-load copies back, or they would revert those changes.
      // eslint-disable-next-line no-unused-vars
      const { verification: _v, paymentMethods: _pm, ...owned } = config
      const res = await fetch('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(owned) })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Configuration saved')
      invalidateConfigCache()
      setDirty(false)
    } catch (err) { toast.error(err.message ?? 'Failed to save') }
    finally { setSaving(false) }
  }

  // ── Company ───────────────────────────────────────────────────────────────────

  async function saveCompany(e) {
    e.preventDefault()
    setCompanySaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _group: 'company', company_name: company.name, company_address: company.address, company_phone: company.phone, company_email: company.email, company_website: company.website }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Company info saved')
    } catch (err) { toast.error(err.message || 'Failed to save') }
    finally { setCompanySaving(false) }
  }

  // ── Verification ──────────────────────────────────────────────────────────────

  async function saveVerification(updated) {
    setVerificationSaving(true)
    try {
      const res = await fetch('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verification: updated }) })
      if (!res.ok) throw new Error((await res.json()).error)
      setVerification(updated)
      setConfig(c => (c ? { ...c, verification: updated } : c))
      invalidateConfigCache()
      toast.success('Verification settings saved')
    } catch (err) { toast.error(err.message || 'Failed to save') }
    finally { setVerificationSaving(false) }
  }
  function toggleVerification(key) { saveVerification({ ...verification, [key]: !verification[key] }) }

  // ── Payment methods ───────────────────────────────────────────────────────────

  async function savePm(methods) {
    setPmSaving(true)
    try {
      const res = await fetch('/api/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentMethods: methods }) })
      if (!res.ok) throw new Error((await res.json()).error)
      setPaymentMethods(methods)
      setConfig(c => (c ? { ...c, paymentMethods: methods } : c))
      invalidateConfigCache()
      toast.success('Payment methods saved')
    } catch (err) { toast.error(err.message || 'Failed to save') }
    finally { setPmSaving(false) }
  }
  function addPaymentMethod() {
    const label = pmNewLabel.trim()
    if (!label) { toast.error('Enter a method name'); return }
    if (paymentMethods.some(m => m.label.toLowerCase() === label.toLowerCase())) { toast.error('A method with this name already exists'); return }
    const value = uniqueId(label, paymentMethods.map(m => m.value), { upper: true })
    savePm([...paymentMethods, { value, label }])
    setPmNewLabel('')
  }
  function deletePaymentMethod(value) {
    const label = paymentMethods.find(m => m.value === value)?.label ?? value
    setConfirmState({ title: 'Remove payment method?', message: `"${label}" will be removed from all payment dropdowns.`, onConfirm: () => { setConfirmState(null); savePm(paymentMethods.filter(m => m.value !== value)) } })
  }
  function startEditPm(idx)  { setPmEditingIdx(idx); setPmEditingLabel(paymentMethods[idx].label) }
  function saveEditPm(idx) {
    const label = pmEditingLabel.trim()
    if (!label) { toast.error('Label cannot be empty'); return }
    savePm(paymentMethods.map((m, i) => i === idx ? { ...m, label } : m))
    setPmEditingIdx(null)
  }

  // ── Email ─────────────────────────────────────────────────────────────────────

  async function saveEmail(updated) {
    setEmailSaving(true)
    try {
      const res = await fetch('/api/settings/email', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Email settings saved')
      setEmailMode('list'); setEmailEditing(null)
    } catch (err) { toast.error(err.message || 'Failed to save') }
    finally { setEmailSaving(false) }
  }
  function handleEmailAdd(account)  { const u = [...accounts, account]; setAccounts(u); saveEmail(u) }
  function handleEmailEdit(account) { const u = accounts.map(a => a.id === account.id ? account : a); setAccounts(u); saveEmail(u) }
  function handleEmailDelete(id) {
    const acct = accounts.find(a => a.id === id)
    setConfirmState({ title: 'Remove email account?', message: `"${acct?.label ?? 'This account'}" will be removed. Emails using this account will fall back to General.`, onConfirm: () => { setConfirmState(null); const u = accounts.filter(a => a.id !== id); setAccounts(u); saveEmail(u) } })
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────────

  async function saveWa(updated) {
    setWaSaving(true)
    try {
      const res = await fetch('/api/settings/whatsapp', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('WhatsApp settings saved')
      setWaMode('list'); setWaEditing(null)
    } catch (err) { toast.error(err.message || 'Failed to save') }
    finally { setWaSaving(false) }
  }
  function handleWaAdd(account)  { const u = [...waAccounts, account]; setWaAccounts(u); saveWa(u) }
  function handleWaEdit(account) { const u = waAccounts.map(a => a.id === account.id ? account : a); setWaAccounts(u); saveWa(u) }
  function handleWaDelete(id) {
    const acct = waAccounts.find(a => a.id === id)
    setConfirmState({ title: 'Remove WhatsApp account?', message: `"${acct?.label ?? 'This account'}" will be removed. Notifications using this account will fall back to General.`, onConfirm: () => { setConfirmState(null); const u = waAccounts.filter(a => a.id !== id); setWaAccounts(u); saveWa(u) } })
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function setTab(id) { router.push(`/admin/config?tab=${id}`, { scroll: false }) }

  const configNeedsLoad = ['ventures', 'leads', 'verification', 'payment'].includes(activeTab) && !loadErrors.config && (configLoading || !configLoaded)
  const visibleTabs     = TABS.filter(t => isSuperAdmin || (t.id !== 'email' && t.id !== 'whatsapp'))

  function renderLoadError(section, label) {
    return (
      <Card>
        <EmptyState
          icon={AlertTriangle}
          title={`Couldn't load ${label}`}
          description={loadErrors[section]}
          action={<Button variant="outline" onClick={() => retryLoad(section)}>Retry</Button>}
        />
      </Card>
    )
  }

  const spinner = <LoadingSpinner className="py-20" />

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl space-y-6">

      {/* Shared confirm modal */}
      {confirmState && (
        <ConfirmModal
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel="Remove"
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {/* Venture add/edit modal */}
      {ventureModalMode && (
        <VentureModal
          mode={ventureModalMode}
          initial={ventureModalInitial}
          existingIds={config?.ventures?.map(v => v.id) ?? []}
          onSubmit={handleVentureSubmit}
          onClose={() => setVentureModalMode(null)}
        />
      )}

      {/* Header */}
      <PageHeader
        title="Configuration"
        actions={(activeTab === 'ventures' || activeTab === 'leads' || activeTab === 'payment') ? (
          <>
            {dirty && <Badge variant="warning" dot>Unsaved changes</Badge>}
            <Button onClick={saveConfig} loading={saving} disabled={!dirty}>
              {!saving && <Save />} Save changes
            </Button>
          </>
        ) : null}
      />

      {/* Tab bar */}
      <Tabs
        variant="underline"
        value={activeTab}
        onChange={setTab}
        tabs={visibleTabs.map(t => ({ value: t.id, label: t.label, icon: t.icon }))}
      />

      {['ventures', 'leads', 'verification', 'payment'].includes(activeTab) && loadErrors.config &&
        renderLoadError('config', 'configuration')}

      {/* Loading */}
      {configNeedsLoad && spinner}

      {/* ── Ventures tab ────────────────────────────────────────────────────── */}
      {activeTab === 'ventures' && config && (
        <Card className="overflow-hidden">
          {/* Venture switcher */}
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
            {(config.ventures ?? []).length > 0 && (
              <Tabs
                size="sm"
                value={ventureTab}
                onChange={setVentureTab}
                tabs={(config.ventures ?? []).map(v => ({
                  value: v.id,
                  label: (
                    <>
                      {v.label}
                      {v.prefix && <span className="font-mono text-[11px] text-muted-foreground">{v.prefix}P</span>}
                    </>
                  ),
                }))}
              />
            )}
            <Button variant="ghost" size="sm" onClick={openAddVenture} className="ml-auto">
              <Plus /> Add venture
            </Button>
          </div>

          {/* Active venture panel */}
          <div className="p-5">
            {(config.ventures ?? []).length === 0 && (
              <EmptyState
                icon={Building2}
                title="No ventures yet"
                action={<Button variant="outline" onClick={openAddVenture}><Plus /> Add venture</Button>}
              />
            )}
            {(config.ventures ?? []).map(v => {
              if (v.id !== ventureTab) return null
              return (
                <div key={v.id}>
                  {/* Venture info */}
                  <div className="mb-6 flex items-start gap-4 rounded-lg bg-gray-50 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">{v.label}</p>
                        <Badge variant="outline" className="font-mono">{v.id}</Badge>
                        {v.prefix ? (
                          <Badge variant="outline" className="font-mono">{v.prefix}P-YYMM</Badge>
                        ) : (
                          <Badge variant="warning">No prefix — using fallback</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-[13px] text-muted-foreground">{v.description || 'No description'}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openEditVenture(v)}>
                      <Pencil /> Edit
                    </Button>
                  </div>
                  <VenturePanel ventureId={v.id} services={(config.services ?? {})[v.id] ?? []} config={config} onChange={svc => updateServices(v.id, svc)} />
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* ── Leads tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'leads' && config && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LeadOptionList label="Sources"             items={config?.leadSources            ?? []} onChange={v => updateLeadOption('leadSources', v)} />
            <LeadOptionList label="Platforms"           items={config?.leadPlatforms          ?? []} onChange={v => updateLeadOption('leadPlatforms', v)} />
            <LeadOptionList label="Business categories" items={config?.leadBusinessCategories ?? []} onChange={v => updateLeadOption('leadBusinessCategories', v)} />
          </div>
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-gray-900">Company item categories</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Presets for employee asset items</p>
            </div>
            <LeadOptionList label="Item categories" items={config?.companyItemCategories ?? []} onChange={v => updateLeadOption('companyItemCategories', v)} />
          </div>
        </div>
      )}

      {/* ── Departments tab ──────────────────────────────────────────────────── */}
      {activeTab === 'departments' && <DepartmentsSection />}

      {/* ── Company tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'company' && (
        loadErrors.company ? (
          renderLoadError('company', 'company information')
        ) : companyLoading || !companyLoaded ? (
          spinner
        ) : (
          <Card as="form" onSubmit={saveCompany}>
            <CardHeader>
              <div>
                <CardTitle>Company information</CardTitle>
                <CardDescription>Shown on invoices and quotations</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className={lc}>Company name</label><input value={company.name}    onChange={e => setCompany(c => ({ ...c, name:    e.target.value }))} placeholder="e.g. Acme Ltd."             className={ic} /></div>
                <div><label className={lc}>Email</label>       <input type="email" value={company.email}   onChange={e => setCompany(c => ({ ...c, email:   e.target.value }))} placeholder="e.g. info@yourcompany.com" className={ic} /></div>
                <div><label className={lc}>Phone</label>       <input value={company.phone}   onChange={e => setCompany(c => ({ ...c, phone:   e.target.value }))} placeholder="e.g. +8801XXXXXXXXX"        className={ic} /></div>
                <div><label className={lc}>Website</label>     <input value={company.website} onChange={e => setCompany(c => ({ ...c, website: e.target.value }))} placeholder="e.g. www.yourcompany.com"    className={ic} /></div>
                <div className="sm:col-span-2"><label className={lc}>Address</label><input value={company.address} onChange={e => setCompany(c => ({ ...c, address: e.target.value }))} placeholder="e.g. 123 Main St, Dhaka" className={ic} /></div>
              </div>
              <div className="flex flex-col gap-3 rounded-lg bg-gray-50 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-700">BIN, TIN &amp; VAT are managed in Tax settings.</p>
                  <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                    BIN {companyTax.bin || 'not set'} · TIN {companyTax.tin || 'not set'}
                  </p>
                </div>
                <Link href="/admin/tax/settings" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-gray-900 underline-offset-4 hover:underline">
                  Open tax settings <ExternalLink className="size-3.5" />
                </Link>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button type="submit" loading={companySaving}>
                {!companySaving && <Save />} Save
              </Button>
            </CardFooter>
          </Card>
        )
      )}

      {/* ── Verification tab ─────────────────────────────────────────────────── */}
      {activeTab === 'verification' && configLoaded && (
        <div className="space-y-3">
          {!configNeedsLoad && (
            <Card className="overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle>Verification &amp; access</CardTitle>
                {verificationSaving && (
                  <CardAction className="text-xs text-muted-foreground">
                    <LoadingSpinner size="sm" /> Saving…
                  </CardAction>
                )}
              </CardHeader>
              <div className="divide-y divide-gray-100 border-t border-gray-100">
                {[
                  { key: 'freelancer',         title: 'Freelancer & agency verification',
                    on:  'KYC and admin approval required before portal access.',
                    off: 'Active immediately; KYC is optional.' },
                  { key: 'clientKyc',          title: 'Client KYC verification',
                    on:  'An admin must approve submitted ID documents.',
                    off: 'Clients are marked Verified on creation.' },
                  { key: 'employeeOnboarding', title: 'Employee onboarding flow',
                    on:  'New hires self-fill via onboarding link; HR approves.',
                    off: 'Admins create employees directly, no link.' },
                ].map(({ key, title, on, off }) => (
                  <div key={key} className="flex items-start justify-between gap-4 px-5 py-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{title}</p>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">{verification[key] ? on : off}</p>
                    </div>
                    <button type="button" role="switch" aria-checked={!!verification[key]} aria-label={title}
                      disabled={verificationSaving} onClick={() => toggleVerification(key)} className="mt-0.5 shrink-0 disabled:opacity-50">
                      <Switch on={verification[key]} />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Finance tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'payment' && configLoaded && (
        <div className="space-y-6">

          {/* Transaction Categories — each category owns its subcategories (parent → children) */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Transaction categories</CardTitle>
                <CardDescription>Subcategory totals roll up to their parent</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {!configNeedsLoad && config ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-[13px] font-medium text-gray-900">Expense categories</p>
                    <CategoryGroupManager
                      items={config.expenseCategories ?? []}
                      onChange={v => updateLeadOption('expenseCategories', v)}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[13px] font-medium text-gray-900">Income categories</p>
                    <CategoryGroupManager
                      items={config.incomeCategories ?? []}
                      onChange={v => updateLeadOption('incomeCategories', v)}
                    />
                  </div>
                </div>
              ) : (
                !configNeedsLoad && <LoadingSpinner className="py-10" />
              )}
            </CardContent>
          </Card>

          {/* Payment Methods */}
          {!configNeedsLoad && (
            <Card className="overflow-hidden">
              <CardHeader className="pb-3">
                <div>
                  <CardTitle>Payment methods</CardTitle>
                  <CardDescription>Shown in every payment dropdown</CardDescription>
                </div>
              </CardHeader>
              <div className="divide-y divide-gray-100 border-t border-gray-100">
                {paymentMethods.map((m, idx) => (
                  <div key={m.value} className="flex items-center gap-3 px-5 py-2.5">
                    {pmEditingIdx === idx ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <input autoFocus value={pmEditingLabel} onChange={e => setPmEditingLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEditPm(idx); if (e.key === 'Escape') setPmEditingIdx(null) }}
                          className={cn(ic, 'h-8 flex-1')} />
                        <Button size="icon-sm" onClick={() => saveEditPm(idx)} disabled={pmSaving} aria-label="Save"><Check /></Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => setPmEditingIdx(null)} aria-label="Cancel" className="text-gray-400"><X /></Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <span className="text-sm font-medium text-gray-900">{m.label}</span>
                          <span className="font-mono text-xs text-muted-foreground">{m.value}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button variant="ghost" size="icon-sm" onClick={() => startEditPm(idx)} title="Rename" aria-label="Rename" className="text-gray-400"><Pencil className="size-3.5" /></Button>
                          <Button variant="ghost" size="icon-sm" onClick={() => deletePaymentMethod(m.value)} disabled={pmSaving} title="Remove" aria-label="Remove" className="text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-3.5" /></Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-5 py-3">
                <input value={pmNewLabel} onChange={e => setPmNewLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPaymentMethod() }}
                  placeholder="New method, e.g. PayPal" className={cn(ic, 'flex-1')} />
                <Button variant="outline" onClick={addPaymentMethod} loading={pmSaving} disabled={!pmNewLabel.trim()}>
                  {!pmSaving && <Plus />} Add
                </Button>
              </div>
            </Card>
          )}

        </div>
      )}

      {/* ── Email tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'email' && isSuperAdmin && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-gray-900">
              Email accounts
              <Badge variant="default" className="tabular-nums">{accounts.length}</Badge>
            </h2>
            {emailMode === 'list' && emailLoaded && !emailLoading && (
              <Button onClick={() => { setEmailEditing(null); setEmailMode('add') }}>
                <Plus /> Add account
              </Button>
            )}
          </div>

          {loadErrors.email ? (
            renderLoadError('email', 'email accounts')
          ) : emailLoading || !emailLoaded ? (
            spinner
          ) : (
            <>
              {emailMode === 'add' && <AccountForm initial={null} onSave={handleEmailAdd} onCancel={() => setEmailMode('list')} isSaving={emailSaving} />}
              {accounts.length === 0 && emailMode !== 'add' ? (
                <Card>
                  <EmptyState
                    icon={Mail}
                    title="No email accounts yet"
                    description="Without one, server SMTP settings are used"
                    action={<Button variant="outline" onClick={() => setEmailMode('add')}><Plus /> Add account</Button>}
                  />
                </Card>
              ) : (
                <div className="space-y-3">
                  {accounts.map(account => (
                    emailMode === 'edit' && emailEditing?.id === account.id
                      ? <AccountForm key={account.id} initial={emailEditing} onSave={handleEmailEdit} onCancel={() => { setEmailMode('list'); setEmailEditing(null) }} isSaving={emailSaving} />
                      : <AccountCard key={account.id} account={account} onEdit={a => { setEmailEditing(a); setEmailMode('edit') }} onDelete={handleEmailDelete} />
                  ))}
                </div>
              )}
              <PurposeReference purposes={PURPOSES} />
            </>
          )}
        </div>
      )}

      {/* ── WhatsApp tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'whatsapp' && isSuperAdmin && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-gray-900">
              WhatsApp accounts
              <Badge variant="default" className="tabular-nums">{waAccounts.length}</Badge>
            </h2>
            {waMode === 'list' && waLoaded && !waLoading && (
              <Button onClick={() => { setWaEditing(null); setWaMode('add') }}>
                <Plus /> Add account
              </Button>
            )}
          </div>

          {loadErrors.whatsapp ? (
            renderLoadError('whatsapp', 'WhatsApp accounts')
          ) : waLoading || !waLoaded ? (
            spinner
          ) : (
            <>
              <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Link the WhatsApp instance to a phone number in Enfinito Cloud first.
                </span>
                <a href="https://api.enfinito.cloud" target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium underline-offset-4 hover:underline">
                  Open dashboard <ExternalLink className="size-3.5" />
                </a>
              </div>
              {waMode === 'add' && <WAAccountForm initial={null} onSave={handleWaAdd} onCancel={() => setWaMode('list')} isSaving={waSaving} />}
              {waAccounts.length === 0 && waMode !== 'add' ? (
                <Card>
                  <EmptyState
                    icon={MessageCircle}
                    title="No WhatsApp accounts yet"
                    action={<Button variant="outline" onClick={() => setWaMode('add')}><Plus /> Add account</Button>}
                  />
                </Card>
              ) : (
                <div className="space-y-3">
                  {waAccounts.map(account => (
                    waMode === 'edit' && waEditing?.id === account.id
                      ? <WAAccountForm key={account.id} initial={waEditing} onSave={handleWaEdit} onCancel={() => { setWaMode('list'); setWaEditing(null) }} isSaving={waSaving} />
                      : <WAAccountCard key={account.id} account={account} onEdit={a => { setWaEditing(a); setWaMode('edit') }} onDelete={handleWaDelete} />
                  ))}
                </div>
              )}
              <PurposeReference purposes={WA_PURPOSES} />
            </>
          )}
        </div>
      )}

    </div>
  )
}

// Purpose → description list shown under the email / WhatsApp accounts.
function PurposeReference({ purposes }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div>
          <CardTitle>Purposes</CardTitle>
          <CardDescription>Unmatched purposes fall back to General</CardDescription>
        </div>
      </CardHeader>
      <div className="divide-y divide-gray-100 border-t border-gray-100">
        {purposes.map(p => (
          <div key={p.id} className="flex items-center gap-3 px-5 py-2.5">
            <span className="w-32 shrink-0"><Badge variant="default">{p.label}</Badge></span>
            <span className="text-[13px] text-muted-foreground">{p.description}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Page wrapper ───────────────────────────────────────────────────────────────

export default function ConfigPage() {
  return (
    <Suspense fallback={<LoadingSpinner className="py-20" />}>
      <ConfigContent />
    </Suspense>
  )
}
