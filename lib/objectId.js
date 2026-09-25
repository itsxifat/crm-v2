import mongoose from 'mongoose'

/**
 * Strict ObjectId check for route params / body ids. Mongoose's isValid() alone
 * accepts any 12-character string, so also require the canonical 24-hex form.
 * Use to return 400/404 instead of letting a CastError surface as a 500.
 *
 *   import { isValidObjectId } from '@/lib/objectId'
 *   if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
 *
 * @param {any} id — string (or ObjectId, which is stringified)
 * @returns {boolean}
 */
export function isValidObjectId(id) {
  if (id === null || id === undefined) return false
  const s = typeof id === 'string' ? id : String(id)
  return /^[a-f\d]{24}$/i.test(s) && mongoose.Types.ObjectId.isValid(s)
}
