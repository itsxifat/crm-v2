/**
 * Register definitions — PURE (columns in official Mushak order).
 *
 * Column: { key, no?, label, type: 'serial'|'text'|'date'|'money'|'qty', stock?, total? }
 *   no     — the column number printed on the official form (Mushak-6.1 / 6.2 / 6.10)
 *   stock  — inventory column; left blank for services (hidden on screen by default)
 *   total  — summed in the totals row
 */

export const REGISTER_TYPES = ['sales', 'purchases', 'disclosure', 'vds', 'tds']

const SALES_COLUMNS = [
  { key: 'serial',          no: 1,  label: 'SL',                                  type: 'serial' },
  { key: 'date',            no: 2,  label: 'Date',                                type: 'date' },
  { key: 'openingQty',      no: 3,  label: 'Opening stock — quantity',            type: 'qty',   stock: true },
  { key: 'openingValue',    no: 4,  label: 'Opening stock — value',               type: 'money', stock: true },
  { key: 'productionQty',   no: 5,  label: 'Production — quantity',               type: 'qty',   stock: true },
  { key: 'productionValue', no: 6,  label: 'Production — value',                  type: 'money', stock: true },
  { key: 'totalQty',        no: 7,  label: 'Total quantity (3+5)',                type: 'qty',   stock: true },
  { key: 'totalValue',      no: 8,  label: 'Total value (4+6)',                   type: 'money', stock: true },
  { key: 'buyerName',       no: 9,  label: 'Buyer name',                          type: 'text' },
  { key: 'buyerAddress',    no: 10, label: 'Buyer address',                       type: 'text' },
  { key: 'buyerBin',        no: 11, label: 'Buyer registration / NID no.',        type: 'text' },
  { key: 'challanNo',       no: 12, label: 'Challan (Mushak-6.3) no.',            type: 'text' },
  { key: 'challanDate',     no: 13, label: 'Challan date',                        type: 'date' },
  { key: 'description',     no: 14, label: 'Description of goods / services',     type: 'text' },
  { key: 'quantity',        no: 15, label: 'Quantity',                            type: 'qty' },
  { key: 'taxableValue',    no: 16, label: 'Taxable value',                       type: 'money', total: true },
  { key: 'sd',              no: 17, label: 'Supplementary duty',                  type: 'money', total: true },
  { key: 'vat',             no: 18, label: 'VAT',                                 type: 'money', total: true },
  { key: 'closingQty',      no: 19, label: 'Closing stock — quantity (7−15)',     type: 'qty',   stock: true },
  { key: 'closingValue',    no: 20, label: 'Closing stock — value (8−16)',        type: 'money', stock: true },
  { key: 'remarks',         no: 21, label: 'Remarks',                             type: 'text' },
]

const PURCHASE_COLUMNS = [
  { key: 'serial',        no: 1,  label: 'SL',                                        type: 'serial' },
  { key: 'date',          no: 2,  label: 'Date',                                      type: 'date' },
  { key: 'openingQty',    no: 3,  label: 'Opening stock of inputs — quantity',        type: 'qty',   stock: true },
  { key: 'openingValue',  no: 4,  label: 'Opening stock of inputs — value',           type: 'money', stock: true },
  { key: 'challanNo',     no: 5,  label: 'Challan / bill of entry no.',               type: 'text' },
  { key: 'challanDate',   no: 6,  label: 'Challan date',                              type: 'date' },
  { key: 'sellerName',    no: 7,  label: 'Seller name',                               type: 'text' },
  { key: 'sellerAddress', no: 8,  label: 'Seller address',                            type: 'text' },
  { key: 'sellerBin',     no: 9,  label: 'Registration / enlistment / NID no.',       type: 'text' },
  { key: 'description',   no: 10, label: 'Description',                               type: 'text' },
  { key: 'quantity',      no: 11, label: 'Quantity',                                  type: 'qty' },
  { key: 'value',         no: 12, label: 'Value (excl. all taxes)',                   type: 'money', total: true },
  { key: 'sd',            no: 13, label: 'Supplementary duty',                        type: 'money', total: true },
  { key: 'vat',           no: 14, label: 'VAT',                                       type: 'money', total: true },
  { key: 'totalQty',      no: 15, label: 'Total quantity (3+11)',                     type: 'qty',   stock: true },
  { key: 'totalValue',    no: 16, label: 'Total value (4+12)',                        type: 'money', stock: true },
  { key: 'usedQty',       no: 17, label: 'Used in production — quantity',             type: 'qty',   stock: true },
  { key: 'usedValue',     no: 18, label: 'Used in production — value',                type: 'money', stock: true },
  { key: 'closingQty',    no: 19, label: 'Closing stock — quantity',                  type: 'qty',   stock: true },
  { key: 'closingValue',  no: 20, label: 'Closing stock — value',                     type: 'money', stock: true },
  { key: 'remarks',       no: 21, label: 'Remarks',                                   type: 'text' },
]

/** Shared by both parts of Mushak-6.10; party labels differ per part. */
const DISCLOSURE_COLUMNS = [
  { key: 'part',         label: 'Part',                         type: 'text' },
  { key: 'serial',       no: 1, label: 'SL',                    type: 'serial' },
  { key: 'challanNo',    no: 2, label: 'Challan / invoice no.', type: 'text' },
  { key: 'challanDate',  no: 3, label: 'Issue date',            type: 'date' },
  { key: 'value',        no: 4, label: 'Value (incl. VAT & SD)', type: 'money', total: true },
  { key: 'partyName',    no: 5, label: 'Name',                  type: 'text' },
  { key: 'partyAddress', no: 6, label: 'Address',               type: 'text' },
  { key: 'partyBin',     no: 7, label: 'BIN / NID',             type: 'text' },
]

