'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Search } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Input, Textarea, Field, Label } from '@/components/ui/Input'
import ClientSearch from '@/components/ui/ClientSearch'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ColorDots from './ColorDots'
import { orgFetch } from './api'

/**
 * Create / edit an organizer.
 *   <OrganizerFormModal open onOpenChange={setOpen} organizer={editing} onSaved={(org) => …} />
 */
export default function OrganizerFormModal({ open, onOpenChange, organizer, onSaved }) {
  const isEdit = Boolean(organizer?.id)
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={isEdit ? 'Edit organizer' : 'New organizer'} size="md">
      {/* Dialog content unmounts when closed, so the form re-initialises on every open. */}
      <OrganizerForm
        key={organizer?.id ?? 'new'}
        organizer={isEdit ? organizer : null}
        onCancel={() => onOpenChange?.(false)}
        onSaved={(saved) => {
          onSaved?.(saved)
          onOpenChange?.(false)
        }}
      />
    </Modal>
  )
}

function OrganizerForm({ organizer, onCancel, onSaved }) {
  const isEdit = Boolean(organizer)
  const [form, setForm] = useState(() => ({
    name:        organizer?.name ?? '',
    color:       organizer?.color ?? 'zinc',
    clientId:    organizer?.client?.id ?? '',
    projectIds:  (organizer?.projects ?? []).map((p) => p.id),
    description: organizer?.description ?? '',
  }))
  const [nameError, setNameError] = useState(null)
  const [saving, setSaving] = useState(false)

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))

  function changeClient(id) {
    const next = id || ''
    // Projects belong to a client — a different client starts with none selected.
    setForm((f) => ({ ...f, clientId: next, projectIds: next === f.clientId ? f.projectIds : [] }))
  }

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    const name = form.name.trim()
    if (!name) {
      setNameError('Name is required')
      return
    }
    const description = form.description.trim()
    const projectIds = form.clientId ? form.projectIds : []
    const body = isEdit
      ? { name, color: form.color, description, clientId: form.clientId || null, projectIds }
      : {
          name,
          color: form.color,
          projectIds,
          ...(description ? { description } : {}),
          ...(form.clientId ? { clientId: form.clientId } : {}),
        }

    setSaving(true)
    try {
      const json = await orgFetch(
        isEdit ? `/api/organizer/organizers/${organizer.id}` : '/api/organizer/organizers',
        { method: isEdit ? 'PATCH' : 'POST', body }
      )
      toast.success(isEdit ? 'Organizer updated' : 'Organizer created')
      onSaved(json?.data ?? null)
    } catch (err) {
      toast.error(err.message)
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Name" htmlFor="organizer-name" required error={nameError}>
        <Input
          id="organizer-name"
          autoFocus
          maxLength={120}
          value={form.name}
          invalid={!!nameError}
          onChange={(e) => {
            set('name', e.target.value)
            if (nameError) setNameError(null)
          }}
        />
      </Field>

      <Field label="Color">
        <ColorDots value={form.color} onChange={(v) => set('color', v)} />
      </Field>

      <Field label="Client">
        {/* Enter in the search box must not submit the form (it would save without the client). */}
        <div onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}>
          <ClientSearch value={form.clientId} onChange={changeClient} placeholder="Search clients…" />
        </div>
      </Field>

      {form.clientId && (
        <ProjectPicker
          clientId={form.clientId}
          value={form.projectIds}
          onChange={(ids) => set('projectIds', ids)}
          known={organizer?.client?.id === form.clientId ? organizer?.projects : null}
        />
      )}

      <Field label="Description" htmlFor="organizer-description">
        <Textarea
          id="organizer-description"
          rows={3}
          maxLength={2000}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>

      <ModalFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {isEdit ? 'Save changes' : 'Create organizer'}
        </Button>
      </ModalFooter>
    </form>
  )
}

/** Checkbox list of the client's projects (GET /api/projects?clientId=…). */
function ProjectPicker({ clientId, value, onChange, known }) {
  const [projects, setProjects] = useState(null) // null while loading
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    setProjects(null)
    setError(null)
    setQuery('')
    orgFetch('/api/projects', { query: { clientId, limit: 100 }, signal: ctrl.signal })
      .then((json) => setProjects(json?.data ?? []))
      .catch((err) => {
        if (ctrl.signal.aborted) return
        setError(err.message)
        setProjects([])
      })
    return () => ctrl.abort()
  }, [clientId])

  // Keep already-linked projects visible even when the list API doesn't return them
  // (e.g. staff who only see projects they work on).
  const options = useMemo(() => {
    const list = (projects ?? []).map((p) => ({ id: p.id, name: p.name, code: p.projectCode ?? null }))
    const seen = new Set(list.map((p) => p.id))
    for (const p of known ?? []) if (!seen.has(p.id)) list.push({ id: p.id, name: p.name, code: null })
    return list
  }, [projects, known])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter((p) => p.name?.toLowerCase().includes(q) || p.code?.toLowerCase().includes(q))
    : options
  const selected = new Set(value)
  const toggle = (id) => onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id])

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Label className="mb-0">Projects</Label>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-muted-foreground transition-colors hover:text-gray-900"
          >
            {value.length} selected · Clear
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-input bg-white shadow-xs">
        {options.length > 6 && (
          <div className="relative border-b border-gray-100">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
              placeholder="Filter projects…"
              className="h-9 w-full border-0 bg-transparent pl-9 pr-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
            />
          </div>
        )}
        <div className="max-h-52 overflow-y-auto p-1">
          {projects === null ? (
            <LoadingSpinner size="sm" className="py-6" />
          ) : error ? (
            <p className="px-2.5 py-3 text-sm text-red-600">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="px-2.5 py-3 text-sm text-muted-foreground">
              {options.length ? 'No matches' : 'No projects'}
            </p>
          ) : (
            filtered.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  className="size-4 rounded border-gray-300"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900">{p.name}</span>
                {p.code && <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.code}</span>}
              </label>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
