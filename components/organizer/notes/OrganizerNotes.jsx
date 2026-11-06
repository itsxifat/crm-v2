'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FolderKanban, LayoutGrid, Pin, Plus, Rows3, StickyNote, Tag } from 'lucide-react'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Tabs from '@/components/ui/Tabs'
import { orgFetch } from '../api'
import FilterBar from '../filters/FilterBar'
import { isSameValue, useUrlFilters } from '../filters/useUrlFilters'
import { useOrganizers, usePersistentState, useTagSuggestions } from '../todos/hooks'
import NoteEditorModal from './NoteEditorModal'
import { NoteGrid, NoteList } from './NoteViews'

const LIMIT = 100
const FILTER_KEYS = ['q', 'org', 'tags', 'pinned']

const MASTER_DEFAULTS = { q: '', org: [], tags: [], pinned: false, sort: 'updated', dir: '' }
const ORGANIZER_DEFAULTS = { q: '', tags: [], pinned: false, sort: 'updated', dir: '' }

const NOTE_SORTS = [
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'Title' },
  { value: 'organizer', label: 'Organizer' },
]

const defaultNoteDir = (sort) => (sort === 'title' || sort === 'organizer' ? 'asc' : 'desc')

function SectionLabel({ children }) {
  return <h3 className="mb-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">{children}</h3>
}

/**
 * Notes for one organizer (`organizerId`) or all organizers (master).
 * Uses useSearchParams — render inside <Suspense>.
 */
