# Calling through Envo

Staff call clients and leads from the CRM, and take calls in it, through Envo (the office's PBX). The CRM is a
customer of Envo here, like any business using its API; Envo's billing reaching the CRM is a separate integration
([envo.md](envo.md)).

## What staff get

Everyone with an extension (below) has a phone button in the top bar, next to notifications.

| | |
|---|---|
| **Dialpad** | Type a number or a name: clients, leads and colleagues come up with their numbers, one click calls. *Recent* lists this browser's calls. *Use my desk phone instead* has Envo ring the person's phones first and dial once they pick up. |
| **Call buttons** | Next to the phones on a client's page (main, company, alternate), a lead's page and the leads list. They name the record, not the number, so they also work where the number is shown masked. |
| **Incoming calls** | Ring in the CRM, with the caller's details beside Answer: the client (VIP, unpaid and overdue invoices, revenue, active projects, notes), or the lead (status, value, follow-up, latest activity), or the colleague, and the last calls with that number in Envo. An unknown number offers *Add as lead* with the number filled in. |
| **During a call** | Mute, hold, keypad (DTMF), transfer to a colleague or a number, hang up. The window minimises to a pill; the call carries on across pages, and over open forms. |

The phone lives in one of the person's CRM tabs; the others show the same call and work as remote controls, so
answering in the tab you are looking at answers it. The ringtone plays in the tab in view (with no CRM tab in view: a
desktop notification and the tab title). Closing the phone's tab hands the phone to another open tab. Closing them all
takes the person off the phone: calls then ring their other devices on the extension, or go where Envo sends them.

**What the panel shows follows permissions**, as the client and lead pages do: clients need *View Customers*, money
also *View Invoices*, leads *View Leads* (an employee only sees leads assigned to them), and phones and emails are
masked without *View Email & Phone*. A masked number is still dialled; the browser has it, it is only not shown. Every
call placed from a call button is in the activity log (action `CALL`).

## Setting it up

**In Envo**, on the SIP server the office's extensions are on:

1. *Integrations → API keys → New key* with **Read**, **Calls** and **Web phone**. Allowed origins can stay empty: the
   CRM talks to Envo from its server. The package must include API access (Enfinito's own account always does).
2. On each extension that will be used from the CRM: turn on the **web phone**.

**In the CRM**, *Configuration → Calling* (Super Admin):

1. Envo's address (`https://envo.enfinito.cloud`) and the API key, **Test key**, turn on **Phone in the CRM**, **Save**.
2. *Who calls from which extension*: pick each person's extension (Envo's list shows who is online and which web
   phones are off), **Save extensions**. People see the phone the next time they open the CRM. An extension can be
   shared (a reception line), and every sharer's CRM rings.

**On the CRM server**: the browser opens the phone's SIP WebSocket straight to Envo, which the page's security policy
must allow. The default is `wss://call.enfinito.cloud` (Envo's SIP domain, DNS-only because SIP cannot pass
Cloudflare). Another Envo needs `ENVO_PHONE_WS=wss://<its SIP domain>` in the environment and a restart (no rebuild).
The page also allows the microphone for itself (`Permissions-Policy: microphone=(self)`).

Calls work best in Chrome or Edge. The browser asks for the microphone once (the dialpad has an *Allow* button for it).

## How it works

- **The API key stays on the server.** The CRM mints a 60-second web phone token for the person's own extension
  (`POST /api/v1/webphone/token`) and exchanges it at Envo (`/api/embed/session`) for the extension's web phone
  credentials, kept 10 minutes in memory so tab hand-overs don't spend Envo's 120 requests/minute.
- **One registration per person.** Tabs elect the phone's tab with a Web Lock (`crm-phone:<userId>`) and share its
  state over a BroadcastChannel of the same name. Envo rings every web phone registered on an extension, so this keeps
  one ring per browser. Browsers without Web Locks (older Safari) run a phone in every tab.
- **Offline is not silent.** If the browser phone cannot reach Envo (blocked network, Envo down), calling falls back to
  *ring my phone* (`POST /api/v1/calls`), and the dialpad says why it is offline with a retry.
- **Who is calling** is matched on the last ten digits, so `+880 1712-345678`, `8801712345678` and `01712345678` are the
  same number; numbers shorter than seven digits are extensions (colleagues). Searched: clients' company and alternate
  phones, their main contact's and members' login phones, leads' phones, staff phones.
- **Recent calls** in the panel come from Envo's call records (`GET /api/v1/calls`), anyone's on the SIP server.

## Not done yet

- Calls are not written into the CRM's own records (a call log per client, notes per call, recordings). Envo keeps
  them; its call webhooks (`call.started` / `answered` / `ended`, signed `X-Envo-Signature`) are the way in.
- One call at a time per person: a second caller gets busy and Envo's routing takes over (voicemail, next in group).
- No choice of microphone or speaker yet (the system default is used).

## When something goes wrong

| Seen | Cause |
|---|---|
| No phone button | Calling is off, or the person has no extension (*Configuration → Calling*). |
| *Offline* with "security policy does not allow" | Envo's SIP domain is not in `ENVO_PHONE_WS`. |
| *Offline*, "Envo refused the API key" / "missing the webphone scope" | Make a key with Read, Calls and Web phone. |
| *Offline*, "does not have the web phone enabled" | Turn the extension's web phone on in Envo. |
| *Offline*, connection lost | Port 443 to Envo's SIP domain is blocked, or Envo is down; calls ring the desk phone meanwhile. |
| Rings, but no audio | The network blocks WebRTC media (UDP 10000–20000 to Envo). |
| Microphone blocked | Allow it from the icon at the left of the address bar, then reload. |

`localStorage['crm-phone-debug'] = '1'` and a reload log the phone and JsSIP's SIP traffic in the browser console.

## Code

`lib/telephony/`: `envo.js` (Envo's API), `access.js` (who has a phone), `lookup.js` (caller panel, dialpad search, the
number behind a call button), `numbers.js` (matching and dialling), `csp.js` (`ENVO_PHONE_WS`), `route.js` ·
`app/api/telephony/*` (`me`, `session`, `lookup`, `search`, `resolve`, `originate`, `history`) ·
`app/api/settings/telephony` · settings in `lib/integrations/settings.js` (`envo_phone`) ·
`components/telephony/`: `engine.js` (JsSIP, tabs), `PhoneProvider.jsx` (`usePhone()`), `Softphone.jsx`,
`CallerDetails.jsx`, `CallButton.jsx`, `PhoneButton.jsx` · `components/admin/telephony/TelephonySettings.jsx`.

Tested against Asterisk 23 in Docker as a stand-in for Envo's web endpoints (`webrtc=yes`, five contacts,
`PJSIP_DIAL_CONTACTS`) and a stand-in for Envo's API, in headless Chrome with a fake microphone: registration, one
registration across tabs, incoming calls with the panel, answering from another tab with audio both ways, outgoing
calls, call buttons, ring-my-phone and the hand-over when the phone's tab closes.
