'use client'

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Input'
import ColorDots from '../ColorDots'
import { orgFetch } from '../api'

/** Create / rename / recolour a to-do list. onSaved(list, { created }). */
export default function ListFormModal({ open, onOpenChange, organizerId, list = null, onSaved }) {
  const editing = !!list
  const [name, setName] = useState('')
  const [color, setColor] = useState('zinc')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(list?.name ?? '')
    setColor(list?.color ?? 'zinc')
    setError(null)
  }, [open, list])

  async function save(e) {
    e?.preventDefault()
    if (saving) return
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    try {
      const json = editing
        ? await orgFetch(`/api/organizer/lists/${list.id}`, { method: 'PATCH', body: { name: name.trim(), color } })
        : await orgFetch('/api/organizer/lists', { method: 'POST', body: { organizerId, name: name.trim(), color } })
      onSaved?.(json.data, { created: !editing })
      onOpenChange?.(false)
    } catch (err) {
      toast.error(err.message || 'Could not save list')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={editing ? 'Edit list' : 'New list'} size="sm">
      <form onSubmit={save} className="space-y-4">
        <Field label="Name" htmlFor="list-name" error={error}>
          <Input
            id="list-name"
            autoFocus
            value={name}
            maxLength={80}
            invalid={!!error}
            onChange={(e) => { setName(e.target.value); setError(null) }}
            placeholder="e.g. Launch checklist"
          />
        </Field>
        <Field label="Colour">
          <ColorDots value={color} onChange={setColor} />
        </Field>
        <ModalFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancel</Button>
          <Button type="submit" loading={saving}>{editing ? 'Save' : 'Create list'}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}