export default function OrganizerNotes({ organizerId, organizers: organizersProp, canManage = false }) {
  const isMaster = !organizerId
  const organizers = useOrganizers(organizersProp, isMaster)
  const tagSuggestions = useTagSuggestions()

  const { filters, setFilters, reset, defaults } = useUrlFilters('n_', isMaster ? MASTER_DEFAULTS : ORGANIZER_DEFAULTS)
  const [storedView, setView] = usePersistentState('org-notes-view', 'grid')
  const view = storedView === 'list' ? 'list' : 'grid'

  const [notes, setNotes] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [editor, setEditor] = useState({ open: false, note: null })

  const notesRef = useRef(notes)
  notesRef.current = notes

  const sort = filters.sort || defaults.sort
  const dir = filters.dir || defaultNoteDir(sort)
  const filtersActive = FILTER_KEYS.some((k) => k in defaults && !isSameValue(filters[k], defaults[k]))

  const query = useMemo(() => ({
    organizerIds: isMaster ? filters.org : [organizerId],
    tags: filters.tags,
    pinned: filters.pinned ? 1 : '',
    search: (filters.q ?? '').trim(),
    sort,
    dir,
    limit: LIMIT,
  }), [isMaster, organizerId, filters, sort, dir])
  const queryKey = JSON.stringify(query)

  const reqId = useRef(0)
  const load = useCallback(async (page = 1) => {
    const id = ++reqId.current
    if (page === 1) setLoading(true)
    else setLoadingMore(true)
    try {
      const json = await orgFetch('/api/organizer/notes', { query: { ...JSON.parse(queryKey), page } })
      if (id !== reqId.current) return
      const rows = json?.data ?? []
      setNotes((prev) => {
        if (page === 1) return rows
        const seen = new Set(prev.map((n) => n.id))
        return [...prev, ...rows.filter((n) => !seen.has(n.id))]
      })
      setMeta(json?.meta ?? null)
    } catch (err) {
      if (id === reqId.current) toast.error(err.message || 'Could not load notes')
    } finally {
      if (id === reqId.current) { setLoading(false); setLoadingMore(false) }
    }
  }, [queryKey])

  useEffect(() => { load(1) }, [load])

  // ── Mutations ──────────────────────────────────────────────────────────────
  const togglePin = useCallback(async (note) => {
    const pinned = !note.pinned
    setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, pinned } : n)))
    try {
      const json = await orgFetch(`/api/organizer/notes/${note.id}`, { method: 'PATCH', body: { pinned } })
      if (json?.data) setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, ...json.data } : n)))
    } catch (err) {
      setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, pinned: note.pinned } : n)))
      toast.error(err.message || 'Could not update note')
    }
  }, [])

  const deleteNote = useCallback(async (note) => {
    if (!confirm(`Delete "${note.title?.trim() || 'Untitled'}"?`)) return
    try {
      await orgFetch(`/api/organizer/notes/${note.id}`, { method: 'DELETE' })
      setNotes((ns) => ns.filter((n) => n.id !== note.id))
      setMeta((m) => (m ? { ...m, total: Math.max(0, (m.total ?? 1) - 1) } : m))
      toast.success('Note deleted')
    } catch (err) {
      toast.error(err.message || 'Could not delete note')
    }
  }, [])

  function onSaved(note, { created }) {
    if (created) {
      setNotes((ns) => [note, ...ns])
      setMeta((m) => (m ? { ...m, total: (m.total ?? 0) + 1 } : m))
    } else {
      setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, ...note } : n)))
    }
  }

  function onDeleted(id) {
    setNotes((ns) => ns.filter((n) => n.id !== id))
    setMeta((m) => (m ? { ...m, total: Math.max(0, (m.total ?? 1) - 1) } : m))
  }

  const openNote = useCallback((note) => setEditor({ open: true, note }), [])
  const openCreate = () => setEditor({ open: true, note: null })

  // ── Filter bar config ──────────────────────────────────────────────────────
  const organizerOptions = useMemo(
    () => organizers.map((o) => ({ value: o.id, label: o.name, color: o.color })),
    [organizers]
  )
  const tagOptions = useMemo(() => tagSuggestions.map((t) => ({ value: t, label: `#${t}` })), [tagSuggestions])

  const fields = [
    isMaster && { type: 'multi', key: 'org', label: 'Organizer', icon: FolderKanban, options: organizerOptions, searchable: true },
    { type: 'multi', key: 'tags', label: 'Tags', icon: Tag, options: tagOptions, getLabel: (v) => `#${v}`, emptyText: 'No tags' },
    { type: 'toggle', key: 'pinned', label: 'Pinned', icon: Pin },
  ]
  const sortOptions = NOTE_SORTS.filter((s) => isMaster || s.value !== 'organizer')

  const viewToggle = (
    <Tabs
      size="sm"
      value={view}
      onChange={setView}
      tabs={[
        { value: 'grid', label: 'Grid', icon: LayoutGrid },
        { value: 'list', label: 'List', icon: Rows3 },
      ]}
    />
  )

  // Server returns pinned first; keep that split visible.
  const pinned = notes.filter((n) => n.pinned)
  const others = notes.filter((n) => !n.pinned)
  const hasMore = !!meta && (meta.page ?? 1) < (meta.pages ?? 1)

  const viewProps = {
    showOrganizer: isMaster,
    canManage,
    onOpen: openNote,
    onTogglePin: togglePin,
    onDelete: deleteNote,
  }
  const View = view === 'list' ? NoteList : NoteGrid

  let body
  if (loading && !notes.length) {
    body = <Card className="py-16"><LoadingSpinner /></Card>
  } else if (!notes.length) {
    body = (
      <Card>
        <EmptyState
          icon={StickyNote}
          title={filtersActive ? 'No matching notes' : 'No notes yet'}
          action={filtersActive ? (
            <Button variant="outline" size="sm" onClick={() => reset(FILTER_KEYS.filter((k) => k in defaults))}>Clear filters</Button>
          ) : canManage ? (
            <Button size="sm" onClick={openCreate}><Plus /> New note</Button>
          ) : null}
        />
      </Card>
    )
  } else {
    body = (
      <div className={loading ? 'space-y-6 opacity-60 transition-opacity' : 'space-y-6 transition-opacity'}>
        {pinned.length > 0 && (
          <section>
            {others.length > 0 && <SectionLabel>Pinned</SectionLabel>}
            <View notes={pinned} {...viewProps} />
          </section>
        )}
        {others.length > 0 && (
          <section>
            {pinned.length > 0 && <SectionLabel>Others</SectionLabel>}
            <View notes={others} {...viewProps} />
          </section>
        )}
        {hasMore && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              loading={loadingMore}
              onClick={() => { if (!loading && !loadingMore) load((meta?.page ?? 1) + 1) }}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <FilterBar
        values={filters}
        defaults={defaults}
        onChange={setFilters}
        onReset={() => reset()}
        search={{ key: 'q', placeholder: 'Search notes' }}
        fields={fields}
        sort={{ key: 'sort', dirKey: 'dir', options: sortOptions, defaultDir: defaultNoteDir }}
        actions={
          <>
            {viewToggle}
            {canManage && (
              <Button size="sm" onClick={openCreate}>
                <Plus /> New note
              </Button>
            )}
          </>
        }
      />

      {body}

      <NoteEditorModal
        open={editor.open}
        onOpenChange={(open) => setEditor((e) => ({ ...e, open }))}
        note={editor.note}
        organizerId={organizerId}
        organizers={organizers}
        canManage={canManage}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    </div>
  )
}

export { OrganizerNotes }
