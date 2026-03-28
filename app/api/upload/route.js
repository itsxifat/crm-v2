import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'

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

    const allowedTypes = ['image/jpeg','image/png','image/webp','application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WebP or PDF allowed' }, { status: 422 })
    }

    const maxSize = 5 * 1024 * 1024 // 5 MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File too large (max 5 MB)' }, { status: 422 })
    }

    const ext      = file.name.split('.').pop().toLowerCase()
    const filename = `${randomUUID()}.${ext}`
    const dir      = path.join(process.cwd(), 'public', 'uploads', 'receipts')

    await mkdir(dir, { recursive: true })

    const bytes  = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(path.join(dir, filename), buffer)

    return NextResponse.json({ url: `/uploads/receipts/${filename}` }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/upload]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
