// Shared message query bits (private folder — not a route).

// Everything toListItem() reads — html/text/flags/references stay in the database.
export const LIST_FIELDS = 'accountId folderId folderRole threadKey messageId from to cc subject snippet date receivedAt seen flagged answered draft hasAttachments attachments size priority'

export const LIST_PROJECTION = Object.fromEntries(LIST_FIELDS.split(' ').map(f => [f, 1]))

export const HIDDEN_ROLES = ['SPAM', 'TRASH']
