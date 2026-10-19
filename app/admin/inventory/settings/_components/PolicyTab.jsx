'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Loader2, Save, Info, CalendarDays, Lock, ExternalLink } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { usePermission } from '@/components/auth/Can'
import { DEPRECIATION_CONVENTION_LABELS } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'
import { fetchJson, errorText, fmtDay, fmtTk } from '../../reports/_components/format'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const CONVENTION_HELP = {
  PRORATA_DAYS: 'An asset put to use on 10 March is charged 22/31 of a month for March. The month of disposal is charged up to the disposal date. Most precise; recommended.',
  FULL_MONTH: 'The whole first month is charged regardless of the day the asset is put to use. Simpler, slightly front-loaded.',
}

export default function PolicyTab() {
  const { can } = usePermission()
  const [settings, setSettings] = useState(null)
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await fetchJson('/api/finance/settings')
      const s = json.data?.settings ?? json.data
      setSettings(s)
      const inv = s?.inventory ?? {}
      setForm({
        capitalizationThreshold: String(inv.capitalizationThreshold ?? 10000),
        depreciationConvention: inv.depreciationConvention ?? 'PRORATA_DAYS',
        tagPrefix: inv.tagPrefix ?? 'EN',
        postDepreciationToLedger: inv.postDepreciationToLedger !== false,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  if (loading && !form) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  if (error && !form) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl">
        <EmptyState title="Couldn't load the inventory policy" description={error}
          action={<button onClick={load} className="bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium">Try again</button>} />
      </div>
    )
  }

  const inv = settings?.inventory ?? {}
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const threshold = Number(form.capitalizationThreshold)
  const prefixOk = /^[A-Z0-9]{1,6}$/.test(form.tagPrefix)
  const dirty = threshold !== Number(inv.capitalizationThreshold ?? 10000)
    || form.depreciationConvention !== (inv.depreciationConvention ?? 'PRORATA_DAYS')
    || form.tagPrefix !== (inv.tagPrefix ?? 'EN')
    || form.postDepreciationToLedger !== (inv.postDepreciationToLedger !== false)

  async function save() {
    if (!Number.isFinite(threshold) || threshold < 0) { toast.error('Enter a threshold of 0 or more'); return }
    if (!prefixOk) { toast.error('Tag prefix: 1–6 letters or digits'); return }
    if (form.tagPrefix !== (inv.tagPrefix ?? 'EN') && !window.confirm(`New tags will start with ${form.tagPrefix}-. Existing tags never change. Continue?`)) return
    setSaving(true)
    try {
      const json = await fetchJson('/api/finance/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventory: {
            capitalizationThreshold: threshold,
            depreciationConvention: form.depreciationConvention,
            tagPrefix: form.tagPrefix,
            postDepreciationToLedger: form.postDepreciationToLedger,
          },
        }),
      })
      const s = json.data?.settings ?? json.data
      if (s?.inventory) setSettings(s)
      else await load()
      toast.success('Inventory policy saved')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 bg-white border border-gray-100 rounded-xl p-5 space-y-6">
        <div>
          <label className={labelCls}>Capitalisation threshold (Tk per unit)</label>
          <input type="number" min="0" step="500" className={cn(inputCls, 'max-w-[220px]')} value={form.capitalizationThreshold}
            onChange={e => set('capitalizationThreshold', e.target.value)} />
          <p className="mt-1 text-xs text-gray-500">
            Items costing at least {Number.isFinite(threshold) ? fmtTk(threshold) : '—'} (including non-creditable VAT) are carried as assets and depreciated;
            cheaper items are expensed but still tagged and tracked. Keep it low — the Third Schedule treats anything lasting over a year as an asset, and capital spending that was expensed may be disallowed.
          </p>
        </div>

        <div>
          <p className={labelCls}>Depreciation in the first and last month</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(DEPRECIATION_CONVENTION_LABELS).map(([v, l]) => (
              <label key={v} className={cn('flex gap-3 rounded-xl border p-3 cursor-pointer', form.depreciationConvention === v ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50')}>
                <input type="radio" name="convention" className="mt-0.5" checked={form.depreciationConvention === v} onChange={() => set('depreciationConvention', v)} />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{l}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{CONVENTION_HELP[v]}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">Applies to runs posted from now on; months already posted are not recalculated.</p>
        </div>

        <div>
          <label className={labelCls}>Asset tag prefix</label>
          <input className={cn(inputCls, 'max-w-[160px] font-mono uppercase', !prefixOk && 'border-red-300')} value={form.tagPrefix} maxLength={6}
            onChange={e => set('tagPrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          <p className="mt-1 text-xs text-gray-500">
            Tags look like <span className="font-mono text-gray-700">{prefixOk ? form.tagPrefix : 'EN'}-LAP-00042</span>. Issued tags never change or get reused.
          </p>
        </div>

        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.postDepreciationToLedger}
            onChange={e => set('postDepreciationToLedger', e.target.checked)} />
          <span>
            <span className="block text-sm font-medium text-gray-900">Post depreciation to the ledger</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Each monthly run adds one non-cash &quot;Depreciation&quot; expense dated the last day of the month, so the P&amp;L shows it. Turn off only if your accountant books depreciation separately.
            </span>
          </span>
        </label>

        <div className="flex justify-end border-t border-gray-100 pt-4">
          <button onClick={save} disabled={saving || !dirty || !prefixOk}
            className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save policy
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-gray-400" /> Books</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Fiscal year starts</dt>
              <dd className="text-gray-900">{MONTHS[(settings?.fiscalYearStartMonth ?? 7) - 1]}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Go-live date</dt>
              <dd className="text-gray-900">{settings?.goLiveDate ? fmtDay(settings.goLiveDate) : 'Not set'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500 flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Books locked to</dt>
              <dd className="text-gray-900">{settings?.lockedUntil ? fmtDay(settings.lockedUntil) : 'Open'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Opening balances</dt>
              <dd className="text-gray-900">{settings?.openingLocked ? 'Locked' : 'Open'}</dd>
            </div>
          </dl>
          {can('finance.opening.manage') && (
            <Link href="/admin/finance/opening-balances" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900">
              Opening balances &amp; locks <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
        <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl p-4">
          <Info className="w-4 h-4 shrink-0 text-gray-400" />
          <span>Depreciation can only be posted for months after the books lock. The opening register is entered as at the day before go-live.</span>
        </div>
      </div>
    </div>
  )
}
