// Pure helpers for the organizer calendar: visible ranges, event normalisation,
// lane layout for all-day / multi-day bars, overlap columns for timed events,
// and display formatting. No React in here.

import {
  addDays, addMonths, addWeeks, differenceInCalendarDays, format,
  isSameDay, isSameMonth, isSameYear, startOfDay, startOfMonth, startOfWeek,
} from 'date-fns'
import { WEEK_STARTS_ON, fromYMD } from '../constants'

export const VIEWS = ['month', 'week', 'day', 'agenda']
export const AGENDA_DAYS = 30
const DAY_MS = 86400000

// ─── Ranges ──────────────────────────────────────────────────────────────────

/** Visible days for a view. `end` is exclusive (local midnight after the last day). */
export function getRange(view, cursor) {
  const c = startOfDay(cursor)
  let start
  let count
  if (view === 'month') {
    start = startOfWeek(startOfMonth(c), { weekStartsOn: WEEK_STARTS_ON })
    count = 42
  } else if (view === 'week') {
    start = startOfWeek(c, { weekStartsOn: WEEK_STARTS_ON })
    count = 7
  } else if (view === 'day') {
    start = c
    count = 1
  } else {
    start = c
    count = AGENDA_DAYS
  }
  const days = Array.from({ length: count }, (_, i) => addDays(start, i))
  return { start, end: addDays(start, count), days }
}

export function shiftCursor(view, cursor, dir) {
  if (view === 'month') return addMonths(cursor, dir)
  if (view === 'week') return addWeeks(cursor, dir)
  if (view === 'day') return addDays(cursor, dir)
  return addDays(cursor, dir * AGENDA_DAYS)
}

/** "7 – 13 Nov 2026", "28 Nov – 4 Dec 2026", "28 Dec 2026 – 3 Jan 2027". `b` is inclusive. */
export function formatSpan(a, b) {
  if (isSameDay(a, b)) return format(a, 'd MMM yyyy')
  if (isSameMonth(a, b)) return `${format(a, 'd')} – ${format(b, 'd MMM yyyy')}`
  if (isSameYear(a, b)) return `${format(a, 'd MMM')} – ${format(b, 'd MMM yyyy')}`
  return `${format(a, 'd MMM yyyy')} – ${format(b, 'd MMM yyyy')}`
}

export function rangeTitle(view, cursor, range) {
  if (view === 'month') return { title: format(cursor, 'MMMM yyyy'), short: format(cursor, 'MMM yyyy') }
  if (view === 'day') return { title: format(cursor, 'EEEE, d MMMM yyyy'), short: format(cursor, 'EEE, d MMM') }
  const t = formatSpan(range.start, addDays(range.end, -1))
  return { title: t, short: t }
}

// ─── Time formatting ─────────────────────────────────────────────────────────

/** "10 AM", "10:30 AM" */
export function fmtTime(d) {
  return format(d, d.getMinutes() ? 'h:mm a' : 'h a')
}

/** "10am", "10:30am" */
export function fmtTimeCompact(d) {
  return format(d, d.getMinutes() ? 'h:mma' : 'ha').toLowerCase()
}

/** "10 – 11:30 AM", "11 AM – 1 PM" */
export function fmtTimeRange(s, e) {
  if (!e || +e === +s) return fmtTime(s)
  const sameMeridiem = isSameDay(s, e) && format(s, 'a') === format(e, 'a')
  const left = sameMeridiem ? format(s, s.getMinutes() ? 'h:mm' : 'h') : fmtTime(s)
  return `${left} – ${fmtTime(e)}`
}

function dayFmt(d, long = true) {
  const sameYear = isSameYear(d, new Date())
  if (long) return format(d, sameYear ? 'EEEE, d MMMM' : 'EEEE, d MMMM yyyy')
  return format(d, sameYear ? 'd MMM' : 'd MMM yyyy')
}

/** Human "when" line for a normalised event occurrence. */
export function describeWhen(ev) {
  if (ev.allDay) {
    if (isSameDay(ev._sDay, ev._eDay)) return dayFmt(ev._sDay)
    return formatSpan(ev._sDay, ev._eDay)
  }
  if (isSameDay(ev._sDay, ev._eDay)) return `${dayFmt(ev._start)} · ${fmtTimeRange(ev._start, ev._end)}`
  return `${dayFmt(ev._start, false)}, ${fmtTime(ev._start)} – ${dayFmt(ev._end, false)}, ${fmtTime(ev._end)}`
}

const REPEAT_UNIT = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }
const REPEAT_WORD = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' }

export function repeatUnit(repeat, n = 1) {
  const u = REPEAT_UNIT[repeat]
  if (!u) return ''
  return n === 1 ? u : `${u}s`
}

