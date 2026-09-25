export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { saveUpload } from '@/lib/uploads'

// POST /api/upload  (multipart/form-data, field: "file")
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const formData = await request.formData()
    const file     = formData.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Type is decided from the file's magic bytes (never the client-declared
    // MIME type or file name), and the file is stored outside public/.
    const saved = await saveUpload(file, { bucket: 'receipts', maxSize: 5 * 1024 * 1024 })
    if (saved.error) return NextResponse.json({ error: saved.error }, { status: saved.status })

    return NextResponse.json({ url: saved.url }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/upload]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
