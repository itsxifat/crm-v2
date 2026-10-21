// Server-only: shape MailAccount / MailFolder / MailMessage / MailOutbox rows for the API.
// Never emits passwords or raw (unsanitised) HTML.

function idOf(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') return v
  if (v._id) return String(v._id)
  if (typeof v.id === 'string') return v.id   // already-serialised row
  return String(v)
}

function iso(d) {
  if (!d) return null
  const t = d instanceof Date ? d : new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

function addr(a) {
  return { name: a?.name || '', address: a?.address || '' }
}

function addrList(list) {
  return Array.isArray(list) ? list.filter(a => a?.address || a?.name).map(addr) : []
}

/** Plain-text preview of composer HTML (outbox rows have no stored snippet). */
export function previewText(html, max = 200) {
  return String(html || '')
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|blockquote)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function userItem(u) {
  if (!u) return null
  if (!u.name && !u.email) return { id: idOf(u), name: '', email: '', avatar: null, role: null }
  return { id: idOf(u), name: u.name || '', email: u.email || '', avatar: u.avatar || null, role: u.role || null }
}

export function toAccountItem(acc, { unread = 0, manage = false } = {}) {
  const sync = acc.sync || {}
  const item = {
    id: idOf(acc),
    name: acc.name || '',
    email: acc.email || '',
    fromName: acc.fromName || '',
    color: acc.color || '#18181b',
    provider: acc.provider || 'custom',
    signature: acc.signature || '',
    isActive: acc.isActive !== false,
    syncEnabled: acc.syncEnabled !== false,
    sync: {
      status: sync.status || 'PENDING',
      lastSyncAt: iso(sync.lastSyncAt),
      lastError: sync.lastError || null,
      idle: !!sync.idle,
      messageCount: Number(sync.messageCount) || 0,
    },
    unread: Number(unread) || 0,
  }
  if (manage) {
    Object.assign(item, {
      username: acc.username || '',
      imap: { host: acc.imap?.host || '', port: Number(acc.imap?.port) || 993, secure: acc.imap?.secure !== false },
      smtp: { host: acc.smtp?.host || '', port: Number(acc.smtp?.port) || 465, secure: acc.smtp?.secure !== false },
      options: {
        saveSentCopy: acc.options?.saveSentCopy !== false,
        realtime: acc.options?.realtime !== false,
        initialSyncLimit: Number(acc.options?.initialSyncLimit) || 300,
      },
      assignedUsers: (acc.assignedUsers || []).map(userItem).filter(Boolean),
      hasPassword: true,
      createdAt: iso(acc.createdAt),
    })
  }
  return item
}

export function toFolderItem(f, unreadOverride) {
  const delimiter = f.delimiter || '/'
  const segments = String(f.path || '').split(delimiter).filter(Boolean)
  return {
    id: idOf(f),
    accountId: idOf(f.accountId),
    path: f.path,
    name: f.name,
    parentPath: f.parentPath ?? null,
    delimiter,
    role: f.role || 'CUSTOM',
    unread: Number(unreadOverride ?? f.unread) || 0,
    total: Number(f.total) || 0,
    depth: Math.max(0, segments.length - 1),
    noSelect: !!f.noSelect,
  }
}

export function toListItem(m) {
  const item = {
    id: idOf(m),
    accountId: idOf(m.accountId),
    folderId: idOf(m.folderId),
    folderRole: m.folderRole || 'CUSTOM',
    threadKey: m.threadKey ?? null,
    from: addr(m.from),
    to: addrList(m.to),
    cc: addrList(m.cc),
    subject: m.subject || '',
    snippet: m.snippet || '',
    date: iso(m.date || m.receivedAt),
    seen: !!m.seen,
    flagged: !!m.flagged,
    answered: !!m.answered,
    draft: !!m.draft,
    hasAttachments: !!m.hasAttachments,
    attachments: (m.attachments || [])
      .filter(a => !a.inline)
      .map(a => ({ idx: a.idx, filename: a.filename || 'attachment', contentType: a.contentType || 'application/octet-stream', size: Number(a.size) || 0 })),
    size: Number(m.size) || 0,
    priority: m.priority || 'normal',
  }
  // Conversation mode (threads=1) only
  if (m.threadCount !== undefined) {
    item.threadCount = Number(m.threadCount) || 1
    item.threadUnread = Number(m.threadUnread) || 0
  }
  return item
}

export function toFullMessage(m, { html = '', remoteBlocked = false, thread = [], crm = null } = {}) {
  const id = idOf(m)
  return {
    ...toListItem(m),
    bcc: addrList(m.bcc),
    replyTo: addrList(m.replyTo),
    messageId: m.messageId ?? null,
    inReplyTo: m.inReplyTo ?? null,
    references: Array.isArray(m.references) ? m.references : [],
    html: html || '',
    text: m.text || '',
    remoteBlocked: !!remoteBlocked,
    listUnsubscribe: m.listUnsubscribe || null,
    attachments: (m.attachments || []).map(a => ({
      idx: a.idx,
      filename: a.filename || 'attachment',
      contentType: a.contentType || 'application/octet-stream',
      size: Number(a.size) || 0,
      inline: !!a.inline,
      cid: a.cid || null,
      url: `/api/mail/messages/${id}/attachments/${a.idx}`,
    })),
    thread: thread.map(t => (t && t.id && !t._id ? t : toListItem(t))),
    crm: crm || null,
  }
}

export function toOutboxItem(o) {
  const p = o.payload || {}
  return {
    id: idOf(o),
    accountId: idOf(o.accountId),
    sendAt: iso(o.sendAt),
    status: o.status,
    scheduled: !!o.scheduled,
    to: addrList(p.to),
    subject: p.subject || '',
    snippet: p.text ? String(p.text).replace(/\s+/g, ' ').trim().slice(0, 200) : previewText(p.html),
    attempts: Number(o.attempts) || 0,
    lastError: o.lastError || null,
  }
}
