# V1 Auth Mechanics — Grounding Document

**Source repo:** `C:/users/inteliflow/core`
**Mined:** 2026-06-19
**Purpose:** Exact reference for porting auth flows to V2. Read this before touching any auth code in NEW-CORE.

---

## 1. Sign-In Flow

**File:** `app/login/page.tsx` (client component, Suspense-wrapped)

Three modes on one page, toggled via a `Mode` type (`'signin' | 'magic' | 'forgot'`):

### 1a. Password sign-in (`handleSignIn`)

```
supabase.auth.signInWithPassword({ email, password })
  → on success: supabase.from('users').select('role').eq('id', user.id)
  → router.push(ROLE_HOME[profile.role] ?? '/login')
  → router.refresh()
```

Role-to-route map (shared across login page, callback route, and proxy):

| role | destination |
|---|---|
| `teacher` | `/teacher` |
| `student` | `/student` |
| `parent` | `/parent` |
| `school_admin` | `/admin` |
| `school_sysadmin` | `/admin` (proxy only) |
| `platform_admin` | `/platform` |

### 1b. Magic-link sign-in (`handleMagicLink`)

```
supabase.auth.signInWithOtp({
  email,
  options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
})
```

Email arrives → user clicks → lands at `/auth/callback?code=...` → callback does `exchangeCodeForSession` → role-routes.

### 1c. Forgot-password (`handleForgotPassword`)

```
supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`
})
```

Email arrives → user clicks → lands at `/auth/callback?token_hash=...&type=recovery` → callback does `verifyOtp({ type: 'recovery', token_hash })` → redirects to `/reset-password` (set via the `next`/`redirect_to` param).

### 1d. Error states on login page

Query param `?error=` values handled on mount:
- `auth_failed` — generic auth failure (callback fallback)
- `sso_failed` — Google OAuth failed
- `not_provisioned` — user not in `users` table
- `clever_sso_failed` — Clever SSO failed
- `reset_expired` — token_hash verification failed

Query param `?expired=true` shows a session-expired banner (5 s auto-dismiss). Set by proxy when unauthenticated user hits a protected route.

### 1e. SSO buttons

**Google:** Domain-aware — on email blur, fetches `/api/auth/sso-config?domain=...`; if `providers` includes `'google'`, shows Google button linking to `/api/auth/google` (initiates OAuth with CSRF state cookie). This is a domain-gated enterprise feature, not shown by default.

**Clever:** Always visible. Link constructs Clever OAuth URL client-side:
```
https://clever.com/oauth/authorize?response_type=code
  &client_id=${NEXT_PUBLIC_CLEVER_CLIENT_ID}
  &redirect_uri=${NEXT_PUBLIC_APP_URL}/api/teacher/admin/sis/clever
```

---

## 2. Auth Callback / Code Exchange

**File:** `app/auth/callback/route.ts` (Route Handler, server-side)

Handles two distinct flows:

### 2a. `token_hash` + `type` (password-reset / email verification)

```
supabase.auth.verifyOtp({ type, token_hash })
  → success + redirectTo param → redirect(redirectTo)   [e.g. /reset-password]
  → success + no redirectTo → fetch role → redirect to role home
  → failure → redirect(`/login?error=reset_expired`)
```

### 2b. `code` (OAuth / magic link PKCE exchange)

```
supabase.auth.exchangeCodeForSession(code)
  → success → fetch role → redirect to role home
  → failure → redirect(`/login?error=auth_failed`)
```

The `next` param (also checked as `redirect_to`) is passed from `resetPasswordForEmail` to carry the `/reset-password` destination through the callback hop.

---

## 3. Set-Password (Reset) Page

**File:** `app/reset-password/page.tsx` (client component)

Lands here after callback has already called `verifyOtp` and established a session. Page:

1. On mount: calls `supabase.auth.getSession()` — if session exists, sets `ready = true`.
2. Also subscribes to `onAuthStateChange` for `PASSWORD_RECOVERY` or `SIGNED_IN` events (legacy hash-fragment flow fallback).
3. Shows "Verifying your reset link..." until `ready`.
4. On submit: validates ≥8 chars + match, then:

```
supabase.auth.updateUser({ password })
  → success → show "Password updated! Redirecting..." → setTimeout 2s → router.push('/login')
  → error   → show error message
```

Password change from within an active session (profile modal tab) also uses `supabase.auth.updateUser({ password })` directly in `DashboardLayoutInner.handleChangePassword`.

---

## 4. Logout

**File:** `app/(dashboard)/layout.tsx` — `handleSignOut` function

```typescript
async function handleSignOut() {
  await supabase.auth.signOut();
  router.push('/login');
}
```

Called from two places in the same file:
- Sidebar footer button ("↩ Sign Out")
- Top-bar avatar dropdown "Sign Out" item

Both call the same `handleSignOut`. No server-side session invalidation endpoint; relies entirely on `supabase.auth.signOut()` clearing the cookie.

---

## 5. Route Protection

V1 has a **two-layer** protection model:

### Layer 1 — Proxy (middleware equivalent)

**File:** `proxy.ts` at repo root (renamed from `middleware.ts` for Next.js 16)

```
matcher: [all routes except static assets, _next, sentry-tunnel]

