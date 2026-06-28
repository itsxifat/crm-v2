---
name: activity-log-manual-wiring
description: Activity/audit logging is per-route manual via logActivity() — no middleware; new mutating routes must call it or they won't appear
metadata:
  type: project
---

The activity log (`/admin/activity-logs`, backed by the `AuditLog` model and read via `/api/activity-logs`) is populated **only** by explicit `logActivity({...})` calls from `@/lib/logActivity` inside each route, plus the direct `AuditLog.create` LOGIN entry in [lib/auth.js]. There is **no middleware/interceptor** that records mutations automatically (same self-guard pattern as [[api-routes-need-role-checks]]).

**Gotcha:** when adding a new mutating API route (POST/PUT/PATCH/DELETE), you must add a `logActivity` call after the successful DB write or the action will silently never show in the activity log.

History: until 2026-06-26 only login + invoice routes logged anything (DB had just 11 LOGIN + 3 CREATE/INVOICE rows) — the client reported "activity log not showing some of them." Fixed by wiring logActivity into leads, projects, clients, tasks, quotations, transactions, employees, vendors, freelancers, and invoice payments (CREATE/UPDATE/DELETE/STATUS_CHANGE/CONVERT/PAYMENT). Action types must also exist in `ACTION_CONFIG` in [app/admin/activity-logs/[userId]/page.js] to get a styled badge (else falls back to raw label).

Note: audit data is now plaintext (encryption layer removed — see `db:decrypt` script and [[encryption-breaks-queries]]), so equality/`$regex` filters on action/entity work again.
