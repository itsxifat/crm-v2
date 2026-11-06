'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Pin, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Field } from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import ColorDots from '../ColorDots'
import { orgFetch } from '../api'
import TagInput from '../todos/TagInput'
import { rememberTags, useOrganizerDetail } from '../todos/hooks'
import { noteSurface } from './NoteCard'

const NO_PROJECT = '__none'
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

function emptyNote(organizerId) {
  return { organizerId: organizerId ?? null, title: '', content: '', color: 'zinc', pinned: false, tags: [], projectId: null }
}

function fromNote(n) {
  return {
    organizerId: n.organizer?.id ?? null,
    title: n.title ?? '',
    content: n.content ?? '',
    color: n.color ?? 'zinc',
    pinned: !!n.pinned,
    tags: n.tags ?? [],
    projectId: n.project?.id ?? null,
  }
}

const sameArr = (a = [], b = []) => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * Create / edit a note. Save button or Ctrl/Cmd+Enter.
 *   note          existing note | null
 *   organizerId   organizer mode; in master mode an organizer Select is shown (required on create)
 *   organizers    [{ id, name, color }] for that Select
 *   onSaved(note, { created })  onDeleted(id)
 */
export default function NoteEditorModal({
  open,
  onOpenChange,
  note = null,
  organizerId,
  organizers = [],
  canManage = true,
  onSaved,
  onDeleted,
}) {
  const editing = !!note
  const readOnly = !canManage
  const [form, setForm] = useState(() => emptyNote(organizerId))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const contentRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setForm(note ? fromNote(note) : emptyNote(organizerId))
    setErrors({})
  }, [open, note, organizerId])

  const orgId = organizerId ?? form.organizerId
  const { projects } = useOrganizerDetail(open ? orgId : null)

  const projectOptions = useMemo(() => {
    const opts = projects.map((p) => ({ value: p.id, label: p.name }))
    if (note?.project && note.organizer?.id === orgId && !opts.some((o) => o.value === note.project.id)) {
      opts.unshift({ value: note.project.id, label: note.project.name })
    }
    return opts.length ? [{ value: NO_PROJECT, label: 'No project' }, ...opts] : []
  }, [projects, note, orgId])

  const organizerOptions = useMemo(
    () => organizers.map((o) => ({ value: o.id, label: o.name })),
    [organizers]
  )

  // Auto-grow the content area. Keyed on `form` (a new object on every open), not just its
  // content: the dialog mounts the textarea a commit after `open` flips, so reopening a note
  // with unchanged content would otherwise never size it.
  useIsoLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 180)}px`
  }, [form, open])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const showOrganizerSelect = !organizerId && !editing

  async function save() {
    if (readOnly || saving) return
    const errs = {}
    if (showOrganizerSelect && !form.organizerId) errs.organizerId = 'Choose an organizer'
    if (!form.title.trim() && !form.content.trim()) errs.content = 'Add a title or some content'
    setErrors(errs)
    if (Object.keys(errs).length) return

    const payload = {
      title: form.title.trim(),
      content: form.content,
      color: form.color,
      pinned: form.pinned,
      tags: form.tags,
      projectId: form.projectId || null,
    }

    let body
    if (editing) {
      const orig = fromNote(note)
      body = {}
      if (payload.title !== orig.title) body.title = payload.title
      if (payload.content !== orig.content) body.content = payload.content
      if (payload.color !== orig.color) body.color = payload.color
      if (payload.pinned !== orig.pinned) body.pinned = payload.pinned
      if (!sameArr(payload.tags, orig.tags)) body.tags = payload.tags
      if (payload.projectId !== orig.projectId) body.projectId = payload.projectId
      if (!Object.keys(body).length) { onOpenChange?.(false); return }
    } else {
      body = { organizerId: orgId, ...payload }
      if (!body.projectId) delete body.projectId
      if (!body.tags.length) delete body.tags
    }

    setSaving(true)
    try {
      const json = editing
        ? await orgFetch(`/api/organizer/notes/${note.id}`, { method: 'PATCH', body })
        : await orgFetch('/api/organizer/notes', { method: 'POST', body })
      rememberTags(form.tags)
      toast.success(editing ? 'Note saved' : 'Note created')
      onSaved?.(json.data, { created: !editing })
      onOpenChange?.(false)
    } catch (err) {
      toast.error(err.message || 'Could not save note')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editing || deleting) return
    if (!confirm(`Delete "${note.title?.trim() || 'Untitled'}"?`)) return
    setDeleting(true)
    try {
      await orgFetch(`/api/organizer/notes/${note.id}`, { method: 'DELETE' })
      toast.success('Note deleted')
      onDeleted?.(note.id)
      onOpenChange?.(false)
    } catch (err) {
      toast.error(err.message || 'Could not delete note')
    } finally {
      setDeleting(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? (readOnly ? 'Note' : 'Edit note') : 'New note'} size="lg">
      <form onSubmit={(e) => { e.preventDefault(); save() }} onKeyDown={onKeyDown} className="space-y-4">
        {showOrganizerSelect && (
          <Field label="Organizer" required error={errors.organizerId}>
            <Select
              value={form.organizerId}
              onChange={(v) => { set({ organizerId: v, projectId: null }); setErrors((e) => ({ ...e, organizerId: null })) }}
              options={organizerOptions}
              placeholder="Choose an organizer"
            />
          </Field>
        )}

        <div className={cn('overflow-hidden rounded-xl border border-gray-200/80 transition-colors', noteSurface(form.color), errors.content && 'border-red-300')}>
          <input
            autoFocus={!editing}
            value={form.title}
            maxLength={200}
            disabled={readOnly}
            onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); contentRef.current?.focus() }
            }}
            placeholder="Title"
            aria-label="Title"
            className="block w-full border-0 bg-transparent px-4 pb-1 pt-3.5 text-base font-semibold text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0 disabled:cursor-not-allowed"
          />
          <textarea
            ref={contentRef}
            value={form.content}
            maxLength={50000}
            disabled={readOnly}
            onChange={(e) => { set({ content: e.target.value }); if (errors.content) setErrors((x) => ({ ...x, content: null })) }}
            placeholder="Write a note…"
            aria-label="Content"
            className="block min-h-[180px] w-full resize-none border-0 bg-transparent px-4 pb-4 pt-1 text-sm leading-relaxed text-gray-800 outline-none placeholder:text-gray-400 focus:ring-0 disabled:cursor-not-allowed"
          />
        </div>
        {errors.content && <p className="-mt-2 text-xs text-red-600">{errors.content}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ColorDots value={form.color} onChange={(color) => !readOnly && set({ color })} size="sm" />
          <button
            type="button"
            disabled={readOnly}
            aria-pressed={form.pinned}
            onClick={() => set({ pinned: !form.pinned })}
            className={buttonVariants({ variant: form.pinned ? 'default' : 'outline', size: 'sm' })}
          >
            <Pin className={cn('size-3.5', form.pinned && 'fill-current')} />
            {form.pinned ? 'Pinned' : 'Pin'}
          </button>
        </div>

        <div className={cn('grid gap-4', projectOptions.length > 0 && 'sm:grid-cols-2')}>
          <Field label="Tags">
            <TagInput value={form.tags} onChange={(tags) => set({ tags })} disabled={readOnly} />
          </Field>
          {projectOptions.length > 0 && (
            <Field label="Project">
              <Select
                value={form.projectId ?? NO_PROJECT}
                onChange={(v) => set({ projectId: v && v !== NO_PROJECT ? v : null })}
                options={projectOptions}
                disabled={readOnly}
              />
            </Field>
          )}
        </div>

        <ModalFooter>
          {editing && canManage && (
            <Button
              variant="ghost"
              onClick={remove}
              loading={deleting}
              className="text-red-600 hover:bg-red-50 hover:text-red-700 sm:mr-auto"
            >
              {!deleting && <Trash2 />}
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>{readOnly ? 'Close' : 'Cancel'}</Button>
          {!readOnly && <Button type="submit" loading={saving}>{editing ? 'Save' : 'Create note'}</Button>}
        </ModalFooter>
      </form>
    </Modal>
  )
}