PUBLIC_ROUTES = ['/', '/login', '/auth/callback', '/core', '/reset-password',
                 '/demo/core/new', '/demo/core/expired', '/reel', '/learner-challenge']

Also public (prefix-matched): /auth/, /demo/, /legal/, /handoff/, /print/booklet/, /launch/
API routes (/api/) → passed through with rate-limiting, no auth gate
```

Logic on each request:

1. Create SSR Supabase client, call `supabase.auth.getUser()`.
2. If path is in public routes AND user is authenticated AND path is `/` or `/login` → fetch role → redirect to role home (prevents logged-in users re-seeing login page).
3. If path is public (not `/` or `/login`) → pass through.
4. If `!user` → redirect to `/login?expired=true`.
5. Fetch role from `users` table.
6. If no role → redirect to `/login`.
7. If user is accessing a path outside their role's base (`ROLE_HOME[role]`) → redirect to their own role home.

### Layer 2 — Dashboard Layout Client Guard

**File:** `app/(dashboard)/layout.tsx` — `DashboardLayout` (root export)

Client component. On mount:

```typescript
supabase.auth.getUser()
  → !authUser → router.push('/login')
  → authUser  → supabase.from('users').select('*').eq('id', authUser.id)
              → setUser(profile); setSentryUser(...)
```

Shows a loading spinner until `user` is resolved. Renders `null` if user resolves to null (proxy has already redirected in this case, so this is a belt-and-suspenders guard for client-side navigation).

**Trial expiry redirect** (also in layout):

```typescript
if (data.trial_status === 'expired' && !pathname.includes('trial-expired')) {
  router.push('/trial-expired');
}
```

**Onboarding redirects:**
- `school_admin` with `welcome_completed === false` → `/onboarding`
- `teacher` with `onboarding_completed === false` → `/teacher/onboarding`

### Layer 3 — API Route Guards

**File:** `lib/auth/guards.ts`

Functions `guardPlatformAdmin()`, `guardSchoolAdmin()`, `guardClassAccess(classId)`, `guardStudentAccess(studentId)` — used inside API route handlers to enforce object-level authz on routes that use the service-role admin client (which bypasses RLS).

---

## 6. Trial-Expired Page

**File:** `app/(dashboard)/trial-expired/page.tsx`

Lives **inside** the `(dashboard)` route group so the sidebar shell wraps it. Client component — fetches `schools.trial_expires_at` to display a data-deletion warning date (expiry + 14 days). Shows:
- Heading: "Your 30-day trial has ended."
- CTA: `/upgrade`
- Secondary CTA: Calendly link

The redirect to this page is triggered from within the dashboard layout when `trial_status === 'expired'`.

---

## 7. Environment / Config

All auth-relevant env vars from V1 `.env.example`:

```
NEXT_PUBLIC_SUPABASE_URL=          # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # Supabase anon/publishable key
SUPABASE_SERVICE_ROLE_KEY=         # Service-role key (server-only, never client)
NEXT_PUBLIC_APP_URL=               # Canonical origin — used in OAuth redirectTo params
                                   # Baked at build time (NEXT_PUBLIC_*); redeploy needed on change
NEXT_PUBLIC_CLEVER_CLIENT_ID=      # Clever SSO — exposed to client for login button URL
GOOGLE_CLIENT_ID=                  # Google OAuth app credentials
GOOGLE_CLIENT_SECRET=
```

**`NEXT_PUBLIC_APP_URL` usage in auth flows:**
- `resetPasswordForEmail` redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`
  — V1 login page uses `window.location.origin`, NOT the env var, for the redirectTo in `resetPasswordForEmail` and `signInWithOtp`. This means it works correctly across all deployed environments without a redeploy.
- Clever SSO login button: uses `NEXT_PUBLIC_APP_URL` as the redirect_uri fallback.

---

## 8. Supabase Client Instantiation

