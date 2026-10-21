// Runs once when the Next.js server starts. The mail worker needs Node APIs
// (sockets, TLS), so it is only loaded in the nodejs runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.MAIL_SYNC_WORKER !== 'off') {
    try {
      const { startMailWorker } = await import('./lib/mail/worker')
      startMailWorker()
    } catch (err) {
      console.error('[mail-worker] failed to start:', err?.message || err)
    }
  }
}
