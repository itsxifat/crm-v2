'use client'

import toast from 'react-hot-toast'
import { orgFetch } from '../api'

// Organizer mutations shared by the dashboard cards and the organizer page header.

const itemUrl = (id) => `/api/organizer/organizers/${id}`

/** PATCH an organizer; returns the updated organizer (throws on failure). */
export async function updateOrganizer(id, patch) {
  const json = await orgFetch(itemUrl(id), { method: 'PATCH', body: patch })
  return json?.data ?? null
}

/** Archive ↔ restore. Returns the updated organizer, or null on failure (already toasted). */
export async function toggleArchive(org) {
  const archiving = org.status !== 'ARCHIVED'
  try {
    const data = await updateOrganizer(org.id, { status: archiving ? 'ARCHIVED' : 'ACTIVE' })
    toast.success(archiving ? 'Organizer archived' : 'Organizer restored')
    return data ?? { ...org, status: archiving ? 'ARCHIVED' : 'ACTIVE' }
  } catch (err) {
    toast.error(err.message)
    return null
  }
}

/** Confirm, then delete (cascades server-side). Returns true when deleted. */
export async function deleteOrganizer(org) {
  if (!confirm(`Delete "${org.name}"? Its calendars, events, to-dos and notes will be deleted too.`)) return false
  try {
    await orgFetch(itemUrl(org.id), { method: 'DELETE' })
    toast.success('Organizer deleted')
    return true
  } catch (err) {
    toast.error(err.message)
    return false
  }
}
