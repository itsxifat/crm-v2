'use client'

import { useState, useEffect } from 'react'
import {
  Mail, Plus, Trash2, Pencil, Save, X, Check, Loader2,
  Eye, EyeOff, Send, ChevronDown, ChevronUp, ShieldCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

// ─── Purpose definitions ──────────────────────────────────────────────────────

const PURPOSES = [
  { id: 'general',      label: 'General',              description: 'Default fallback for all emails' },
  { id: 'invoice',      label: 'Invoices',             description: 'Invoice delivery to clients' },
  { id: 'client',       label: 'Client Welcome',       description: 'New client account credentials' },
  { id: 'freelancer',   label: 'Freelancer Invites',   description: 'Freelancer/agency panel invites' },
  { id: 'notification', label: 'Notifications',        description: 'System alerts and reminders' },
]

// ─── Empty account template ───────────────────────────────────────────────────

function emptyAccount() {
  return {
    id:       crypto.randomUUID(),
    label:    '',
    fromName: '',
    host:     '',
    port:     '587',
    secure:   false,
    user:     '',
    password: '',
    purposes: [],
  }
}

// ─── Purpose badge ────────────────────────────────────────────────────────────

function PurposeBadge({ id, selected, onClick }) {
  const p = PURPOSES.find(x => x.id === id)
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      title={p?.description}
      className={cn(
        'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors',
        selected
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      )}
    >
      {p?.label ?? id}
    </button>
  )
}

// ─── Account Form (add / edit) ────────────────────────────────────────────────

