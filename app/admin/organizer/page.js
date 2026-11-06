'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { CalendarDays, LayoutGrid, ListTodo, Plus, StickyNote } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Tabs from '@/components/ui/Tabs'
import LoadingSpinner, { PageLoader } from '@/components/ui/LoadingSpinner'
import { usePermission } from '@/components/auth/Can'
import OrganizerCalendar from '@/components/organizer/calendar'
import { OrganizerTodos } from '@/components/organizer/todos'
import { OrganizerNotes } from '@/components/organizer/notes'
import OrganizerFormModal from '@/components/organizer/OrganizerFormModal'
import OrganizerOverview from '@/components/organizer/overview/OrganizerOverview'
import { orgFetch } from '@/components/organizer/api'
import { deleteOrganizer, toggleArchive, updateOrganizer } from '@/components/organizer/overview/organizerActions'

const TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'calendar', label: 'Calendar', icon: CalendarDays },
  { value: 'todo',     label: 'To-do',    icon: ListTodo },
  { value: 'notes',    label: 'Notes',    icon: StickyNote },
]
const TAB_KEYS = TABS.map((t) => t.value)

function OrganizerDashboard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can, ready } = usePermission()
  const canManage = can('organizer.manage')

  // ── Tab (mirrored in ?tab=) ──
  const tabParam = searchParams.get('tab')
  const urlTab = TAB_KEYS.includes(tabParam) ? tabParam : 'overview'
  const [tab, setTab] = useState(urlTab)
  useEffect(() => { setTab(urlTab) }, [urlTab])

  /** router.replace with an edited copy of the live query (keeps the t_/n_ filter keys). */
  const replaceQuery = useCallback((edit) => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
    edit(params)
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [router, pathname])

  function changeTab(value) {
    setTab(value)
    replaceQuery((p) => {
      if (value === 'overview') p.delete('tab')
      else p.set('tab', value)
    })
  }

  // ── All organizers (both statuses): grid, stats and the master views' organizer filters ──
  const [organizers, setOrganizers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [version, setVersion] = useState(0)

  const load = useCallback(async () => {
    try {
      const json = await orgFetch('/api/organizer/organizers', { query: { status: 'ALL' } })
      setOrganizers(json?.data ?? [])
      setLoadError(null)
    } catch (err) {
      setLoadError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  // Counts change while working in the other tabs — refresh when coming back to the overview.
  const prevTab = useRef(tab)
  useEffect(() => {
    if (tab === 'overview' && prevTab.current !== 'overview') load()
    prevTab.current = tab
  }, [tab, load])

  const merge = useCallback((org) => {
    if (!org?.id) return
    setOrganizers((list) =>
      list.some((o) => o.id === org.id)
        ? list.map((o) => (o.id === org.id ? { ...o, ...org } : o))
        : [org, ...list]
    )
  }, [])

  // ── Create / edit modal (also opened by ?new=1) ──
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const openCreate = useCallback(() => {
    setEditing(null)
    setFormOpen(true)
  }, [])
  const openEdit = useCallback((org) => {
    setEditing(org)
    setFormOpen(true)
  }, [])

  const wantsNew = searchParams.get('new') === '1'
  useEffect(() => {
    if (!wantsNew || !ready) return
    if (canManage) openCreate()
    replaceQuery((p) => p.delete('new'))
  }, [wantsNew, ready, canManage, openCreate, replaceQuery])

  function handleSaved(saved) {
    if (!saved?.id) {
      load()
      return
    }
    const isNew = !organizers.some((o) => o.id === saved.id)
    merge(saved)
    if (isNew) router.push(`/admin/organizer/${saved.id}`)
  }

  // ── Card actions ──
  async function handleTogglePin(org) {
    merge({ ...org, pinned: !org.pinned }) // optimistic
    try {
      const data = await updateOrganizer(org.id, { pinned: !org.pinned })
      if (data) merge(data)
    } catch (err) {
      merge(org)
      toast.error(err.message)
    }
  }

  async function handleToggleArchive(org) {
    const data = await toggleArchive(org)
    if (data) {
      merge(data)
      setVersion((v) => v + 1)
    }
  }

  async function handleDelete(org) {
    if (await deleteOrganizer(org)) {
      setOrganizers((list) => list.filter((o) => o.id !== org.id))
      setVersion((v) => v + 1)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizer"
        actions={canManage ? <Button onClick={openCreate}><Plus /> New organizer</Button> : null}
      />

      <Tabs variant="underline" value={tab} onChange={changeTab} tabs={TABS} />

      <Suspense fallback={<LoadingSpinner className="py-20" />}>
        {tab === 'overview' && (
          <OrganizerOverview
            organizers={organizers}
            loading={loading}
            error={loadError}
            onRetry={() => { setLoading(true); load() }}
            onRefresh={load}
            canManage={canManage}
            version={version}
            onNew={openCreate}
            onEdit={openEdit}
            onTogglePin={handleTogglePin}
            onToggleArchive={handleToggleArchive}
            onDelete={handleDelete}
            onTabChange={changeTab}
          />
        )}
        {tab === 'calendar' && (
          <OrganizerCalendar organizers={organizers} canManage={canManage} storageKey="org-master-cal" />
        )}
        {tab === 'todo' && <OrganizerTodos organizers={organizers} canManage={canManage} />}
        {tab === 'notes' && <OrganizerNotes organizers={organizers} canManage={canManage} />}
      </Suspense>

      <OrganizerFormModal open={formOpen} onOpenChange={setFormOpen} organizer={editing} onSaved={handleSaved} />
    </div>
  )
}

export default function OrganizerPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <OrganizerDashboard />
    </Suspense>
  )
}
