/**
 * Plain-language guidance for the opening-balance wizard — PURE (client + server).
 * Each tax type says what number to enter and where to find it.
 */

export const STEPS = [
  { key: 1, label: 'Go-live & fiscal year', short: 'Go-live' },
  { key: 2, label: 'Money accounts',        short: 'Accounts' },
  { key: 3, label: 'Tax balances',          short: 'Tax' },
  { key: 4, label: 'Assets & stock',        short: 'Assets' },
  { key: 5, label: 'Review & lock',         short: 'Review' },
]

export const MONTH_OPTIONS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((label, i) => ({ value: i + 1, label }))

/**
 * Field keys used by the tax-opening form:
 *   party (partyName), bin (partyBin), tin (partyTin), payeeType, section,
 *   documentNo, baseAmount, amount, sdAmount, balanceSide, treatment, certificate
 */
export const OPENING_TAX_META = {
  VAT_BALANCE_BF: {
    title: 'VAT balance carried forward',
    short: 'VAT b/f',
    side: 'either',
    what: 'The closing balance of the last VAT return (Mushak-9.1) you filed before go-live.',
    where: 'Note 65 "Closing balance — VAT" of that return (note 66 for SD). A credit is set off against your next return. Choose "Payable" only for VAT from earlier returns that you still owe.',
    dateLabel: 'Last day of that return period',
    dateHint: 'e.g. 30 Sep 2026 for the Jul–Sep 2026 return. The 6-period carry-forward limit counts from here.',
    amountLabel: 'VAT balance (note 65)',
    fields: ['balanceSide', 'sdAmount', 'documentNo'],
    documentLabel: 'Return acknowledgement / reference',
    addLabel: 'Add VAT balance',
    single: true,
  },
  INPUT_VAT: {
    title: 'Unclaimed input VAT',
    short: 'Input VAT',
    side: 'asset',
    what: 'VAT on purchase bills (a Mushak-6.3 showing your BIN) that you have not claimed in any VAT return yet.',
    where: 'Your purchase register (Mushak-6.1): bills not yet included in notes 14/16 of a filed return. Enter one line per supplier invoice — each can only be claimed in its month or the next 6 tax periods, and the deadline is tracked from the bill date.',
    dateLabel: 'Date on the supplier\'s Mushak-6.3',
    dateHint: 'Bills older than 6 tax periods before go-live can no longer be claimed and are refused.',
    partyLabel: 'Supplier',
    amountLabel: 'Input VAT',
    fields: ['party', 'bin', 'documentNo', 'baseAmount', 'treatment'],
    documentLabel: 'Mushak-6.3 / invoice no.',
    baseLabel: 'Value excluding VAT',
    addLabel: 'Add purchase bill',
  },
  VDS_RECEIVABLE: {
    title: 'VDS deducted by clients',
    short: 'VDS receivable',
    side: 'asset',
    what: 'VAT your clients withheld at source from your invoices (they paid you less and deposited the VAT themselves) that you have not yet adjusted in a return.',
    where: 'Client payment advices or bank credits, and the Mushak-6.6 certificates clients sent you. Mark the certificate as received if you hold the 6.6 — it is claimed in note 29 within 6 tax periods.',
    dateLabel: 'Date the client paid you',
    dateHint: 'The day the client deducted the VAT (their payment date).',
    partyLabel: 'Client',
    amountLabel: 'VAT deducted',
    fields: ['party', 'bin', 'documentNo', 'baseAmount', 'certificate'],
    documentLabel: 'Your invoice no.',
    baseLabel: 'Invoice value excluding VAT',
    certificateLabel: 'Mushak-6.6 from the client',
    certificateStatuses: ['PENDING', 'RECEIVED'],
    addLabel: 'Add VDS deduction',
  },
  TDS_RECEIVABLE: {
    title: 'AIT / TDS deducted by clients',
    short: 'AIT credit',
    side: 'asset',
    what: 'Income tax your clients deducted at source from their payments to you. It is a credit against your company income tax.',
    where: 'AIT deducted by clients this income year per their TDS certificates (plus earlier years not yet assessed). One line per certificate or per client.',
    dateLabel: 'Date of deduction',
    dateHint: 'The client\'s payment date shown on the certificate.',
    partyLabel: 'Client',
    amountLabel: 'Tax deducted',
    fields: ['party', 'tin', 'section', 'documentNo', 'baseAmount', 'certificate'],
    documentLabel: 'Your invoice no.',
    baseLabel: 'Amount paid by the client (before tax)',
    certificateLabel: 'TDS certificate from the client',
    certificateStatuses: ['PENDING', 'RECEIVED'],
    addLabel: 'Add AIT credit',
  },
  ADVANCE_TAX: {
    title: 'Advance income tax paid',
    short: 'Advance tax',
    side: 'asset',
    what: 'Quarterly advance income tax instalments (due 15 Sep, 15 Dec, 15 Mar and 15 Jun) you have paid for the income year in progress.',
    where: 'Treasury challans or e-payment receipts — one line per challan.',
    dateLabel: 'Challan date',
    dateHint: 'The date printed on the challan / e-payment receipt.',
    amountLabel: 'Amount paid',
    fields: ['documentNo'],
    documentLabel: 'Challan no.',
    addLabel: 'Add challan',
  },
  TDS_PAYABLE: {
    title: 'TDS deducted, not yet deposited',
    short: 'TDS payable',
    side: 'liability',
    what: 'Income tax you deducted from supplier, freelancer or staff payments before go-live but had not deposited to the government yet.',
    where: 'Your withholding register / payment vouchers for deductions no challan covers yet. Deposit is due within 14 days after the month of deduction (stricter in June).',
    dateLabel: 'Date of deduction',
    dateHint: 'The payment date the tax was deducted on — it sets the deposit deadline.',
    partyLabel: 'Payee',
    amountLabel: 'Tax deducted',
    fields: ['party', 'tin', 'payeeType', 'section', 'documentNo', 'baseAmount', 'certificate'],
    documentLabel: 'Bill / voucher no.',
    baseLabel: 'Payment amount (before tax)',
    certificateLabel: 'TDS certificate to the payee',
    certificateStatuses: ['PENDING', 'ISSUED'],
    addLabel: 'Add TDS deduction',
  },
  VDS_PAYABLE: {
    title: 'VDS deducted, not yet paid',
    short: 'VDS payable',
    side: 'liability',
    what: 'VAT you withheld at source from suppliers that had not been paid to the government (by challan or through a VAT return) by go-live.',
    where: 'Your VDS register — the Mushak-6.6 certificates you issued (or still owe) for deductions not yet paid. If you are VAT-registered, this VDS is declared in note 24 of the VAT return for the month of deduction (usually your last return before go-live) and paid with that return — not by a separate challan or in the first return after go-live. Leave out VDS already included in a filed Mushak-9.1; VAT still owed on a filed return goes under "VAT balance carried forward".',
    dateLabel: 'Date of deduction',
    dateHint: 'The date you paid the supplier and kept back the VAT.',
    partyLabel: 'Supplier',
    amountLabel: 'VAT deducted',
    fields: ['party', 'bin', 'documentNo', 'baseAmount', 'certificate'],
    documentLabel: 'Supplier invoice no.',
    baseLabel: 'Bill value excluding VAT',
    certificateLabel: 'Mushak-6.6 to the supplier',
    certificateStatuses: ['PENDING', 'ISSUED'],
    addLabel: 'Add VDS deduction',
  },
}

