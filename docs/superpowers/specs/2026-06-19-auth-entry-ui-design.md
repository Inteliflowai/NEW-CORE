# Universal Auth-Entry UI — Design Spec (Phase 1)

**Date:** 2026-06-19
**Status:** Approved design → writing-plans next
**Owner:** Marvin Leventhal
**Grounding:** `docs/superpowers/specs/auth-grounding/v1-01-login-design.md`, `v1-02-auth-mechanics.md`, `v1-03-sso-mechanics.md`

---

## 1. Why this, why now

V2 has the full **server** auth chain (`createServerSupabaseClient` → `getUser` → STAFF_ROLES → IDOR guards → admin client) and `src/app/auth/callback/route.ts`, but **no auth-entry UI and no route protection**: no `/login`, no set-password, no `/logout`, no `middleware.ts`, and the route-group layouts are presentational (no session check). **Nobody can log into any V2 surface today** — the 4b foundation, the demo seed, the super-admin provision UI, and future pilots are all unreachable. This phase builds the universal entry point shared by **Trial + Pilot + Client** users and the operators, unblocking everything downstream (notably the self-serve trial-onboarding flow, whose spec is already written and parked behind this).

## 2. Scope

### In scope (Phase 1)
- `/login` — split-panel page, three form modes: **password sign-in, magic-link, forgot-password**.
- `/set-password` — consumes a Supabase recovery/magic link (session already established by the callback) → `updateUser({ password })`.
- `/logout` — route handler: `signOut()` → `/login`.
- `/trial-expired` — server page shown when `schools.trial_status = 'expired'`.
- `/auth/auth-code-error` — friendly failure page (the existing callback already redirects here).
- `/auth/callback` — **extend** the existing handler with a `token_hash` + `type` branch (recovery / magic-link / email-confirm) alongside the current `code` branch.
- `/` (root) — replace the "coming soon" splash with a redirect: authenticated → role home, else → `/login`.
- `middleware.ts` — session-cookie refresh + coarse auth gate + login/home redirects.
- **Server-layout auth guards** — each route-group layout enforces session + role server-side.
- Placeholder landing pages for `student` / `parent` / `school_admin` so login never dead-ends (their full surfaces are unbuilt).

