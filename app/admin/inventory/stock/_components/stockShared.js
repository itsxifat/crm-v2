'use client'

import { useEffect, useState } from 'react'

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function tk(n, decimals = 2) {
  return `৳ ${num(n).toLocaleString('en-BD', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function qtyText(n) {
  return num(n).toLocaleString('en-BD', { maximumFractionDigits: 4 })
}

export const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50'
export const lc = 'block text-xs font-medium text-gray-600 mb-1'

export const ITEM_STATUS_META = {
  OK:       { label: 'In stock',     color: 'green' },
  LOW:      { label: 'Low',          color: 'yellow' },
  OUT:      { label: 'Out of stock', color: 'red' },
  INACTIVE: { label: 'Inactive',     color: 'gray' },
}

let _departments = null
let _deptPromise = null

/** Active departments (GET /api/departments), cached per page load. */
export function useDepartments() {
  const [list, setList] = useState(_departments ?? [])
  useEffect(() => {
    if (_departments) { setList(_departments); return }
    if (!_deptPromise) {
      _deptPromise = fetch('/api/departments')
        .then(r => r.json().then(j => (r.ok ? (j.data ?? []) : [])))
        .catch(() => [])
        .then(rows => { _departments = rows.map(d => ({ id: d.id, name: d.name })); return _departments })
    }
    let alive = true
    _deptPromise.then(rows => { if (alive) setList(rows) })
    return () => { alive = false }
  }, [])
  return list
}
