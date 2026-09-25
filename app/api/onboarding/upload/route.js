export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { EmployeeOnboarding } from '@/models'
import { saveUpload } from '@/lib/uploads'

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
    if (record.expiresAt && new Date(record.expiresAt) < new Date())
      return NextResponse.json({ error: 'Link has expired' }, { status: 410 })
    if (record.status !== 'PENDING_SUBMISSION')
      return NextResponse.json({ error: 'Onboarding link already used' }, { status: 409 })

    const formData = await request.formData()
    const file     = formData.get('file')

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Type is decided from the file's magic bytes (never the client-declared
    // MIME type or file name), and the file is stored outside public/.
    const saved = await saveUpload(file, { bucket: 'onboarding', maxSize: 10 * 1024 * 1024 })
    if (saved.error) return NextResponse.json({ error: saved.error }, { status: saved.status })

    return NextResponse.json({ url: saved.url }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/onboarding/upload]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
