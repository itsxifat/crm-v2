import { getToken } from 'next-auth/jwt'
import { NextResponse } from 'next/server'

// ── Security headers applied to EVERY response ────────────────────────────────
const SECURITY_HEADERS = {
  // Block embedding in iframes (clickjacking)
  'X-Frame-Options': 'DENY',
  // Prevent MIME-type sniffing
  'X-Content-Type-Options': 'nosniff',
  // Stop browser from sending Referer header to other origins
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Disable access to sensitive browser APIs from this origin's scripts
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  // XSS protection for older browsers
  'X-XSS-Protection': '1; mode=block',
  // Enable HSTS — only served over HTTPS; 1 year; include subdomains
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  // Content Security Policy — restrict where resources can load from
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js needs unsafe-inline/eval in dev
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join('; '),
  // Prevent browsers from caching sensitive API responses
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
}

// ── Bot / crawler / scraper user-agent blocklist ──────────────────────────────
const BOT_UA_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /scrape/i, /slurp/i, /wget/i, /curl/i,
  /python-requests/i, /python-urllib/i, /go-http-client/i, /java\//i,
  /axios/i, /libwww/i, /lwp-/i, /jakarta/i, /httrack/i, /harvest/i,
  /nutch/i, /archiver/i, /extract/i, /scan/i, /grabber/i, /fetch/i,
  /scrapy/i, /mechanize/i, /headless/i, /phantomjs/i, /selenium/i,
  /puppeteer/i, /playwright/i, /webdriver/i, /htmlunit/i,
]

function isBotUserAgent(ua) {
  if (!ua) return true  // no UA = automated
  return BOT_UA_PATTERNS.some(p => p.test(ua))
}

// ── In-process rate limiter (per IP, resets per window) ───────────────────────
// Works for single-server / PM2 deployments.
// For multi-instance / serverless, replace with Redis-backed limiter.
const _rateStore = new Map()
const API_RATE_LIMIT   = 120  // requests per window
const API_RATE_WINDOW  = 60 * 1000  // 1-minute window
const AUTH_RATE_LIMIT  = 10   // stricter for auth endpoints
const AUTH_RATE_WINDOW = 15 * 60 * 1000  // 15 minutes

function checkRate(key, limit, window) {
  const now   = Date.now()
  const entry = _rateStore.get(key) ?? { count: 0, since: now }
  if (now - entry.since > window) { entry.count = 0; entry.since = now }
  entry.count++
  _rateStore.set(key, entry)

  const remaining = Math.max(0, limit - entry.count)
  const reset     = Math.ceil((entry.since + window - now) / 1000)
  return { allowed: entry.count <= limit, remaining, reset }
}

// Periodically evict stale entries to prevent memory growth
setInterval(() => {
  const cutoff = Date.now() - AUTH_RATE_WINDOW
  for (const [key, val] of _rateStore) {
    if (val.since < cutoff) _rateStore.delete(key)
  }
}, 5 * 60 * 1000)

// ── Helpers ────────────────────────────────────────────────────────────────────
function getIP(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    '0.0.0.0'
  )
}

function addSecurityHeaders(response) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  // Never reveal server tech stack
  response.headers.delete('x-powered-by')
  response.headers.delete('server')
  return response
}

function blockedResponse(message, status = 403) {
  const res = NextResponse.json({ error: message }, { status })
  addSecurityHeaders(res)
  return res
}

// ── Route definitions ─────────────────────────────────────────────────────────
const ROLE_ROUTES = {
  SUPER_ADMIN: ['/admin'],
  MANAGER:     ['/admin'],
  EMPLOYEE:    ['/admin'],
  FREELANCER:  ['/freelancer'],
  CLIENT:      ['/client'],
  VENDOR:      ['/vendor'],
}

const ROLE_DASHBOARDS = {
  SUPER_ADMIN: '/admin',
  MANAGER:     '/admin',
  EMPLOYEE:    '/admin',
  FREELANCER:  '/freelancer',
  CLIENT:      '/client',
  VENDOR:      '/vendor',
}

