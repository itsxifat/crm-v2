export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import mongoose from 'mongoose'
import { requirePerm, canDo } from '@/lib/rbac'
import connectDB from '@/lib/mongodb'
import Lead from '@/models/Lead'
import { findAccessibleLead } from '@/lib/leadAccess'

// POST /api/leads/[id]/comments  — add a comment
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.leads.view')
    if (denied) return denied

    const { text } = await request.json()
    if (typeof text !== 'string' || !text.trim()) return NextResponse.json({ error: 'Comment text is required' }, { status: 422 })

    await connectDB()

    // EMPLOYEEs may only comment on leads assigned to them
    const existing = await findAccessibleLead(session, params.id, '_id assignedToId')
    if (!existing) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // `comments` is a Mixed array, so Mongoose won't add _id/createdAt —
    // set them explicitly so the comment can be displayed and deleted.
    const added = {
      id:         new mongoose.Types.ObjectId().toString(),
      text:       text.trim(),
      authorId:   session.user.id,
      authorName: session.user.name ?? session.user.email,
      createdAt:  new Date(),
    }

    const lead = await Lead.findByIdAndUpdate(params.id, { $push: { comments: added } }, { new: true })
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    return NextResponse.json({ data: added }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leads/[id]/comments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/leads/[id]/comments?commentId=xxx  — remove a comment
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.leads.view')
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const commentId = searchParams.get('commentId')
    if (!commentId || commentId === 'undefined') return NextResponse.json({ error: 'commentId required' }, { status: 422 })

    await connectDB()

    const lead = await findAccessibleLead(session, params.id, '_id assignedToId comments')
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // Comments are plain objects in a Mixed array; match by id (or legacy _id)
    const matches = (c) => c && (String(c.id ?? '') === commentId || String(c._id ?? '') === commentId)
    const comment = (Array.isArray(lead.comments) ? lead.comments : []).find(matches)
    if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

    // Only the author or someone who can edit leads (outside EMPLOYEE) can delete
    const isOwner = String(comment.authorId ?? '') === session.user.id
    const isAdmin = ['SUPER_ADMIN', 'MANAGER'].includes(session.user.role) && canDo(session, 'sales.leads.update')
    if (!isOwner && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const pullBy = comment.id != null ? { id: comment.id } : { _id: comment._id }
    await Lead.updateOne({ _id: lead._id }, { $pull: { comments: pullBy } })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/leads/[id]/comments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
