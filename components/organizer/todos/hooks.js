'use client'

import { useCallback, useEffect, useState } from 'react'
import { orgFetch } from '../api'

// ── localStorage-backed state (every access wrapped: private mode / blocked storage) ──
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(initial)
  useEffect(() => {
    if (!key) return
    try {
      const raw = window.localStorage.getItem(key)
      if (raw != null) setValue(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [key])
  const set = useCallback((v) => {
    setValue((prev) => {
      const next = typeof v === 'function' ? v(prev) : v
      try { if (key) window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [key])
  return [value, set]
}

// ── Organizer detail (projects, lists) — cached per session ──
const detailCache = new Map()

export function fetchOrganizerDetail(id, { fresh = false } = {}) {
  if (!id) return Promise.resolve(null)
  if (!fresh && detailCache.has(id)) return detailCache.get(id)
  const p = orgFetch(`/api/organizer/organizers/${id}`)
    .then((j) => j?.data ?? null)
    .catch((err) => { detailCache.delete(id); throw err })
  detailCache.set(id, p)
  return p
}

export function useOrganizerDetail(id) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let alive = true
    if (!id) { setDetail(null); return }
    setLoading(true)
    // Show the cached copy at once, but always revalidate: the organizer's projects
    // may have been edited since it was cached.
    const cached = detailCache.get(id)
    if (cached) cached.then((d) => { if (alive) setDetail(d) }).catch(() => {})
    fetchOrganizerDetail(id, { fresh: true })
      .then((d) => { if (alive) setDetail(d) })
      .catch(() => { if (alive && !cached) setDetail(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [id])
  return { detail, projects: detail?.projects ?? [], loading }
}

// ── All to-do lists across organizers (master-mode pickers) ──
export function useAllLists(enabled) {
  const [lists, setLists] = useState(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    orgFetch('/api/organizer/lists')
      .then((j) => { if (alive) setLists(j?.data ?? []) })
      .catch(() => { if (alive) setLists([]) })
    return () => { alive = false }
  }, [enabled])
  return lists
}

// ── Organizers (fallback when the page didn't pass them) ──
export function useOrganizers(provided, enabled = true) {
  const [fetched, setFetched] = useState(null)
  useEffect(() => {
    if (provided || !enabled) return
    let alive = true
    orgFetch('/api/organizer/organizers', { query: { status: 'ALL', sort: 'name' } })
      .then((j) => { if (alive) setFetched(j?.data ?? []) })
      .catch(() => { if (alive) setFetched([]) })
    return () => { alive = false }
  }, [provided, enabled])
  return provided ?? fetched ?? []
}

// ── Tag suggestions (todos + notes), cached with local additions ──
let tagPromise = null
let tagSet = null
const tagListeners = new Set()

function emitTags() {
  const arr = [...(tagSet ?? [])].sort()
  for (const fn of tagListeners) fn(arr)
}

export function loadTags({ fresh = false } = {}) {
  if (!fresh && tagPromise) return tagPromise
  tagPromise = orgFetch('/api/organizer/tags')
    .then((j) => {
      tagSet = new Set([...(tagSet ?? []), ...(j?.data ?? [])])
      emitTags()
      return [...tagSet].sort()
    })
    .catch(() => { tagPromise = null; return [...(tagSet ?? [])].sort() })
  return tagPromise
}

/** Add tags used in a save so suggestions include them without a refetch. */
export function rememberTags(tags = []) {
  if (!tags.length) return
  tagSet = new Set([...(tagSet ?? []), ...tags])
  emitTags()
}

export function useTagSuggestions() {
  const [tags, setTags] = useState(() => (tagSet ? [...tagSet].sort() : []))
  useEffect(() => {
    tagListeners.add(setTags)
    loadTags().then(setTags)
    return () => { tagListeners.delete(setTags) }
  }, [])
  return tags
}

// ── Staff people search ──
export async function searchPeople(q = '') {
  const j = await orgFetch('/api/organizer/people', { query: { q } })
  return j?.data ?? []
}