const VDS_COLUMNS = [
  { key: 'serial',        label: 'SL',                               type: 'serial' },
  { key: 'direction',     label: 'Deducted by',                      type: 'text' },
  { key: 'date',          label: 'Date',                             type: 'date' },
  { key: 'partyBin',      label: 'Party BIN',                        type: 'text' },
  { key: 'partyName',     label: 'Party name',                       type: 'text' },
  { key: 'partyAddress',  label: 'Party address',                    type: 'text' },
  { key: 'value',         label: 'Value',                            type: 'money', total: true },
  { key: 'vds',           label: 'VAT deducted',                     type: 'money', total: true },
  { key: 'invoiceNo',     label: 'Invoice / challan no.',            type: 'text' },
  { key: 'invoiceDate',   label: 'Invoice / challan date',           type: 'date' },
  { key: 'certNo',        label: 'Mushak-6.6 no.',                   type: 'text' },
  { key: 'certDate',      label: 'Certificate date',                 type: 'date' },
  { key: 'certStatus',    label: 'Certificate status',               type: 'text' },
  { key: 'accountCode',   label: 'Deposit account code',             type: 'text' },
  { key: 'depositSerial', label: 'Deposit serial (challan / DV)',    type: 'text' },
  { key: 'depositDate',   label: 'Deposit date',                     type: 'date' },
  { key: 'returnNote',    label: '9.1 note / claim',                 type: 'text' },
  { key: 'remarks',       label: 'Remarks',                          type: 'text' },
]

const TDS_COLUMNS = [
  { key: 'serial',      label: 'SL',                    type: 'serial' },
  { key: 'direction',   label: 'Deducted by',           type: 'text' },
  { key: 'date',        label: 'Date',                  type: 'date' },
  { key: 'section',     label: 'Section',               type: 'text' },
  { key: 'partyName',   label: 'Party name',            type: 'text' },
  { key: 'partyTin',    label: 'Party TIN',             type: 'text' },
  { key: 'payeeType',   label: 'Payee type',            type: 'text' },
  { key: 'documentNo',  label: 'Document no.',          type: 'text' },
  { key: 'base',        label: 'Amount paid (base)',    type: 'money', total: true },
  { key: 'rate',        label: 'Rate %',                type: 'qty' },
  { key: 'tds',         label: 'Tax deducted',          type: 'money', total: true },
  { key: 'certNo',      label: 'Certificate no.',       type: 'text' },
  { key: 'certDate',    label: 'Certificate date',      type: 'date' },
  { key: 'certStatus',  label: 'Certificate status',    type: 'text' },
  { key: 'challanNo',   label: 'Challan no.',           type: 'text' },
  { key: 'challanDate', label: 'Challan date',          type: 'date' },
  { key: 'depositStatus', label: 'Deposit status',      type: 'text' },
  { key: 'remarks',     label: 'Remarks',               type: 'text' },
]

export const REGISTERS = {
  sales: {
    type: 'sales', form: 'Mushak-6.2', formBn: 'মূসক-৬.২', title: 'Sales register',
    rule: 'VAT & SD Rules 2016, rule 40(1)(b)', numbered: true, landscape: true, columns: SALES_COLUMNS,
    hint: 'Tax invoices issued (output VAT), with credit notes (negative) and debit notes. Stock columns stay blank for services.',
  },
  purchases: {
    type: 'purchases', form: 'Mushak-6.1', formBn: 'মূসক-৬.১', title: 'Purchase register',
    rule: 'VAT & SD Rules 2016, rule 40(1)(a)', numbered: true, landscape: true, columns: PURCHASE_COLUMNS,
    hint: 'Every business purchase: received purchase bills (one row per line), purchases recorded with input VAT, and paid supplier expenses without VAT (e.g. from unregistered sellers — name, address and NID/BIN in columns 7–9). Stock columns stay blank for services.',
  },
  disclosure: {
    type: 'disclosure', form: 'Mushak-6.10', formBn: 'মূসক-৬.১০', title: 'Purchases and sales above Tk 2,00,000',
    rule: 'VAT & SD Rules 2016, rule 42', numbered: true, landscape: false, columns: DISCLOSURE_COLUMNS,
    parts: {
      A: { title: 'Part A — Purchases', partyLabel: 'Seller' },
      B: { title: 'Part B — Sales', partyLabel: 'Buyer' },
    },
    hint: 'Each purchase or sale invoice above Tk 2,00,000 (value including VAT & SD) — purchase bills, purchases with input VAT and paid supplier expenses without VAT — submitted with the return.',
  },
  vds: {
    type: 'vds', form: null, title: 'VDS register', rule: 'VAT deducted at source — s.49; VDS Rules 2025',
    numbered: false, landscape: true, columns: VDS_COLUMNS,
    hint: 'VAT we deducted from suppliers (note 24, we issue Mushak-6.6) and VAT customers deducted from us (note 29, we collect Mushak-6.6).',
  },
  tds: {
    type: 'tds', form: null, title: 'TDS / AIT register', rule: 'Income Tax Act 2023 — withholding at source',
    numbered: false, landscape: true, columns: TDS_COLUMNS,
    hint: 'Income tax we deducted from payees (to deposit by challan and certify) and tax customers deducted from us (AIT credit).',
  },
}
