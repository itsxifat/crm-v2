'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RATED, blank, treatmentDefaultRate, clearDisallowedLineRates } from './quotationUi'

/**
 * VAT state for the quotation forms (new + edit).
 *
 *   clientId  the selected client (null for lead-sourced quotations) — its VAT
 *             profile drives hints and, for new quotations, the default treatment
 *   enabled   load the defaults only while the form is shown
 *   setItems  the form's items setter — whenever the treatment changes, per-line
 *             VAT rates the new treatment cannot carry are cleared (STANDARD ⇒
 *             15% only, REDUCED ⇒ 0–15% exclusive, others ⇒ 0; see ratesFor)
 *
 * New quotations start with `vatTreatment = null` ("company default") and take
 * the company / client defaults from /api/quotations/vat-defaults until the
 * user picks something. `reset(initial)` loads a stored quotation's setup for
 * editing; defaults then never overwrite it.
 */
export function useQuotationVat({ clientId = null, enabled = true, setItems = null } = {}) {
  const touched = useRef(false)
  const [vatTreatment,   setVatTreatment]   = useState(null)
  const [defaultVatRate, setDefaultVatRate] = useState(15)
  const [serviceCode,    setServiceCode]    = useState('')
  const [perLineVat,     setPerLineVat]     = useState(false)
  const [vatInfo,        setVatInfo]        = useState(null)
  const [vatInfoState,   setVatInfoState]   = useState('idle') // idle | loading | ready | failed

  /** Per-line rates `t` cannot carry fall back to the default rate. */
  const dropDisallowedLineRates = useCallback((t) => {
    if (setItems) setItems(prev => clearDisallowedLineRates(prev, t))
  }, [setItems])

  useEffect(() => {
    if (!enabled) return
    let stale = false
    setVatInfoState('loading')
    fetch(`/api/quotations/vat-defaults${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Failed')
        return j.data
      })
      .then(d => {
        if (stale) return
        setVatInfo(d ?? null)
        setVatInfoState('ready')
        if (!touched.current && d) {
          setVatTreatment(d.vatTreatment ?? 'NONE')
          dropDisallowedLineRates(d.vatTreatment ?? 'NONE')
          if (RATED.includes(d.vatTreatment)) setDefaultVatRate(Number(d.vatRate) || treatmentDefaultRate(d.vatTreatment))
          if (d.serviceCode) setServiceCode(prev => prev || d.serviceCode)
        }
      })
      .catch(() => { if (!stale) setVatInfoState('failed') })
    return () => { stale = true }
  }, [clientId, enabled, dropDisallowedLineRates])

  const effectiveTreatment = vatTreatment ?? 'NONE'
  const isVat   = effectiveTreatment !== 'NONE'
  const ratesOn = RATED.includes(effectiveTreatment)
  const registrationType = vatInfo?.registrationType ?? null
  const notRegistered    = !!registrationType && registrationType !== 'REGISTERED'

  /** Load a stored setup (edit) — or clear back to "company default" with null. */
  const reset = useCallback((initial) => {
    touched.current = !!initial
    setVatTreatment(initial?.vatTreatment ?? null)
    setDefaultVatRate(initial?.defaultVatRate ?? 15)
    setServiceCode(initial?.serviceCode ?? '')
    setPerLineVat(!!initial?.perLineVat)
  }, [])

  function changeTreatment(v) {
    const t = blank(v) ? 'NONE' : v
    touched.current = true
    setVatTreatment(t)
    dropDisallowedLineRates(t)
    if (RATED.includes(t)) {
      const companyRate = vatInfo?.vatTreatment === t && Number(vatInfo?.vatRate) > 0 ? Number(vatInfo.vatRate) : null
      setDefaultVatRate(companyRate ?? treatmentDefaultRate(t))
    } else {
      setPerLineVat(false)
    }
  }

  function changeRate(v) {
    touched.current = true
    setDefaultVatRate(blank(v) ? 0 : Number(v))
  }

  /** A service code implies its rate (e.g. S099.10 ITES → reduced 5%). */
  function changeServiceCode(code, obj) {
    setServiceCode(code ?? '')
    if (!obj || !RATED.includes(effectiveTreatment)) return
    const rate = blank(obj.vatRate) ? NaN : Number(obj.vatRate)
    const codeTreatment = RATED.includes(obj.treatment)
      ? obj.treatment
      : (rate === 15 ? 'STANDARD' : rate > 0 ? 'REDUCED' : null)
    if (!codeTreatment) return
    touched.current = true
    if (codeTreatment !== effectiveTreatment) {
      setVatTreatment(codeTreatment)
      dropDisallowedLineRates(codeTreatment)
    }
    if (Number.isFinite(rate)) setDefaultVatRate(rate)
  }

  /** Turning per-line VAT on seeds every line without a rate with the default. */
  function togglePerLineVat(on, setItems) {
    setPerLineVat(on)
    if (on && setItems) setItems(prev => prev.map(i => (blank(i.vatRate) ? { ...i, vatRate: defaultVatRate } : i)))
  }

  /** VAT fields for the request body; null treatment = let the server apply the default. */
  function bodyFields() {
    if (!vatTreatment) return {}
    return {
      vatTreatment,
      vatRate:     ratesOn ? Number(defaultVatRate) || 0 : 0,
      serviceCode: vatTreatment === 'NONE' ? null : (serviceCode || null),
    }
  }

  return {
    vatTreatment, effectiveTreatment, isVat, ratesOn,
    defaultVatRate, serviceCode, perLineVat,
    vatInfo, vatInfoState, registrationType, notRegistered,
    clientInfo: vatInfo?.client ?? null,
    reset, changeTreatment, changeRate, changeServiceCode, togglePerLineVat, bodyFields,
  }
}
