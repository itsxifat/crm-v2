export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { OrganizerTodo, OrganizerNote } from '@/models'
import { authorize, VIEW, handleError } from '@/lib/organizer/http'
import { parseSearch } from '@/lib/organizer/validation'
import { organizerScope, toObjectIds } from '@/lib/organizer/refs'

// GET /api/organizer/tags?organizerIds=&q= → distinct tags across to-dos and notes (sorted, ≤ 500)
export async function GET(request) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    await connectDB()

    const sp = new URL(request.url).searchParams
    const scope = await organizerScope(sp)
    if (scope && !scope.length) return NextResponse.json({ data: [] })
    const filter = scope ? { organizerId: { $in: toObjectIds(scope) } } : {}

    const [todoTags, noteTags] = await Promise.all([
      OrganizerTodo.distinct('tags', filter),
      OrganizerNote.distinct('tags', filter),
    ])
    const q = parseSearch(sp.get('q')).toLowerCase()
    const tags = [...new Set([...todoTags, ...noteTags])]
      .filter(t => typeof t === 'string' && t && (!q || t.includes(q)))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 500)

    return NextResponse.json({ data: tags })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/tags]')
  }
}
