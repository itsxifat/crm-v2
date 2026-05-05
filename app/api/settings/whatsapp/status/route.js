// This file is intentionally left as a 404 — the Enfinito Cloud API does not
// expose a /status or /qr endpoint. Instance management is done via the
// Enfinito Cloud dashboard at https://api.enfinito.cloud.
export async function GET() {
  return new Response('Not implemented', { status: 404 })
}
