export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Setting } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { requireAnyPerm } from '@/app/api/tax/registers/_lib/auth'
import { logActivity } from '@/lib/logActivity'
import { getFinanceSettings, saveFinanceSettings, getCompanyProfile } from '@/lib/finance/settings'
import { isValidBin, isValidTin, normalizeBin, normalizeTin, VAT_TREATMENT_VALUES } from '@/lib/tax/catalog'
import { z } from 'zod'

// Company-profile keys this route manages (Setting group 'company'). Name, address,
// phone, email and website stay on the Configuration page.
const COMPANY_FIELDS = {
  bin:                  'company_bin',
  tin:                  'company_tin',
  tradeLicense:         'company_trade_license',
  vatCircle:            'company_vat_circle',
  issueAddress:         'company_issue_address',
  signatoryName:        'company_signatory_name',
  signatoryDesignation: 'company_signatory_designation',
}

const empty = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const optText = (max) => z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(max).nullable()).optional()
// Blank ⇒ undefined ⇒ NaN ⇒ a validation error (never silently 0).
const pct = z.preprocess(
  v => (v === '' || v === null ? undefined : v),
  z.coerce.number({ invalid_type_error: 'Enter a percentage' }).finite('Enter a percentage').min(0, 'Must be 0–100').max(100, 'Must be 0–100'),
)
const bool = z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())

const schema = z.object({
  company: z.object({
    bin: z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(20).nullable()
      .refine(v => v === null || isValidBin(v), 'BIN is 9 or 13 digits, e.g. 000123456-0101')).optional(),
    tin: z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(20).nullable()
      .refine(v => v === null || isValidTin(v), 'TIN (e-TIN) is 12 digits')).optional(),
    tradeLicense:         optText(80),
    vatCircle:            optText(160),
    issueAddress:         optText(400),
    signatoryName:        optText(120),
    signatoryDesignation: optText(120),
  }).optional(),
  vat: z.object({
    registrationType:      z.enum(['REGISTERED', 'TURNOVER', 'UNREGISTERED']).optional(),
    returnFrequency:       z.enum(['MONTHLY', 'QUARTERLY']).optional(),
    defaultSalesTreatment: z.enum(VAT_TREATMENT_VALUES).optional(),
    defaultSalesRate:      pct.optional(),
    defaultServiceCode:    z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(40).regex(/^[A-Za-z0-9._-]+$/, 'Invalid service code').nullable()).optional(),
    isVdsEntity:           bool.optional(),
    commissionerateCode:   z.preprocess(v => (empty(v) ? '' : v), z.string().trim().regex(/^(\d{4})?$/, 'Commissionerate code is 4 digits, e.g. 0010')).optional(),
  }).optional(),
  incomeTax: z.object({
    isWithholdingEntity:   bool.optional(),
    corporateRate:         pct.optional(),
    cashlessRate:          pct.optional(),
    taxZone:               z.preprocess(v => (empty(v) ? '' : v), z.string().trim().max(120)).optional(),
    taxCircle:             z.preprocess(v => (empty(v) ? '' : v), z.string().trim().max(120)).optional(),
    cashRatioThresholdPct: pct.optional(),
    cashDisallowPct:       pct.optional(),
  }).optional(),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).optional(),
})

function profileView(company, settings, session) {
  return {
    company: {
      name:                 company.name,
      address:              company.address,
      phone:                company.phone,
      email:                company.email,
      website:              company.website,
      bin:                  company.bin,
      tin:                  company.tin,
      tradeLicense:         company.tradeLicense,
      vatCircle:            company.vatCircle,
      issueAddress:         company.issueAddress,
      signatoryName:        company.signatoryName,
      signatoryDesignation: company.signatoryDesignation,
    },
    vat:                  settings.vat,
    incomeTax:            settings.incomeTax,
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    goLiveDate:           settings.goLiveDate ?? null,
    lockedUntil:          settings.lockedUntil ?? null,
    taxLockedUntil:       settings.taxLockedUntil ?? null,
    openingLocked:        !!settings.openingLocked,
    canEdit:              canDo(session, 'tax.manage'),
    canEditFiscalYear:    canDo(session, 'finance.opening.manage') && !settings.openingLocked,
  }
}

