'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { addDays, addMinutes, differenceInCalendarDays } from 'date-fns'
import { cn } from '@/lib/utils'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { Field, Input, Label, Textarea, inputClass } from '@/components/ui/Input'
import ColorDots from '../ColorDots'
import { REPEAT_OPTIONS, fromYMD, toYMD } from '../constants'
import { orgFetch } from '../api'
import { repeatUnit } from './layout'
import { Switch } from './parts'

const NO_PROJECT = '__none'
const pad = (n) => String(n).padStart(2, '0')
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const calOrgId = (c) => c?.organizerId ?? c?.organizer?.id ?? null

/** Local Date from 'YYYY-MM-DD' + 'HH:mm' (= new Date(y, m, d, h, min)). */
function combine(ymd, time) {
  const d = fromYMD(ymd)
  if (!d || Number.isNaN(+d)) return null
  const [h, m] = String(time || '00:00').split(':').map(Number)
  d.setHours(h || 0, m || 0, 0, 0)
  return d
}

function initialState({ event, defaults, defaultCalendarId }) {
  if (event) {
    // Editing edits the series, so prefill from the master event, not this occurrence.
    const sIso = event.seriesStart || event.start
    const eIso = event.seriesEnd || event.end || sIso
    let startDate, endDate
    let startTime = '09:00'
    let endTime = '10:00'
    if (event.allDay) {
      startDate = String(sIso).slice(0, 10)
      endDate = String(eIso).slice(0, 10)
    } else {
      const s = new Date(sIso)
      const e = new Date(eIso)
      startDate = toYMD(s)
      endDate = toYMD(e)
      startTime = hm(s)
      endTime = hm(e)
    }
    return {
      title: event.title ?? '',
      calendarId: event.calendar?.id ?? event.calendarId ?? null,
      allDay: !!event.allDay,
      startDate, startTime, endDate, endTime,
      repeat: event.repeat || 'NONE',
      repeatInterval: String(event.repeatInterval || 1),
      repeatUntil: event.repeatUntil ? String(event.repeatUntil).slice(0, 10) : null,
      projectId: event.project?.id ?? null,
      location: event.location ?? '',
      description: event.description ?? '',
      color: event.colorOverride ?? null,
    }
  }

  const date = defaults?.date ? new Date(defaults.date) : new Date()
  const start = new Date(date)
  if (defaults?.minutes != null) {
    start.setHours(0, defaults.minutes, 0, 0)
  } else if (toYMD(date) === toYMD(new Date())) {
    start.setHours(Math.min(new Date().getHours() + 1, 23), 0, 0, 0)
  } else {
    start.setHours(9, 0, 0, 0)
  }
  const end = addMinutes(start, 60)
  return {
    title: '',
    calendarId: defaultCalendarId ?? null,
    allDay: !!defaults?.allDay,
    startDate: toYMD(start),
    startTime: hm(start),
    endDate: defaults?.allDay ? toYMD(start) : toYMD(end),
    endTime: hm(end),
    repeat: 'NONE',
    repeatInterval: '1',
    repeatUntil: null,
    projectId: null,
    location: '',
    description: '',
    color: null,
  }
}

/**
 * Create / edit an event. Editing a recurring occurrence edits the whole series.
 *   event       occurrence to edit (omit to create)
 *   defaults    { date: Date, allDay?: boolean, minutes?: number } for new events
 *   calendars   every calendar the user may pick
 *   master      label calendars "Organizer · Calendar"
 *   onSaved(event, { created })
 */
