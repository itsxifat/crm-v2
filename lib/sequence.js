import mongoose from 'mongoose'

/**
 * Atomically allocate the next number in a named sequence (e.g. an invoice
 * number prefix for one month). Backed by a tiny `counters` collection:
 *   { _id: <key>, seq: <last issued number> }
 *
 * `floor` is the highest number already in use for this key (derived from the
 * existing documents by the caller). The counter never goes below it, so it
 * self-heals when records were created before the counter existed, and it never
 * goes backwards when records are deleted — unlike countDocuments() + 1, which
 * reissues an existing number after a delete and collides on the unique index.
 *
 * The single findOneAndUpdate (pipeline update + upsert) is atomic, so two
 * concurrent callers can never receive the same number.
 *
 * @param {string} key
 * @param {number} [floor=0]
 * @returns {Promise<number>} the allocated number (1-based)
 */
export async function nextSequence(key, floor = 0) {
  const safeFloor = Number.isFinite(Number(floor)) ? Math.max(0, Math.floor(Number(floor))) : 0
  const res = await mongoose.connection.db.collection('counters').findOneAndUpdate(
    { _id: key },
    [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, safeFloor] }, 1] } } }],
    { upsert: true, returnDocument: 'after' },
  )
  // Driver v6 returns the document; older drivers wrap it in { value }
  const doc = res?.seq !== undefined ? res : res?.value
  return doc.seq
}

/**
 * Give back `value` — a number nextSequence(key) just allocated — after the
 * record that took it was rolled back (deleted) before anyone could rely on it,
 * so a statutory series keeps no gap. Only rolls the counter back while `value`
 * is still the latest number issued for the key: once a later number is out,
 * `value` stays used (a gap, never a duplicate). Delete the record FIRST — the
 * caller's floor (highest number still in use) then lets nextSequence hand the
 * same number out again.
 *
 * @param {string} key
 * @param {number} value
 * @returns {Promise<boolean>} true when the number was given back
 */
export async function releaseSequence(key, value) {
  const n = Number(value)
  if (!key || !Number.isInteger(n) || n < 1) return false
  const res = await mongoose.connection.db.collection('counters').updateOne(
    { _id: key, seq: n },
    { $set: { seq: n - 1 } },
  )
  return res.modifiedCount === 1
}
