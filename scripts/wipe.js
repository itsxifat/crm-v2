/**
 * Wipe all data from the database.
 * Run: node scripts/wipe.js
 * WARNING: This is irreversible. All records will be deleted.
 */

import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'
import readline from 'readline'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(root, '.env.local') })
dotenv.config({ path: path.join(root, '.env') })

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set.')
  process.exit(1)
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.question('Type "WIPE" to confirm deleting ALL data: ', async (answer) => {
  rl.close()
  if (answer.trim() !== 'WIPE') {
    console.log('Aborted.')
    process.exit(0)
  }

  await mongoose.connect(MONGODB_URI, { bufferCommands: false })
  const db = mongoose.connection.db
  const collections = await db.listCollections().toArray()

  if (collections.length === 0) {
    console.log('No collections found — already empty.')
  } else {
    for (const col of collections) {
      await db.collection(col.name).deleteMany({})
      console.log(`  ✓ Cleared: ${col.name}`)
    }
    console.log(`\nDone. ${collections.length} collection(s) wiped.`)
  }

  await mongoose.disconnect()
  process.exit(0)
})