export default function EventFormModal({ open, onOpenChange, event = null, defaults = null, calendars = [], defaultCalendarId, master = false, onSaved }) {
  const editing = !!event
  const [form, setForm] = useState(() => initialState({ event, defaults, defaultCalendarId }))
  const initialRef = useRef(form)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [projects, setProjects] = useState([])
  const projectCache = useRef(new Map())
  const wasOpen = useRef(false)

  // Reset whenever the modal opens.
  useEffect(() => {
    if (open && !wasOpen.current) {
      const s = initialState({ event, defaults, defaultCalendarId })
      setForm(s)
      initialRef.current = s
      setErrors({})
    }
    wasOpen.current = open
  }, [open, event, defaults, defaultCalendarId])

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const calendar = calendars.find((c) => c.id === form.calendarId) ?? null
  const organizerId = calOrgId(calendar)

  // Projects come from the selected calendar's organizer.
  useEffect(() => {
    if (!open || !organizerId) { setProjects([]); return }
    // Show the cached list at once, but always refresh: the organizer's projects
    // may have been edited while this calendar stayed mounted.
    const cached = projectCache.current.get(organizerId)
    if (cached) setProjects(cached)
    let alive = true
    orgFetch(`/api/organizer/organizers/${organizerId}`)
      .then((json) => {
        const list = Array.isArray(json?.data?.projects) ? json.data.projects : []
        projectCache.current.set(organizerId, list)
        if (alive) setProjects(list)
      })
      .catch(() => { if (alive) setProjects([]) })
    return () => { alive = false }
  }, [open, organizerId])

  const calendarOptions = useMemo(
    () => calendars.map((c) => ({
      value: c.id,
      label: master && c.organizer?.name ? `${c.organizer.name} · ${c.name}` : c.name,
    })),
    [calendars, master],
  )

  const projectOptions = useMemo(() => {
    const opts = projects.map((p) => ({ value: p.id, label: p.name }))
    if (form.projectId && !opts.some((o) => o.value === form.projectId) && event?.project?.id === form.projectId) {
      opts.unshift({ value: event.project.id, label: event.project.name })
    }
    return [{ value: NO_PROJECT, label: 'No project' }, ...opts]
  }, [projects, form.projectId, event])
  const showProject = projectOptions.length > 1

  function changeCalendar(id) {
    if (!id) return
    const next = calendars.find((c) => c.id === id)
    setForm((f) => ({
      ...f,
      calendarId: id,
      // A project belongs to one organizer — drop it when the organizer changes.
      projectId: calOrgId(next) === organizerId ? f.projectId : null,
    }))
    setErrors((e) => ({ ...e, calendarId: undefined }))
  }

  function changeStartDate(v) {
    if (!v) return
    setForm((f) => {
      const diff = differenceInCalendarDays(fromYMD(v), fromYMD(f.startDate))
      const end = f.endDate ? toYMD(addDays(fromYMD(f.endDate), diff)) : v
      return { ...f, startDate: v, endDate: end }
    })
    setErrors((e) => ({ ...e, start: undefined, end: undefined }))
  }

  function changeStartTime(v) {
    setForm((f) => {
      if (!v) return { ...f, startTime: v }
      const oldS = combine(f.startDate, f.startTime)
      const oldE = combine(f.endDate, f.endTime)
      const dur = oldS && oldE && oldE >= oldS ? oldE - oldS : 3600000
      const s = combine(f.startDate, v)
      const e = new Date(s.getTime() + dur)
      return { ...f, startTime: v, endDate: toYMD(e), endTime: hm(e) }
    })
    setErrors((e) => ({ ...e, start: undefined, end: undefined }))
  }

  function changeAllDay(v) {
    setForm((f) => ({ ...f, allDay: v, endDate: v && f.endDate < f.startDate ? f.startDate : f.endDate }))
    setErrors((e) => ({ ...e, start: undefined, end: undefined }))
  }

  function computeTiming(f) {
    if (f.allDay) {
      return { allDay: true, start: f.startDate, end: f.endDate || f.startDate }
    }
    const s = combine(f.startDate, f.startTime)
    const e = combine(f.endDate || f.startDate, f.endTime || f.startTime)
    return { allDay: false, start: s?.toISOString() ?? null, end: e?.toISOString() ?? null, _s: s, _e: e }
  }

  async function submit(e) {
    e?.preventDefault()
    if (saving) return
    const errs = {}
    const title = form.title.trim()
    if (!title) errs.title = 'Title is required'
    if (!form.calendarId) errs.calendarId = 'Choose a calendar'

    const timing = computeTiming(form)
    if (!form.startDate) errs.start = 'Pick a start date'
    else if (form.allDay) {
      if (timing.end < timing.start) errs.end = 'End is before the start'
    } else if (!form.startTime || !timing._s) errs.start = 'Pick a start time'
    else if (!form.endTime || !timing._e || timing._e < timing._s) errs.end = 'End is before the start'

    const interval = parseInt(form.repeatInterval, 10)
    if (form.repeat !== 'NONE') {
      if (!(interval >= 1 && interval <= 365)) errs.repeat = 'Repeat every 1 to 365'
      else if (form.repeatUntil && form.repeatUntil < form.startDate) errs.repeat = 'Repeat end is before the start'
    }
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return

    const fields = (f) => ({
      calendarId: f.calendarId,
      title: f.title.trim(),
      description: f.description.trim() || null,
      location: f.location.trim() || null,
      projectId: f.projectId || null,
      color: f.color || null,
    })
    const repeatFields = (f) => ({
      repeat: f.repeat,
      repeatInterval: f.repeat === 'NONE' ? 1 : parseInt(f.repeatInterval, 10) || 1,
      repeatUntil: f.repeat === 'NONE' ? null : f.repeatUntil || null,
    })
    const timingFields = ({ allDay, start, end }) => ({ allDay, start, end })

    let body
    if (!editing) {
      body = { ...fields(form), ...timingFields(timing), ...repeatFields(form) }
      for (const k of Object.keys(body)) if (body[k] === null) delete body[k]
    } else {
      // Send only what changed: untouched timing keeps the series' skipped occurrences.
      const init = initialRef.current
      body = {}
      const a = fields(form)
      const b = fields(init)
      for (const k of Object.keys(a)) if (a[k] !== b[k]) body[k] = a[k]
      const ta = timingFields(timing)
      const tb = timingFields(computeTiming(init))
      if (ta.allDay !== tb.allDay || ta.start !== tb.start || ta.end !== tb.end) Object.assign(body, ta)
      const ra = repeatFields(form)
      const rb = repeatFields(init)
      if (ra.repeat !== rb.repeat || ra.repeatInterval !== rb.repeatInterval || ra.repeatUntil !== rb.repeatUntil) Object.assign(body, ra)
      if (!Object.keys(body).length) { onOpenChange?.(false); return }
    }

    setSaving(true)
    try {
      const json = editing
        ? await orgFetch(`/api/organizer/events/${event.id}`, { method: 'PATCH', body })
        : await orgFetch('/api/organizer/events', { method: 'POST', body })
      toast.success(editing ? 'Event updated' : 'Event created')
      onSaved?.(json?.data, { created: !editing })
      onOpenChange?.(false)
    } catch (err) {
      toast.error(err.message || 'Could not save event')
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e)
  }

  const title = editing ? (event.isRecurring ? 'Edit recurring event' : 'Edit event') : 'New event'
  const timeClass = cn(inputClass, 'w-[7.5rem] shrink-0 tabular-nums')

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="lg">
      <form onSubmit={submit} onKeyDown={onKeyDown} className="space-y-4">
        <Field label="Title" htmlFor="ev-title" required error={errors.title}>
          <Input
            id="ev-title"
            autoFocus
            value={form.title}
            maxLength={200}
            invalid={!!errors.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Add title"
          />
        </Field>

        <Field label="Calendar" required error={errors.calendarId}>
          <Select value={form.calendarId} onChange={changeCalendar} options={calendarOptions} placeholder="Choose a calendar" />
        </Field>

        <div className="flex items-center gap-2.5">
          <Switch id="ev-allday" checked={form.allDay} onChange={changeAllDay} />
          <label htmlFor="ev-allday" className="cursor-pointer text-sm font-medium text-gray-900">All day</label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" error={errors.start}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <DatePicker value={form.startDate} onChange={changeStartDate} clearable={false} />
              </div>
              {!form.allDay && (
                <input
                  type="time"
                  aria-label="Start time"
                  value={form.startTime}
                  onChange={(e) => changeStartTime(e.target.value)}
                  className={timeClass}
                />
              )}
            </div>
          </Field>
          <Field label="Ends" error={errors.end}>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <DatePicker
                  value={form.endDate}
                  onChange={(v) => { if (v) { set('endDate', v); setErrors((er) => ({ ...er, end: undefined })) } }}
                  clearable={false}
                />
              </div>
              {!form.allDay && (
                <input
                  type="time"
                  aria-label="End time"
                  value={form.endTime}
                  aria-invalid={!!errors.end || undefined}
                  onChange={(e) => { set('endTime', e.target.value); setErrors((er) => ({ ...er, end: undefined })) }}
                  className={timeClass}
                />
              )}
            </div>
          </Field>
        </div>

        <div>
          <Label>Repeat</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={form.repeat}
              onChange={(v) => set('repeat', v || 'NONE')}
              options={REPEAT_OPTIONS}
              className="w-full sm:w-48"
            />
            {form.repeat !== 'NONE' && (
              <>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>Every</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    aria-label="Repeat interval"
                    value={form.repeatInterval}
                    onChange={(e) => set('repeatInterval', e.target.value)}
                    className={cn(inputClass, 'w-16 tabular-nums')}
                  />
                  <span>{repeatUnit(form.repeat, parseInt(form.repeatInterval, 10) || 1)}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>until</span>
                  <div className="w-40">
                    <DatePicker value={form.repeatUntil} onChange={(v) => set('repeatUntil', v)} placeholder="No end date" />
                  </div>
                </div>
              </>
            )}
          </div>
          {errors.repeat && <p className="mt-1.5 text-xs text-red-600">{errors.repeat}</p>}
        </div>

        {showProject && (
          <Field label="Project">
            <Select
              value={form.projectId ?? NO_PROJECT}
              onChange={(v) => set('projectId', v && v !== NO_PROJECT ? v : null)}
              options={projectOptions}
            />
          </Field>
        )}

        <Field label="Location" htmlFor="ev-location">
          <Input
            id="ev-location"
            value={form.location}
            maxLength={300}
            onChange={(e) => set('location', e.target.value)}
            placeholder="Add location"
          />
        </Field>

        <Field label="Description" htmlFor="ev-desc">
          <Textarea
            id="ev-desc"
            rows={3}
            value={form.description}
            maxLength={5000}
            onChange={(e) => set('description', e.target.value)}
          />
        </Field>

        <Field label="Colour">
          <ColorDots value={form.color} onChange={(v) => set('color', v)} allowNone size="sm" />
        </Field>

        <ModalFooter>
          <Button variant="outline" onClick={() => onOpenChange?.(false)}>Cancel</Button>
          <Button type="submit" loading={saving}>{editing ? 'Save' : 'Create event'}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}
