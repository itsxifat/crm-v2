/**
 * Bangladesh tax catalog — PURE static data and pure helpers.
 *
 * Safe to import from 'use client' components: this file must never import
 * mongoose, '@/models', '@/lib/mongodb', next-auth or any server-only module.
 *
 * Rates are as of 15 Oct 2026:
 *   - VAT: VAT & SD Act 2012 (as amended by Finance Act 2026), Third Schedule;
 *     VDS Rules 2025 (SRO 182-Ain/2025/310-Mushak, amended by SRO 140/2026).
 *   - Income-tax withholding: Income Tax Act 2023, Withholding Tax Rules 2026
 *     (SRO 273-Ain/Aykor-5/2026, effective 1 Jul 2026); FY2025-26 variants from
 *     the Finance Ordinance 2025 rules.
 *   - Tax depreciation: Income Tax Act 2023, Third Schedule.
 * Every row carries a `source` note; rows flagged `verify` need professional
 * confirmation before relying on them.
 */

/** Day ('YYYY-MM-DD') the built-in rates and rules above were last checked. */
export const RATES_VERIFIED_AS_OF = '2026-10-15'

// ─── Money helpers ────────────────────────────────────────────────────────────

/** Round to 2 decimals, half-up (money). */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** Round a percentage rate to 4 decimals (e.g. 7.5 × 1.5 = 11.25). */
export const roundRate = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

/** VAT contained in a VAT-inclusive amount: gross × rate / (100 + rate). */
export function vatFromInclusive(gross, rate) {
  const g = Number(gross) || 0
  const r = Number(rate) || 0
  if (r <= 0) return 0
  return round2((g * r) / (100 + r))
}

