/**
 * lib/products/catalog.js — PURE (client-safe). The products that bill on their
 * own and push their invoices here (docs/envo.md, docs/ncom.md).
 *
 * Each one talks the same protocol (POST /api/webhooks/<key>, signed with
 * `<Label>-Signature`) and is kept apart from the others by its own fields:
 * `<key>Id` on Client, Invoice and ProjectPayment (unique), `<key>Owned` on
 * Client, its own sync model and settings row, and ledger rows with Transaction
 * IDs `<TXN>P<payment>` (income) and `<TXN>F<payment>` (gateway charge). Ids may
 * repeat between products: Envo's invoice 7 and NCOM's invoice 7 are two invoices.
 *
 * Envo's names are the ones it always had; nothing here may change them.
 */

export const PRODUCTS = Object.freeze({
  envo: Object.freeze({
    key:            'envo',
    label:          'Envo',
    productId:      'ENVO',                 // Configuration → Products, unit PRODUCT:ENVO
    productDescription: 'Cloud PBX',
    idField:        'envoId',
    ownedField:     'envoOwned',
    statusField:    'envoStatus',           // on its sync record
    versionField:   'envoVersion',
    txnPrefix:      'ENVO',                 // ENVOP<payment> income, ENVOF<payment> gateway charge
    signatureHeader: 'envo-signature',
    settingsKey:    'envo',
    reconcileKey:   'envo_reconcile_last',
    incomeCategory: 'Envo Subscriptions',
    customerNoun:   'account',
    // Recharges and top-ups go on a balance, so their VAT is a setting of its own.
    hasTopups:      true,
    placeholderEmail: (id) => `envo-account-${id}@customers.envo.invalid`,
    noLogin:        '!envo-customer-no-crm-login',
    ownedMessage:   'This invoice belongs to Envo: the customer pays it there and the CRM follows. It cannot be edited, sent, cancelled or paid here.',
    notPayable:     'This invoice is billed and paid in Envo',
  }),
  ncom: Object.freeze({
    key:            'ncom',
    label:          'NCOM',
    productId:      'NCOM',
    productDescription: 'Websites and online stores',
    idField:        'ncomId',
    ownedField:     'ncomOwned',
    statusField:    'ncomStatus',
    versionField:   'ncomVersion',
    txnPrefix:      'NCOM',                 // NCOMP<payment>, NCOMF<payment>
    signatureHeader: 'ncom-signature',
    settingsKey:    'ncom',
    reconcileKey:   'ncom_reconcile_last',
    incomeCategory: 'NCOM Subscriptions',
    customerNoun:   'workspace',
    hasTopups:      false,
    placeholderEmail: (id) => `ncom-workspace-${id}@customers.ncom.invalid`,
    noLogin:        '!ncom-customer-no-crm-login',
    ownedMessage:   'This invoice belongs to NCOM: the customer pays it there and the CRM follows. It cannot be edited, sent, cancelled or paid here.',
    notPayable:     'This invoice is billed and paid in NCOM',
  }),
})

export const PRODUCT_LIST = Object.freeze(Object.values(PRODUCTS))

/** Every `<key>Id` field, for a `.select()` that has to know who owns a document. */
export const OWNER_FIELDS = PRODUCT_LIST.map(p => p.idField).join(' ')

/** The product an invoice or payment belongs to (it pays there and the CRM follows), or null. */
export function productOwning(doc) {
  if (!doc) return null
  return PRODUCT_LIST.find(p => doc[p.idField] !== null && doc[p.idField] !== undefined) ?? null
}

/** The product that created a client and keeps its details current, or null. */
export function productOwningClient(client) {
  if (!client) return null
  return PRODUCT_LIST.find(p => client[p.ownedField] === true) ?? null
}

/** What finance is told trying to change a product's invoice by hand; null for the CRM's own. */
export function ownedMessage(doc) {
  return productOwning(doc)?.ownedMessage ?? null
}
