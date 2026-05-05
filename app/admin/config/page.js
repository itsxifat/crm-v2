'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Mail, Plus, Trash2, Pencil, Save, X, Check, Loader2,
  Eye, EyeOff, Send, ChevronDown, ChevronUp, ShieldCheck,
  MessageCircle, ExternalLink, Building2, ShieldAlert, Users, UserCheck,
  CreditCard, GripVertical, ChevronRight, Settings2, AlertTriangle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import { invalidateConfigCache } from '@/lib/useConfig'

// ── Constants ──────────────────────────────────────────────────────────────────

const PURPOSES = [
  { id: 'general',      label: 'General',            description: 'Default fallback for all emails' },
  { id: 'invoice',      label: 'Invoices',           description: 'Invoice delivery to clients' },
  { id: 'client',       label: 'Client Welcome',     description: 'New client account credentials' },
  { id: 'freelancer',   label: 'Freelancer Invites', description: 'Freelancer/agency panel invites' },
  { id: 'notification', label: 'Notifications',      description: 'System alerts and reminders' },
]

const WA_PURPOSES = [
  { id: 'general',      label: 'General',            description: 'Default fallback for all messages' },
  { id: 'client',       label: 'Client Welcome',     description: 'New client account credentials' },
  { id: 'freelancer',   label: 'Freelancer Invites', description: 'Freelancer/agency panel invites' },
  { id: 'onboarding',   label: 'Onboarding',         description: 'Employee onboarding invitations' },
  { id: 'notification', label: 'Notifications',      description: 'System alerts and reminders' },
]

// ── Shared design tokens ───────────────────────────────────────────────────────

const ic  = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-gray-400 transition-colors'
const lc  = 'block text-xs font-medium text-gray-500 mb-1.5'
const btn = 'flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-150 disabled:opacity-50'
const btnPrimary  = `${btn} bg-gray-900 hover:bg-gray-800 text-white`
const btnGhost    = `${btn} border border-gray-200 hover:bg-gray-50 text-gray-600`
const btnDanger   = `${btn} bg-red-500 hover:bg-red-600 text-white`

// ── ConfirmModal ───────────────────────────────────────────────────────────────

