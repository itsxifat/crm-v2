'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Loader2, Save, ExternalLink } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import Button from '@/components/ui/Button'
import { Card, CardTitle } from '@/components/ui/Card'
import { Input, Label, Field } from '@/components/ui/Input'
import { usePermission } from '@/components/auth/Can'
import { DEPRECIATION_CONVENTION_LABELS } from '@/lib/inventory/constants'
import { cn } from '@/lib/utils'
import { fetchJson, errorText, fmtDay, fmtTk } from '../../reports/_components/format'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const CONVENTION_HELP = {
  PRORATA_DAYS: 'Charged by days in use. Recommended.',
  FULL_MONTH: 'Whole first month charged, whatever the day.',
}

const CONVENTION_TITLE = {
  PRORATA_DAYS: 'An asset put to use on 10 March is charged 22/31 of a month for March. The month of disposal is charged up to the disposal date.',
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

  if (loading && !form) return <div className="flex justify-center py-16"><Loader2 className="size-5 animate-spin text-gray-400" /></div>
  if (error && !form) {
    return (
      <Card>
        <EmptyState title="Couldn't load the inventory policy" description={error}
          action={<Button variant="outline" onClick={load}>Try again</Button>} />
      </Card>
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
    if (form.tagPrefix !== (inv.tagPrefix ?? 'EN') && !window.confirm(`New tags will start with ${form.tagPrefix} (e.g. ${form.tagPrefix}LAP00042). Existing tags never change. Continue?`)) return
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
      toast.success('Policy saved')
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="space-y-6 p-6 lg:col-span-2">
        <Field label="Capitalisation threshold (Tk per unit)"
          hint={`Items from ${Number.isFinite(threshold) ? fmtTk(threshold) : '—'} (incl. non-creditable VAT) are capitalised; keep it low — expensed capital spend may be disallowed for tax.`}>
          <Input type="number" min="0" step="500" className="max-w-[220px] tabular-nums" value={form.capitalizationThreshold}
            onChange={e => set('capitalizationThreshold', e.target.value)} />
        </Field>

        <div>
          <Label>First and last month</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(DEPRECIATION_CONVENTION_LABELS).map(([v, l]) => (
              <label key={v} title={CONVENTION_TITLE[v]}
                className={cn('flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors', form.depreciationConvention === v ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50')}>
                <input type="radio" name="convention" className="mt-0.5" checked={form.depreciationConvention === v} onChange={() => set('depreciationConvention', v)} />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{l}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{CONVENTION_HELP[v]}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">Posted months aren’t recalculated.</p>
        </div>

        <Field label="Asset tag prefix"
          hint={<>Tags look like <span className="font-mono text-gray-700">{prefixOk ? form.tagPrefix : 'EN'}LAP00042</span></>}>
          <Input className="max-w-[160px] font-mono uppercase" invalid={!prefixOk} value={form.tagPrefix} maxLength={6}
            onChange={e => set('tagPrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
        </Field>

        <label className="flex items-start gap-3"
          title="Turn off only if your accountant books depreciation separately.">
          <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.postDepreciationToLedger}
            onChange={e => set('postDepreciationToLedger', e.target.checked)} />
          <span>
            <span className="block text-sm font-medium text-gray-900">Post depreciation to the ledger</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              One non-cash expense per month, shown in the P&amp;L.
            </span>
          </span>
        </label>

        <div className="flex justify-end border-t border-gray-100 pt-4">
          <Button onClick={save} loading={saving} disabled={!dirty || !prefixOk}>
            {!saving && <Save />} Save policy
          </Button>
        </div>
      </Card>

      <Card className="h-fit p-5">
        <CardTitle>Books</CardTitle>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Fiscal year starts</dt>
            <dd className="text-gray-900">{MONTHS[(settings?.fiscalYearStartMonth ?? 7) - 1]}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground" title="The opening register is entered as at the day before go-live">Go-live date</dt>
            <dd className="text-gray-900">{settings?.goLiveDate ? fmtDay(settings.goLiveDate) : 'Not set'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground" title="Depreciation can only be posted for months after the books lock">Books locked to</dt>
            <dd className="text-gray-900">{settings?.lockedUntil ? fmtDay(settings.lockedUntil) : 'Open'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Opening balances</dt>
            <dd className="text-gray-900">{settings?.openingLocked ? 'Locked' : 'Open'}</dd>
          </div>
        </dl>
        {can('finance.opening.manage') && (
          <Link href="/admin/finance/opening-balances" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900">
            Opening balances &amp; locks <ExternalLink className="size-3.5" />
          </Link>
        )}
      </Card>
    </div>
  )
}
