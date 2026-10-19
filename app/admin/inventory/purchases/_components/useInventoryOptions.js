'use client'

import { useCallback, useEffect, useState } from 'react'

// Module-level cache shared by the purchase and consumables pages (60s).
const TTL_MS = 60 * 1000
let _data = null
let _at = 0
let _promise = null

function fresh() {
  return _data !== null && Date.now() - _at < TTL_MS
}

function load(force = false) {
  if (!force && fresh()) return Promise.resolve(_data)
  if (_promise) return _promise
  _promise = fetch('/api/inventory/purchases/options', { cache: 'no-store' })
    .then(async (res) => {
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not load inventory settings')
      _data = json.data ?? { categories: [], locations: [], stockItems: [], settings: {} }
      _at = Date.now()
      return _data
    })
    .finally(() => { _promise = null })
  return _promise
}

/** Force the next useInventoryOptions() to refetch (after creating stock items etc.). */
export function invalidateInventoryOptions() {
  _at = 0
}

/**
 * Categories, locations, stock items and inventory/VAT settings from
 * /api/inventory/purchases/options.
 * @returns {{ options: object|null, loading: boolean, error: string|null, reload: () => Promise<void> }}
 */
export function useInventoryOptions() {
  const [state, setState] = useState(() => ({ options: fresh() ? _data : null, loading: !fresh(), error: null }))

  const run = useCallback(async (force) => {
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const data = await load(force)
      setState({ options: data, loading: false, error: null })
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: err.message }))
    }
  }, [])

  useEffect(() => {
    if (!fresh()) run(false)
  }, [run])

  const reload = useCallback(() => run(true), [run])
  return { ...state, reload }
}
