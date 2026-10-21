// Access-checked loaders for message / folder routes (private folder — not a route).
import { MailMessage, MailFolder } from '@/models'
import { getUsableAccount } from '@/lib/mail/access'
import { isValidObjectId, jsonError } from './http'

/** → { message, account } or { error: NextResponse }. 404 for missing and inaccessible alike. */
export async function loadUsableMessage(session, id, select = 'accountId folderId folderRole seen threadKey') {
  if (!isValidObjectId(id)) return { error: jsonError('Message not found', 404) }
  const message = await MailMessage.findById(id).select(`accountId ${select}`).lean()
  if (!message) return { error: jsonError('Message not found', 404) }
  const { account, error } = await getUsableAccount(session, message.accountId)
  if (error) return { error: jsonError('Message not found', 404) }
  return { message, account }
}

/** → { folder, account } or { error: NextResponse }. */
export async function loadUsableFolder(session, id) {
  if (!isValidObjectId(id)) return { error: jsonError('Folder not found', 404) }
  const folder = await MailFolder.findById(id).lean()
  if (!folder) return { error: jsonError('Folder not found', 404) }
  const { account, error } = await getUsableAccount(session, folder.accountId)
  if (error) return { error: jsonError('Folder not found', 404) }
  return { folder, account }
}
