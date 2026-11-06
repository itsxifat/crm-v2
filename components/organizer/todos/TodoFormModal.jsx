'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Trash2 } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { orgFetch } from '../api'
import { PRIORITY, PRIORITY_KEYS, TODO_STATUS, TODO_STATUS_KEYS } from '../constants'
import AssigneePicker from './AssigneePicker'
import TagInput from './TagInput'
import { rememberTags, useAllLists, useOrganizerDetail } from './hooks'

const NO_PROJECT = '__none'

const STATUS_SELECT = TODO_STATUS_KEYS.map((k) => ({ value: k, label: TODO_STATUS[k].label }))
const PRIORITY_SELECT = PRIORITY_KEYS.map((k) => ({ value: k, label: PRIORITY[k].label }))

function listOrganizerId(list) {
  return list?.organizerId ?? list?.organizer?.id ?? null
}

function emptyForm(listId) {
  return {
    title: '', notes: '', listId: listId ?? null, status: 'OPEN', priority: 'MEDIUM',
    dueDate: null, assignee: null, tags: [], projectId: null,
  }
}

function formFromTodo(t) {
  return {
    title: t.title ?? '',
    notes: t.notes ?? '',
    listId: t.list?.id ?? null,
    status: t.status ?? 'OPEN',
    priority: t.priority ?? 'MEDIUM',
    dueDate: t.dueDate ? t.dueDate.slice(0, 10) : null,
    assignee: t.assignee ?? null,
    tags: t.tags ?? [],
    projectId: t.project?.id ?? null,
  }
}

const sameArr = (a = [], b = []) => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * Create / edit a to-do.
 *   todo            existing to-do (edit) | null (create)
 *   organizerId     organizer mode scope (lists come from `lists`)
 *   lists           List[] for the list picker; omitted in master mode → all lists are fetched
 *   defaultListId   preselected list on create
 *   onSaved(todo, { created })  onDeleted(id)
 */
