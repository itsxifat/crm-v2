'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Pencil, Save, X, ChevronRight, Settings2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

// ─── Inline editable tag ──────────────────────────────────────────────────────

function Tag({ label, onDelete, onRename }) {
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
      <span className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1">
        <input
          autoFocus
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(label); setEditing(false) } }}
          onBlur={commit}
          className="text-xs bg-transparent outline-none text-blue-800 w-28"
        />
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 rounded-lg px-2.5 py-1 text-xs group/tag">
      <span className="cursor-pointer hover:text-gray-900" onClick={() => setEditing(true)}>{label}</span>
      <button onClick={() => onDelete(label)}
        className="text-gray-300 hover:text-red-500 transition-colors ml-0.5 opacity-0 group-hover/tag:opacity-100">
        <X className="w-3 h-3" />
      </button>
    </span>
  )
}

// ─── Add Input ────────────────────────────────────────────────────────────────

function AddInput({ placeholder, onAdd }) {
  const [val, setVal] = useState('')

  function submit() {
    const trimmed = val.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setVal('')
  }

  return (
    <div className="flex items-center gap-1.5 mt-2">
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
        placeholder={placeholder}
        className="flex-1 text-xs border border-dashed border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400 placeholder-gray-400 bg-white"
      />
      <button onClick={submit}
        className="p-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors">
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── Service Section ──────────────────────────────────────────────────────────

function ServiceSection({ service, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  function addSubcat(name) {
    if (service.subcategories.includes(name)) { toast.error('Already exists'); return }
    onUpdate({ ...service, subcategories: [...service.subcategories, name] })
  }

  function deleteSubcat(name) {
    onUpdate({ ...service, subcategories: service.subcategories.filter(s => s !== name) })
  }

  function renameSubcat(old, next) {
    onUpdate({ ...service, subcategories: service.subcategories.map(s => s === old ? next : s) })
  }

  function renameService(newLabel) {
    onUpdate({ ...service, label: newLabel })
  }

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-50/60 cursor-pointer hover:bg-gray-100/60 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          <span className="text-sm font-medium text-gray-800">{service.label}</span>
          <span className="text-xs text-gray-400 bg-gray-200 rounded-full px-2 py-0.5">
            {service.subcategories.length} subcategories
          </span>
        </div>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => {
              const newLabel = prompt('Rename service:', service.label)
              if (newLabel?.trim() && newLabel.trim() !== service.label) renameService(newLabel.trim())
            }}
            className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-white transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(service.id)}
            className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-white transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {service.subcategories.map(sub => (
              <Tag key={sub} label={sub} onDelete={deleteSubcat} onRename={renameSubcat} />
            ))}
          </div>
          <AddInput placeholder="Add subcategory…" onAdd={addSubcat} />
        </div>
      )}
    </div>
  )
}

// ─── Venture Panel ────────────────────────────────────────────────────────────