export const OPENING_TAX_ORDER = [
  'VAT_BALANCE_BF', 'INPUT_VAT', 'VDS_RECEIVABLE', 'TDS_RECEIVABLE', 'ADVANCE_TAX', 'TDS_PAYABLE', 'VDS_PAYABLE',
]

export const CERTIFICATE_STATUS_LABELS = {
  NOT_REQUIRED: 'Not required',
  PENDING:      'Pending',
  RECEIVED:     'Received',
  ISSUED:       'Issued',
}

export const INPUT_TREATMENT_OPTIONS = [
  { value: 'STANDARD',   label: 'Standard rate (15%)' },
  { value: 'REDUCED',    label: 'Reduced rate' },
  { value: 'ZERO_RATED', label: 'Zero-rated' },
  { value: 'EXEMPT',     label: 'Exempt' },
]

export const PAYEE_TYPE_OPTIONS = [
  { value: 'COMPANY',      label: 'Company / firm' },
  { value: 'INDIVIDUAL',   label: 'Individual' },
  { value: 'NON_RESIDENT', label: 'Non-resident' },
]

/** Hint shown under an account's opening balance input. */
export function accountBalanceHint(type) {
  switch (type) {
    case 'BANK_CURRENT':
    case 'BANK_SAVINGS':
      return 'Closing balance on the bank statement for the day before go-live.'
    case 'CASH':
    case 'PETTY_CASH':
      return 'Count the cash in the box at close of business the day before go-live.'
    case 'MFS':
      return 'Wallet balance in the bKash/Nagad merchant statement or app at end of that day.'
    case 'CARD':
      return 'Amount owed on the card statement — enter it as a negative number.'
    case 'LOAN_OD':
      return 'Loan or overdraft outstanding — enter the amount owed as a negative number.'
    case 'GATEWAY':
      return 'Balance held by the payment gateway, not yet settled to your bank.'
    default:
      return 'Balance at the end of the day before go-live.'
  }
}

/** Activity-log action labels shown in the lock history. */
export const HISTORY_ACTION_LABELS = {
  LOCK:   'Locked',
  UNLOCK: 'Unlocked',
  UPDATE: 'Updated',
  CREATE: 'Added',
  VOID:   'Voided',
  DELETE: 'Removed',
  IMPORT: 'Imported',   // inventory opening register (POST /api/inventory/opening)
}
