import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable in .env')
}

// Cache connection across hot reloads in development
let cached = globalThis._mongoose ?? { conn: null, promise: null }
globalThis._mongoose = cached

export async function connectDB() {
  if (cached.conn) return cached.conn

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
    })
  }

  cached.conn = await cached.promise

  // Drop the old non-partial employeeId unique index if it still exists.
  // The new index uses partialFilterExpression so null/absent values are not indexed.
  try {
    const db = cached.conn.connection.db
    const indexes = await db.collection('employees').indexes()
    const old = indexes.find(
      ix => ix.name === 'employeeId_1' && !ix.partialFilterExpression
    )
    if (old) {
      await db.collection('employees').dropIndex('employeeId_1')
      console.log('[DB] Dropped legacy employeeId_1 index — will be recreated with partialFilterExpression')
    }
  } catch (e) {
    // Collection may not exist yet on first run; safe to ignore
  }

  return cached.conn
}

export default connectDB
