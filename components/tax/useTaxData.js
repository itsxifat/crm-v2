'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson } from './taxUi'

/**
 * GET a tax API URL; only the latest request may update the state.
 * Pass `null` as url to skip loading.
 * @returns {{ data: any, json: object|null, loading: boolean, error: string|null, reload: () => Promise<void> }}
 */
export function useTaxData(url) {
  const [json, setJson] = useState(null)
  const [loading, setLoading] = useState(!!url)
  const [error, setError] = useState(null)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    if (!url) { setLoading(false); return }
    const my = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetchJson(url)
      if (my === seq.current) setJson(res)
    } catch (err) {
      if (my === seq.current) setError(err.message)
    } finally {
      if (my === seq.current) setLoading(false)
    }
  }, [url])

  useEffect(() => { reload() }, [reload])

  return { data: json?.data ?? null, json, loading, error, reload }
}

/**
 * Open a printable document in a new tab and reload the data when the user
 * comes back to this tab (printing may assign certificate numbers).
 */
export function usePrintThenReload(reload) {
  const pending = useRef(false)
  useEffect(() => {
    const onFocus = () => {
      if (!pending.current) return
      pending.current = false
      reload?.()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])
  return useCallback((url) => {
    pending.current = true
    window.open(url, '_blank')
  }, [])
}

/**
 * Issue a certificate we give (Mushak-6.6 / TDS certificate) and open it for
 * printing. Issuing is a POST (the print GET is read-only); the tab is opened
 * before the request so the popup blocker allows it, then pointed at the
 * numbered certificate. Throws the API error (with .details) after closing it.
 * @param {'vds'|'tds'} kind
 * @param {string[]} ids
 * @returns {Promise<{ number: string, date: string, alreadyIssued: boolean }>}
 */
export async function issueCertificateThenPrint(kind, ids) {
  const w = window.open('', '_blank')
  try {
    const res = await fetchJson(`/api/tax/certificates/${kind}/print`, { method: 'POST', body: { ids } })
    const url = `/api/tax/certificates/${kind}/print?ids=${ids.join(',')}`
    if (w && !w.closed) w.location.href = url
    else window.open(url, '_blank')
    return res.data
  } catch (err) {
    if (w && !w.closed) w.close()
    throw err
  }
}