function VenturePanel({ ventureId, services, config, onChange }) {
  const venture = config.ventures?.find(v => v.id === ventureId)

  function addService(label) {
    const id = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    if (services.some(s => s.id === id || s.label === label)) { toast.error('Service already exists'); return }
    onChange([...services, { id, label, subcategories: [] }])
  }

  function updateService(updated) {
    onChange(services.map(s => s.id === updated.id ? updated : s))
  }

  function deleteService(id) {
    if (!confirm('Delete this service and all its subcategories?')) return
    onChange(services.filter(s => s.id !== id))
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 mb-2">
        Services &amp; subcategories for{' '}
        <span className="font-medium text-gray-600">{venture?.label ?? ventureId}</span>
        {' '}— linked to "Add New Project" form
      </p>
      {services.map(svc => (
        <ServiceSection key={svc.id} service={svc} onUpdate={updateService} onDelete={deleteService} />
      ))}
      <div className="pt-1">
        <AddInput placeholder="Add new service / category…" onAdd={addService} />
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Lead Options List ────────────────────────────────────────────────────────

function LeadOptionList({ label, description, items, onChange }) {
  function add(val) {
    if (items.includes(val)) { toast.error('Already exists'); return }
    onChange([...items, val])
  }
  function remove(val) {
    onChange(items.filter(i => i !== val))
  }
  function rename(old, next) {
    onChange(items.map(i => i === old ? next : i))
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <p className="text-sm font-semibold text-gray-800 mb-0.5">{label}</p>
      <p className="text-xs text-gray-400 mb-3">{description}</p>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 italic mb-2">No options yet — add one below</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-1">
          {items.map(item => (
            <Tag key={item} label={item} onDelete={remove} onRename={rename} />
          ))}
        </div>
      )}
      <AddInput placeholder={`Add ${label.toLowerCase()}…`} onAdd={add} />
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ConfigPage() {
  const [config,   setConfig]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [tab,      setTab]      = useState('ENSTUDIO')
  const [dirty,    setDirty]    = useState(false)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(j => { setConfig(j.data); setLoading(false) })
      .catch(() => { toast.error('Failed to load config'); setLoading(false) })
  }, [])

  function updateLeadOption(key, values) {
    setConfig(c => ({ ...c, [key]: values }))
    setDirty(true)
  }

  function updateServices(ventureId, services) {
    setConfig(c => ({ ...c, services: { ...c.services, [ventureId]: services } }))
    setDirty(true)
  }

  function addVenture() {
    const id    = prompt('Venture ID (e.g. ENDESIGN — no spaces):')?.trim().toUpperCase()
    const label = prompt('Display label (e.g. Endesign):')?.trim()
    if (!id || !label) return
    if (config.ventures.some(v => v.id === id)) { toast.error('Venture ID already exists'); return }
    setConfig(c => ({
      ...c,
      ventures: [...c.ventures, { id, label, description: '', active: true }],
      services: { ...c.services, [id]: [] },
    }))
    setDirty(true)
    setTab(id)
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Configuration saved')
      setDirty(false)
    } catch (err) {
      toast.error(err.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const ventures  = config?.ventures ?? []
  const services  = config?.services ?? {}

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Admin Configuration</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage ventures, services, categories and subcategories</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              Unsaved changes
            </span>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Config
          </button>
        </div>
      </div>

      {/* Ventures tab bar */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="flex items-center border-b border-gray-100 px-1 pt-1 gap-0.5">
          {ventures.map(v => (
            <button
              key={v.id}
              onClick={() => setTab(v.id)}
              className={`px-4 py-2.5 text-sm rounded-t-lg transition-colors mb-[-1px] ${
                tab === v.id
                  ? 'bg-white border border-b-white border-gray-100 font-medium text-gray-900'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
              }`}
            >
              {v.label}
            </button>
          ))}
          <button
            onClick={addVenture}
            className="ml-auto mr-2 mb-1 flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Venture
          </button>
        </div>

        <div className="p-5">
          {/* Venture meta */}
          {ventures.map(v => {
            if (v.id !== tab) return null
            return (
              <div key={v.id}>
                <div className="flex items-center gap-3 mb-5 p-3 bg-gray-50 rounded-xl">
                  <Settings2 className="w-5 h-5 text-gray-400" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900">{v.label}</p>
                    <p className="text-xs text-gray-400">{v.description || 'No description'}</p>
                  </div>
                  <button
                    onClick={() => {
                      const desc = prompt('Description:', v.description ?? '')
                      if (desc !== null) {
                        setConfig(c => ({
                          ...c,
                          ventures: c.ventures.map(x => x.id === v.id ? { ...x, description: desc } : x),
                        }))
                        setDirty(true)
                      }
                    }}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-white transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit description
                  </button>
                </div>

                <VenturePanel
                  ventureId={v.id}
                  services={services[v.id] ?? []}
                  config={config}
                  onChange={(svc) => updateServices(v.id, svc)}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Lead Options */}
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Lead Options</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Manage dropdown options for the Lead form.
            <span className="ml-1 text-gray-300">Service / Sister Concern, Category, and Subcategory are driven by the Ventures &amp; Services configuration above.</span>
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <LeadOptionList
            label="Sources"
            description="How the lead found out about you (e.g. Referral, Cold Outreach)"
            items={config?.leadSources ?? []}
            onChange={v => updateLeadOption('leadSources', v)}
          />
          <LeadOptionList
            label="Platforms"
            description="Channel where the lead was contacted (e.g. Facebook, LinkedIn)"
            items={config?.leadPlatforms ?? []}
            onChange={v => updateLeadOption('leadPlatforms', v)}
          />
        </div>
      </div>

      {/* Info */}
      <div className="text-xs text-gray-400 bg-gray-50 rounded-xl p-4">
        <p className="font-medium text-gray-600 mb-1">How this config links to projects &amp; leads</p>
        <p>When creating a new project or lead, the <strong>Venture / Sister Concern</strong> dropdown loads from the Ventures above.
          Selecting a venture dynamically populates the <strong>Category</strong> dropdown from that venture&apos;s services,
          and then the <strong>Subcategory</strong> dropdown from the selected service&apos;s subcategories — all driven by this configuration.
          Changes take effect immediately after saving.</p>
      </div>
    </div>
  )
}
