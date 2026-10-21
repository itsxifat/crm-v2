// Server-only: mail account secrets and connection configs.
import nodemailer from 'nodemailer'
import { encrypt, decrypt } from '@/lib/encryption'
import { MailAccount } from '@/models'

const COLLECTION = 'mail_accounts'

export function encryptMailPassword(plain) {
  return encrypt(String(plain), COLLECTION, 'password')
}

export function decryptMailPassword(stored) {
  return decrypt(stored, COLLECTION, 'password')
}

/** Load an account (lean) including its decrypted password as `secret`. Null if missing. */
export async function loadAccountWithSecret(accountId) {
  const acc = await MailAccount.findById(accountId).select('+password').lean()
  if (!acc) return null
  const { password, ...rest } = acc
  return { ...rest, secret: decryptMailPassword(password) }
}

/**
 * ImapFlow constructor options for an account. `account` needs imap, username and
 * either `secret` (plaintext) or `password` (encrypted wire format).
 */
export function imapConfig(account, extra = {}) {
  const pass = account.secret ?? decryptMailPassword(account.password)
  return {
    host: account.imap.host,
    port: Number(account.imap.port) || 993,
    secure: account.imap.secure !== false,
    auth: { user: account.username || account.email, pass },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 5 * 60 * 1000,
    tls: { minVersion: 'TLSv1.2' },
    ...extra,
  }
}

/** Nodemailer SMTP transport for an account. */
export function smtpTransport(account, extra = {}) {
  const pass = account.secret ?? decryptMailPassword(account.password)
  const port = Number(account.smtp.port) || 465
  return nodemailer.createTransport({
    host: account.smtp.host,
    port,
    secure: account.smtp.secure ?? port === 465,
    requireTLS: account.smtp.secure === false, // STARTTLS must succeed on 587
    auth: { user: account.username || account.email, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
    ...extra,
  })
}

/** RFC 5322 From value: "Name" <email>. */
export function fromHeader(account) {
  const name = (account.fromName || account.name || '').replace(/"/g, '')
  return name ? { name, address: account.email } : account.email
}