/** '৳1,00,000.00' — Taka with Bangladeshi digit grouping. */
export function tk(n) {
  return `৳${round2(n).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Money equality with the house tolerance (never compare floats with ==). */
export function moneyEquals(a, b) {
  return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005
}

// ─── Identifiers ──────────────────────────────────────────────────────────────

/** Business Identification Number: 9-digit core, optionally a 4-digit suffix (13 digits, e.g. 000123456-0101). */
export const BIN_REGEX = /^\d{9}(-?\d{4})?$/
/** e-TIN: 12 digits. */
export const TIN_REGEX = /^\d{12}$/

/** Normalises a BIN for storage: 13 digits ⇒ 'NNNNNNNNN-NNNN', 9 digits ⇒ as is. Returns null for empty input. */
export function normalizeBin(s) {
  if (s === null || s === undefined) return null
  const raw = String(s).trim()
  if (!raw) return null
  const digits = raw.replace(/[\s-]/g, '')
  if (/^\d{13}$/.test(digits)) return `${digits.slice(0, 9)}-${digits.slice(9)}`
  if (/^\d{9}$/.test(digits)) return digits
  return raw
}

export function isValidBin(s) {
  if (s === null || s === undefined) return false
  return BIN_REGEX.test(String(s).replace(/\s/g, ''))
}

/** Normalises a TIN for storage (digits only). Returns null for empty input. */
export function normalizeTin(s) {
  if (s === null || s === undefined) return null
  const raw = String(s).trim()
  if (!raw) return null
  const digits = raw.replace(/[\s-]/g, '')
  return /^\d+$/.test(digits) ? digits : raw
}

export function isValidTin(s) {
  if (s === null || s === undefined) return false
  return TIN_REGEX.test(String(s).replace(/[\s-]/g, ''))
}

// ─── VAT ──────────────────────────────────────────────────────────────────────

/** `note` = the Mushak-9.1 output note the treatment reports under. */
export const VAT_TREATMENTS = [
  { value: 'STANDARD',   label: 'Standard rate (15%)',            defaultRate: 15, note: 4 },
  { value: 'REDUCED',    label: 'Reduced rate (e.g. ITES 5%)',    defaultRate: 5,  note: 7 },
  { value: 'ZERO_RATED', label: 'Zero-rated (export of services)', defaultRate: 0,  note: 1 },
  { value: 'EXEMPT',     label: 'Exempt',                          defaultRate: 0,  note: 3 },
  { value: 'NONE',       label: 'No VAT (not a VAT invoice)',      defaultRate: 0,  note: null },
]
export const VAT_TREATMENT_VALUES = VAT_TREATMENTS.map(t => t.value)

export function vatTreatmentMeta(value) {
  return VAT_TREATMENTS.find(t => t.value === value) ?? null
}

/** Rates found in the law (standard 15% and the Third Schedule reduced rates). */
export const VAT_RATE_OPTIONS = [0, 1.5, 2, 2.4, 4.5, 5, 7.5, 10, 15]

/** VAT status of a supplier / of the company itself. */
export const SUPPLIER_VAT_TYPES = [
  { value: 'REGISTERED',   label: 'VAT registered (issues Mushak-6.3)' },
  { value: 'TURNOVER',     label: 'Turnover tax (enlisted)' },
  { value: 'UNREGISTERED', label: 'Not VAT registered' },
  { value: 'FOREIGN',      label: 'Foreign / non-resident' },
]

const SRC_VDS_PWC = 'VDS Rules 2025 (SRO 182-Ain/2025/310-Mushak, am. SRO 140/2026); rates per PwC Bangladesh tax summary reviewed 31 Jul 2026'

/**
 * Seed for TaxCode kind VAT_SERVICE.
 * vatRate = VAT the supplier charges; vdsRate = VAT deducted at source by a
 * withholding entity (applied on the value EXCLUDING VAT, capped at the VAT).
 */
export const VAT_SERVICE_CODES = [
  {
    code: 'S099.10', label: 'Information technology enabled services (ITES)',
    description: 'Software development & customisation, website development & services, web hosting, IT support & maintenance, digital content development, data entry & analytics, SEO and other ITES',
    vatRate: 5, vdsRate: 5, treatment: 'REDUCED', effectiveFrom: '2025-07-01',
    source: 'VAT & SD Act 2012, Third Schedule Table-1 (5%), SRO 154/2023; VDS 5% (the full VAT) per ' + SRC_VDS_PWC + '. No input tax credit for a reduced-rate supplier.',
  },
  {
    code: 'S007.00', label: 'Advertising agency',
    description: 'Advertising agency services',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15% (VAT & SD Act 2012 s.15); ' + SRC_VDS_PWC,
  },
  {
    code: 'S007.10', label: 'Advertisement agency',
    description: 'Advertisement agency / ad-making services',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15%; VDS 15% per ' + SRC_VDS_PWC,
  },
  {
    code: 'S007.20', label: 'Online advertisement',
    description: 'Online / social-media / search-engine advertisement',
    vatRate: 5, vdsRate: 5, treatment: 'REDUCED', effectiveFrom: '2026-07-01', verify: true,
    source: 'VERIFY: Finance Act 2026 reportedly cut VAT on social-media & search-engine ads from 15% to 5% (Dhaka Tribune, Jun 2026); VDS 5% per PwC. No rate-schedule entry seen.',
  },
  {
    code: 'S032.00', label: 'Consultancy & supervisory firm',
    description: 'Consultancy and supervisory services',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15%; VDS 15% per ' + SRC_VDS_PWC + '. Note: FA 2026 exempts "computer specialist consultancy firm" (SRO 127-Ain/2026/332-Mushak) — verify scope.',
  },
  {
    code: 'S050.20', label: 'Graphic designer',
    description: 'Graphic design services',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01', verify: true,
    source: 'Standard rate 15%; VDS 15% per ' + SRC_VDS_PWC + '. VERIFY: "digital graphics design" may fall under ITES S099.10 (5%).',
  },
  {
    code: 'S071.00', label: 'Event organiser',
    description: 'Event organising / management',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15%; VDS 15% per ' + SRC_VDS_PWC,
  },
  {
    code: 'S072.00', label: 'Manpower supply',
    description: 'Manpower supply services',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15%; VDS 15% per ' + SRC_VDS_PWC,
  },
  {
    code: 'S099.20', label: 'Miscellaneous services',
    description: 'Other miscellaneous services',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15%; VDS 15% per ' + SRC_VDS_PWC + '. Individual freelancers / content creators are exempt until 30 Jun 2029 (FA 2026).',
  },
  {
    code: 'S099.30', label: 'Sponsorship services',
    description: 'Sponsorship',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15%; VDS 15% per ' + SRC_VDS_PWC,
  },
  {
    code: 'S037.00', label: 'Procurement provider',
    description: 'Supply of goods by a non-manufacturer charging 7.5% / 10% VAT',
    vatRate: 10, vdsRate: 10, treatment: 'REDUCED', effectiveFrom: '2025-07-01',
    source: 'VDS 10% per ' + SRC_VDS_PWC + '. A trader charging 15% with Mushak-6.3 is not a procurement provider (FA 2026).',
  },
  {
    code: 'S033.00', label: 'Lessee (house / office rent)',
    description: 'Rent of space — VAT paid by the tenant',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01', verify: true,
    source: 'Tenant pays 15% (' + SRC_VDS_PWC + '). VERIFY: FA 2026 requires separate A-challan deposit for rent VAT. Office rent is excluded from "input" (no ITC).',
  },
  {
    code: 'S021.00', label: 'Equipment / machinery rental',
    description: 'Rental of equipment',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15%; VDS 15% per ' + SRC_VDS_PWC,
  },
  {
    code: 'S031.00', label: 'Repair & servicing',
    description: 'Repair, maintenance and servicing',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15%; VDS 15% per ' + SRC_VDS_PWC,
  },
  {
    code: 'S028.00', label: 'Courier',
    description: 'Courier and express mail services',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15%; VDS 15% per ' + SRC_VDS_PWC,
  },
  {
    code: 'S012.14', label: 'Internet service',
    description: 'Internet establishment / internet service provider',
    vatRate: 5, vdsRate: 5, treatment: 'REDUCED', effectiveFrom: '2025-07-01',
    source: 'Third Schedule reduced rate 5% (taxpertbd VAT rate chart FY2025-26); VDS capped at the VAT charged.',
  },
  {
    code: 'GENERAL', label: 'Other standard-rated supply',
    description: 'Any other supply taxed at the standard rate',
    vatRate: 15, vdsRate: 15, treatment: 'STANDARD', effectiveFrom: '2025-07-01',
    source: 'Standard rate 15% (VAT & SD Act 2012 s.15). VDS applies only if the service is on the VDS list — check the supplier\'s service code.',
  },
]

export const INPUT_NON_CREDIT_REASONS = {
  REDUCED_RATE_OUTPUT:   'Our supply is reduced-rate/exempt (no ITC)',
  UNREGISTERED_SUPPLIER: 'Supplier not VAT registered',
  TURNOVER_SUPPLIER:     'Supplier on turnover tax',
  EXCLUDED_ITEM:         'Item excluded from "input" (office equipment, furniture, vehicles, rent, entertainment…)',
  NO_MUSHAK:             'No Mushak-6.3 with both BINs',
  CASH_OVER_LIMIT:       'Supply > Tk 1,00,000 not paid through banking channel',
  EXPIRED:               'Claim window (6 periods) expired',
  OTHER:                 'Other',
}

/** Supplies above this value must be paid through a banking channel for ITC (s.46). */
export const ITC_BANKING_THRESHOLD = 100000
/** Input VAT and VDS certificates may be claimed in the period or the next N periods. */
export const CLAIM_WINDOW_PERIODS = 6
/** Buyer name/BIN mandatory on Mushak-6.3 above this value. */
export const BUYER_BIN_THRESHOLD = 25000
/** Mushak-6.10 disclosure threshold (per invoice). */
export const DISCLOSURE_THRESHOLD = 200000

/**
 * Whether input VAT on a purchase can be credited in the VAT return.
 * Checks run in statutory order; the first failing condition is the reason.
 * @returns {{ creditable: boolean, reason: string|null }}
 */
export function inputVatCreditability({
  ourTreatment = 'STANDARD',
  supplierVatType = 'REGISTERED',
  hasMushak = true,
  excludedItem = false,
  grossAmount = 0,
  bankingChannel = true,
} = {}) {
  if (['REDUCED', 'EXEMPT', 'NONE'].includes(ourTreatment)) return { creditable: false, reason: 'REDUCED_RATE_OUTPUT' }
  if (supplierVatType === 'UNREGISTERED') return { creditable: false, reason: 'UNREGISTERED_SUPPLIER' }
  if (supplierVatType === 'TURNOVER')     return { creditable: false, reason: 'TURNOVER_SUPPLIER' }
  if (excludedItem)                       return { creditable: false, reason: 'EXCLUDED_ITEM' }
  if (!hasMushak)                         return { creditable: false, reason: 'NO_MUSHAK' }
  if ((Number(grossAmount) || 0) > ITC_BANKING_THRESHOLD && !bankingChannel) return { creditable: false, reason: 'CASH_OVER_LIMIT' }
  return { creditable: true, reason: null }
}

// ─── Income-tax withholding (TDS / AIT) ──────────────────────────────────────

export const PAYEE_TYPES = [
  { value: 'COMPANY',      label: 'Company / firm' },
  { value: 'INDIVIDUAL',   label: 'Individual' },
  { value: 'NON_RESIDENT', label: 'Non-resident' },
]

/** s.142: rate is 50% higher when the payee shows no PSR, or is not paid by bank transfer. */
export const TDS_HIGHER_RATE_MULTIPLIER = 1.5

const SRC_WHT26 = 'Withholding Tax Rules 2026 (SRO 273-Ain/Aykor-5/2026, eff. 1 Jul 2026)'
const SRC_WHT25 = 'Withholding Tax Rules 2024 as amended for FY2025-26 (Finance Ordinance 2025)'

/**
 * Seed for TaxCode kind TDS_SECTION. Rates in %.
 * basis GROSS: rate × base. COMMISSION_OR_GROSS: higher of commission × commissionRate
 * and gross × grossRate (Rule 4 proviso (kha)).
 * effectiveFrom '2025-07-01' where the rate was the same in FY2025-26 and FY2026-27;
 * rows that changed have an FY2025-26 variant with effectiveTo '2026-06-30'.
 */
export const TDS_SECTIONS = [
  { code: '89-GOODS', section: '89', label: 'Supply of goods (incl. office equipment, computers)', rateCompany: 5, rateIndividual: 5, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: 'Flat rate on any base value (no slabs since FY2024-25).', source: SRC_WHT26 + ', Rule 3 table item 20(a)' },
  { code: '89-CONTRACT', section: '89', label: 'Contract: manufacturing, processing, conversion, civil, construction, engineering', rateCompany: 5, rateIndividual: 5, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: '7% in FY2024-25; 5% from FY2025-26.', source: SRC_WHT26 + ', Rule 3 table item 18' },
  { code: '90-CONSULTANCY', section: '90', label: 'Advisory or consultancy fee', rateCompany: 7.5, rateIndividual: 15, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: 'Individual 15%, others 7.5%.', source: SRC_WHT26 + ', Rule 4 table item 1' },
  { code: '90-PROFESSIONAL', section: '90', label: 'Professional service fee', rateCompany: 7.5, rateIndividual: 15, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: 'Individual 15%, others 7.5%.', source: SRC_WHT26 + ', Rule 4 table item 2' },
  { code: '90-TECHNICAL', section: '90', label: 'Technical services, technical know-how or assistance', rateCompany: 10, rateIndividual: 15, basis: 'GROSS', effectiveFrom: '2026-07-01', effectiveTo: null,
    note: 'Individual 15%, others 10% (FY2025-26: 10% for all).', source: SRC_WHT26 + ', Rule 4 table item 3' },
  { code: '90-MEDIA', section: '90', label: 'Creative media, print & electronic media agency, cleaning, security, manpower supply', rateCompany: 1, rateIndividual: 1, basis: 'COMMISSION_OR_GROSS', commissionRate: 10, grossRate: 1, effectiveFrom: '2026-07-01', effectiveTo: null,
    note: 'Higher of 10% of commission or 1% of gross bill.', source: SRC_WHT26 + ', Rule 4 table item 4 and proviso (kha)' },
  { code: '90-EVENT', section: '90', label: 'Catering, PR, event management, training/workshop, courier, packing & shifting', rateCompany: 2, rateIndividual: 2, basis: 'GROSS', effectiveFrom: '2026-07-01', effectiveTo: null,
    note: '2% of gross bill.', source: SRC_WHT26 + ', Rule 4 table item 5' },
  { code: '90-TRANSPORT', section: '90', label: 'Transport, vehicle rental, repair & maintenance, sharing economy', rateCompany: 2, rateIndividual: 2, basis: 'GROSS', effectiveFrom: '2026-07-01', effectiveTo: null,
    note: '2% (FY2025-26: 5%).', source: SRC_WHT26 + ', Rule 4 table item 14' },
  { code: '90-INTERNET', section: '90', label: 'Internet service', rateCompany: 5, rateIndividual: 5, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: '', source: SRC_WHT26 + ', Rule 4 table item 16' },
  { code: '90-OTHER', section: '90', label: 'Any other service (default for IT/software, digital marketing)', rateCompany: 10, rateIndividual: 10, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: 'No reduced ITES withholding rate; payee may show an NBR certificate under Rule 4(2).', source: SRC_WHT26 + ', Rule 4 table item 19' },
  { code: '91-ROYALTY', section: '91', label: 'Royalty, licence, franchise, intellectual property', rateCompany: 10, rateIndividual: 10, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: 'Flat 10% from FY2025-26. Software licences likely fall here — verify classification.', source: SRC_WHT26 + '; PwC withholding summary (31 Jul 2026)' },
  { code: '92-ADVERT', section: '92', label: 'Advertising paid to media', rateCompany: 5, rateIndividual: 5, basis: 'GROSS', effectiveFrom: '2026-07-01', effectiveTo: null,
    note: 'VERIFY: rate from PwC summary only.', source: 'PwC Bangladesh withholding taxes summary (31 Jul 2026)', verify: true },
  { code: '94-COMMISSION', section: '94', label: 'Commission, discount, fees', rateCompany: 10, rateIndividual: 10, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: '', source: SRC_WHT26 + '; PwC withholding summary (31 Jul 2026)' },
  { code: '109-RENT', section: '109', label: 'House / office rent', rateCompany: 10, rateIndividual: 10, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: 'Raised from 5% on 1 Jul 2025. Rent not paid through a bank is disallowed (ITA s.55).', source: SRC_WHT26 + '; PwC withholding summary (31 Jul 2026)' },
  { code: '86-SALARY', section: '86', label: 'Salary (average rate — enter manually)', rateCompany: 0, rateIndividual: 0, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: 'Average rate on estimated annual income, deducted monthly; certificate Tofsil-1.', source: 'Income Tax Act 2023 s.86; ' + SRC_WHT26 + ' Rule 10(1)' },
  { code: '119-NR-TECH', section: '119', label: 'Non-resident: technical, advisory, consultancy, professional services', rateCompany: 10, rateIndividual: 20, basis: 'GROSS', effectiveFrom: '2026-07-01', effectiveTo: null,
    note: 'Individual 20%, others 10% (FY2025-26 technical: 20% for all).', source: SRC_WHT26 + ', Rule 5 table' },
  { code: '119-NR-DIGITAL', section: '119', label: 'Non-resident: advertisement making & digital marketing', rateCompany: 10, rateIndividual: 10, basis: 'GROSS', effectiveFrom: '2026-07-01', effectiveTo: null,
    note: '10% (FY2025-26: 15%).', source: SRC_WHT26 + ', Rule 5 table' },
  { code: '119-NR-OTHER', section: '119', label: 'Non-resident: any other payment', rateCompany: 20, rateIndividual: 20, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: null,
    note: 'Default for foreign freelancers / software not listed elsewhere. Treaty relief needs an NBR certificate (Rule 5(2)).', source: SRC_WHT26 + ', Rule 5 table' },

  // FY2025-26 variants that differ from FY2026-27
  { code: '90-TECHNICAL', section: '90', label: 'Technical services, technical know-how or assistance', rateCompany: 10, rateIndividual: 10, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30',
    note: 'FY2025-26: 10% for all payees.', source: SRC_WHT25 },
  { code: '90-TRANSPORT', section: '90', label: 'Transport, vehicle rental, repair & maintenance, sharing economy', rateCompany: 5, rateIndividual: 5, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30',
    note: 'FY2025-26: 5%.', source: SRC_WHT25 },
  { code: '119-NR-DIGITAL', section: '119', label: 'Non-resident: advertisement making & digital marketing', rateCompany: 15, rateIndividual: 15, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30',
    note: 'FY2025-26: 15%.', source: SRC_WHT25 },
  { code: '119-NR-TECH', section: '119', label: 'Non-resident: technical, advisory, consultancy, professional services', rateCompany: 20, rateIndividual: 20, basis: 'GROSS', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30',
    note: 'FY2025-26: 20% for all payees.', source: SRC_WHT25 },
]

// ─── Fixed assets (income-tax depreciation) ──────────────────────────────────

/** Income Tax Act 2023, Third Schedule. rate = % per income year (WDV unless method 'SL'). */
export const TAX_DEPRECIATION_CLASSES = {
  COMPUTER:         { label: 'Computer hardware & peripherals',              rate: 25, bookLifeMonths: 36 },
  FURNITURE:        { label: 'Furniture & fittings',                         rate: 10, bookLifeMonths: 96 },
  OFFICE_EQUIPMENT: { label: 'Office equipment',                             rate: 10, bookLifeMonths: 60 },
  MACHINERY:        { label: 'Machinery & plant',                            rate: 10, bookLifeMonths: 60 },
  MOTOR_VEHICLE:    { label: 'Motor vehicle (not for hire)',                 rate: 10, bookLifeMonths: 72, costCap: 3000000 },
  AUDIO_VISUAL:     { label: 'Audio-visual production equipment',            rate: 20, bookLifeMonths: 48 },
  BATTERY:          { label: 'Battery-operated apparatus & batteries',       rate: 30, bookLifeMonths: 24 },
  BOOKS:            { label: 'Professional & reference books',               rate: 25, bookLifeMonths: 36 },
  BUILDING:         { label: 'Building (general)',                           rate: 5,  bookLifeMonths: 240 },
  SOFTWARE_LOCAL:   { label: 'Software (developed in BD) — straight-line',   rate: 20, bookLifeMonths: 36, method: 'SL' },
  SOFTWARE_FOREIGN: { label: 'Software (foreign) — straight-line',           rate: 10, bookLifeMonths: 36, method: 'SL' },
  OTHER:            { label: 'Other assets',                                 rate: 10, bookLifeMonths: 60 },
}

// ─── Mushak-9.1 VAT return ───────────────────────────────────────────────────

/** Column labels per part of the return. */
export const VAT_RETURN_PARTS = [
  { part: 3,  title: 'Part 3 — Supply (output tax)',      columns: { a: 'Value', b: 'SD', c: 'VAT' }, notes: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { part: 4,  title: 'Part 4 — Purchase (input tax)',     columns: { a: 'Value', b: 'VAT' },          notes: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] },
  { part: 5,  title: 'Part 5 — Increasing adjustments',   columns: { c: 'VAT' },                      notes: [24, 25, 26, 27, 28] },
  { part: 6,  title: 'Part 6 — Decreasing adjustments',   columns: { c: 'VAT' },                      notes: [29, 30, 31, 32, 33] },
  { part: 7,  title: 'Part 7 — Net tax calculation',      columns: { c: 'Amount' },                   notes: [34, 35, 41, 43, 44, 50, 52] },
  { part: 9,  title: 'Part 9 — Treasury deposits',        columns: { c: 'Amount' },                   notes: [58] },
  { part: 10, title: 'Part 10 — Closing balance',         columns: { c: 'Amount' },                   notes: [65] },
]

/** Labels for the Mushak-9.1 notes the system computes. */
export const VAT_RETURN_NOTES = {
  1:  { part: 3, label: 'Zero-rated goods/services — direct export' },
  2:  { part: 3, label: 'Zero-rated goods/services — deemed export' },
  3:  { part: 3, label: 'Exempted goods/services' },
  4:  { part: 3, label: 'Standard-rated goods/services' },
  5:  { part: 3, label: 'Goods based on MRP' },
  6:  { part: 3, label: 'Goods/services based on specific VAT' },
  7:  { part: 3, label: 'Goods/services other than standard rate (e.g. ITES 5%)' },
  8:  { part: 3, label: 'Retail / wholesale / trade-based supply' },
  9:  { part: 3, label: 'Total sales value & total payable taxes', formula: 'Σ notes 1–8', total: true },
  10: { part: 4, label: 'Zero-rated goods/services — local purchase' },
  11: { part: 4, label: 'Zero-rated goods/services — import' },
  12: { part: 4, label: 'Exempted goods/services — local purchase' },
  13: { part: 4, label: 'Exempted goods/services — import' },
  14: { part: 4, label: 'Standard-rated goods/services — local purchase' },
  15: { part: 4, label: 'Standard-rated goods/services — import' },
  16: { part: 4, label: 'Goods/services other than standard rate — local purchase' },
  17: { part: 4, label: 'Goods/services other than standard rate — import' },
  18: { part: 4, label: 'Goods based on specific VAT — local purchase' },
  19: { part: 4, label: 'Not admissible for credit — purchases from turnover-tax units' },
  20: { part: 4, label: 'Not admissible for credit — purchases from unregistered persons' },
  21: { part: 4, label: 'Not admissible for credit — local (exempt/specific/reduced-rate seller, excluded item or claim out of time)' },
  22: { part: 4, label: 'Not admissible for credit — import' },
  23: { part: 4, label: 'Total input tax credit', formula: '14b + 15b + 16b + 17b + 18b + 18a(b)', total: true },
  24: { part: 5, label: 'VDS deducted by you from supplies received (your Mushak-6.6)' },
  25: { part: 5, label: 'Purchases above Tk 1,00,000 not paid through a banking channel' },
  26: { part: 5, label: 'Debit notes issued (Mushak-6.8)' },
  27: { part: 5, label: 'Any other increasing adjustment (e.g. VAT on house rent, ITC reversal)' },
  28: { part: 5, label: 'Total increasing adjustment', formula: '24 + 25 + 26 + 27', total: true },
  29: { part: 6, label: 'VDS deducted from your supplies by buyers (their Mushak-6.6)' },
  30: { part: 6, label: 'Advance tax paid at import stage' },
  31: { part: 6, label: 'Credit notes issued (Mushak-6.7)' },
  32: { part: 6, label: 'Any other decreasing adjustment' },
  33: { part: 6, label: 'Total decreasing adjustment', formula: '29 + 30 + 31 + 32', total: true },
  34: { part: 7, label: 'Net payable VAT for the tax period', formula: '9c − 23b + 28 − 33', total: true },
  35: { part: 7, label: 'Net payable VAT after adjusting the closing balance', formula: '34 − (52 + 56)', total: true },
  41: { part: 7, label: 'Interest on overdue VAT (1% per month)' },
  43: { part: 7, label: 'Penalty for non-submission of return' },
  44: { part: 7, label: 'Other fine / penalty / interest / fee' },
  50: { part: 7, label: 'Net payable VAT for treasury deposit', formula: '35 + 41 + 43 + 44', total: true },
  52: { part: 7, label: 'Closing balance of last tax period (VAT)' },
  58: { part: 9, label: 'Treasury deposit — VAT (challan)' },
  65: { part: 10, label: 'Closing balance — VAT (carried forward)', total: true },
}

/**
 * Known statutory deviations from the regular return calendar.
 * FA 2026 made Jul–Sep 2026 a single quarterly return; NBR extended it to 25 Oct 2026.
 * Monthly returns resumed from Oct 2026 (VAT & SD (Amendment) Ordinance 2026).
 */
export const VAT_RETURN_DUE_OVERRIDES = [
  { start: '2026-07', end: '2026-09', key: '2026-07..2026-09', label: 'Jul–Sep 2026 (quarterly, FA 2026)', dueDate: '2026-10-25',
    source: 'NBR extension of the Jul–Sep 2026 return to 25 Oct 2026 (Dhaka Tribune, Oct 2026)' },
]

export function vatReturnOverrideFor(period) {
  return VAT_RETURN_DUE_OVERRIDES.find(o => period >= o.start && period <= o.end) ?? null
}

/** Treasury / economic codes. {OP} = VAT commissionerate code (e.g. 0010 Dhaka South). */
export const CHALLAN_CODES = {
  VAT:             '1/1133/{OP}/0311',
  VAT_NEW:         '1141101',
  SD:              '1/1133/{OP}/0721',   // supplementary duty on services (0711 = on goods)
  SD_NEW:          '1141103',            // SD on domestic services (1141102 = goods)
  TDS_COMPANY:     '1112101',
  TDS_NON_COMPANY: '1111101',
}

export function vatChallanCode(commissionerateCode = '0010') {
  return CHALLAN_CODES.VAT.replace('{OP}', String(commissionerateCode || '0010'))
}

/** Supplementary duty (Mushak-9.1 note 59) challan code — services. */
export function sdChallanCode(commissionerateCode = '0010') {
  return CHALLAN_CODES.SD.replace('{OP}', String(commissionerateCode || '0010'))
}

/** Income-tax challan code follows the payee's status. */
export function tdsChallanCode(payeeType) {
  return payeeType === 'COMPANY' ? CHALLAN_CODES.TDS_COMPANY : CHALLAN_CODES.TDS_NON_COMPANY
}

// ─── Tax sub-ledger vocabulary ────────────────────────────────────────────────

export const TAX_ENTRY_TYPES = [
  'OUTPUT_VAT', 'INPUT_VAT', 'VDS_RECEIVABLE', 'VDS_PAYABLE', 'TDS_RECEIVABLE', 'TDS_PAYABLE',
  'CREDIT_NOTE', 'DEBIT_NOTE', 'VAT_PAYMENT', 'TDS_DEPOSIT', 'ADVANCE_TAX', 'VAT_ADJUSTMENT', 'VAT_BALANCE_BF',
]

/** group: VAT | INCOME_TAX; side: what the entry means for the company. */
export const TAX_ENTRY_TYPE_META = {
  OUTPUT_VAT:     { label: 'Output VAT',                      group: 'VAT',        side: 'PAYABLE' },
  INPUT_VAT:      { label: 'Input VAT',                       group: 'VAT',        side: 'CREDIT' },
  VDS_RECEIVABLE: { label: 'VDS by customers (6.6 to collect)', group: 'VAT',      side: 'CREDIT' },
  VDS_PAYABLE:    { label: 'VDS deducted from suppliers',     group: 'VAT',        side: 'PAYABLE' },
  TDS_RECEIVABLE: { label: 'TDS / AIT by customers (credit)', group: 'INCOME_TAX', side: 'CREDIT' },
  TDS_PAYABLE:    { label: 'TDS deducted from payees',        group: 'INCOME_TAX', side: 'PAYABLE' },
  CREDIT_NOTE:    { label: 'Credit note (Mushak-6.7)',        group: 'VAT',        side: 'CREDIT' },
  DEBIT_NOTE:     { label: 'Debit note (Mushak-6.8)',         group: 'VAT',        side: 'PAYABLE' },
  VAT_PAYMENT:    { label: 'VAT payment (challan)',           group: 'VAT',        side: 'PAYMENT' },
  TDS_DEPOSIT:    { label: 'TDS deposit (challan)',           group: 'INCOME_TAX', side: 'PAYMENT' },
  ADVANCE_TAX:    { label: 'Advance income tax',              group: 'INCOME_TAX', side: 'CREDIT' },
  VAT_ADJUSTMENT: { label: 'VAT adjustment',                  group: 'VAT',        side: null },
  VAT_BALANCE_BF: { label: 'VAT balance brought forward',     group: 'VAT',        side: null },
}

/** Entry types governed by the VAT lock (`taxLockedUntil`). */
export const VAT_ENTRY_TYPES = TAX_ENTRY_TYPES.filter(t => TAX_ENTRY_TYPE_META[t].group === 'VAT')

export function isVatEntryType(entryType) {
  return VAT_ENTRY_TYPES.includes(entryType)
}

export const CERTIFICATE_STATUSES = [
  { value: 'NOT_REQUIRED', label: 'Not required' },
  { value: 'PENDING',      label: 'Pending' },
  { value: 'RECEIVED',     label: 'Received' },
  { value: 'ISSUED',       label: 'Issued' },
]

export const DEPOSIT_STATUSES = [
  { value: 'NOT_REQUIRED', label: 'Not required' },
  { value: 'PENDING',      label: 'To deposit' },
  { value: 'DEPOSITED',    label: 'Deposited' },
  { value: 'VIA_RETURN',   label: 'Paid via VAT return' },
]

export const TAX_FILING_KINDS = ['VAT_RETURN', 'WHT_RETURN', 'ADVANCE_TAX', 'INCOME_TAX_RETURN']

/** 9.1 increasing-adjustment notes a manual VAT_ADJUSTMENT INCREASE may use. */
export const VAT_INCREASE_NOTES = [25, 27, 41, 43, 44]

export const CREDIT_NOTE_REASONS = [
  { value: 'PRICE_REDUCTION',  label: 'Price reduction' },
  { value: 'DISCOUNT',         label: 'Discount after invoicing' },
  { value: 'CANCELLED_SUPPLY', label: 'Supply cancelled' },
  { value: 'RETURN',           label: 'Goods / services returned' },
  { value: 'RATE_CHANGE',      label: 'VAT rate change' },
  { value: 'ERROR_CORRECTION', label: 'Correction of an error' },
  { value: 'OTHER',            label: 'Other' },
]

/**
 * Mushak-9.1 note an entry reports under (null when it does not appear on the return).
 */
export function vatReturnNoteOf(entry) {
  if (!entry) return null
  const t = entry.entryType
  switch (t) {
    case 'OUTPUT_VAT': {
      const tr = entry.treatment || 'STANDARD'
      // A rated supply reports by its rate, not its label, so an entry saved as
      // STANDARD at 5% (or REDUCED at 15%) before invoice rates were tied to the
      // treatment still lands in the right note. A 0% rated entry keeps its label.
      if (tr === 'STANDARD' || tr === 'REDUCED') {
        const r = Number(entry.rate) || 0
        if (r >= 15) return 4
        if (r > 0) return 7
      }
      return { STANDARD: 4, REDUCED: 7, ZERO_RATED: 1, EXEMPT: 3 }[tr] ?? null
    }
    case 'INPUT_VAT': {
      if (entry.creditable === true) {
        const tr = entry.treatment || 'STANDARD'
        return { STANDARD: 14, REDUCED: 16, ZERO_RATED: 10, EXEMPT: 12 }[tr] ?? 14
      }
      if (entry.nonCreditReason === 'UNREGISTERED_SUPPLIER') return 20
      if (entry.nonCreditReason === 'TURNOVER_SUPPLIER') return 19
      return 21
    }
    case 'VDS_PAYABLE':    return 24
    case 'DEBIT_NOTE':     return 26
    case 'VDS_RECEIVABLE': return 29
    case 'CREDIT_NOTE':    return 31
    case 'VAT_ADJUSTMENT':
      if (entry.adjustmentDirection === 'DECREASE') return 32
      if (entry.adjustmentDirection === 'INCREASE') return Number(entry.adjustmentNote) || 27
      return null
    case 'VAT_PAYMENT':    return 58
    case 'VAT_BALANCE_BF': return 52
    default:               return null
  }
}

// ─── Effective-dated lookups over the catalog (pure) ─────────────────────────

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000

/** 'YYYY-MM-DD' Dhaka day of a Date / ISO string / day string. */
export function dayKeyOf(value = new Date()) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return dayKeyOf(new Date())
  return new Date(t + DHAKA_OFFSET_MS).toISOString().slice(0, 10)
}

/** True when a row (effectiveFrom/effectiveTo as 'YYYY-MM-DD' strings) applies on `date`. */
export function isEffectiveOn(row, date = new Date()) {
  const d = dayKeyOf(date)
  const from = row.effectiveFrom ? dayKeyOf(row.effectiveFrom) : null
  const to = row.effectiveTo ? dayKeyOf(row.effectiveTo) : null
  return (!from || from <= d) && (!to || to >= d)
}

/**
 * Picks the version of a code that applies on `date` from rows of the SAME code.
 * Active rows win over inactive ones, then the latest effectiveFrom.
 * When no version covers the date, falls back to the nearest version and sets
 * `effectiveNote` so callers can tell the user.
 */
export function pickEffectiveVersion(rows, date = new Date()) {
  if (!rows?.length) return null
  const d = dayKeyOf(date)
  const byFromDesc = [...rows].sort((a, b) => dayKeyOf(b.effectiveFrom).localeCompare(dayKeyOf(a.effectiveFrom)))
  const effective = byFromDesc.filter(r => isEffectiveOn(r, d))
  if (effective.length) return effective.find(r => r.isActive !== false) ?? effective[0]
  const earliest = byFromDesc[byFromDesc.length - 1]
  if (d < dayKeyOf(earliest.effectiveFrom)) {
    return { ...earliest, effectiveNote: `No rate on record for ${d}; using the rate effective from ${dayKeyOf(earliest.effectiveFrom)}` }
  }
  const latest = byFromDesc[0]
  return { ...latest, effectiveNote: `No rate on record for ${d}; using the latest rate (from ${dayKeyOf(latest.effectiveFrom)})` }
}

/** Catalog TDS section effective on `date` (or nearest version), or null for an unknown code. */
export function catalogTdsSection(code, date = new Date()) {
  const c = String(code ?? '').trim().toUpperCase()
  return pickEffectiveVersion(TDS_SECTIONS.filter(r => r.code === c), date)
}

/** Catalog VAT service code effective on `date` (or nearest version), or null. */
export function catalogVatServiceCode(code, date = new Date()) {
  const c = String(code ?? '').trim().toUpperCase()
  return pickEffectiveVersion(VAT_SERVICE_CODES.filter(r => r.code === c), date)
}

/** Catalog rows of a kind effective on `date`, one per code, in catalog order. */
export function catalogCodesFor(kind, date = new Date()) {
  const rows = kind === 'TDS_SECTION' ? TDS_SECTIONS : VAT_SERVICE_CODES
  const seen = new Set()
  const out = []
  for (const r of rows) {
    if (seen.has(r.code) || !isEffectiveOn(r, date)) continue
    seen.add(r.code)
    out.push({ ...r, kind, isActive: true, isSystem: true, sortOrder: rows.indexOf(r) * 10 })
  }
  return out
}

/** Human-readable rate for a TDS section row, e.g. '7.5% (individual 15%)'. */
export function tdsRateText(row) {
  if (!row) return ''
  if (row.basis === 'COMMISSION_OR_GROSS') return `${row.commissionRate}% of commission or ${row.grossRate}% of gross`
  if (row.section === '86' || row.code === '86-SALARY') return 'average rate'
  const c = Number(row.rateCompany) || 0
  const i = Number(row.rateIndividual) || 0
  return c === i ? `${c}%` : `${c}% (individual ${i}%)`
}

/** Option label for a TDS section row. */
export function tdsSectionLabel(row) {
  if (!row) return ''
  return `${row.code} · s.${row.section} — ${row.label} (${tdsRateText(row)})`
}

/** Option label for a VAT service code row. */
export function vatServiceLabel(row) {
  if (!row) return ''
  return `${row.code} — ${row.label} (VAT ${Number(row.vatRate) || 0}% · VDS ${Number(row.vdsRate) || 0}%)`
}

/** Default VAT treatment for a VAT service rate. */
export function treatmentForRate(vatRate) {
  const r = Number(vatRate) || 0
  if (r >= 15) return 'STANDARD'
  if (r <= 0) return 'EXEMPT'
  return 'REDUCED'
}

/**
 * Cross-field checks for a tax code (create / edit forms and the codes API).
 * Takes the merged code object; returns { field: message } (empty when valid).
 */
export function taxCodeProblems(c = {}) {
  const errs = {}
  const missing = (v) => v === null || v === undefined || v === '' || Number.isNaN(Number(v))
  if (c.kind === 'VAT_SERVICE') {
    if (missing(c.vatRate)) errs.vatRate = 'VAT rate is required'
    if (missing(c.vdsRate)) errs.vdsRate = 'VDS rate is required (0 when there is no VDS)'
  } else if (c.kind === 'TDS_SECTION') {
    if (!String(c.section ?? '').trim()) errs.section = 'Section is required (e.g. 90)'
    if ((c.basis ?? 'GROSS') === 'COMMISSION_OR_GROSS') {
      if (missing(c.commissionRate)) errs.commissionRate = 'Rate on commission is required'
      if (missing(c.grossRate)) errs.grossRate = 'Rate on gross bill is required'
    } else {
      if (missing(c.rateCompany)) errs.rateCompany = 'Rate for companies is required'
      if (missing(c.rateIndividual)) errs.rateIndividual = 'Rate for individuals is required'
    }
  } else {
    errs.kind = 'Kind must be VAT_SERVICE or TDS_SECTION'
  }
  if (!c.effectiveFrom) errs.effectiveFrom = 'Effective-from date is required'
  else if (c.effectiveTo && dayKeyOf(c.effectiveTo) < dayKeyOf(c.effectiveFrom)) errs.effectiveTo = 'Must be on or after the effective-from date'
  return errs
}

// ─── Withholding calculators (pure; the engine wraps them with DB lookups) ───

/**
 * Income-tax withholding for one payment under a TDS section row.
 * @returns {{ sectionCode, section, label, basis, appliedBasis, payeeType, baseAmount, commissionAmount,
 *             baseRate, rate, amount, higherRateApplied, higherRateReason, reasons: string[] }}
 */
export function calcTds(row, {
  payeeType = 'COMPANY',
  baseAmount = 0,
  commissionAmount = null,
  hasPsr = true,
  bankingChannel = true,
} = {}) {
  if (!row) return null
  const base = Math.max(0, round2(Number(baseAmount) || 0))
  const commission = commissionAmount === null || commissionAmount === undefined || commissionAmount === ''
    ? null
    : Math.max(0, round2(Number(commissionAmount) || 0))
  const reasons = []
  const section = String(row.section ?? '')
  const isSalary = section === '86' || row.code === '86-SALARY'
  const isNonResidentSection = section === '119'

  if (payeeType === 'NON_RESIDENT' && !isNonResidentSection && !isSalary) {
    reasons.push('Payee is non-resident — payments to non-residents fall under s.119')
  }
  if (payeeType !== 'NON_RESIDENT' && isNonResidentSection) {
    reasons.push('s.119 applies to non-resident payees only')
  }

  // s.142 uplifts (not for salary). PSR does not apply to non-residents, who need not file in BD.
  const uplift = []
  if (!isSalary) {
    if (!hasPsr && payeeType !== 'NON_RESIDENT') uplift.push('+50%: payee has no PSR (proof of return submission) — s.142(1)')
    if (!bankingChannel) uplift.push('+50%: payment not made by bank transfer — s.142(2)')
  }
  const higher = uplift.length > 0
  const mult = higher ? TDS_HIGHER_RATE_MULTIPLIER : 1
  if (uplift.length > 1) uplift.push('Higher rate applied once (×1.5) although both conditions apply')

  let baseRate
  let rate
  let amount
  let appliedBasis = 'GROSS'

  if (isSalary) {
    baseRate = 0
    rate = 0
    amount = 0
    reasons.push('Salary TDS (s.86) uses the average rate on estimated annual income — enter the amount manually')
  } else if (row.basis === 'COMMISSION_OR_GROSS') {
    const cRate = roundRate((Number(row.commissionRate) || 0) * mult)
    const gRate = roundRate((Number(row.grossRate) || 0) * mult)
    const onGross = round2((base * gRate) / 100)
    const onCommission = commission === null ? null : round2((commission * cRate) / 100)
    if (onCommission !== null && onCommission > onGross) {
      appliedBasis = 'COMMISSION'
      baseRate = Number(row.commissionRate) || 0
      rate = cRate
      amount = onCommission
      reasons.push(`${cRate}% of commission (${tk(onCommission)}) is higher than ${gRate}% of gross (${tk(onGross)})`)
    } else {
      baseRate = Number(row.grossRate) || 0
      rate = gRate
      amount = onGross
      reasons.push(onCommission === null
        ? `Commission not given — ${gRate}% of the gross bill applied (deduct ${cRate}% of commission instead if that is higher)`
        : `${gRate}% of gross (${tk(onGross)}) is not lower than ${cRate}% of commission (${tk(onCommission)})`)
    }
  } else {
    const rc = Number(row.rateCompany) || 0
    const ri = Number(row.rateIndividual) || 0
    if (payeeType === 'INDIVIDUAL') baseRate = ri
    else if (payeeType === 'NON_RESIDENT') {
      baseRate = Math.max(rc, ri)
      if (rc !== ri) reasons.push(`Non-resident: individual rate ${ri}% applied — use ${rc}% if the payee is a company`)
    } else baseRate = rc
    rate = roundRate(baseRate * mult)
    amount = round2((base * rate) / 100)
  }

  return {
    sectionCode:      row.code,
    section,
    label:            row.label,
    basis:            row.basis ?? 'GROSS',
    appliedBasis,
    payeeType,
    baseAmount:       base,
    commissionAmount: commission,
    baseRate,
    rate,
    amount,
    higherRateApplied: higher && rate > 0,
    higherRateReason:  higher && rate > 0 ? uplift.filter(u => u.startsWith('+50%')).join('; ') : null,
    reasons:           [...(rate > 0 ? uplift : []), ...reasons],
  }
}

/**
 * VAT deducted at source on one purchase under a VAT service code row.
 * Base is the value EXCLUDING VAT; the result is capped at the VAT on the bill when given.
 * @returns {{ serviceCode, label, vatRate, rate, amount, baseAmount, vatAmount, reasons: string[] }}
 */
export function calcVds(row, { baseAmount = 0, vatAmount = null, supplierVatType = 'REGISTERED' } = {}) {
  const base = Math.max(0, round2(Number(baseAmount) || 0))
  const vat = vatAmount === null || vatAmount === undefined || vatAmount === '' ? null : Math.max(0, round2(Number(vatAmount) || 0))
  const result = (rate, amount, reasons) => ({
    serviceCode: row?.code ?? null,
    label:       row?.label ?? null,
    vatRate:     row ? Number(row.vatRate) || 0 : null,
    rate,
    amount,
    baseAmount:  base,
    vatAmount:   vat,
    reasons,
  })
  if (!row) return result(0, 0, ['Select the VAT service code of the supply'])
  if (supplierVatType === 'UNREGISTERED') return result(0, 0, ['Supplier is not VAT registered — no VDS (no Mushak-6.3)'])
  if (supplierVatType === 'TURNOVER')     return result(0, 0, ['Supplier is on turnover tax — no VDS'])
  if (supplierVatType === 'FOREIGN')      return result(0, 0, ['Foreign supplier — VAT on imported services is collected by the remitting bank, not as VDS'])
  if (['EXEMPT', 'ZERO_RATED'].includes(row.treatment)) return result(0, 0, ['Exempt / zero-rated supply — no VDS'])

  const rate = Number(row.vdsRate) || 0
  if (rate <= 0) return result(0, 0, ['No VDS on this service code'])
  let amount = round2((base * rate) / 100)
  if (vat !== null && vat <= 0) return result(0, 0, ['No VAT charged on the bill — nothing to withhold'])
  const reasons = []
  if (vat !== null && amount > vat) {
    amount = vat
    reasons.push('Capped at the VAT shown on the bill')
  }
  if (row.verify) reasons.push('Rate flagged for verification — check with your tax adviser')
  return result(rate, amount, reasons)
}