function ConfirmModal({ title, message, confirmLabel = 'Remove', onConfirm, onCancel, danger = true }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl border border-gray-100 w-full max-w-sm p-6 shadow-2xl space-y-5">
        <div className="flex items-start gap-3.5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-red-50' : 'bg-amber-50'}`}>
            <AlertTriangle className={`w-5 h-5 ${danger ? 'text-red-500' : 'text-amber-500'}`} />
          </div>
          <div className="pt-0.5">
            <p className="text-sm font-semibold text-gray-900">{title ?? 'Are you sure?'}</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className={btnGhost + ' text-sm py-2'}>Cancel</button>
          <button onClick={onConfirm} className={danger ? btnDanger + ' py-2' : btnPrimary + ' py-2'}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

// ── Email sub-components ───────────────────────────────────────────────────────

function emptyAccount() {
  return { id: crypto.randomUUID(), label: '', fromName: '', host: '', port: '587', secure: false, user: '', password: '', purposes: [] }
}

function PurposeBadge({ id, selected, onClick }) {
  const p = PURPOSES.find(x => x.id === id)
  return (
    <button type="button" onClick={() => onClick(id)} title={p?.description}
      className={cn('px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
        selected ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
      {p?.label ?? id}
    </button>
  )
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
    <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5 shadow-sm">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lc}>Account Label <span className="text-red-400">*</span></label>
          <input value={form.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Invoice Mailer" className={ic} />
        </div>
        <div>
          <label className={lc}>Sender Display Name</label>
          <input value={form.fromName} onChange={e => set('fromName', e.target.value)} placeholder="e.g. Enfinito" className={ic} />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className={lc}>SMTP Host <span className="text-red-400">*</span></label>
          <input value={form.host} onChange={e => set('host', e.target.value)} placeholder="smtp.gmail.com" className={ic} />
        </div>
        <div>
          <label className={lc}>Port</label>
          <input value={form.port} onChange={e => set('port', e.target.value)} placeholder="587" className={ic} />
        </div>
      </div>
      <label className="flex items-center gap-2.5 cursor-pointer w-fit">
        <div onClick={() => set('secure', !form.secure)} className={cn('w-9 h-5 rounded-full transition-colors relative cursor-pointer', form.secure ? 'bg-gray-900' : 'bg-gray-200')}>
          <span className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform', form.secure ? 'translate-x-4' : 'translate-x-0.5')} />
        </div>
        <span className="text-xs text-gray-600">Use SSL/TLS (port 465)</span>
      </label>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lc}>Username / Email <span className="text-red-400">*</span></label>
          <input value={form.user} onChange={e => set('user', e.target.value)} placeholder="invoices@yourdomain.com" className={ic} />
        </div>
        <div>
          <label className={lc}>Password / App Password <span className="text-red-400">*</span></label>
          <div className="relative">
            <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)} placeholder="App password or SMTP password" className={`${ic} pr-10`} />
            <button type="button" onClick={() => setShowPass(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
      <div>
        <label className={lc}>Used For <span className="text-red-400">*</span> <span className="text-gray-400 font-normal">— which emails go through this account</span></label>
        <div className="flex flex-wrap gap-2 mt-1">{PURPOSES.map(p => <PurposeBadge key={p.id} id={p.id} selected={form.purposes.includes(p.id)} onClick={togglePurpose} />)}</div>
      </div>
      <div className="border-t border-gray-100 pt-4">
        <button type="button" onClick={() => setShowTest(v => !v)} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors mb-2">
          <Send className="w-3.5 h-3.5" /> Test connection {showTest ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {showTest && (
          <div className="flex items-center gap-2">
            <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="Send test email to… (leave blank for your account)" className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-gray-400" />
            <button type="button" onClick={testConnection} disabled={testing} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-xs font-medium rounded-xl hover:bg-gray-200 disabled:opacity-50 transition-colors">
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send Test
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
        <button type="button" onClick={() => validate() && onSave(form)} disabled={isSaving} className={btnPrimary}>
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save Account
        </button>
      </div>
    </div>
  )
}

function AccountCard({ account, onEdit, onDelete }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-start gap-4 shadow-sm">
      <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
        <Mail className="w-5 h-5 text-gray-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-gray-900">{account.label}</p>
          {account.purposes.includes('general') && (
            <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5"><ShieldCheck className="w-3 h-3" /> Default</span>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-2">{account.user} · {account.host}:{account.port}</p>
        <div className="flex flex-wrap gap-1.5">
          {account.purposes.map(pid => { const p = PURPOSES.find(x => x.id === pid); return <span key={pid} className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-lg font-medium">{p?.label ?? pid}</span> })}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => onEdit(account)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"><Pencil className="w-4 h-4" /></button>
        <button onClick={() => onDelete(account.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
  )
}

// ── WhatsApp sub-components ────────────────────────────────────────────────────

function emptyWAAccount() {
  return { id: crypto.randomUUID(), label: '', apiKey: '', purposes: [] }
}

function WAPurposeBadge({ id, selected, onClick }) {
  const p = WA_PURPOSES.find(x => x.id === id)
  return (
    <button type="button" onClick={() => onClick(id)} title={p?.description}
      className={cn('px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
        selected ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
      {p?.label ?? id}
    </button>
  )
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
    <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5 shadow-sm">
      <div>
        <label className={lc}>Account Label <span className="text-red-400">*</span></label>
        <input value={form.label} onChange={e => set('label', e.target.value)} placeholder="e.g. Main WhatsApp" className={ic} />
      </div>
      <div>
        <label className={lc}>API Key <span className="text-red-400">*</span></label>
        <div className="relative">
          <input type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={e => set('apiKey', e.target.value)} placeholder="enf_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={`${ic} pr-10 font-mono`} />
          <button type="button" onClick={() => setShowKey(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
      <div>
        <label className={lc}>Used For <span className="text-red-400">*</span> <span className="text-gray-400 font-normal">— which notifications go through this account</span></label>
        <div className="flex flex-wrap gap-2 mt-1">{WA_PURPOSES.map(p => <WAPurposeBadge key={p.id} id={p.id} selected={form.purposes.includes(p.id)} onClick={togglePurpose} />)}</div>
      </div>
      <div className="border-t border-gray-100 pt-4">
        <button type="button" onClick={() => setShowTest(v => !v)} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors mb-2">
          <Send className="w-3.5 h-3.5" /> Send test message {showTest ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {showTest && (
          <div className="flex items-center gap-2">
            <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="+8801XXXXXXXXX" className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-gray-400" />
            <button type="button" onClick={testConnection} disabled={testing} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-xs font-medium rounded-xl hover:bg-gray-200 disabled:opacity-50 transition-colors">
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send Test
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
        <button type="button" onClick={() => validate() && onSave(form)} disabled={isSaving} className={btnPrimary}>
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save Account
        </button>
      </div>
    </div>
  )
}

function WAAccountCard({ account, onEdit, onDelete }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 flex items-start gap-4 shadow-sm">
      <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
        <MessageCircle className="w-5 h-5 text-gray-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-gray-900">{account.label}</p>
          {account.purposes.includes('general') && (
            <span className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5"><ShieldCheck className="w-3 h-3" /> Default</span>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-2 font-mono">{account.apiKey ? `${account.apiKey.slice(0, 12)}••••••••` : 'No key'}</p>
        <div className="flex flex-wrap gap-1.5">
          {account.purposes.map(pid => { const p = WA_PURPOSES.find(x => x.id === pid); return <span key={pid} className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-lg font-medium">{p?.label ?? pid}</span> })}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => onEdit(account)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"><Pencil className="w-4 h-4" /></button>
        <button onClick={() => onDelete(account.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
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
      <span className="inline-flex items-center gap-1 bg-gray-900 rounded-lg px-2 py-1">
        <input autoFocus value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(label); setEditing(false) } }}
          onBlur={commit} className="text-xs bg-transparent outline-none text-white w-28" />
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 rounded-lg px-2.5 py-1 text-xs group/tag">
      <span className="cursor-pointer hover:text-gray-900" onClick={() => setEditing(true)}>{label}</span>
      <button onClick={() => onDelete(label)} className="text-gray-300 hover:text-red-500 transition-colors ml-0.5 opacity-0 group-hover/tag:opacity-100"><X className="w-3 h-3" /></button>
    </span>
  )
}

function AddInput({ placeholder, onAdd }) {
  const [val, setVal] = useState('')
  function submit() { const t = val.trim(); if (!t) return; onAdd(t); setVal('') }
  return (
    <div className="flex items-center gap-1.5 mt-2">
      <input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }}
        placeholder={placeholder} className="flex-1 text-xs bg-white border border-dashed border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:border-gray-400 placeholder-gray-400" />
      <button onClick={submit} className="p-2 rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-900 hover:text-white transition-colors"><Plus className="w-3.5 h-3.5" /></button>
    </div>
  )
}

function ServiceSection({ service, onUpdate, onDelete }) {
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
  function addSubcat(name) {
    if (service.subcategories.includes(name)) { toast.error('Already exists'); return }
    onUpdate({ ...service, subcategories: [...service.subcategories, name] })
  }
  function deleteSubcat(name)        { onUpdate({ ...service, subcategories: service.subcategories.filter(s => s !== name) }) }
  function renameSubcat(old, next)   { onUpdate({ ...service, subcategories: service.subcategories.map(s => s === old ? next : s) }) }

  return (
    <>
      {confirmDel && (
        <ConfirmModal
          title="Delete service?"
          message={`"${service.label}" and all its subcategories will be removed. This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { setConfirmDel(false); onDelete(service.id) }}
          onCancel={() => setConfirmDel(false)}
        />
      )}
      <div className="border border-gray-100 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50/60 cursor-pointer hover:bg-gray-100/60 transition-colors" onClick={() => !renaming && setExpanded(e => !e)}>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`} />
            {renaming ? (
              <input
                ref={renameRef}
                value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false) }}
                onBlur={commitRename}
                onClick={e => e.stopPropagation()}
                className="flex-1 text-sm bg-white border border-gray-300 rounded-lg px-2.5 py-0.5 focus:outline-none focus:border-gray-900 min-w-0"
              />
            ) : (
              <span className="text-sm font-medium text-gray-800 truncate">{service.label}</span>
            )}
            <span className="text-xs text-gray-400 bg-gray-200 rounded-full px-2 py-0.5 shrink-0">{service.subcategories.length}</span>
          </div>
          <div className="flex items-center gap-1 ml-2 shrink-0" onClick={e => e.stopPropagation()}>
            <button onClick={startRename} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition-colors" title="Rename"><Pencil className="w-3.5 h-3.5" /></button>
            <button onClick={() => setConfirmDel(true)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-white transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        {expanded && (
          <div className="px-4 py-3 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {service.subcategories.map(sub => <CfgTag key={sub} label={sub} onDelete={deleteSubcat} onRename={renameSubcat} />)}
              {service.subcategories.length === 0 && <p className="text-xs text-gray-400 italic">No subcategories yet</p>}
            </div>
            <AddInput placeholder="Add subcategory…" onAdd={addSubcat} />
          </div>
        )}
      </div>
    </>
  )
}

function VenturePanel({ ventureId, services, config, onChange }) {
  const venture = config.ventures?.find(v => v.id === ventureId)
  function addService(label) {
    const id = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (services.some(s => s.id === id || s.label === label)) { toast.error('Service already exists'); return }
    onChange([...services, { id, label, subcategories: [] }])
  }
  function updateService(updated) { onChange(services.map(s => s.id === updated.id ? updated : s)) }
  function deleteService(id)      { onChange(services.filter(s => s.id !== id)) }
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-gray-400 mb-3">Services &amp; subcategories for <span className="font-medium text-gray-600">{venture?.label ?? ventureId}</span> — linked to "Add New Project" form</p>
      {services.map(svc => <ServiceSection key={svc.id} service={svc} onUpdate={updateService} onDelete={deleteService} />)}
      {services.length === 0 && <p className="text-xs text-gray-400 italic py-2">No services yet — add one below.</p>}
      <div className="pt-1"><AddInput placeholder="Add new service / category…" onAdd={addService} /></div>
    </div>
  )
}

function LeadOptionList({ label, description, items, onChange }) {
  function add(val) { if (items.includes(val)) { toast.error('Already exists'); return }; onChange([...items, val]) }
  function remove(val) { onChange(items.filter(i => i !== val)) }
  function rename(old, next) { onChange(items.map(i => i === old ? next : i)) }
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <p className="text-sm font-semibold text-gray-900 mb-0.5">{label}</p>
      <p className="text-xs text-gray-400 mb-3">{description}</p>
      {items.length === 0
        ? <p className="text-xs text-gray-400 italic mb-2">No options yet — add one below</p>
        : <div className="flex flex-wrap gap-1.5 mb-1">{items.map(item => <CfgTag key={item} label={item} onDelete={remove} onRename={rename} />)}</div>
      }
      <AddInput placeholder={`Add ${label.toLowerCase()}…`} onAdd={add} />
    </div>
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
          message={`"${confirmDel.name}" will be deactivated. Existing employees will keep their current department code.`}
          confirmLabel="Deactivate"
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDel(null)}
          danger={false}
        />
      )}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-5">
        <form onSubmit={handleSave} className="space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{editing ? `Editing: ${editing.name}` : 'Add Department'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className={lc}>Department Name <span className="text-red-400">*</span></label>
              <input required value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="e.g. Human Resources" className={ic} />
            </div>
            <div>
              <label className={lc}>Short Code <span className="text-red-400">*</span></label>
              <input required value={form.shortCode} onChange={e => handleCodeChange(e.target.value)} placeholder="e.g. HR" maxLength={6} className={`${ic} font-mono uppercase tracking-widest`} />
              <p className="text-[10px] text-gray-400 mt-1">Auto-generated · you can edit</p>
            </div>
            <div>
              <label className={lc}>Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" className={ic} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={saving} className={btnPrimary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Department'}
            </button>
            {editing && <button type="button" onClick={cancelEdit} className={btnGhost}>Cancel</button>}
          </div>
        </form>

        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Active Departments</p>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
          ) : departments.length === 0 ? (
            <p className="text-xs text-gray-400 italic py-4 text-center">No departments yet — add one above.</p>
          ) : (
            <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
              {departments.map(dept => (
                <div key={dept.id} className={`flex items-center justify-between px-4 py-3 transition-colors ${editing?.id === dept.id ? 'bg-gray-50' : 'bg-white hover:bg-gray-50/60'}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-xs font-bold text-gray-600 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-lg shrink-0 min-w-[40px] text-center">{dept.shortCode}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">{dept.name}</p>
                      {dept.description && <p className="text-xs text-gray-400 truncate">{dept.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-3">
                    <button onClick={() => startEdit(dept)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setConfirmDel({ id: dept.id, name: dept.name })} disabled={deleting === dept.id} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40">
                      {deleting === dept.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Tab definitions ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'ventures',     label: 'Ventures & Services' },
  { id: 'leads',        label: 'Lead Options' },
  { id: 'departments',  label: 'Departments' },
  { id: 'company',      label: 'Company Info' },
  { id: 'verification', label: 'Verification' },
  { id: 'payment',      label: 'Finance' },
  { id: 'email',        label: 'Email' },
  { id: 'whatsapp',     label: 'WhatsApp' },
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl border border-gray-100 w-full max-w-md p-6 shadow-2xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">{isAdd ? 'Add Venture' : `Edit ${initial?.label}`}</h3>
            <p className="text-xs text-gray-400 mt-0.5">{isAdd ? 'Create a new venture with a unique project ID prefix' : 'Update venture label, prefix and description'}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 transition-colors"><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        {/* Fields */}
        <div className="space-y-3.5">
          <div>
            <label className={lc}>Display Label <span className="text-red-400">*</span></label>
            <input autoFocus value={form.label} onChange={e => onLabelChange(e.target.value)}
              placeholder="e.g. Enfinito Studio"
              className={ic} />
          </div>

          <div className={`grid gap-3 ${isAdd ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {isAdd && (
              <div>
                <label className={lc}>
                  Venture ID <span className="text-red-400">*</span>
                  {!idManual && <span className="text-gray-300 font-normal ml-1">· auto</span>}
                </label>
                <input value={form.id}
                  onChange={e => { setIdManual(true); setForm(f => ({ ...f, id: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) })) }}
                  placeholder="ENSTUDIO"
                  className={`${ic} font-mono uppercase`} />
              </div>
            )}
            <div>
              <label className={lc}>
                Project Prefix <span className="text-red-400">*</span>
                {!pfxManual && <span className="text-gray-300 font-normal ml-1">· auto</span>}
              </label>
              <input value={form.prefix}
                onChange={e => { setPfxManual(true); setForm(f => ({ ...f, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) })) }}
                placeholder="ENS"
                maxLength={4}
                className={`${ic} font-mono uppercase`} />
            </div>
          </div>

          {form.prefix && (
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
              <span className="text-xs text-gray-500">Project IDs will look like:</span>
              <span className="font-mono text-sm font-bold text-gray-900 tracking-wider">{form.prefix}P-2604A01</span>
            </div>
          )}

          <div>
            <label className={lc}>Description</label>
            <input value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Short description of this venture…"
              className={ic} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end pt-1 border-t border-gray-50">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={handleSubmit} className={btnPrimary}>
            {isAdd ? <Plus className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            {isAdd ? 'Add Venture' : 'Save Changes'}
          </button>
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
    if (!needsConfig || configLoaded || configLoading) return
    setConfigLoading(true)
    fetch('/api/config')
      .then(r => r.json())
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
      .catch(() => { toast.error('Failed to load configuration'); setConfigLoading(false) })
  }, [activeTab, configLoaded, configLoading])

  useEffect(() => {
    if (activeTab !== 'company' || companyLoaded || companyLoading) return
    setCompanyLoading(true)
    fetch('/api/settings?group=company')
      .then(r => r.json())
      .then(j => {
        const d = j.data ?? {}
        setCompany({ name: d.company_name ?? '', address: d.company_address ?? '', phone: d.company_phone ?? '', email: d.company_email ?? '', website: d.company_website ?? '' })
        setCompanyLoaded(true)
        setCompanyLoading(false)
      })
      .catch(() => setCompanyLoading(false))
  }, [activeTab, companyLoaded, companyLoading])

  useEffect(() => {
    if (activeTab !== 'email' || emailLoaded || emailLoading) return
    setEmailLoading(true)
    fetch('/api/settings/email')
      .then(r => r.json())
      .then(j => { setAccounts(j.data ?? []); setEmailLoaded(true); setEmailLoading(false) })
      .catch(() => { toast.error('Failed to load email settings'); setEmailLoading(false) })
  }, [activeTab, emailLoaded, emailLoading])

  useEffect(() => {
    if (activeTab !== 'whatsapp' || waLoaded || waLoading) return
    setWaLoading(true)
    fetch('/api/settings/whatsapp')
      .then(r => r.json())
      .then(j => { setWaAccounts(j.data ?? []); setWaLoaded(true); setWaLoading(false) })
      .catch(() => { toast.error('Failed to load WhatsApp settings'); setWaLoading(false) })
  }, [activeTab, waLoaded, waLoading])

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
      const res = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
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
      invalidateConfigCache()
      toast.success('Payment methods saved')
    } catch (err) { toast.error(err.message || 'Failed to save') }
    finally { setPmSaving(false) }
  }
  function pmLabelToValue(label) { return label.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '') }
  function addPaymentMethod() {
    const label = pmNewLabel.trim()
    if (!label) { toast.error('Enter a method name'); return }
    const value = pmLabelToValue(label)
    if (paymentMethods.some(m => m.value === value)) { toast.error('A method with this name already exists'); return }
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

  const configNeedsLoad = ['ventures', 'leads', 'verification', 'payment'].includes(activeTab) && (configLoading || !configLoaded)

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-4xl">

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Configuration</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage ventures, services, and system settings</p>
        </div>
        {(activeTab === 'ventures' || activeTab === 'leads' || activeTab === 'payment') && (
          <div className="flex items-center gap-2">
            {dirty && <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-1.5">Unsaved changes</span>}
            <button onClick={saveConfig} disabled={saving || !dirty} className={btnPrimary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Changes
            </button>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-gray-100 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 -mb-px',
              activeTab === t.id ? 'border-gray-900 text-gray-900 font-semibold' : 'border-transparent text-gray-400 hover:text-gray-700'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {configNeedsLoad && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
        </div>
      )}

      {/* ── Ventures tab ────────────────────────────────────────────────────── */}
      {activeTab === 'ventures' && config && (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
          {/* Venture tab strip */}
          <div className="flex items-center border-b border-gray-100 px-2 pt-2 gap-1 flex-wrap">
            {(config.ventures ?? []).map(v => (
              <button key={v.id} onClick={() => setVentureTab(v.id)}
                className={`flex items-center gap-2 px-3.5 py-2 text-sm rounded-t-xl transition-all -mb-px ${
                  ventureTab === v.id
                    ? 'bg-white border border-b-white border-gray-100 font-semibold text-gray-900 shadow-sm'
                    : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
                }`}>
                {v.label}
                {v.prefix && (
                  <span className="font-mono text-[10px] bg-gray-900 text-white px-1.5 py-0.5 rounded-md leading-none">{v.prefix}P</span>
                )}
              </button>
            ))}
            <button onClick={openAddVenture}
              className="ml-auto mr-2 mb-1.5 flex items-center gap-1 text-xs text-gray-400 hover:text-gray-900 hover:bg-gray-100 px-2.5 py-1.5 rounded-xl transition-colors font-medium">
              <Plus className="w-3.5 h-3.5" /> Add Venture
            </button>
          </div>

          {/* Active venture panel */}
          <div className="p-6">
            {(config.ventures ?? []).length === 0 && (
              <div className="text-center py-12">
                <Building2 className="w-8 h-8 text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-500 font-medium">No ventures yet</p>
                <p className="text-xs text-gray-400 mt-1 mb-4">Add your first venture to start creating projects</p>
                <button onClick={openAddVenture} className={btnPrimary + ' mx-auto'}><Plus className="w-4 h-4" /> Add First Venture</button>
              </div>
            )}
            {(config.ventures ?? []).map(v => {
              if (v.id !== ventureTab) return null
              return (
                <div key={v.id}>
                  {/* Venture info card */}
                  <div className="flex items-start gap-4 mb-6 p-4 bg-gray-50 rounded-2xl">
                    <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center shrink-0">
                      <Settings2 className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-gray-900">{v.label}</p>
                        <span className="font-mono text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-lg">{v.id}</span>
                        {v.prefix ? (
                          <span className="font-mono text-xs bg-gray-900 text-white px-2 py-0.5 rounded-lg">{v.prefix}P-YYMM</span>
                        ) : (
                          <span className="text-xs text-amber-500 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-lg">No prefix — using fallback</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{v.description || <span className="italic text-gray-400">No description</span>}</p>
                    </div>
                    <button onClick={() => openEditVenture(v)}
                      className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-400 px-3 py-1.5 rounded-xl transition-all shrink-0 font-medium">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  </div>
                  <VenturePanel ventureId={v.id} services={(config.services ?? {})[v.id] ?? []} config={config} onChange={svc => updateServices(v.id, svc)} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Leads tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'leads' && config && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight">Lead Options</h2>
            <p className="text-sm text-gray-400 mt-0.5">Manage dropdown options for the Lead form.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LeadOptionList label="Sources"             description="How the lead found out about you (e.g. Referral, Cold Outreach)"    items={config?.leadSources            ?? []} onChange={v => updateLeadOption('leadSources', v)} />
            <LeadOptionList label="Platforms"           description="Channel where the lead was contacted (e.g. Facebook, LinkedIn)"     items={config?.leadPlatforms          ?? []} onChange={v => updateLeadOption('leadPlatforms', v)} />
            <LeadOptionList label="Business Categories" description="Industry or business type of the lead (e.g. E-commerce, Healthcare)" items={config?.leadBusinessCategories ?? []} onChange={v => updateLeadOption('leadBusinessCategories', v)} />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight mb-0.5">Company Item Categories</h2>
            <p className="text-sm text-gray-400 mb-4">Item name presets shown when adding company-provided assets to an employee profile.</p>
            <LeadOptionList label="Item Categories" description="Suggested item names (e.g. Laptop, SIM Card, Access Card)" items={config?.companyItemCategories ?? []} onChange={v => updateLeadOption('companyItemCategories', v)} />
          </div>
          <div className="text-xs text-gray-400 bg-gray-50 rounded-2xl p-4 border border-gray-100">
            <p className="font-semibold text-gray-600 mb-1">How this config links to projects &amp; leads</p>
            <p>Selecting a venture dynamically populates the <strong>Category</strong> and <strong>Subcategory</strong> dropdowns. Changes take effect immediately after saving.</p>
          </div>
        </div>
      )}

      {/* ── Departments tab ──────────────────────────────────────────────────── */}
      {activeTab === 'departments' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight">Departments</h2>
            <p className="text-sm text-gray-400 mt-0.5">Manage departments used for employee grouping. Short codes appear in employee IDs.</p>
          </div>
          <DepartmentsSection />
        </div>
      )}

      {/* ── Company tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'company' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight">Company Information</h2>
            <p className="text-sm text-gray-400 mt-0.5">This information appears on printed invoices and quotations.</p>
          </div>
          {companyLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
          ) : (
            <form onSubmit={saveCompany} className="bg-white border border-gray-100 rounded-2xl p-6 space-y-4 shadow-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className={lc}>Company Name</label><input value={company.name}    onChange={e => setCompany(c => ({ ...c, name:    e.target.value }))} placeholder="e.g. Acme Ltd."             className={ic} /></div>
                <div><label className={lc}>Email</label>       <input type="email" value={company.email}   onChange={e => setCompany(c => ({ ...c, email:   e.target.value }))} placeholder="e.g. info@yourcompany.com" className={ic} /></div>
                <div><label className={lc}>Phone</label>       <input value={company.phone}   onChange={e => setCompany(c => ({ ...c, phone:   e.target.value }))} placeholder="e.g. +8801XXXXXXXXX"        className={ic} /></div>
                <div><label className={lc}>Website</label>     <input value={company.website} onChange={e => setCompany(c => ({ ...c, website: e.target.value }))} placeholder="e.g. www.yourcompany.com"    className={ic} /></div>
                <div className="sm:col-span-2"><label className={lc}>Address</label><input value={company.address} onChange={e => setCompany(c => ({ ...c, address: e.target.value }))} placeholder="e.g. 123 Main St, Dhaka, Bangladesh" className={ic} /></div>
              </div>
              <div className="flex justify-end pt-2">
                <button type="submit" disabled={companySaving} className={btnPrimary}>
                  {companySaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Company Info
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ── Verification tab ─────────────────────────────────────────────────── */}
      {activeTab === 'verification' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-bold text-gray-900 tracking-tight">Verification &amp; Access</h2>
            <p className="text-sm text-gray-400 mt-0.5">Control whether new users must complete a verification step before their account is active.</p>
          </div>
          {!configNeedsLoad && (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm divide-y divide-gray-50">
              {[
                { key: 'freelancer',        icon: Users,      iconBg: 'bg-purple-50', iconColor: 'text-purple-600', title: 'Freelancer & Agency Verification',
                  on:  'New freelancers and agencies receive an invite link and must set their own password before accessing the panel.',
                  off: 'Accounts are created immediately. Login credentials are emailed directly — no invite step required.' },
                { key: 'clientKyc',         icon: UserCheck,  iconBg: 'bg-blue-50',   iconColor: 'text-blue-600',   title: 'Client KYC Verification',
                  on:  'Clients must submit identity documents. An admin must approve them before their KYC status is marked Verified.',
                  off: 'Clients are automatically marked as Verified upon account creation — no review required.' },
                { key: 'employeeOnboarding',icon: ShieldCheck,iconBg: 'bg-emerald-50',iconColor: 'text-emerald-600',title: 'Employee Onboarding Flow',
                  on:  'New employees receive a secure onboarding link to fill in their own profile. HR reviews and approves before activation.',
                  off: 'Employees can be created directly by an admin without the self-service onboarding link.' },
              ].map(({ key, icon: Icon, iconBg, iconColor, title, on, off }) => (
                <div key={key} className="flex items-start justify-between gap-4 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 ${iconBg} rounded-xl flex items-center justify-center shrink-0 mt-0.5`}><Icon className={`w-4 h-4 ${iconColor}`} /></div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{verification[key] ? on : off}</p>
                    </div>
                  </div>
                  <button type="button" disabled={verificationSaving} onClick={() => toggleVerification(key)} className="shrink-0 mt-0.5 disabled:opacity-50">
                    <div className={cn('w-10 h-5 rounded-full transition-colors relative', verification[key] ? 'bg-gray-900' : 'bg-gray-200')}>
                      <span className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform', verification[key] ? 'translate-x-5' : 'translate-x-0.5')} />
                    </div>
                  </button>
                </div>
              ))}
            </div>
          )}
          {verificationSaving && <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</div>}
        </div>
      )}

      {/* ── Finance tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'payment' && (
        <div className="space-y-8">

          {/* Expense Categories */}
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-900 tracking-tight">Expense Categories</h2>
              <p className="text-sm text-gray-400 mt-0.5">Define your own expense categories — these appear in the "Expense Category" dropdown when recording an expense transaction.</p>
            </div>
            {!configNeedsLoad && config ? (
              <LeadOptionList
                label="Categories"
                description='Add tags like "Office Supplies", "Cloud Hosting", "Marketing Ads" etc.'
                items={config.expenseCategories ?? []}
                onChange={v => updateLeadOption('expenseCategories', v)}
              />
            ) : (
              !configNeedsLoad && <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
            )}
          </div>

          {/* Payment Methods */}
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-bold text-gray-900 tracking-tight">Payment Methods</h2>
              <p className="text-sm text-gray-400 mt-0.5">These options appear in every payment dropdown across the CRM — project payments, invoices, expenses, and accounts.</p>
            </div>
          {!configNeedsLoad && (
            <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
              <div className="divide-y divide-gray-50">
                {paymentMethods.map((m, idx) => (
                  <div key={m.value} className="flex items-center gap-3 px-4 py-3">
                    <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    {pmEditingIdx === idx ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <input autoFocus value={pmEditingLabel} onChange={e => setPmEditingLabel(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEditPm(idx); if (e.key === 'Escape') setPmEditingIdx(null) }}
                          className="flex-1 text-sm bg-gray-50 border border-gray-300 rounded-xl px-3 py-1.5 focus:outline-none focus:border-gray-900" />
                        <button onClick={() => saveEditPm(idx)} disabled={pmSaving} className="p-1.5 rounded-xl bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"><Check className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setPmEditingIdx(null)} className="p-1.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0 flex items-center gap-2.5">
                          <span className="text-sm text-gray-900 font-medium">{m.label}</span>
                          <span className="text-xs text-gray-400 font-mono bg-gray-50 border border-gray-100 rounded-lg px-1.5 py-0.5">{m.value}</span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => startEditPm(idx)} className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors" title="Rename"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => deletePaymentMethod(m.value)} disabled={pmSaving} className="p-1.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 px-4 py-3 flex items-center gap-2 bg-gray-50/50">
                <input value={pmNewLabel} onChange={e => setPmNewLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPaymentMethod() }}
                  placeholder="New method… e.g. Upwork, PayPal" className="flex-1 text-sm bg-white border border-gray-200 rounded-xl px-3.5 py-2 focus:outline-none focus:border-gray-400" />
                <button onClick={addPaymentMethod} disabled={pmSaving || !pmNewLabel.trim()} className={btnPrimary + ' py-2 text-xs'}>
                  {pmSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
                </button>
              </div>
            </div>
          )}
          </div>{/* /Payment Methods section */}

        </div>
      )}

      {/* ── Email tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'email' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
                Email Accounts
                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 font-normal">{accounts.length}</span>
              </h2>
              <p className="text-sm text-gray-400 mt-0.5">SMTP accounts used to send emails from the CRM</p>
            </div>
            {emailMode === 'list' && !emailLoading && (
              <button onClick={() => { setEmailEditing(null); setEmailMode('add') }} className={btnPrimary}>
                <Plus className="w-4 h-4" /> Add Account
              </button>
            )}
          </div>

          {emailLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
          ) : (
            <>
              {emailMode === 'add' && <AccountForm initial={null} onSave={handleEmailAdd} onCancel={() => setEmailMode('list')} isSaving={emailSaving} />}
              {accounts.length === 0 && emailMode !== 'add' ? (
                <div className="text-center py-14 border-2 border-dashed border-gray-100 rounded-2xl">
                  <Mail className="w-8 h-8 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 font-semibold">No email accounts configured</p>
                  <p className="text-xs text-gray-400 mt-1 mb-5">Add an account to start sending emails from the CRM</p>
                  <button onClick={() => setEmailMode('add')} className={btnPrimary + ' mx-auto'}><Plus className="w-4 h-4" /> Add First Account</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {accounts.map(account => (
                    emailMode === 'edit' && emailEditing?.id === account.id
                      ? <AccountForm key={account.id} initial={emailEditing} onSave={handleEmailEdit} onCancel={() => { setEmailMode('list'); setEmailEditing(null) }} isSaving={emailSaving} />
                      : <AccountCard key={account.id} account={account} onEdit={a => { setEmailEditing(a); setEmailMode('edit') }} onDelete={handleEmailDelete} />
                  ))}
                </div>
              )}
              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 text-xs text-gray-600 space-y-1.5">
                <p className="font-semibold text-gray-700">How email routing works</p>
                <ul className="space-y-1 text-gray-500 list-disc list-inside">
                  <li>Each account is assigned one or more <strong>purposes</strong></li>
                  <li>When the CRM sends an email it picks the account assigned to that purpose</li>
                  <li>If no specific account matches, the <strong>General</strong> account is used as fallback</li>
                  <li>If no accounts are configured, the system falls back to server environment variables</li>
                </ul>
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-gray-50"><p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Purpose Reference</p></div>
                <div className="divide-y divide-gray-50">
                  {PURPOSES.map(p => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-28 px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-lg font-medium text-center shrink-0">{p.label}</span>
                      <span className="text-xs text-gray-500">{p.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── WhatsApp tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'whatsapp' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900 tracking-tight flex items-center gap-2">
                WhatsApp Accounts
                <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 font-normal">{waAccounts.length}</span>
              </h2>
              <p className="text-sm text-gray-400 mt-0.5">API keys used to send WhatsApp notifications</p>
            </div>
            {waMode === 'list' && !waLoading && (
              <button onClick={() => { setWaEditing(null); setWaMode('add') }} className={btnPrimary}>
                <Plus className="w-4 h-4" /> Add Account
              </button>
            )}
          </div>

          {waLoading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
          ) : (
            <>
              {waMode === 'add' && <WAAccountForm initial={null} onSave={handleWaAdd} onCancel={() => setWaMode('list')} isSaving={waSaving} />}
              {waAccounts.length === 0 && waMode !== 'add' ? (
                <div className="text-center py-14 border-2 border-dashed border-gray-100 rounded-2xl">
                  <MessageCircle className="w-8 h-8 text-gray-200 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 font-semibold">No WhatsApp accounts configured</p>
                  <p className="text-xs text-gray-400 mt-1 mb-5">Add an API key to start sending WhatsApp notifications</p>
                  <button onClick={() => setWaMode('add')} className={btnPrimary + ' mx-auto'}><Plus className="w-4 h-4" /> Add First Account</button>
                </div>
              ) : (
                <div className="space-y-3">
                  {waAccounts.map(account => (
                    waMode === 'edit' && waEditing?.id === account.id
                      ? <WAAccountForm key={account.id} initial={waEditing} onSave={handleWaEdit} onCancel={() => { setWaMode('list'); setWaEditing(null) }} isSaving={waSaving} />
                      : <WAAccountCard key={account.id} account={account} onEdit={a => { setWaEditing(a); setWaMode('edit') }} onDelete={handleWaDelete} />
                  ))}
                </div>
              )}
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-xs text-amber-800 space-y-2">
                <p className="font-semibold">Instance must be connected first</p>
                <p className="text-amber-700">Before this account can send messages, the WhatsApp instance must be linked to a phone number on the <strong>Enfinito Cloud dashboard</strong>.</p>
                <a href="https://api.enfinito.cloud" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-amber-800 font-medium hover:underline">Open Enfinito Cloud Dashboard <ExternalLink className="w-3 h-3" /></a>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 text-xs text-gray-600 space-y-1.5">
                <p className="font-semibold text-gray-700">How WhatsApp routing works</p>
                <ul className="space-y-1 text-gray-500 list-disc list-inside">
                  <li>Each account is assigned one or more <strong>purposes</strong></li>
                  <li>When the CRM sends a WhatsApp message it picks the account assigned to that purpose</li>
                  <li>If no specific account matches, the <strong>General</strong> account is used as fallback</li>
                </ul>
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-gray-50"><p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Purpose Reference</p></div>
                <div className="divide-y divide-gray-50">
                  {WA_PURPOSES.map(p => (
                    <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="w-28 px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded-lg font-medium text-center shrink-0">{p.label}</span>
                      <span className="text-xs text-gray-500">{p.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

    </div>
  )
}

// ── Page wrapper ───────────────────────────────────────────────────────────────

export default function ConfigPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>}>
      <ConfigContent />
    </Suspense>
  )
}