### Out of scope (Phase 2 — its own spec → plan)
- **Google + Clever SSO** in all forms: the `/api/auth/sso-config`, `/api/auth/google[/callback]`, and `/api/auth/clever/callback` routes; the magiclink session-minting trick; Google Classroom launch.
- The SSO **schema migration**: `school_domains`, `sso_configs`, and the `users` SSO columns (`google_id`, `sso_provider`, `sis_external_id`, `sis_provider`, google-token columns) — none exist in V2.
- **No SSO buttons render on the Phase-1 login page** (decided: avoid a control that can't complete a sign-in).
- The Google **auto-create-student** policy decision (deferred with the SSO build).

## 3. Decisions log (from brainstorm)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Split-panel** layout (slideshow one side, light cobalt form the other) | User chose it over V1's centered-dark-card and over a light re-skin. Fresh take, on-brand with V2 cobalt. |
| D2 | **Phase SSO to Phase 2**, core login first | SSO is migration-heavy + credential-blocked + needs a policy call; not needed to log in. |
| D3 | **No SSO buttons** in Phase 1 | Don't show a control that can't sign anyone in yet. |
| D4 | **Keep magic-link** in Phase 1 | Already a V1 mode, near-zero added cost; useful for passwordless pilot access. |
| D5 | **Middleware + server-layout guards** | Supabase's recommended belt-and-suspenders; never trust middleware alone for authz. |
| D6 | **Placeholder-per-role** landing for student/parent/school_admin | Login must not dead-end on roles whose surface isn't built. |
| D7 | Tokens-only, V2 fonts, V2 brand mark | V2's WCAG-AA gate fails on hardcoded hex; use `next/font` + `/images/new-core.jpg`. |

## 4. Architecture — route protection

**Key constraint:** V2 uses **route groups** (`(teacher)`, `(student)`, `(parent)`, `(school-admin)`, `(super-admin)`) which **do not put the role in the URL** — teacher pages are `/today`, `/roster`, `/gradebook`…; super-admin is `/provision`. V1's proxy enforced role boundaries via URL prefixes (`/teacher/*`); V2 has no such prefix. So responsibilities split:

### 4.1 `middleware.ts` (repo root) — authentication + session
- New helper `src/lib/supabase/middleware.ts` exporting `updateSession(request)` per the `@supabase/ssr` Next.js pattern (creates a server client bound to request/response cookies, calls `getUser()`, returns the response with refreshed cookies). **Must not run code between client creation and `getUser()`** (Supabase guidance).
- `PUBLIC_ROUTES` allowlist (exact + prefix): `/login`, `/set-password`, `/logout`, `/auth/...` (callback + error), `/trial-expired`, and Next static (`_next`, favicon, `/images`, etc.). Matcher excludes static assets.
- Logic per request:
  1. Refresh session via `updateSession`.
  2. If **unauthenticated** and path is **not** public → redirect `/login?expired=true`.
  3. If **authenticated** and path is `/` or `/login` → redirect to `ROLE_HOME[role]` (prevents re-seeing login).
  4. Otherwise pass through. **Middleware does not enforce role-by-path** (it can't — no prefix); that's the layout guard's job.
- `getUser()` is the source of truth (never `getSession()` for auth decisions).

### 4.2 Server-layout guards — authorization (the real boundary)
- Shared helper `src/lib/auth/requireRole.ts`: `await requireRole(allowed: readonly Role[])` → `createServerSupabaseClient()` → `getUser()` (redirect `/login` if none) → fetch `users.role` (+ `school_id`) → if role ∉ allowed → `redirect(ROLE_HOME[role])`. Returns the resolved `{ user, role, profile }` for the layout to use.
- Each route-group layout becomes (or wraps with) a Server Component calling `requireRole`:
  - `(teacher)` → `['teacher']` **only** in Phase 1. STAFF_ROLES governs teacher-facing *API* access (server routes), not UI cross-viewing; staff "preview/impersonate the teacher view" is explicitly a later concern, not Phase 1. Keeping the group teacher-only avoids a school_admin/platform_admin silently landing in a class-scoped UI with no class context.
  - `(student)` → `['student']`; `(parent)` → `['parent']`; `(school-admin)` → `SCHOOL_ADMIN_ROLES` (`school_admin`, `school_sysadmin`, `platform_admin`); `(super-admin)` → `['platform_admin']`.
- **Trial-expiry redirect** lives here too: if the user's `school.trial_status === 'expired'` and path isn't `/trial-expired` → `redirect('/trial-expired')`. (Implemented in `requireRole` or a thin wrapper so every protected layout inherits it.)

### 4.3 `ROLE_HOME` (V2 paths)
Add to `src/lib/auth/roles.ts` (or a new `src/lib/auth/roleHome.ts`):
```
teacher        → /today          (built)
platform_admin → /provision      (built, super-admin group)
school_admin   → /admin-home     (placeholder, see §5.7)
school_sysadmin→ /admin-home     (placeholder; school-tier role, NOT super-admin)
student        → /student-home   (placeholder)
parent         → /parent-home    (placeholder)
```
Placeholder home paths are finalized in the plan; the contract is "every role resolves to a real, guarded page."

## 5. Page specs

### 5.1 `/login` (client page, Suspense-wrapped)
**Layout (D1 split-panel):**
- `md+`: two columns. **Left** = full-bleed `BackgroundRotator` (slideshow + caption + dot nav). **Right** = centered form panel on a light surface.
- `< md`: single column, form only (slideshow hidden or reduced to a slim top band). Inputs `font-size: 16px` to stop iOS zoom.

**Styling (D7, tokens only — WCAG-AA gate):**
- Form panel: `bg-bg`/`bg-surface`, content text `text-fg` (deep-ink, not muted), borders `border-surface`, brand accent `cobalt-600` via token classes. **No hardcoded hex, no arbitrary `[var(--..)]` in components.**
- Slideshow side may use a token-driven dark scrim for caption legibility (Tier-1 primitive on the element, allowed pre-auth).
- Fonts: `var(--font-sans)` (Inter) body, `var(--font-display)` (Bricolage) for any display text — **not** V1's DM Sans/Syne.
- Brand: reuse `/images/new-core.jpg` (as the current splash does) — no V1 PNG / pulse-ring.

**Slideshow:** port the 5 JPEGs to `public/images/login/` (`login-classroom-ai.jpg`, `login-student-before-after.jpg`, `login-brain-ai.jpg`, `login-learning-paths.jpg`, `login-student-discovery.jpg`). Reuse V1's rotator behavior: 7000 ms interval, slide-left 1 s ease-in-out, caption bottom-left (fades on slide), 5 clickable dot indicators bottom-right (active = widened pill). `'use client'`, `setTimeout` ref pattern with cleanup. Captions inlined (no i18n):
1. "The future of education is brilliantly personal."
2. "Every student has the potential to transform."
3. "Intelligence flows in every direction."
4. "Every mind is an explosion waiting to happen."
5. "Learning is the most colorful adventure."

**Form modes** (`'signin' | 'magic' | 'forgot'`):
- **Email** field always. Placeholder `you@school.edu`.
- **signin:** + password (show/hide toggle, `autoComplete="current-password"`), label row has a **"Forgot?"** link → `forgot` mode. Submit → `supabase.auth.signInWithPassword({email,password})` → on success fetch `users.role` → `router.push(ROLE_HOME[role] ?? '/login')` + `router.refresh()`.
- **magic:** hint "We'll email you a one-click link. No password needed." Submit → `signInWithOtp({ email, options: { emailRedirectTo: \`${window.location.origin}/auth/callback\` } })` → success banner "Check your email".
- **forgot:** back link to signin; heading "Reset your password"; hint "Enter your email and we'll send you a reset link." Submit → `resetPasswordForEmail(email, { redirectTo: \`${window.location.origin}/auth/callback?next=/set-password\` })` → success banner.
- Submit labels: "Sign in to CORE" / "Send magic link" / "Send reset link" / "Please wait…" (loading).
- Use `window.location.origin` (not the env var) for redirect URLs so preview deploys work without a redeploy (V1 convention).

**Query-param states** (read on mount):
- `?expired=true` → amber "Your session expired, please sign in again." (auto-dismiss 5 s).
- `?error=` → banner; map `auth_failed`, `reset_expired`, `not_provisioned` (others tolerated generically).

**Supabase client:** the existing `src/lib/supabase/client.ts` browser factory (reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Do **not** import a V1 client.

### 5.2 `/set-password` (client page)
- On mount: `getSession()`; if a session exists set ready. Also subscribe to `onAuthStateChange` for `PASSWORD_RECOVERY` / `SIGNED_IN` (fallback). Show "Verifying your reset link…" until ready; if no session after the callback, show an error with a link back to `/login` (forgot mode).
- Form: new password + confirm. Validate **≥ 8 chars + match**. Submit → `supabase.auth.updateUser({ password })` → success "Password updated! Redirecting…" → `router.push('/login')` after ~2 s. Error → inline message.
- Reached via the callback's recovery branch (`?next=/set-password`). This is the page Trial admins use to set their first password (no plaintext password is ever emailed — consistent with the trial-onboarding spec).

### 5.3 `/auth/callback` (extend existing route handler)
Keep the current `code` branch + `isSafeRedirectPath`. Add, before/around it:
- If `token_hash` + `type` present → `supabase.auth.verifyOtp({ type, token_hash })`:
  - success + safe `next` → `redirect(next)` (recovery → `/set-password`).
  - success + no `next` → fetch role → `redirect(ROLE_HOME[role])` (email-confirm / magic-link-as-token_hash).
  - failure → `redirect('/login?error=reset_expired')`.
- Existing `code` branch unchanged (magic-link / future OAuth PKCE). Reuse `isSafeRedirectPath` for all redirects.

### 5.4 `/logout` (route handler)
- `POST` (and tolerate `GET` for a plain link): `createServerSupabaseClient()` → `signOut()` → `redirect('/login')`. Wire the existing nav shells' sign-out affordance to it.

### 5.5 `/trial-expired` (server page)
- Public route (reachable while session may be flagged expired). Reads the signed-in school's `trial_expires_at` (via server client) to show the data-retention date; copy: "Your trial has ended." + upgrade/contact CTA. Uses the four-audience-safe copy helpers; no raw numbers. Layout/guard redirects expired trials here.

### 5.6 `/auth/auth-code-error` (server page)
- Small static page: "We couldn't complete that sign-in link." + "It may have expired — request a new one." + button → `/login`. Token-styled, V2 fonts.

### 5.7 Root `/` + role placeholders
- `src/app/page.tsx` → server redirect: if authenticated → `ROLE_HOME[role]`, else `/login`. (Middleware also covers this; the page redirect is the no-JS/SSR backstop.)
- Placeholder landing pages (D6) at the `student`/`parent`/`school_admin` homes: a minimal token-styled "Your CORE space is being set up." card inside each role's existing layout, so the guard has a real page to protect and login never 404s. Replaced when those surfaces are built (4c+).

## 6. Environment variables
Reuses existing V2 names (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`). `NEXT_PUBLIC_APP_URL` is **not** required for Phase-1 auth (client flows use `window.location.origin`); it remains needed by the parked trial-onboarding flow. No new env vars in Phase 1. (Phase-2 SSO will add the Google/Clever vars.)

## 7. Testing plan
Vitest 4.x. React pages use `// @vitest-environment jsdom` + `import '@/test/setup-dom';`; middleware/route handlers run in the default `node` env. Mock the Supabase client/server factories.
- **login:** each mode calls the right Supabase method with the right args; success redirects to `ROLE_HOME[role]`; `?expired`/`?error` banners render; show/hide password toggle; mode switching.
- **set-password:** validation (length + match), `updateUser` called, redirect on success, error path, "verifying" gate.
- **callback:** `token_hash`+`type` → `verifyOtp` → safe-redirect to `next` / role home; failure → `?error=reset_expired`; existing `code` branch still passes; open-redirect rejected by `isSafeRedirectPath`.
- **middleware:** public path passes; unauth protected → `/login?expired=true`; authed on `/login` → role home; cookie refresh invoked.
- **requireRole:** no session → `/login`; wrong role → own home; expired trial → `/trial-expired`; correct role → returns profile.
- **logout:** `signOut` called → `/login`.
- **a11y:** `npm run a11y` contrast gate must pass (no hardcoded hex).

## 8. Build order (for the plan)
1. `ROLE_HOME` + `requireRole` helper (+ tests).
2. `src/lib/supabase/middleware.ts` `updateSession` + `middleware.ts` (+ tests).
3. Callback `token_hash` extension (+ tests).
4. `BackgroundRotator` + port image assets.
5. `/login` page (+ tests).
6. `/set-password` (+ tests).
7. `/logout`, `/auth/auth-code-error`, `/trial-expired`, root redirect, role placeholders (+ tests).
8. Wire server-layout guards into the 5 route-group layouts (+ tests).
9. Full `npm run build` (type-check) + `npm test` + `npm run a11y` green.

## 9. Risks / watch-items
- **Middleware + `@supabase/ssr` cookie handling on Next.js 16** — follow the bundled `node_modules/next/dist/docs` + Supabase SSR guidance exactly; the "no code between createClient and getUser" rule is load-bearing.
- **Route-group layouts becoming async Server Components** — current `(teacher)/layout.tsx` is a sync presentational component nesting `RoleLayout`; converting to do `requireRole` must preserve the existing nav shell composition.
- **Teacher staff-access** — confirm whether staff roles should land on/within the teacher group or only their own; align with existing STAFF_ROLES usage.
- **Placeholder homes** must still pass the contrast gate and four-audience discipline.
```
