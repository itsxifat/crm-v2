export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailMessage } from '@/models'
import { requireMailUser } from '@/lib/mail/access'
import { renameFolder, deleteFolder } from '@/lib/mail/actions'
import { toFolderItem } from '@/lib/mail/serialize'
import { mailError, readJson, jsonError } from '../../_lib/http'
import { loadUsableFolder } from '../../_lib/guards'

// PATCH /api/mail/folders/[id] — { name } (custom folders only)
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    const body = await readJson(request)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return jsonError('Folder name is required', 422)
    if (name.length > 200) return jsonError('Folder name is too long', 422)

    await connectDB()
    const { folder, error } = await loadUsableFolder(session, params.id)
    if (error) return error
    if (folder.role !== 'CUSTOM') return jsonError('Only custom folders can be renamed', 422)

    const updated = (await renameFolder(session, String(folder._id), name)) || { ...folder, name }
    const unread = await MailMessage.countDocuments({ folderId: updated._id ?? folder._id, seen: false })
    return NextResponse.json({ data: toFolderItem(updated, unread) })
  } catch (err) {
    return mailError(err, '[PATCH /api/mail/folders/[id]]')
  }
}

// DELETE /api/mail/folders/[id] — custom folders only (server folder + its local messages)
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    await connectDB()
    const { folder, error } = await loadUsableFolder(session, params.id)
    if (error) return error
    if (folder.role !== 'CUSTOM') return jsonError('Only custom folders can be deleted', 422)

    await deleteFolder(session, String(folder._id))
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    return mailError(err, '[DELETE /api/mail/folders/[id]]')
  }
}
