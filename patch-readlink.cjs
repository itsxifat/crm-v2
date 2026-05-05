/**
 * Windows EISDIR readlink fix
 *
 * On this system (E: drive, Node v24+), fs.readlink / fs.readlinkSync return
 * EISDIR instead of EINVAL when called on a regular (non-symlink) file.
 * Webpack and @vercel/nft treat EINVAL as "not a symlink" and continue safely,
 * but EISDIR causes a hard crash.  This shim normalises the error code.
 *
 * Loaded via NODE_OPTIONS="--require ./patch-readlink.cjs" in package.json.
 */
const fs = require('fs')

const origAsync = fs.readlink.bind(fs)
fs.readlink = function readlink(path, options, callback) {
  if (typeof options === 'function') { callback = options; options = {} }
  origAsync(path, options, function (err, linkString) {
    if (err && err.code === 'EISDIR') {
      const e = Object.assign(
        new Error(`EINVAL: invalid argument, readlink '${path}'`),
        { code: 'EINVAL', errno: -22, syscall: 'readlink', path }
      )
      return callback(e)
    }
    callback(err, linkString)
  })
}

const origSync = fs.readlinkSync.bind(fs)
fs.readlinkSync = function readlinkSync(path, options) {
  try {
    return origSync(path, options)
  } catch (e) {
    if (e.code === 'EISDIR') {
      throw Object.assign(
        new Error(`EINVAL: invalid argument, readlink '${path}'`),
        { code: 'EINVAL', errno: -22, syscall: 'readlink', path }
      )
    }
    throw e
  }
}

// Also patch the promises API (used by @vercel/nft during Next.js build tracing)
const origPromise = fs.promises.readlink.bind(fs.promises)
fs.promises.readlink = async function readlinkPromise(path, options) {
  try {
    return await origPromise(path, options)
  } catch (e) {
    if (e.code === 'EISDIR') {
      throw Object.assign(
        new Error(`EINVAL: invalid argument, readlink '${path}'`),
        { code: 'EINVAL', errno: -22, syscall: 'readlink', path }
      )
    }
    throw e
  }
}
