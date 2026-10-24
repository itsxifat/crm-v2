// Runs once when the Next.js server starts. The workers need Node APIs
// (sockets, TLS), so they are only loaded in the nodejs runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.MAIL_SYNC_WORKER !== 'off') {
    try {
      const { startMailWorker } = await import('./lib/mail/worker')
      startMailWorker()
    } catch (err) {
      console.error('[mail-worker] failed to start:', err?.message || err)
    }
  }
  // Enfinito Pay & encloud: retries, lost-webhook checks, encloud sync sweeps.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.INTEGRATIONS_WORKER !== 'off') {
    try {
      const { startIntegrationsWorker } = await import('./lib/integrations/worker')
      startIntegrationsWorker()
    } catch (err) {
      console.error('[integrations-worker] failed to start:', err?.message || err)
    }
  }
}