### Browser (client components)

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';
export function createClient() {
  return createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
```

### Server (Route Handlers, Server Components)

```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
// async — awaits cookies() (required in Next.js 16)
export async function createServerSupabaseClient() { ... }
// Service-role — bypasses RLS, server-only
export function createAdminSupabaseClient() { ... }
```

**V2 key difference:** V2 uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (renamed from `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and `SUPABASE_SECRET_KEY` (renamed from `SUPABASE_SERVICE_ROLE_KEY`). The functionality is identical; only the env var names changed.

---

## 9. What V2 Already Has

- `src/app/auth/callback/route.ts` — handles `?code=` via `exchangeCodeForSession` + safe-redirect guard (`isSafeRedirectPath`). Redirects to `next` param or `/auth/auth-code-error` on failure. Does NOT handle `token_hash` / `type` (recovery flow) yet.
- `src/lib/supabase/client.ts` — `createBrowserClient` wrapper.
- `src/lib/supabase/server.ts` — `createServerSupabaseClient` + `createAdminSupabaseClient`.
- `src/lib/auth/guards.ts` — all four guards ported from V1 with `isPlatformAdmin` improvement.
- `src/lib/auth/roles.ts` — canonical role constants.
- `src/app/(teacher)/layout.tsx`, `(student)/layout.tsx`, `(parent)/layout.tsx`, `(school-admin)/layout.tsx`, `(super-admin)/layout.tsx` — route group layouts exist (presentational `RoleLayout` shell) but have NO auth guard — no `supabase.auth.getUser()` check, no redirect-to-login.

---

## 10. Critical Gaps — What Must Be Built New in V2

### Must build new (no V1 equivalent ported):

**A. Login page** (`src/app/login/page.tsx`)
- Full frosted-glass single-page with three modes: password, magic-link, forgot-password
- `signInWithPassword` → fetch role from `users` table → `router.push(ROLE_HOME[role])`
- `signInWithOtp` (magic link) with `emailRedirectTo` pointing to `/auth/callback`
- `resetPasswordForEmail` with `redirectTo` pointing to `/auth/callback?next=/reset-password`
- SSO buttons (Google domain-gated + Clever always-visible) are lower priority for V2 pilot; password + magic-link are the critical paths
- Error display for `?error=` and `?expired=true` query params

**B. Set-password page** (`src/app/reset-password/page.tsx`)
- Wait for session (getSession + onAuthStateChange `PASSWORD_RECOVERY` listener)
- `supabase.auth.updateUser({ password })` on submit
- Redirect to `/login` on success

**C. Auth callback token_hash handling** (`src/app/auth/callback/route.ts` — extend existing)
- V2 callback only handles `?code=` today
- Must add: `token_hash` + `type` branch → `supabase.auth.verifyOtp({ type, token_hash })` → redirect to `next` param (for recovery) or role home (for email confirm)
- On failure: `redirect('/login?error=reset_expired')`
- The existing `isSafeRedirectPath` guard in V2 is correct and should be reused for the `next` param

**D. Proxy / middleware** (`proxy.ts` at V2 root or `middleware.ts`)
- V2 has NO proxy/middleware file at all — no route protection at the edge
- Must port: PUBLIC_ROUTES list, `getUser()`, unauthenticated → `/login?expired=true`, role-base enforcement (wrong-role → own home)
- In V2, the file should be named `middleware.ts` (the V1 `proxy.ts` naming was a Next.js 16 workaround that was project-specific)

**E. Dashboard layout auth guard** (in each role-group layout or a shared guard component)
- V2 `(teacher)/layout.tsx` is presentational only — no session check
- Must add: `supabase.auth.getUser()` on mount (or Server Component equivalent), redirect to `/login` if no session
- Trial-expiry redirect (`trial_status === 'expired'` → `/trial-expired`) if trial system is in scope for V2

**F. Trial-expired page** (`src/app/(teacher)/trial-expired/page.tsx` or a shared route)
- Low priority for initial V2 build but required before pilot if trial provisioning ships

**G. Root page redirect** (`src/app/page.tsx`)
- V2 currently shows a "coming soon" splash; V1 redirects `/` to `/login`
- Must change to `redirect('/login')` (or the proxy will handle it if proxy is added)

### Can reuse existing V2 code:

- `src/app/auth/callback/route.ts` — the `?code=` / `exchangeCodeForSession` path is correct and only needs the `token_hash` branch added
- `src/lib/supabase/client.ts` and `server.ts` — identical pattern, correct env var names
- `src/lib/auth/guards.ts` — fully ported, improved over V1
- `src/lib/auth/roles.ts` — canonical, already has `ROLE_HOME` equivalent data

### V2 env var renames vs V1:

| V1 name | V2 name |
|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SECRET_KEY` |

All other auth env vars (`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_CLEVER_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) carry the same names.

---

## 11. Design Notes for V2 Port

- **No middleware.ts exists in V2 yet.** The proxy must be created; name it `middleware.ts` (standard Next.js convention).
- **V2 route groups** use `(teacher)`, `(student)`, `(parent)`, `(school-admin)`, `(super-admin)` — note `(super-admin)` replaces V1's `platform_admin` in route naming.
- **Auth callback `next` param convention:** V1 uses `?next=` in the forgot-password redirectTo so the callback can forward to `/reset-password`. The V2 callback already reads `?next=` — this is consistent.
- **`window.location.origin` vs `NEXT_PUBLIC_APP_URL`:** For `emailRedirectTo` / `redirectTo` in client-side Supabase calls, use `window.location.origin` (as V1 does) rather than the env var — it adapts correctly to preview deployments without a redeploy.
- **Session check pattern:** V1 layout guard uses `supabase.auth.getUser()` (not `getSession()`). V2 guards.ts already enforces `getUser` — the login page and layout guards should follow the same pattern.
