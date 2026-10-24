# Ventures & products in finance

Every financial figure — income, expense, profit or loss, margin, receivables and the monthly trend —
can be split by **venture** (Enfinito Tech, Enfinito Studio, …) and by **product** (Envo, Ncom, …).
A product is a business unit of its own, not part of a venture.

## The business unit

Every money record carries one **unit**:

| Shown as | Stored as | Meaning |
|---|---|---|
| *Enfinito Tech* | `VENTURE:ENTECH` | a venture |
| *Envo (product)* | `PRODUCT:ENVO` | a product |
| *Company / shared* | `COMPANY` | company-wide income or a shared cost |
| *Unassigned* | `null` | an old record that could not be placed (new records never are) |

The unit is fixed when the money is recorded. Changing a project's venture later does not move the
income and costs already recorded.

**Shared costs.** A salary follows the employee's venture. Every other shared cost goes to
*Company / shared*: rent, utilities, bank charges, depreciation, tax penalties, purchases. It is
shown beside the ventures and products, so a venture's profit is its profit **before overheads**.

## Recording income and expenses

Choosing the venture or product is **required** whenever someone records income or an expense. The
CRM fills it in when it knows it, and *Company / shared* is always a valid choice.

| Money in or out | Unit |
|---|---|
| Invoice payment: manual, project payment, online (Enfinito Pay, encloud), tax withheld | The invoice's unit; else its project's venture; else Company |
| Credit-note refund | As the invoice |
| Standalone invoice (no project) | Chosen on the invoice form |
| New expense, reimbursement, My Expenses | Chosen on the form; with a project, that project's venture |
| Project expense, freelancer or agency payment | The project's venture |
| Paying an expense | The expense's unit, else its project's venture, else Company |
| Salary | The employee's venture, else Company (a freelancer's salary: Company) |
| Other income, interest received, bank charge (Finance → Movements) | Chosen on the form (Company by default) |
| Purchase bills, assets (purchase, repair, disposal), depreciation, transfer fees, tax deposits and penalties | Company |
| Capital, drawings, loans, transfers between accounts | Company (not in the P&L) |

*Record payment* shows the unit it will book to; it cannot be changed there.

## Reports

- **Accounts → Ventures & products**: one row per unit for the chosen period (the current fiscal
  year, July–June, by default) with income, expense, profit, margin and what is still to be received,
  plus a totals row. *Company / shared* and *Unassigned* are listed when they have figures. Open a
  row for its month-by-month figures; *View transactions* lists that unit's transactions.
- **P&L** and **Overview** have a unit selector (all units, or one).
- **Transactions** has a unit filter and a *Venture / product* column.

The figures use exactly the P&L rules: only income and expenses that count in the P&L, reversals
netted, VAT and SD left out of income.

**Who sees what.** Super Admin, and anyone given *See every venture and product in finance reports*
(`finance.units.all`), sees every unit. Everyone else sees only the venture on their employee profile
(and a note saying so); without a venture they see no figures. Grant it through custom roles or
individual permissions (*People → Roles*).

## Correcting a unit

*Transactions → row menu → Change venture / product.* It is allowed in open periods. In a locked
period only a row that is still *Unassigned* can be placed. Every change is in the activity log.

## Setting up ventures and products

*Configuration → Ventures* and *Configuration → Products*: add, edit, or deactivate. The id
(letters A–Z and digits, up to 12) is set when the venture or product is created and never changes.
A deactivated venture or product is no longer offered on forms, but its history still reports. One
that records still use cannot be removed: deactivate it instead.

## Records from before ventures and products

`scripts/backfill-finance-units.js` places the records saved before units existed. It only fills
records that have no unit yet, never overwrites one, and is safe to run again.

```bash
npm run db:backfill-finance-units              # dry run: what it would set, and what stays Unassigned
npm run db:backfill-finance-units -- --apply   # write
```

| Record | Placed by |
|---|---|
| Expense | Its project's venture, else its own venture; salary: the employee's venture (a freelancer's: Company); purchase bills and asset repairs: Company |
| Invoice | Its project's venture (standalone invoices stay Unassigned) |
| Transaction | The row it reverses (for a reversal); the expense it paid; its project's venture; salary: the employee's venture (a freelancer's: Company); the invoice it settled; Company for transfers, capital, drawings, loans, adjustments, tax, purchases and assets, depreciation, bank charges and interest |

Everything else stays *Unassigned* and the dry run lists it by category, with its P&L amount: for
example manual income without a project, "Other income", rent, or settlements of standalone
invoices. Place those with *Change venture / product*. A salary whose employee has no venture also
stays Unassigned: set the venture on the employee and run the script again.

## For developers

Use these helpers rather than working a unit out somewhere else.

- **`lib/units.js`** (client-safe): `COMPANY_UNIT`, `UNASSIGNED` (the query value for `unit: null`),
  `ventureUnit(id)`, `productUnit(id)`, `parseUnit(unit)` → `{ kind, id }` or null,
  `isValidUnit(unit, config)` (Company, or an id in `crm_config`, active or not),
  `unitOptions(config, { includeInactive })` (ventures, products, Company), `unitLabel(unit, config)`.
- **`lib/finance/ledger.js`**: `postMoneyEntry({ …, unit })` stores a unit string as given (its shape
  is checked: a malformed one is a 422; the config is not — routes check a person's choice with
  `isValidUnit`). Without a unit: `VENTURE:<project.venture>` when `projectId` names a project with a
  venture, else `COMPANY`; never null. `reverseMoneyEntry` copies the original's unit, null included,
  so a pair always nets to zero in one unit. `createTransfer` books every row to `COMPANY`.
- **`lib/finance/scope.js`** (server): `financeScope(session)` → `{ all: true }` or
  `{ all: false, units: ['VENTURE:<Employee.venture>'] }` (empty without a venture);
  `scopeFilter(scope, field = 'unit')` → `{}` or `{ [field]: { $in: units } }` (an empty list matches
  nothing). Every finance report applies it.
- **Models**: `Transaction.unit` (index `{ unit: 1, date: 1 }`), `ProjectExpense.unit`,
  `Invoice.unit`. `ProjectExpense.venture` stays as it was. Products live in `crm_config.products`
  (`[{ id, label, description, active }]`); `useConfig()` exposes `products`, `productOptions` and
  `unitOptions`, and `components/finance/UnitSelect.jsx` is the picker.
- **API**: `GET /api/accounts/units-report?from&to` (`finance.reports.view`, scoped). The `unit` query
  parameter on `GET /api/transactions`, `/api/accounts/pl-report` and `/api/accounts/summary` takes a
  unit value or `UNASSIGNED`. `POST /api/transactions` requires `unit`; `PATCH /api/transactions/[id]`
  re-tags one.
