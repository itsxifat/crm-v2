'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Input'
import ColorDots from '../ColorDots'
import { orgFetch } from '../api'

/** Create / rename / recolour a calendar. onSaved(calendar, { created }). */
export default function CalendarFormModal({ open, onOpenChange, organizerId, calendar = null, onSaved }) {
  const editing = !!calendar
  const [name, setName] = useState('')
  const [color, setColor] = useState('blue')
  const [description, setDescription] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(calendar?.name ?? '')
    setColor(calendar?.color ?? 'blue')
    setDescription(calendar?.description ?? '')
    setError(null)
  }, [open, calendar])

  async function save(e) {
    e?.preventDefault()
    if (saving) return
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    try {
      const desc = description.trim()
      const json = editing
        ? await orgFetch(`/api/organizer/calendars/${calendar.id}`, {
            method: 'PATCH',
            body: { name: name.trim(), color, description: desc || null },
          })
        : await orgFetch('/api/organizer/calendars', {
            method: 'POST',
            body: { organizerId, name: name.trim(), color, ...(desc ? { description: desc } : {}) },
          })
      toast.success(editing ? 'Calendar updated' : 'Calendar created')
      onSaved?.(json?.data, { created: !editing })
      onOpenChange?.(false)
    } catch (err) {
      toast.error(err.message || 'Could not save calendar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? 'Edit calendar' : 'New calendar'} size="sm">
      <form onSubmit={save} className="space-y-4">
        <Field label="Name" htmlFor="cal-name" required error={error}>
          <Input
            id="cal-name"
            autoFocus
            value={name}
            maxLength={80}
            invalid={!!error}
            onChange={(e) => { setName(e.target.value); setError(null) }}
            placeholder="e.g. Meetings"
          />
        </Field>
        <Field label="Colour">
          <ColorDots value={color} onChange={setColor} size="sm" />
        </Field>
        <Field label="Description" htmlFor="cal-desc">
          <Textarea id="cal-desc" rows={2} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ModalFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancel</Button>
          <Button type="submit" loading={saving}>{editing ? 'Save' : 'Create calendar'}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}
