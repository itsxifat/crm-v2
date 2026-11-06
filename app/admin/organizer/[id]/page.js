'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { CalendarDays, CalendarX, CircleAlert, ListTodo, StickyNote } from 'lucide-react'
import Button from '@/components/ui/Button'
import Tabs from '@/components/ui/Tabs'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner, { PageLoader } from '@/components/ui/LoadingSpinner'
import { usePermission } from '@/components/auth/Can'
import OrganizerCalendar from '@/components/organizer/calendar'
import { OrganizerTodos } from '@/components/organizer/todos'
import { OrganizerNotes } from '@/components/organizer/notes'
import OrganizerHeader from '@/components/organizer/OrganizerHeader'
import OrganizerFormModal from '@/components/organizer/OrganizerFormModal'
import { deleteOrganizer, toggleArchive, updateOrganizer } from '@/components/organizer/overview/organizerActions'

const TABS = [
  { value: 'calendar', label: 'Calendar', icon: CalendarDays },
  { value: 'todo',     label: 'To-do',    icon: ListTodo },
  { value: 'notes',    label: 'Notes',    icon: StickyNote },
]
const TAB_KEYS = TABS.map((t) => t.value)

function OrganizerDetail() {
  const { id } = useParams()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = usePermission()
  const canManage = can('organizer.manage')

  const [organizer, setOrganizer] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | notfound | error
  const [error, setError] = useState(null)
  const [formOpen, setFormOpen] = useState(false)

  // ── Tab (mirrored in ?tab=, default calendar) ──
  const tabParam = searchParams.get('tab')
  const urlTab = TAB_KEYS.includes(tabParam) ? tabParam : 'calendar'
  const [tab, setTab] = useState(urlTab)
  useEffect(() => { setTab(urlTab) }, [urlTab])

  function changeTab(value) {
    setTab(value)
    // Edit the live query so the to-do / notes filter keys (t_*, n_*) survive.
    const params = new URLSearchParams(window.location.search)
    if (value === 'calendar') params.delete('tab')
    else params.set('tab', value)
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }

  // ── Load ──
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/organizer/organizers/${id}`)
      const json = await res.json().catch(() => null)
      if (res.status === 404 || res.status === 400) {
        setState('notfound')
        return
      }
      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`)
      setOrganizer(json?.data ?? null)
      setState(json?.data ? 'ready' : 'notfound')
    } catch (err) {
      setError(err.message)
      setState('error')
    }
  }, [id])

  useEffect(() => {
    setState('loading')
    load()
  }, [load])

  const merge = (data) => data && setOrganizer((prev) => (prev ? { ...prev, ...data } : data))

  // ── Actions ──
  async function handleTogglePin() {
    const prev = organizer
    merge({ pinned: !prev.pinned }) // optimistic
    try {
      merge(await updateOrganizer(prev.id, { pinned: !prev.pinned }))
    } catch (err) {
      merge({ pinned: prev.pinned })
      toast.error(err.message)
    }
  }

  async function handleToggleArchive() {
    merge(await toggleArchive(organizer))
  }

  async function handleDelete() {
    if (await deleteOrganizer(organizer)) router.push('/admin/organizer')
  }

  if (state === 'loading') return <PageLoader />

  if (state === 'notfound') {
    return (
      <EmptyState
        icon={CalendarX}
        title="Organizer not found"
        action={<Button variant="outline" href="/admin/organizer">All organizers</Button>}
        className="min-h-[400px]"
      />
    )
  }

  if (state === 'error') {
    return (
      <EmptyState
        icon={CircleAlert}
        title="Couldn't load organizer"
        description={error}
        action={
          <Button variant="outline" size="sm" onClick={() => { setState('loading'); load() }}>
            Retry
          </Button>
        }
        className="min-h-[400px]"
      />
    )
  }

  return (
    <div className="space-y-6">
      <OrganizerHeader
        organizer={organizer}
        canManage={canManage}
        onEdit={() => setFormOpen(true)}
        onTogglePin={handleTogglePin}
        onToggleArchive={handleToggleArchive}
        onDelete={handleDelete}
      />

      <Tabs variant="underline" value={tab} onChange={changeTab} tabs={TABS} />

      <Suspense fallback={<LoadingSpinner className="py-20" />}>
        {tab === 'calendar' && (
          <OrganizerCalendar organizerId={id} canManage={canManage} storageKey={`org-cal-${id}`} />
        )}
        {tab === 'todo' && <OrganizerTodos organizerId={id} canManage={canManage} />}
        {tab === 'notes' && <OrganizerNotes organizerId={id} canManage={canManage} />}
      </Suspense>

      <OrganizerFormModal open={formOpen} onOpenChange={setFormOpen} organizer={organizer} onSaved={merge} />
    </div>
  )
}

export default function OrganizerDetailPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <OrganizerDetail />
    </Suspense>
  )
}
