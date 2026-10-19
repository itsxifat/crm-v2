'use client'

import { useSession } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import { canDo, canDoAny, getRoutePermission } from '@/lib/rbac'
import { ShieldAlert, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/Button'

/**
 * Client-side permission helpers.
 *
 * These mirror the server-side rbac guards so the UI hides / blocks exactly what
 * the API rejects. The API remains the real security boundary — these only stop
 * showing controls and pages the user isn't allowed to use.
 */

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * usePermission — read the current user's permissions in a component.
 *
 *   const { can, canAny, role, ready } = usePermission()
 *   if (can('hr.employees.create')) { ... }
 *
 * `ready` is false while the session is still resolving, so callers can avoid
 * flashing gated UI before permissions are known.
 */
export function usePermission() {
  const { data: session, status } = useSession()
  const ready = status !== 'loading'
  return {
    ready,
    role: session?.user?.role ?? null,
    can:    (perm)  => canDo(session, perm),
    canAny: (perms) => canDoAny(session, perms),
  }
}

// ─── <Can> — conditionally render children ────────────────────────────────────

/**
 * Render children only when the user holds the given permission(s).
 *
 *   <Can perm="hr.employees.create">
 *     <button>Add Employee</button>
 *   </Can>
 *
 *   <Can any={['finance.payments.confirm', 'finance.payments.request']}> … </Can>
 *
 * Props:
 *   perm     — a single permission string
 *   any      — array; passes if the user has ANY of them
 *   fallback — optional node rendered when denied (default: nothing)
 */
export function Can({ perm, any, children, fallback = null }) {
  const { can, canAny, ready } = usePermission()
  if (!ready) return null
  const allowed = any ? canAny(any) : can(perm)
  return allowed ? <>{children}</> : fallback
}

// ─── <RouteGuard> — block direct access to a page the user can't open ─────────

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-24 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-gray-200/80 bg-white shadow-xs">
        <ShieldAlert className="size-5 text-red-600" />
      </div>
      <h1 className="text-base font-semibold text-gray-900">Access denied</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        You don&apos;t have permission to view this page.
      </p>
      <Link href="/admin" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-5')}>
        <ArrowLeft />
        Back to dashboard
      </Link>
    </div>
  )
}

/**
 * Wraps admin page content and blocks it when the current user lacks the
 * permission mapped to the current route (ROUTE_PERMISSIONS in lib/rbac).
 * SUPER_ADMIN and unmapped/open routes always pass. Renders an Access Denied
 * screen instead of the page so a hidden nav item can't be reached by URL.
 */
export function RouteGuard({ children }) {
  const { data: session, status } = useSession()
  const pathname = usePathname()

  // Wait for the session before deciding — avoids a denied flash on first paint.
  if (status === 'loading') return null

  const requiredPerm = getRoutePermission(pathname)
  if (!requiredPerm) return <>{children}</>          // open route

  // A route may require a single permission or ANY of a set (e.g. finance tabs).
  const allowed = Array.isArray(requiredPerm)
    ? canDoAny(session, requiredPerm)
    : canDo(session, requiredPerm)

  return allowed ? <>{children}</> : <AccessDenied />
}
