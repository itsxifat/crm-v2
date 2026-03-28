import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task } from '@/models'

// PUT /api/projects/:id/tasks/:taskId
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const body = await request.json()
    const { title, description, status, priority, dueDate } = body

    if (!title?.trim()) return NextResponse.json({ error: 'Title required' }, { status: 422 })

    const task = await Task.findOneAndUpdate(
      { _id: params.taskId, projectId: params.id },
      {
        title:       title.trim(),
        description: description || null,
        status:      status      ?? 'TODO',
        priority:    priority    ?? 'MEDIUM',
        dueDate:     dueDate     ? new Date(dueDate) : null,
      },
      { new: true, runValidators: true }
    )
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ data: task.toJSON() })
  } catch (err) {
    console.error('[PUT task]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/projects/:id/tasks/:taskId
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const task = await Task.findOneAndDelete({ _id: params.taskId, projectId: params.id })
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE task]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
