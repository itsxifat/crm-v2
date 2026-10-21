'use client'

// Thin client for /api/mail. Every call resolves to the `{ data, meta }`
// envelope's pieces and throws an Error carrying the API's `{ error }` message.

export async function mailFetch(url, { method = 'GET', body, signal } = {}) {
  const res = await fetch(url, {
    method,
    signal,
    cache: 'no-store',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch {}
  if (!res.ok) {
    const err = new Error(json?.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return json ?? {}
}

function qs(params) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '' || v === false) continue
    sp.set(k, v === true ? '1' : String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const enc = encodeURIComponent

export const mailApi = {
  accounts: () => mailFetch('/api/mail/accounts').then(j => j.data ?? []),

  folders: (accountId = 'all') => mailFetch(`/api/mail/folders${qs({ accountId })}`).then(j => j.data ?? []),
  createFolder: (body) => mailFetch('/api/mail/folders', { method: 'POST', body }).then(j => j.data),
  renameFolder: (id, name) => mailFetch(`/api/mail/folders/${enc(id)}`, { method: 'PATCH', body: { name } }).then(j => j.data),
  deleteFolder: (id) => mailFetch(`/api/mail/folders/${enc(id)}`, { method: 'DELETE' }).then(j => j.data),
  loadOlder: (id) => mailFetch(`/api/mail/folders/${enc(id)}/load-older`, { method: 'POST' }).then(j => j.data ?? {}),

  /** → { data: listItem[], meta: { total, nextCursor, hasMoreRemote } } */
  messages: (params, signal) => mailFetch(`/api/mail/messages${qs(params)}`, { signal })
    .then(j => ({ data: j.data ?? [], meta: j.meta ?? {} })),
  message: (id, { images, peek } = {}, signal) => mailFetch(`/api/mail/messages/${enc(id)}${qs({ images, peek })}`, { signal })
    .then(j => j.data),
  act: (ids, action, folderId) => mailFetch('/api/mail/messages', { method: 'PATCH', body: { ids, action, ...(folderId ? { folderId } : {}) } })
    .then(j => j.data ?? { updated: 0, failed: [] }),

  syncAccount: (id) => mailFetch(`/api/mail/accounts/${enc(id)}/sync`, { method: 'POST' }).then(j => j.data ?? {}),
  updates: (since, signal) => mailFetch(`/api/mail/updates${qs({ since })}`, { signal }).then(j => j.data ?? {}),

  outbox: (accountId) => mailFetch(`/api/mail/outbox${qs({ accountId })}`).then(j => j.data ?? []),
  cancelOutbox: (id) => mailFetch(`/api/mail/outbox/${enc(id)}`, { method: 'DELETE' }).then(j => j.data ?? {}),
  sendNow: (id) => mailFetch(`/api/mail/outbox/${enc(id)}/send-now`, { method: 'POST' }).then(j => j.data ?? {}),

  deleteDraft: (id) => mailFetch(`/api/mail/drafts/${enc(id)}`, { method: 'DELETE' }).then(j => j.data),

  rawUrl: (id, view = false) => `/api/mail/messages/${enc(id)}/raw${view ? '?view=1' : ''}`,
}