/** "Weekly on Friday · until 31 Dec 2026", "Every 2 months on day 6" */
export function describeRepeat(ev) {
  const r = ev.repeat
  if (!r || r === 'NONE' || !REPEAT_UNIT[r]) return null
  const n = Number(ev.repeatInterval) || 1
  const seriesStartIso = ev.seriesStart || ev.start
  const first = ev.allDay ? fromYMD(seriesStartIso) : new Date(seriesStartIso)
  let s = n === 1 ? REPEAT_WORD[r] : `Every ${n} ${repeatUnit(r, n)}`
  if (first && !Number.isNaN(+first)) {
    if (r === 'WEEKLY') s += ` on ${format(first, 'EEEE')}`
    else if (r === 'MONTHLY') s += ` on day ${format(first, 'd')}`
    else if (r === 'YEARLY') s += ` on ${format(first, 'd MMMM')}`
  }
  if (ev.repeatUntil) s += ` · until ${format(fromYMD(ev.repeatUntil), 'd MMM yyyy')}`
  return s
}

// ─── Normalisation ───────────────────────────────────────────────────────────
// Every item gets: kind, _start/_end (Date, end exclusive), _sDay/_eDay (local
// midnight of the first/last day it touches, inclusive) and _allDayLane (true
// when it belongs in the all-day row / month bars rather than the time grid).

export function normalizeEvent(ev) {
  if (ev.allDay) {
    const s = fromYMD(ev.start)
    let e = fromYMD(ev.end) || s
    if (e < s) e = s
    return { ...ev, kind: 'event', _start: s, _end: addDays(e, 1), _sDay: s, _eDay: e, _allDayLane: true }
  }
  const s = new Date(ev.start)
  let e = new Date(ev.end || ev.start)
  if (!(e >= s)) e = s
  const sDay = startOfDay(s)
  let eDay = startOfDay(e)
  if (+e === +eDay && e > s) eDay = addDays(eDay, -1) // ends exactly at midnight
  if (eDay < sDay) eDay = sDay
  const long = differenceInCalendarDays(eDay, sDay) >= 1 && e - s >= DAY_MS
  return { ...ev, kind: 'event', _start: s, _end: e, _sDay: sDay, _eDay: eDay, _allDayLane: long }
}

export function normalizeTodo(t) {
  const d = fromYMD(t.dueDate)
  return { ...t, kind: 'todo', key: `todo:${t.id}`, _start: d, _end: addDays(d, 1), _sDay: d, _eDay: d, _allDayLane: true }
}

/** Last day an item occupies in a day-row (month cell / all-day row). Short timed events sit on their start day. */
function rowEndDay(it) {
  return it._allDayLane ? it._eDay : it._sDay
}

// ─── Day-row lanes (month weeks + week all-day row) ─────────────────────────

function rowRank(it, span) {
  if (it.kind === 'todo') return 2
  if (it._allDayLane) return span > 1 ? 0 : 1
  return 3
}

/**
 * Place items into lanes across a row of `nDays` consecutive days starting at `rowStart`.
 * Returns segments `{ item, start, end (inclusive col), lane, contStart, contEnd }`.
 */
export function layoutRow(items, rowStart, nDays) {
  const segs = []
  for (const it of items) {
    if (!it._sDay) continue
    const s = differenceInCalendarDays(it._sDay, rowStart)
    const e = differenceInCalendarDays(rowEndDay(it), rowStart)
    if (e < 0 || s >= nDays) continue
    segs.push({
      item: it,
      start: Math.max(0, s),
      end: Math.min(nDays - 1, e),
      contStart: s < 0,
      contEnd: e >= nDays,
      fullSpan: e - s + 1,
    })
  }
  segs.sort((a, b) =>
    a.start - b.start ||
    rowRank(a.item, a.fullSpan) - rowRank(b.item, b.fullSpan) ||
    b.fullSpan - a.fullSpan ||
    a.item._start - b.item._start ||
    String(a.item.title ?? '').localeCompare(String(b.item.title ?? ''))
  )
  const occupied = []
  for (const seg of segs) {
    let lane = 0
    for (;;) {
      const row = occupied[lane] || (occupied[lane] = new Array(nDays).fill(false))
      let free = true
      for (let d = seg.start; d <= seg.end; d++) if (row[d]) { free = false; break }
      if (free) {
        for (let d = seg.start; d <= seg.end; d++) row[d] = true
        seg.lane = lane
        break
      }
      lane++
    }
  }
  return segs
}

/**
 * Apply a visible-lane limit to a laid-out row. Days that overflow give up their
 * last lane to a "+N more" link, so bars crossing such a day are split into pieces.
 * Returns { pieces, more: [{ day, count, lane }], dayItems: item[][], lanes }.
 */
export function limitRow(segs, nDays, maxLanes = Infinity) {
  const perDay = Array.from({ length: nDays }, () => [])
  for (const s of segs) for (let d = s.start; d <= s.end; d++) perDay[d].push(s)
  const limit = perDay.map((list) => (list.some((s) => s.lane >= maxLanes) ? Math.max(0, maxLanes - 1) : maxLanes))

  const pieces = []
  for (const s of segs) {
    let runStart = -1
    for (let d = s.start; d <= s.end + 1; d++) {
      const visible = d <= s.end && s.lane < limit[d]
      if (visible && runStart < 0) runStart = d
      if (!visible && runStart >= 0) {
        pieces.push({
          ...s,
          start: runStart,
          end: d - 1,
          contStart: s.contStart || runStart > s.start,
          contEnd: s.contEnd || d - 1 < s.end,
          first: runStart === s.start && !s.contStart,
        })
        runStart = -1
      }
    }
  }

  const more = []
  perDay.forEach((list, d) => {
    const hidden = list.filter((s) => s.lane >= limit[d]).length
    if (hidden) more.push({ day: d, count: hidden, lane: limit[d] })
  })

  const dayItems = perDay.map((list) => list.slice().sort((a, b) => a.lane - b.lane).map((s) => s.item))
  const usedLanes = segs.reduce((m, s) => Math.max(m, s.lane + 1), 0)
  return { pieces, more, dayItems, lanes: Math.min(usedLanes, maxLanes), overflow: more.length > 0 }
}

