export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectDiscussion } from '@/models'

// Check if user is a member of the project (team member, PM, or admin/manager)
async function isMember(session, projectId) {
  if (['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) return true
  const project = await Project.findById(projectId).select('projectManagerId teamMembers').lean()
  if (!project) return false
  const uid = session.user.id
  return (
    project.projectManagerId?.toString() === uid ||
    project.teamMembers.some(m => m.toString() === uid)
  )
}

// GET /api/projects/:id/discussion  — all messages, oldest first
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const messages = await ProjectDiscussion.find({ projectId: params.id })
      .sort({ createdAt: 1 })
      .populate('userId', 'name avatar role')
      .lean()

    return NextResponse.json({
      data: messages.map(m => ({
        id:        m._id.toString(),
        content:   m.content,
        createdAt: m.createdAt,
        user: {
          id:     m.userId._id.toString(),
          name:   m.userId.name,
          avatar: m.userId.avatar ?? null,
          role:   m.userId.role,
        },
      })),
    })
  } catch (err) {
    console.error('[GET /api/projects/:id/discussion]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects/:id/discussion  — post a new message
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const allowed = await isMember(session, params.id)
    if (!allowed) return NextResponse.json({ error: 'Only project members can post in the discussion' }, { status: 403 })

    const { content } = await request.json()
    if (!content?.trim()) return NextResponse.json({ error: 'Message cannot be empty' }, { status: 422 })

    const msg = await ProjectDiscussion.create({
      projectId: params.id,
      userId:    session.user.id,
      content:   content.trim(),
    })

    await msg.populate('userId', 'name avatar role')

    return NextResponse.json({
      data: {
        id:        msg._id.toString(),
        content:   msg.content,
        createdAt: msg.createdAt,
        user: {
          id:     msg.userId._id.toString(),
          name:   msg.userId.name,
          avatar: msg.userId.avatar ?? null,
          role:   msg.userId.role,
        },
      },
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects/:id/discussion]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
