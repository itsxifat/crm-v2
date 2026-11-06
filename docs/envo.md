# Envo

Envo (the cloud PBX and Envo Phone) sells packages and recharges and takes the money. Everything it bills
comes to the CRM by itself and counts under the **Envo** product, in the same books as everything else:
*Accounts → Ventures & products* shows Envo's income, expenses, profit and what is still to be received.

## What finance sees

| In Envo | In the CRM |
|---|---|
| A customer account | A client (`envoOwned`), created on their first invoice, with no CRM login until you give one. If the owner's **verified** Envo login is the email of a CRM client with one company, they are linked to that client instead, and its details are left alone. The billing email on an Envo account proves nothing and never links anyone. |
| An unpaid invoice | A **draft** with Envo's number (`ENV2611E001`). Not billed, no VAT, nothing in the books. |
| A replaced or cancelled order | The draft is **cancelled**. |
| A paid invoice | **Issued** on the day it was paid (Mushak-6.3, output VAT) and **paid**, like any confirmed client payment: income net of VAT, in the money account you chose. |
| A gateway charge | An expense under Envo, on the same money account (`ENVOF<payment>`). |
| A refund at the gateway | *Needs a check*: raise a credit note with a refund. The CRM never moves the ledger by itself. Refunded before it was booked: the waiting payment is rejected, and a credit note clears the issued invoice. |

Envo's invoices cannot be edited, sent, cancelled or paid by hand here: Envo owns them, and the amounts must stay
what the customer saw. Credit notes still work, and that is how a refund is recorded.

## Controlled from here

*Configuration → Integrations → Envo*:

- **VAT and SD.** The company default from Tax & VAT → Settings, or a treatment of Envo's own, its rate, SD and service
  code. A change applies to invoices Envo raises from then on; one already raised keeps its VAT.
- **Whether package prices include VAT.** On (the default): customers pay the price on the pricing page and the VAT is
  inside it. A price with no exact split comes out a paisa or two under (BDT 1,000 at 15% is 869.56 + 130.43 = 999.99).
  Off: VAT is added on top at checkout.
- **Recharges and top-ups.** They go on a balance as they stand, so they carry no VAT, or VAT inside the amount (never on
  top: the customer would pay 115 and get 115 of credit for a recharge of 100). Off by default: ask your accountant.
- **Foreign customers.** Mark the client *Foreign* on their profile and Envo bills them at zero rate.
- **The online payment charge**: what the gateway reports, a fixed percentage, or none; and the categories.
- **Money accounts.** Online payments go to the account chosen here, else the one chosen for Enfinito Pay. Cash an Envo
  admin marks as paid goes to the account chosen per way of paying. No account: the payment waits, and finance is told.
- **Book test payments.** Payments made with an Enfinito Pay test key move no money and stay out of the books (not
  issued, no VAT). Turn this on only on a demo CRM.

Envo's other costs (the operator, hosting, salaries) are ordinary expenses: choose *Envo* as the venture or product when
recording them, and they appear in the same report.

## When something needs a person

*Configuration → Integrations → Envo → Status* lists what is held, with the reason, and finance gets one notification per
reason however many invoices it holds up. The money is safe and Envo keeps retrying every 15 minutes, so **fixing the cause
is enough**.

| Reason | What to do |
|---|---|
| No money account | Choose one in the settings. |
| Books or tax period locked | Unlock it, or confirm the payment dated in an open period in Payment Confirmations. |
| Paid twice | The customer paid more than the invoice. Refund them; the second payment is never booked. |
| Interrupted | A confirmation in Payment Confirmations died half way. Check the invoice and the ledger before confirming it again. |
| Refunded | Raise a credit note on the invoice: **Refund** when the payment is still booked, so the money and its VAT go back in the books. If you reversed the payment instead, the invoice shows as due with its VAT until a credit note clears it. |
| Test payment | Nothing to do: no money moved. |
| Refused | Envo sent figures the CRM's own calculation does not agree with, or tax settings it never gave out. Nothing was written. This means a bug: tell whoever maintains Envo. |

Envo compares every invoice with the CRM every 6 hours (number, status, total, VAT, SD, what was received and kept, the ledger
against the invoice, and the output VAT entry against the invoice), both ways, and pushes again what a push can fix. The result is at the bottom of the Status section, and in Envo
under Payment settings, where *Compare* runs it on demand.

## Setting it up

1. *Finance → Money accounts*: an account for Envo's online payments, unless Enfinito Pay's will do.
2. *Configuration → Integrations → Envo*: **Make secret**, choose the accounts, turn on **Connect Envo**, **Save**.
3. On the Envo server, set `CRM_BASE_URL` (this CRM's address) and `CRM_API_SECRET` (that secret), then restart it.
4. Going live on a CRM that has real books: also set `CRM_SYNC_FROM` (`YYYY-MM-DD`, a Dhaka day) on Envo, so that invoices
   created and paid before that day (test purchases, or income you already recorded by hand) stay out of them. One raised before
   and paid after goes in: the money belongs to the new books.

Moving Envo from one CRM to another (demo to live) is only changing those settings: it notices and sends everything again. **Connect
it in the new CRM first:** Envo bills nothing (checkouts answer "try again in a minute") until the new CRM has given its tax settings.

## How it stays right

- **Whole state, not events.** Envo pushes everything about an invoice whenever it changes (database triggers mark it, so no
  code path can forget) and the CRM makes itself match. A repeat, a timeout or a restart changes nothing.
- **Nothing can land twice.** `Client`, `Invoice` and `ProjectPayment` carry a unique `envoId`, and ledger rows a fixed
  Transaction ID (`ENVOP<payment>` income, `ENVOF<payment>` charge). The unique indexes hold even if the logic above them fails.
- **Nothing is taken on trust.** Every invoice is recalculated with `computeInvoiceTotals`, the same function as the invoice
  form. A figure that differs is refused, never corrected.
- **Customers never wait for the CRM.** Envo prices invoices with the last tax settings it was given, and pushes behind the
  customer's back in batches, so a peak or an outage here only makes the queue longer. Tested with 1,000 customers buying at
  once and both servers killed in the middle: every invoice and every taka matched.
- **A crash half way** leaves a state the next push recognises: an issued invoice with no VAT entry is repaired, and a payment
  claimed with no ledger row is released or finished according to whether `ENVOP<id>` exists. A person's confirmation interrupted the
  same way goes to finance, because its ledger row has a Transaction ID the CRM cannot predict.
- **What counts as agreeing** is one figure: `keptOnInvoice()`, what was settled less credit notes, withholding and refunds, must equal what
  Envo received, and nothing may be left due.

## Code

`lib/envo/sync.js` (one invoice, the batch) · `lib/envo/policy.js` (tax settings) · `lib/envo/reconcile.js` (comparison, status) ·
`app/api/webhooks/envo/route.js` (signed like Enfinito Pay's and encloud's webhooks: `Envo-Signature`) ·
settings in `lib/integrations/settings.js` · model `EnvoSync`.

| Call (`type`) | |
|---|---|
| `ping` | The connection works. |
| `policy` | Tax settings to bill with. |
| `invoices.sync` | `{ items: [...] }`, at most 100: make the CRM match these invoices. |
| `reconcile.page` | `{ fromId, toId, items }`: compare a range of invoices. |
| `reconcile.report` | Keep the result for the settings screen. |