function hasAccess(role, pathname) {
  return (ROLE_ROUTES[role] || []).some(r => pathname.startsWith(r))
}

// ── Main middleware ───────────────────────────────────────────────────────────
export default async function middleware(req) {
    const { pathname } = req.nextUrl
    const token        = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    const ip           = getIP(req)
    const ua           = req.headers.get('user-agent') || ''

    // ── 1. Block bots and headless browsers on ALL routes ──────────────────
    if (isBotUserAgent(ua)) {
      return blockedResponse('Automated access is not permitted.', 403)
    }

    // ── 2. API route security ───────────────────────────────────────────────
    if (pathname.startsWith('/api/')) {
      // CORS — only same-origin requests accepted on API routes
      const origin = req.headers.get('origin')
      const host   = req.headers.get('host')
      if (origin) {
        try {
          const originHost = new URL(origin).host
          if (originHost !== host) {
            return blockedResponse('Cross-origin requests are not permitted.', 403)
          }
        } catch {
          return blockedResponse('Invalid origin.', 403)
        }
      }

      // Rate limit — stricter for auth endpoints
      const isAuthEndpoint = pathname.startsWith('/api/auth')
      const rlKey     = isAuthEndpoint ? `auth:${ip}` : `api:${ip}`
      const rlLimit   = isAuthEndpoint ? AUTH_RATE_LIMIT  : API_RATE_LIMIT
      const rlWindow  = isAuthEndpoint ? AUTH_RATE_WINDOW : API_RATE_WINDOW
      const rl        = checkRate(rlKey, rlLimit, rlWindow)

      if (!rl.allowed) {
        const res = blockedResponse('Too many requests. Please slow down.', 429)
        res.headers.set('Retry-After',        String(rl.reset))
        res.headers.set('X-RateLimit-Limit',  String(rlLimit))
        res.headers.set('X-RateLimit-Remaining', '0')
        res.headers.set('X-RateLimit-Reset',  String(rl.reset))
        return res
      }
    }

    // ── 3a. Public API routes (no auth, no redirect) ─────────────────────────
    const publicApiRoutes = ['/api/gain', '/api/auth/']
    if (publicApiRoutes.some(r => pathname.startsWith(r))) {
      return addSecurityHeaders(NextResponse.next())
    }

    // ── 3b. Public page routes ───────────────────────────────────────────────
    const publicRoutes = ['/login', '/register', '/forgot-password', '/reset-password', '/freelancer/invite']
    if (publicRoutes.some(r => pathname.startsWith(r))) {
      if (token) {
        const dashboard = ROLE_DASHBOARDS[token.role] || '/admin'
        return addSecurityHeaders(NextResponse.redirect(new URL(dashboard, req.url)))
      }
      return addSecurityHeaders(NextResponse.next())
    }

    // ── 4. Require authentication ────────────────────────────────────────────
    if (!token) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      return addSecurityHeaders(NextResponse.redirect(loginUrl))
    }

    const role = token.role

    // ── 5. Employee profile-completion gate ──────────────────────────────────
    if (role === 'EMPLOYEE' && token.profileStatus !== 'APPROVED') {
      if (!pathname.startsWith('/admin/profile')) {
        return addSecurityHeaders(NextResponse.redirect(new URL('/admin/profile', req.url)))
      }
      return addSecurityHeaders(NextResponse.next())
    }

    // ── 6. Role-based access (page routes only — API routes handle their own auth)
    if (!pathname.startsWith('/api/') && !hasAccess(role, pathname)) {
      const dashboard = ROLE_DASHBOARDS[role] || '/admin'
      return addSecurityHeaders(NextResponse.redirect(new URL(dashboard, req.url)))
    }

    return addSecurityHeaders(NextResponse.next())
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js)|public).*)',
  ],
}
