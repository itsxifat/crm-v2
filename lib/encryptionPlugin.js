/**
 * lib/encryptionPlugin.js
 *
 * Mongoose plugin — transparent multi-layer encryption on every designated field.
 * Works for both hydrated Mongoose documents and lean plain objects.
 *
 * Usage:
 *   schema.plugin(encryptionPlugin, {
 *     collection: 'users',
 *     fields: [
 *       { path: 'phone' },                         // String (default)
 *       { path: 'salary',            type: 'number'  },
 *       { path: 'dateOfBirth',       type: 'date'    },
 *       { path: 'emergencyContacts', type: 'array'   },
 *       { path: 'meta',              type: 'object'  },
 *       { path: 'kyc.documentNumber' },             // nested dot-path
 *     ],
 *     blindIndexes: [
 *       { path: 'email', indexField: 'emailIdx' },  // searchable blind HMAC token
 *     ],
 *   })
 */

import { encrypt, decrypt, blindIndex as makeBlindIndex } from './encryption.js'

// ── dot-path helpers ──────────────────────────────────────────────────────────

function get(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined
  return path.split('.').reduce((cur, key) => cur?.[key], obj)
}

function set(obj, path, value) {
  if (!obj || typeof obj !== 'object') return
  const keys   = path.split('.')
  const last   = keys.pop()
  const parent = keys.reduce((cur, key) => {
    if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = {}
    return cur[key]
  }, obj)
  parent[last] = value
}

// ── plugin ────────────────────────────────────────────────────────────────────

export function encryptionPlugin(schema, opts = {}) {
  const { collection, fields = [], blindIndexes = [] } = opts
  if (!collection) throw new Error('[encryptionPlugin] `collection` option is required')
  if (!fields.length && !blindIndexes.length) return

  // ── Encrypt one document ────────────────────────────────────────────────
  // doc is always a Mongoose Document inside pre('save'), so we use the
  // Mongoose doc.set(path, value) API instead of raw property assignment.
  // This ensures Mixed fields are marked modified and type-casting runs.
  function encryptDoc(doc) {
    // Capture plaintext values for blind index BEFORE encrypting fields
    const originals = {}
    for (const { path } of blindIndexes) {
      originals[path] = get(doc, path)
    }

    for (const { path } of fields) {
      const value = get(doc, path)
      if (value !== null && value !== undefined) {
        const encrypted = encrypt(value, collection, path)
        doc.set(path, encrypted)
        // markModified is required for Mixed-type fields so Mongoose
        // includes the new value in the $set operation.
        doc.markModified(path)
      }
    }

    for (const { path, indexField } of blindIndexes) {
      const original = originals[path]
      if (original !== null && original !== undefined) {
        doc.set(indexField, makeBlindIndex(original, collection, path))
      }
    }
  }

  // ── Decrypt one document ────────────────────────────────────────────────
  function decryptDoc(doc) {
    if (!doc || typeof doc !== 'object') return
    for (const { path, type = 'string' } of fields) {
      try {
        const value = get(doc, path)
        if (value !== null && value !== undefined) {
          set(doc, path, decrypt(value, collection, path, type))
        }
      } catch (err) {
        console.error(`[encryptionPlugin] decryptDoc failed for ${collection}.${path}:`, err.message)
      }
    }
  }

  // ── Encrypt update operators ($set / $setOnInsert / direct) ────────────
  function encryptUpdateOp(opObj) {
    if (!opObj || typeof opObj !== 'object') return

    const originals = {}
    for (const { path } of blindIndexes) {
      if (opObj[path] !== undefined) originals[path] = opObj[path]
    }

    for (const { path } of fields) {
      if (opObj[path] !== undefined) {
        opObj[path] = encrypt(opObj[path], collection, path)
      }
    }

    for (const { path, indexField } of blindIndexes) {
      if (originals[path] !== undefined) {
        opObj[indexField] = makeBlindIndex(originals[path], collection, path)
      }
    }
  }

  function encryptUpdate(update) {
    encryptUpdateOp(update.$set)
    encryptUpdateOp(update.$setOnInsert)
    // Direct-style update (no operators)
    if (!Object.keys(update).some(k => k.startsWith('$'))) {
      encryptUpdateOp(update)
    }
  }

  // ── Hooks ───────────────────────────────────────────────────────────────

  schema.pre('save', function () { encryptDoc(this) })
  schema.post('save', function (doc) { decryptDoc(doc) })

  schema.post('find',            function (docs) { if (Array.isArray(docs)) docs.forEach(decryptDoc) })
  schema.post('findOne',         function (doc)  { decryptDoc(doc) })
  schema.post('findOneAndUpdate',function (doc)  { decryptDoc(doc) })

  schema.pre('findOneAndUpdate',            function () { const u = this.getUpdate(); if (u) encryptUpdate(u) })
  schema.pre(['updateOne','updateMany'],     function () { const u = this.getUpdate(); if (u) encryptUpdate(u) })
}
