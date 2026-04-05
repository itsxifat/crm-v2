import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

// Route definitions per role
const ROLE_ROUTES = {
  SUPER_ADMIN: ['/admin'],
  MANAGER:     ['/admin'],
  EMPLOYEE:    ['/admin'],
  FREELANCER:  ['/freelancer'],
  CLIENT:      ['/client'],
  VENDOR:      ['/vendor'],
}

// Default redirect per role after login
const ROLE_DASHBOARDS = {
  SUPER_ADMIN: '/admin',
  MANAGER:     '/admin',
  EMPLOYEE:    '/admin',
  FREELANCER:  '/freelancer',
  CLIENT:      '/client',
  VENDOR:      '/vendor',
}

function hasAccess(role, pathname) {
  const allowedRoutes = ROLE_ROUTES[role] || []
  return allowedRoutes.some((route) => pathname.startsWith(route))
}

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl
    const token        = req.nextauth.token

    // Allow public routes without redirection
    const publicRoutes = ['/login', '/register', '/forgot-password', '/reset-password', '/freelancer/invite']
    if (publicRoutes.some((r) => pathname.startsWith(r))) {
      // If already logged in, redirect to their dashboard
      if (token) {
        const dashboard = ROLE_DASHBOARDS[token.role] || '/dashboard'
        return NextResponse.redirect(new URL(dashboard, req.url))
      }
      return NextResponse.next()
    }

    // No token – redirect to login
    if (!token) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(loginUrl)
    }

    const role = token.role

    // Employees who have not completed HR approval are restricted to /admin/profile only
    if (role === 'EMPLOYEE') {
      const profileStatus = token.profileStatus
      if (profileStatus !== 'APPROVED') {
        // Allow the profile page and any sub-path of it
        if (!pathname.startsWith('/admin/profile')) {
          return NextResponse.redirect(new URL('/admin/profile', req.url))
        }
        return NextResponse.next()
      }
    }

    // Role-based access check
    if (!hasAccess(role, pathname)) {
      const dashboard = ROLE_DASHBOARDS[role] || '/dashboard'
      return NextResponse.redirect(new URL(dashboard, req.url))
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      // Let the middleware function above decide; always run it
      authorized: () => true,
    },
  }
)

export const config = {
  matcher: [
    /*
     * Match everything except:
     * - _next/static  (static files)
     * - _next/image   (image optimisation)
     * - favicon.ico
     * - public folder assets (served at root, e.g. /en-logo.png)
     * - api/auth      (NextAuth endpoints)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js)|public|api).*)',
  ],
}