function AccountForm({ initial, onSave, onCancel, isSaving }) {
  const [form, setForm] = useState(initial ?? emptyAccount())
  const [showPass, setShowPass]   = useState(false)
  const [testing,  setTesting]    = useState(false)
  const [testTo,   setTestTo]     = useState('')
  const [showTest, setShowTest]   = useState(false)

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function togglePurpose(id) {
    setForm(f => ({
      ...f,
      purposes: f.purposes.includes(id)
        ? f.purposes.filter(p => p !== id)
        : [...f.purposes, id],
    }))
  }

  async function testConnection() {
    if (!form.host || !form.user || !form.password) {
      toast.error('Fill in host, username, and password first')
      return
    }
    setTesting(true)
    try {
      const res = await fetch('/api/settings/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: form, sendTo: testTo || undefined }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      toast.success(j.message || 'Connection successful')
      setShowTest(false)
    } catch (err) {
      toast.error(err.message || 'Connection failed')
    } finally {
      setTesting(false)
    }
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
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">

      {/* Row 1 — label + from name */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Account Label <span className="text-red-500">*</span></label>
          <input
            value={form.label}
            onChange={e => set('label', e.target.value)}
            placeholder="e.g. Invoice Mailer"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Sender Display Name</label>
          <input
            value={form.fromName}
            onChange={e => set('fromName', e.target.value)}
            placeholder="e.g. Enfinito"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
          />
        </div>
      </div>

      {/* Row 2 — host + port + secure */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1.5">SMTP Host <span className="text-red-500">*</span></label>
          <input
            value={form.host}
            onChange={e => set('host', e.target.value)}
            placeholder="smtp.gmail.com"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Port</label>
          <input
            value={form.port}
            onChange={e => set('port', e.target.value)}
            placeholder="587"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
          />
        </div>
      </div>

      {/* Secure toggle */}
      <label className="flex items-center gap-2.5 cursor-pointer w-fit">
        <div
          onClick={() => set('secure', !form.secure)}
          className={cn(
            'w-9 h-5 rounded-full transition-colors relative',
            form.secure ? 'bg-blue-600' : 'bg-gray-200'
          )}
        >
          <span className={cn(
            'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
            form.secure ? 'translate-x-4' : 'translate-x-0.5'
          )} />
        </div>
        <span className="text-xs text-gray-600">Use SSL/TLS (port 465)</span>
      </label>

      {/* Row 3 — username + password */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Username / Email <span className="text-red-500">*</span></label>
          <input
            value={form.user}
            onChange={e => set('user', e.target.value)}
            placeholder="invoices@yourdomain.com"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Password / App Password <span className="text-red-500">*</span></label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={form.password}
              onChange={e => set('password', e.target.value)}
              placeholder="App password or SMTP password"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 pr-9 focus:outline-none focus:border-blue-400"
            />
            <button
              type="button"
              onClick={() => setShowPass(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Purposes */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">
          Used For <span className="text-red-500">*</span>
          <span className="text-gray-400 font-normal ml-1">— which emails go through this account</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {PURPOSES.map(p => (
            <PurposeBadge
              key={p.id}
              id={p.id}
              selected={form.purposes.includes(p.id)}
              onClick={togglePurpose}
            />
          ))}
        </div>
      </div>

      {/* Test connection */}
      <div className="border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={() => setShowTest(v => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            Test connection
            {showTest ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {showTest && (
          <div className="flex items-center gap-2">
            <input
              value={testTo}
              onChange={e => setTestTo(e.target.value)}
              placeholder="Send test email to… (leave blank for your account)"
              className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
            />
            <button
              type="button"
              onClick={testConnection}
              disabled={testing}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 transition-colors"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send Test
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => validate() && onSave(form)}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save Account
        </button>
      </div>
    </div>
  )
}

// ─── Account Card (read mode) ─────────────────────────────────────────────────

function AccountCard({ account, onEdit, onDelete }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4">
      <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
        <Mail className="w-5 h-5 text-blue-600" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-gray-900">{account.label}</p>
          {account.purposes.includes('general') && (
            <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 border border-green-100 rounded-full px-2 py-0.5">
              <ShieldCheck className="w-3 h-3" /> Default
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 mb-2">{account.user} · {account.host}:{account.port}</p>
        <div className="flex flex-wrap gap-1.5">
          {account.purposes.map(pid => {
            const p = PURPOSES.find(x => x.id === pid)
            return (
              <span key={pid} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-lg font-medium">
                {p?.label ?? pid}
              </span>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onEdit(account)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(account.id)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const [accounts, setAccounts] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [mode,     setMode]     = useState('list') // 'list' | 'add' | 'edit'
  const [editing,  setEditing]  = useState(null)

  useEffect(() => {
    fetch('/api/settings/email')
      .then(r => r.json())
      .then(j => { setAccounts(j.data ?? []); setLoading(false) })
      .catch(() => { toast.error('Failed to load settings'); setLoading(false) })
  }, [])

  async function save(updated) {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/email', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Email settings saved')
      setMode('list')
      setEditing(null)
    } catch (err) {
      toast.error(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function handleAdd(account) {
    const updated = [...accounts, account]
    setAccounts(updated)
    save(updated)
  }

  function handleEdit(account) {
    const updated = accounts.map(a => a.id === account.id ? account : a)
    setAccounts(updated)
    save(updated)
  }

  function handleDelete(id) {
    if (!confirm('Remove this email account?')) return
    const updated = accounts.filter(a => a.id !== id)
    setAccounts(updated)
    save(updated)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage email accounts used to send notifications, invoices, and other CRM emails</p>
      </div>

      {/* Email Accounts Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800">Email Accounts</h2>
            <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{accounts.length}</span>
          </div>
          {mode === 'list' && (
            <button
              onClick={() => { setEditing(null); setMode('add') }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Account
            </button>
          )}
        </div>

        {/* Add form */}
        {mode === 'add' && (
          <AccountForm
            initial={null}
            onSave={handleAdd}
            onCancel={() => setMode('list')}
            isSaving={saving}
          />
        )}

        {/* Account list */}
        {accounts.length === 0 && mode !== 'add' ? (
          <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
            <Mail className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500 font-medium">No email accounts configured</p>
            <p className="text-xs text-gray-400 mt-1 mb-4">Add an account to start sending emails from the CRM</p>
            <button
              onClick={() => setMode('add')}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors mx-auto"
            >
              <Plus className="w-4 h-4" /> Add First Account
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map(account => (
              mode === 'edit' && editing?.id === account.id ? (
                <AccountForm
                  key={account.id}
                  initial={editing}
                  onSave={handleEdit}
                  onCancel={() => { setMode('list'); setEditing(null) }}
                  isSaving={saving}
                />
              ) : (
                <AccountCard
                  key={account.id}
                  account={account}
                  onEdit={a => { setEditing(a); setMode('edit') }}
                  onDelete={handleDelete}
                />
              )
            ))}
          </div>
        )}

        {/* Info box */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-800 space-y-1.5">
          <p className="font-semibold">How email routing works</p>
          <ul className="space-y-1 text-blue-700 list-disc list-inside">
            <li>Each account is assigned one or more <strong>purposes</strong></li>
            <li>When the CRM sends an email (invoice, onboarding, etc.) it picks the account assigned to that purpose</li>
            <li>If no specific account matches, the <strong>General</strong> account is used as fallback</li>
            <li>If no accounts are configured, the system falls back to server environment variables</li>
          </ul>
        </div>

        {/* Purpose reference */}
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Purpose Reference</p>
          </div>
          <div className="divide-y divide-gray-50">
            {PURPOSES.map(p => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-28 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-lg font-medium text-center shrink-0">
                  {p.label}
                </span>
                <span className="text-xs text-gray-500">{p.description}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
