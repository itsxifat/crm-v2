// Shared mail constants — safe to import from both client and server code.

// Folder roles. Mapped from IMAP special-use flags (\Sent, \Junk, …) or common names.
export const FOLDER_ROLES = ['INBOX', 'SENT', 'DRAFTS', 'SPAM', 'TRASH', 'ARCHIVE', 'ALL', 'FLAGGED', 'CUSTOM']

// Roles never synced: they duplicate messages that already live in other folders (Gmail).
export const NON_SYNCED_ROLES = ['ALL', 'FLAGGED']

// Order of the standard folders in the mailbox sidebar (and sync priority).
export const STANDARD_FOLDERS = [
  { role: 'INBOX',   label: 'Inbox' },
  { role: 'SENT',    label: 'Sent' },
  { role: 'DRAFTS',  label: 'Drafts' },
  { role: 'ARCHIVE', label: 'Archive' },
  { role: 'SPAM',    label: 'Spam' },
  { role: 'TRASH',   label: 'Trash' },
]

// Virtual views computed from the local index (not IMAP folders).
export const MAIL_VIEWS = ['starred', 'unread', 'attachments', 'scheduled']

// Bulk actions accepted by PATCH /api/mail/messages.
export const MESSAGE_ACTIONS = [
  'read', 'unread', 'star', 'unstar',
  'archive', 'trash', 'spam', 'notSpam', 'restore',
  'move',    // requires folderId
  'delete',  // permanent (\Deleted + expunge)
]

export const SYNC_STATUSES = ['PENDING', 'SYNCING', 'OK', 'ERROR', 'PAUSED']

export const OUTBOX_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED']

export const MAIL_LIMITS = {
  attachmentBytes: 20 * 1024 * 1024,   // per file
  totalAttachmentBytes: 25 * 1024 * 1024,
  maxRecipients: 100,
  undoSendSeconds: 8,
  defaultInitialSync: 300,             // messages per folder on first sync
  pageSize: 50,
}

export const ACCOUNT_COLORS = ['#18181b', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777']

// Provider presets. `{domain}` is replaced with the part after "@" in the email.
// secure=true → TLS on connect (993/465); secure=false → STARTTLS (143/587).
export const MAIL_PROVIDERS = {
  mailcow: {
    label: 'Mailcow',
    imap: { host: 'mail.{domain}', port: 993, secure: true },
    smtp: { host: 'mail.{domain}', port: 465, secure: true },
    saveSentCopy: true,
  },
  cpanel: {
    label: 'cPanel / hosting',
    imap: { host: 'mail.{domain}', port: 993, secure: true },
    smtp: { host: 'mail.{domain}', port: 465, secure: true },
    saveSentCopy: true,
  },
  gmail: {
    label: 'Gmail / Google Workspace',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    saveSentCopy: false, // Gmail stores sent mail itself
  },
  outlook: {
    label: 'Outlook / Microsoft 365',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    saveSentCopy: false,
  },
  zoho: {
    label: 'Zoho Mail',
    imap: { host: 'imap.zoho.com', port: 993, secure: true },
    smtp: { host: 'smtp.zoho.com', port: 465, secure: true },
    saveSentCopy: true,
  },
  hostinger: {
    label: 'Hostinger',
    imap: { host: 'imap.hostinger.com', port: 993, secure: true },
    smtp: { host: 'smtp.hostinger.com', port: 465, secure: true },
    saveSentCopy: true,
  },
  custom: {
    label: 'Custom',
    imap: { host: '', port: 993, secure: true },
    smtp: { host: '', port: 465, secure: true },
    saveSentCopy: true,
  },
}

/** Resolve a provider preset for an email address → { imap, smtp, saveSentCopy }. */
export function providerPreset(provider, email = '') {
  const p = MAIL_PROVIDERS[provider] ?? MAIL_PROVIDERS.custom
  const domain = String(email).split('@')[1]?.trim().toLowerCase() || ''
  const fill = h => (domain ? h.replace('{domain}', domain) : h.replace('{domain}', ''))
  return {
    imap: { ...p.imap, host: fill(p.imap.host) },
    smtp: { ...p.smtp, host: fill(p.smtp.host) },
    saveSentCopy: p.saveSentCopy,
  }
}