// GET /api/tax/profile → { data: { company, vat, incomeTax, fiscalYearStartMonth, ... } }
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAnyPerm(session)
    if (denied) return denied

    await connectDB()
    const [company, settings] = await Promise.all([getCompanyProfile(), getFinanceSettings()])
    return NextResponse.json({ data: profileView(company, settings, session) })
  } catch (err) {
    console.error('[GET /api/tax/profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/tax/profile  { company?: { bin, tin, tradeLicense, vatCircle, issueAddress, signatoryName, signatoryDesignation },
//                         vat?: {...}, incomeTax?: {...}, fiscalYearStartMonth? }   (partial)
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.manage')
    if (denied) return denied

    const body = await request.json().catch(() => null)
    const parsed = schema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const d = parsed.data

    await connectDB()
    const [beforeCompany, beforeSettings] = await Promise.all([getCompanyProfile(), getFinanceSettings()])

    // The fiscal year drives every period and lock — same rule as the opening-balances settings.
    if (d.fiscalYearStartMonth !== undefined && d.fiscalYearStartMonth !== beforeSettings.fiscalYearStartMonth) {
      if (!canDo(session, 'finance.opening.manage')) {
        return NextResponse.json({ error: 'Changing the fiscal year needs the "Manage opening balances & go-live" permission' }, { status: 403 })
      }
      if (beforeSettings.openingLocked) {
        return NextResponse.json({ error: 'Opening balances are locked — the fiscal year can no longer change' }, { status: 409 })
      }
    }

    // Default sales treatment must fit the registration (invoices reject VAT treatments
    // for a company that is not VAT registered) and the rate must fit the treatment.
    const touchesDefaults = d.vat && ['registrationType', 'defaultSalesTreatment', 'defaultSalesRate'].some(k => d.vat[k] !== undefined)
    if (touchesDefaults) {
      const vat = { ...beforeSettings.vat, ...d.vat }
      if (vat.registrationType !== 'REGISTERED' && vat.defaultSalesTreatment !== 'NONE') {
        return NextResponse.json({
          error: 'A company that is not VAT registered must use "No VAT" as the default sales treatment',
          details: { formErrors: [], fieldErrors: { 'vat.defaultSalesTreatment': ['Use "No VAT" unless the company is VAT registered'] } },
        }, { status: 422 })
      }
      if (['ZERO_RATED', 'EXEMPT', 'NONE'].includes(vat.defaultSalesTreatment) && Number(vat.defaultSalesRate) !== 0) {
        d.vat.defaultSalesRate = 0
      }
      if (['STANDARD', 'REDUCED'].includes(vat.defaultSalesTreatment) && !(Number(vat.defaultSalesRate) > 0)) {
        return NextResponse.json({
          error: 'Enter the default VAT rate for this treatment',
          details: { formErrors: [], fieldErrors: { 'vat.defaultSalesRate': ['Must be more than 0 for standard / reduced rate'] } },
        }, { status: 422 })
      }
    }

    // ── finance settings (vat / incomeTax / fiscal year) ──
    const patch = {}
    if (d.vat && Object.keys(d.vat).length) patch.vat = d.vat
    if (d.incomeTax && Object.keys(d.incomeTax).length) patch.incomeTax = d.incomeTax
    if (d.fiscalYearStartMonth !== undefined) patch.fiscalYearStartMonth = d.fiscalYearStartMonth

    let settings = beforeSettings
    if (Object.keys(patch).length) {
      try {
        settings = await saveFinanceSettings(patch)
      } catch (err) {
        if (err?.status === 422) {
          return NextResponse.json({
            error: err.message,
            details: { formErrors: [], fieldErrors: err.field ? { [err.field]: [err.message] } : {} },
          }, { status: 422 })
        }
        throw err
      }
    }

    // ── company tax identity (Setting group 'company') ──
    const companyChanges = {}
    if (d.company) {
      const ops = []
      for (const [field, key] of Object.entries(COMPANY_FIELDS)) {
        if (d.company[field] === undefined) continue
        let value = d.company[field]
        if (value !== null && field === 'bin') value = normalizeBin(value)
        if (value !== null && field === 'tin') value = normalizeTin(value)
        const from = beforeCompany[field] || null
        if ((value ?? null) === from) continue
        companyChanges[field] = { from, to: value ?? null }
        ops.push(value === null
          ? { deleteOne: { filter: { key } } }
          : { updateOne: { filter: { key }, update: { $set: { value: String(value), group: 'company' } }, upsert: true } })
      }
      if (ops.length) await Setting.bulkWrite(ops, { ordered: true })
    }

    // ── audit ──
    const settingsDiff = {}
    for (const group of ['vat', 'incomeTax']) {
      if (!patch[group]) continue
      for (const k of Object.keys(patch[group])) {
        const from = beforeSettings[group]?.[k] ?? null
        const to = settings[group]?.[k] ?? null
        if (JSON.stringify(from) !== JSON.stringify(to)) settingsDiff[`${group}.${k}`] = { from, to }
      }
    }
    if (patch.fiscalYearStartMonth !== undefined && beforeSettings.fiscalYearStartMonth !== settings.fiscalYearStartMonth) {
      settingsDiff.fiscalYearStartMonth = { from: beforeSettings.fiscalYearStartMonth, to: settings.fiscalYearStartMonth }
    }
    if (Object.keys(settingsDiff).length || Object.keys(companyChanges).length) {
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'UPDATE',
        entity:   'FINANCE_SETTINGS',
        entityId: 'tax_profile',
        changes:  JSON.stringify({
          ...settingsDiff,
          ...Object.fromEntries(Object.entries(companyChanges).map(([k, v]) => [`company.${k}`, v])),
        }),
        request,
      })
    }

    const company = Object.keys(companyChanges).length ? await getCompanyProfile() : beforeCompany
    return NextResponse.json({ data: profileView(company, settings, session) })
  } catch (err) {
    if (err?.status && err.status < 500) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[PUT /api/tax/profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