// ─── Time-grid columns (week / day) ─────────────────────────────────────────

function minutesOf(d) {
  return d.getHours() * 60 + d.getMinutes()
}

/** Timed items (not in the all-day lane) that touch `day`. */
export function timedItemsForDay(items, day) {
  const dayStart = startOfDay(day)
  const dayEnd = addDays(dayStart, 1)
  return items.filter((it) => {
    if (it.kind !== 'event' || it._allDayLane) return false
    const zero = +it._start === +it._end
    return it._start < dayEnd && (it._end > dayStart || (zero && it._start >= dayStart))
  })
}

/**
 * Lay out timed events for one day column. Overlapping events share the width
 * side by side; an event widens into free columns to its right.
 * Returns segments `{ item, top, bottom (minutes, visual), col, cols, span, contStart, contEnd }`.
 */
export function layoutDayColumn(items, day, minMinutes = 20) {
  const dayStart = startOfDay(day)
  const dayEnd = addDays(dayStart, 1)
  const segs = timedItemsForDay(items, day).map((it) => {
    const top = it._start <= dayStart ? 0 : minutesOf(it._start)
    const bottom = it._end >= dayEnd ? 1440 : Math.max(top, minutesOf(it._end))
    const vTop = Math.min(top, 1440 - minMinutes)
    const vBottom = Math.max(bottom, vTop + minMinutes)
    return { item: it, top: vTop, bottom: vBottom, realTop: top, realBottom: bottom, contStart: it._start < dayStart, contEnd: it._end > dayEnd }
  })
  segs.sort((a, b) => a.top - b.top || (b.bottom - b.top) - (a.bottom - a.top) || a.item._start - b.item._start)

  let cluster = []
  let clusterEnd = -1
  const flush = () => {
    const cols = []
    for (const seg of cluster) {
      let c = cols.findIndex((col) => col[col.length - 1].bottom <= seg.top)
      if (c < 0) { c = cols.length; cols.push([]) }
      cols[c].push(seg)
      seg.col = c
    }
    for (const seg of cluster) {
      seg.cols = cols.length
      let span = 1
      while (
        seg.col + span < cols.length &&
        !cols[seg.col + span].some((o) => o.top < seg.bottom && o.bottom > seg.top)
      ) span++
      seg.span = span
    }
    cluster = []
  }
  for (const seg of segs) {
    if (cluster.length && seg.top >= clusterEnd) { flush(); clusterEnd = -1 }
    cluster.push(seg)
    clusterEnd = Math.max(clusterEnd, seg.bottom)
  }
  if (cluster.length) flush()
  return segs
}

// ─── Agenda ──────────────────────────────────────────────────────────────────

function agendaRank(it) {
  if (it.kind === 'todo') return 1
  return it._allDayLane ? 0 : 2
}

/** Items touching `day`, all-day first, then to-dos, then timed by start. */
export function itemsForDay(items, day) {
  const d = startOfDay(day)
  const dayEnd = addDays(d, 1)
  const list = items.filter((it) => {
    if (it.kind === 'todo') return isSameDay(it._sDay, d)
    if (it._allDayLane) return it._sDay <= d && it._eDay >= d
    const zero = +it._start === +it._end
    return it._start < dayEnd && (it._end > d || (zero && it._start >= d))
  })
  return list.sort((a, b) =>
    agendaRank(a) - agendaRank(b) ||
    a._start - b._start ||
    String(a.title ?? '').localeCompare(String(b.title ?? ''))
  )
}

/** Time label for an agenda row on a given day. */
export function agendaTime(it, day) {
  if (it.kind === 'todo') return 'Due'
  if (it.allDay) return 'All day'
  const d = startOfDay(day)
  const startsToday = isSameDay(it._start, d)
  const endsToday = isSameDay(it._end, d) || +it._end === +addDays(d, 1)
  if (startsToday && endsToday) return fmtTimeRange(it._start, it._end)
  if (startsToday) return `From ${fmtTime(it._start)}`
  if (endsToday) return `Until ${fmtTime(it._end)}`
  return 'All day'
}

/** "Day 2 of 3" for items spanning several days, else null. */
export function dayOfSpan(it, day) {
  if (!it._allDayLane || it.kind !== 'event') return null
  const total = differenceInCalendarDays(it._eDay, it._sDay) + 1
  if (total < 2) return null
  return `Day ${differenceInCalendarDays(startOfDay(day), it._sDay) + 1} of ${total}`
}
