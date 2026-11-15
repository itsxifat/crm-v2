# NCOM

NCOM (websites and online stores) sells its plans, add-ons and AI credit packs to its workspaces and takes the money
through Enfinito Pay. Every sale comes to the CRM by itself and counts under the **NCOM** product (`PRODUCT:NCOM`), in
the same books as everything else: *Accounts → Ventures & products* shows NCOM's income, expenses, profit and what is still
to be received. A shop's own orders from its shoppers are the shop's business and never come here.

It works exactly like Envo ([envo.md](envo.md)): the same calls, the same checks, the same settings. Only the names differ.

## What finance sees

| In NCOM | In the CRM |
|---|---|
| A workspace | A client (`ncomOwned`), created on its first invoice, with no CRM login until you give one. If the owner's **verified** NCOM login is the email of a CRM client with one company, the workspace is linked to that client instead, and its details are left alone. |
| An order waiting for payment (plan, add-ons, credit pack) | A **draft** with NCOM's number (`ENV2611N001`, NCOM's own series N). Not billed, no VAT, nothing in the books. |
| A cancelled order | The draft is **cancelled**. |
| A paid order | **Issued** on the day it was paid (Mushak-6.3, output VAT) and **paid**: income net of VAT, in the money account you chose. A coupon shows as the invoice's discount. |
| An order an NCOM admin marked as paid | Booked to the manual account for the way it was paid (bKash, Nagad, Rocket, bank, cash), else *Anything else*. |
| A gateway charge | An expense under NCOM, on the same money account (`NCOMF<payment>`). |
| A refund at the gateway | *Needs a check*: raise a credit note with a refund. |

Free orders (a 100% coupon, a free plan) move no money and never come here. NCOM's invoices cannot be edited, sent,
cancelled or paid by hand in the CRM; credit notes still work.

## Setting it up

1. *Finance → Money accounts*: an account for NCOM's online payments, unless Enfinito Pay's will do.
2. *Configuration → Integrations → NCOM*: **Make secret**, choose the accounts (at least *Anything else* for orders
   marked as paid by hand), decide VAT (*Plan and credit prices include VAT* is on by default), turn on **Connect NCOM**, **Save**.
3. On the NCOM server, set and restart:

```bash
CRM_BASE_URL=https://crm.enfinito.com   # this CRM's address
CRM_API_SECRET=whsec_…                  # the secret from step 2
CRM_SYNC_FROM=2026-11-15                # optional, a Dhaka day: orders created and paid before it stay out
```

Connect it here first: until the CRM has given its tax settings, NCOM takes no paid orders ("try again in a minute").
What needs a person, and what to do, is the same as for Envo (*Configuration → Integrations → NCOM → Status*).

## How it is kept apart from Envo

Both talk the same protocol (`lib/products/`), each with its own fields and records: `ncomId` on `Client`, `Invoice` and
`ProjectPayment` (unique), `ncomOwned` on `Client`, model `NcomSync`, settings `ncom`, ledger Transaction IDs
`NCOMP<payment>` (income) and `NCOMF<payment>` (gateway charge). Envo's invoice 7 and NCOM's invoice 7 are two invoices.
Calls come to `POST /api/webhooks/ncom`, signed with `Ncom-Signature` (`t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`).
Don't reuse NCOM's invoice, payment or workspace numbers after wiping its data while it is connected to the same CRM.
