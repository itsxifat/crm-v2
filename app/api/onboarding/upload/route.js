import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import connectDB from '@/lib/mongodb'
import { EmployeeOnboarding } from '@/models'

// POST /api/onboarding/upload?token=...
// Public endpoint — validates via onboarding token (no session required)
export async function POST(request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 })
    }

    await connectDB()
    const record = await EmployeeOnboarding.findOne({ token }).lean()
    if (!record) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    if (record.status !== 'PENDING_SUBMISSION')
      return NextResponse.json({ error: 'Onboarding link already used' }, { status: 409 })

    const formData = await request.formData()
    const file     = formData.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WebP or PDF allowed' }, { status: 422 })
    }

    const maxSize = 10 * 1024 * 1024 // 10 MB
    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 422 })
    }

    const ext      = file.name.split('.').pop().toLowerCase()
    const filename = `${randomUUID()}.${ext}`
    const dir      = path.join(process.cwd(), 'public', 'uploads', 'onboarding')

    await mkdir(dir, { recursive: true })

    const bytes  = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(path.join(dir, filename), buffer)

    return NextResponse.json({ url: `/uploads/onboarding/${filename}` }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/onboarding/upload]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