export default function TodoFormModal({
  open,
  onOpenChange,
  todo = null,
  organizerId,
  lists,
  defaultListId,
  defaults,
  canManage = true,
  onSaved,
  onDeleted,
}) {
  const editing = !!todo
  const [form, setForm] = useState(() => emptyForm(defaultListId))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const initialOrg = useRef(null)

  const fetchedLists = useAllLists(open && !lists)
  const allLists = useMemo(() => {
    const base = lists ?? fetchedLists ?? []
    // Make sure the current list is selectable before the full list arrives.
    if (todo?.list && !base.some((l) => l.id === todo.list.id)) {
      return [{ ...todo.list, organizerId: todo.organizer?.id, organizer: todo.organizer }, ...base]
    }
    return base
  }, [lists, fetchedLists, todo])

  useEffect(() => {
    if (!open) return
    const f = todo ? formFromTodo(todo) : { ...emptyForm(defaultListId ?? (lists?.[0]?.id ?? null)), ...(defaults ?? {}) }
    setForm(f)
    setErrors({})
    initialOrg.current = todo?.organizer?.id ?? organizerId ?? null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, todo])

  const selectedList = allLists.find((l) => l.id === form.listId)
  const orgId = organizerId ?? listOrganizerId(selectedList) ?? todo?.organizer?.id ?? null
  const { projects, detail } = useOrganizerDetail(open ? orgId : null)

  // Moved to another organizer: drop a project that doesn't belong there.
  useEffect(() => {
    if (!detail || !form.projectId) return
    if (orgId === initialOrg.current) return
    if (!projects.some((p) => p.id === form.projectId)) setForm((f) => ({ ...f, projectId: null }))
  }, [detail, orgId, projects, form.projectId])

  const showOrganizerInLabel = !organizerId
  const listOptions = allLists.map((l) => ({
    value: l.id,
    label: showOrganizerInLabel && l.organizer?.name ? `${l.organizer.name} · ${l.name}` : l.name,
  }))

  const projectOptions = useMemo(() => {
    const opts = projects.map((p) => ({ value: p.id, label: p.name }))
    if (todo?.project && !opts.some((o) => o.value === todo.project.id) && orgId === initialOrg.current) {
      opts.unshift({ value: todo.project.id, label: todo.project.name })
    }
    return opts.length ? [{ value: NO_PROJECT, label: 'No project' }, ...opts] : []
  }, [projects, todo, orgId])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const readOnly = !canManage

  async function save() {
    if (readOnly || saving) return
    const errs = {}
    if (!form.title.trim()) errs.title = 'Title is required'
    if (!form.listId) errs.listId = 'Choose a list'
    setErrors(errs)
    if (Object.keys(errs).length) return

    const payload = {
      title: form.title.trim(),
      notes: form.notes.trim() ? form.notes : null,
      listId: form.listId,
      status: form.status,
      priority: form.priority,
      dueDate: form.dueDate || null,
      assigneeId: form.assignee?.id ?? null,
      tags: form.tags,
      projectId: form.projectId || null,
    }

    let body = payload
    if (editing) {
      const orig = formFromTodo(todo)
      body = {}
      if (payload.title !== orig.title) body.title = payload.title
      if ((payload.notes ?? '') !== (orig.notes ?? '')) body.notes = payload.notes
      if (payload.listId !== orig.listId) body.listId = payload.listId
      if (payload.status !== orig.status) body.status = payload.status
      if (payload.priority !== orig.priority) body.priority = payload.priority
      if (payload.dueDate !== orig.dueDate) body.dueDate = payload.dueDate
      if (payload.assigneeId !== (orig.assignee?.id ?? null)) body.assigneeId = payload.assigneeId
      if (!sameArr(payload.tags, orig.tags)) body.tags = payload.tags
      if (payload.projectId !== orig.projectId) body.projectId = payload.projectId
      if (!Object.keys(body).length) { onOpenChange?.(false); return }
    } else {
      // Create: leave out empty optionals.
      body = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length)))
    }

    setSaving(true)
    try {
      const json = editing
        ? await orgFetch(`/api/organizer/todos/${todo.id}`, { method: 'PATCH', body })
        : await orgFetch('/api/organizer/todos', { method: 'POST', body })
      rememberTags(form.tags)
      toast.success(editing ? 'To-do updated' : 'To-do added')
      onSaved?.(json.data, { created: !editing })
      onOpenChange?.(false)
    } catch (err) {
      toast.error(err.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!editing || deleting) return
    if (!confirm(`Delete "${todo.title}"?`)) return
    setDeleting(true)
    try {
      await orgFetch(`/api/organizer/todos/${todo.id}`, { method: 'DELETE' })
      toast.success('To-do deleted')
      onDeleted?.(todo.id)
      onOpenChange?.(false)
    } catch (err) {
      toast.error(err.message || 'Could not delete')
    } finally {
      setDeleting(false)
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save() }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? (readOnly ? 'To-do' : 'Edit to-do') : 'New to-do'} size="lg">
      <form
        onSubmit={(e) => { e.preventDefault(); save() }}
        onKeyDown={onKeyDown}
        className="space-y-4"
      >
        <Field label="Title" htmlFor="todo-title" required={!readOnly} error={errors.title}>
          <Input
            id="todo-title"
            autoFocus={!editing}
            value={form.title}
            maxLength={300}
            disabled={readOnly}
            invalid={!!errors.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="What needs doing?"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="List" required={!readOnly} error={errors.listId}>
            <Select
              value={form.listId}
              onChange={(v) => set({ listId: v })}
              options={listOptions}
              placeholder={lists || fetchedLists ? 'Choose a list' : 'Loading…'}
              disabled={readOnly}
            />
          </Field>
          <Field label="Due date">
            <DatePicker value={form.dueDate} onChange={(v) => set({ dueDate: v })} placeholder="No due date" disabled={readOnly} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(v) => v && set({ status: v })} options={STATUS_SELECT} disabled={readOnly} />
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(v) => v && set({ priority: v })} options={PRIORITY_SELECT} disabled={readOnly} />
          </Field>
          <Field label="Assignee">
            <AssigneePicker value={form.assignee} onChange={(p) => set({ assignee: p })} disabled={readOnly} />
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

        <Field label="Tags">
          <TagInput value={form.tags} onChange={(tags) => set({ tags })} disabled={readOnly} />
        </Field>

        <Field label="Notes" htmlFor="todo-notes">
          <Textarea
            id="todo-notes"
            rows={4}
            maxLength={5000}
            value={form.notes}
            disabled={readOnly}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Add details…"
          />
        </Field>

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
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="submit" loading={saving}>
              {editing ? 'Save' : 'Add to-do'}
            </Button>
          )}
        </ModalFooter>
      </form>
    </Modal>
  )
}
