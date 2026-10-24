# Enfinito Pay & encloud

The CRM takes invoice payments online through **Enfinito Pay** and keeps **encloud** (Enfinito's
client-file drive) in step with clients, projects and unpaid invoices.

## What it does

- **Payment links.** On an issued invoice, *Online payment → Create payment link* gives a link
  (`/pay/<token>`) the client opens without signing in. It always charges what is still due, can be
  copied, emailed or sent on WhatsApp, and turned off. Signed-in clients get a *Pay online* button on
  the invoice in their portal.
- **Payments book themselves.** When Enfinito Pay confirms a payment, the CRM records it like a
  confirmed payment in Payment Confirmations: a `ProjectPayment` settled into the money account chosen
  for online payments, with the gateway's transaction id as the ledger Transaction ID. The invoice,
  project paid amount, ledger and VAT split come out exactly as for a bank receipt.
- **Folders.** Every active client gets `Clients/<name>` in encloud, and every project a folder inside
  it. Renames follow.
- **Files lock until paid.** An issued, unpaid taka invoice becomes a *due* in encloud: the client's
  shared links ask them to pay (through Enfinito Pay, on encloud) before the files open — the project's
  folder, or all of the client's folders for an invoice without a project. Paid, cancelled or unlocked
  → the files open.
- **Payments taken on encloud links** come back to the CRM (`due.paid`) and are booked the same way.
- **Files card** on the project page: folder stats, shared links, *Share with client*, and the client
  link shown in the client portal (`Project.driveLink`; any URL can be pasted for projects outside
  encloud).

## Setup

### 1. Server

| Variable | |
|---|---|
| `ENCRYPTION_MASTER_KEY` | Required to save the keys below (they are stored encrypted). |
| `NEXT_PUBLIC_APP_URL` | The CRM's public address; payment links and webhook addresses use it. |
| `INTEGRATIONS_WORKER` | `off` disables the built-in background worker (then call `POST /api/cron/integrations` with `x-cron-secret` every minute). |
| `ENFINITO_PAY_API_URL` | Development only: points at a stand-in instead of `https://pay.enfinito.com/api/v1`. |
| `ENFINITO_PAY_BOOK_TEST_PAYMENTS` | Development only: `1` books payments made with `sk_test_` keys. Otherwise they wait in Payment Confirmations, marked as tests. |

### 2. Money account

*Finance → Money accounts → Add*: e.g. "Enfinito Pay", type **Payment gateway**, BDT. Online payments
are booked there; move them to the bank with a transfer when Enfinito Pay settles.

### 3. Enfinito Pay (Configuration → Integrations)

In the Enfinito Pay admin, for the CRM's product:

1. Add the **return domain** shown in the CRM (the CRM's host).
2. Set the **webhook URL**: `https://<crm>/api/webhooks/enfinito-pay`.
3. Create a secret key and copy the webhook signing secret.

In the CRM: paste the secret key (`sk_live_…`) and the signing secret (`whsec_…`), choose the money
account, turn *Take payments online* on, and press *Test key*.

### 4. encloud (Configuration → Integrations)

In encloud, *Admin → CRM & API*:

1. **New API key** (read & write). Optionally limit it to the CRM server's address.
2. **Events to the CRM**: address `https://<crm>/api/webhooks/encloud`, then **Make secret**.
3. encloud's own *Admin → Payments* must have its Enfinito Pay keys for customers to pay on links.

In the CRM: encloud address (`https://enfinito.cloud`), the API key (`enc_…`), the events secret
(`whsec_…`), then *Test connection* and *Save*. *Sync everything now* creates the folders and dues for
existing clients, projects and invoices (the worker also does a full pass every hour).

Options: create folders automatically · lock files while an invoice is unpaid (from when it is sent, or
only once overdue) · book payments made on encloud links automatically (turn off while encloud uses a
test key).

## How the edge cases are handled

- **The browser coming back is never proof of payment.** Only the signed webhook, or the checkout
  retrieved from Enfinito Pay server to server, settles a payment. A lost webhook is caught when the
  customer returns, and by the worker every minute.
- **Paid twice** (payment link and encloud link, or two tabs): the second payment is not booked; it
  waits in Payment Confirmations and finance is notified to refund it.
- **No money account chosen, books locked, amount over the balance, test key**: the payment is
  recorded and waits in Payment Confirmations with the reason; finance is notified.
- **Refund at Enfinito Pay**: the payment is marked refunded and finance is notified to reverse it on
  the invoice (the CRM never reverses ledger entries on its own).
- **Changes made in encloud stand**: a due waived, cancelled or marked paid by encloud staff stops the
  CRM locking that invoice (shown on the invoice; *Lock until paid* turns it back on). A due reopened
  in encloud (after a refund there) is reported to finance. The CRM pushes again only when the invoice
  itself changes, or on *Sync*.
- Webhooks are verified (HMAC-SHA256 over the raw body, 5-minute window) and processed once per event
  id; a failure answers 500 so the sender retries.

## Permissions

| Action | Permission |
|---|---|
| Integration settings | Super admin |
| Create, send, turn off payment links | `sales.invoices.send` |
| Unlock / lock an invoice's files | `finance.payments.confirm` |
| Share project files, client link | `projects.update` |

## Code

`lib/enfinitoPay.js` (API client) · `lib/onlinePayments.js` (checkout, settlement, booking) ·
`lib/paymentLinks.js` · `lib/encloud/` (client, sync, events) · `lib/integrations/` (settings,
signatures, webhook inbox, worker) · models `OnlinePayment`, `PaymentLink`, `EncloudLink`,
`IntegrationEvent`.

## Trying it locally

encloud ships an Enfinito Pay stand-in. For the CRM:

```bash
MOCK_PAY_PORT=4398 MOCK_PAY_WHSEC=whsec_local MOCK_PAY_WEBHOOK=http://127.0.0.1:3000/api/webhooks/enfinito-pay \
  node ../encloud/server/scripts/mock-pay.mjs
ENFINITO_PAY_API_URL=http://127.0.0.1:4398/api/v1 ENFINITO_PAY_BOOK_TEST_PAYMENTS=1 npm run dev
```

Then use any `sk_test_…` key and `whsec_local` in Configuration → Integrations.
