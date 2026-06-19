# Universal Auth-Entry UI (Phase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the universal login + auth-entry UI and route protection so every V2 surface (Trial/Pilot/Client + operators) becomes reachable and secured.

**Architecture:** A split-panel `/login` (rotating photo slideshow + a light-cobalt form) drives Supabase email/password, magic-link, and forgot-password flows. `middleware.ts` refreshes the session cookie and does coarse login/home redirects; per-route-group server-layout guards (`requireRole`) are the real role-authorization boundary (V2 route groups don't encode role in the URL). The existing `/auth/callback` gains a `token_hash` branch for recovery/magic-link, and `/set-password` consumes it.

**Tech Stack:** Next.js 16.2.9 (App Router, `src/`), React 19.2.4, `@supabase/ssr` 0.12.0, Tailwind v4 (token classes), Vitest 4.1.9 + `@testing-library/react` (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-19-auth-entry-ui-design.md`. **Grounding:** `docs/superpowers/specs/auth-grounding/v1-01-login-design.md`, `v1-02-auth-mechanics.md`, `v1-03-sso-mechanics.md`.

## Global Constraints

- **Next.js 16 + React 19.** `cookies()`/`headers()` are async; `params`/`searchParams` are async. Verify framework APIs against `node_modules/next/dist/docs/01-app/` before writing — do not assume.
- **Supabase clients (exact names):** browser = `createBrowserSupabaseClient()` from `@/lib/supabase/client` (reads `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`); server = `await createServerSupabaseClient()` from `@/lib/supabase/server`; admin = `createAdminSupabaseClient()` (server-only, bypasses RLS). **Never** use `getSession()` for auth decisions — use `getUser()`.
- **Tokens-only styling (review-enforced).** Use Tier-2 token utility classes: `bg-bg`, `bg-surface`, `text-fg`, `text-fg-muted`, `bg-brand`, `text-brand`, `text-fg-on-brand`, `bg-brand-surface`, `text-brand-fg`, `border-fg-muted`, `rounded`, `rounded-lg`, `shadow`, `shadow-pop`, fonts `font-sans`/`font-display`. Content text is `text-fg` (deep-ink), never `text-fg-muted`. The slideshow scrim/captions are the only sanctioned exception (spec G3): hard-set Tier-1 primitives `var(--ink-950)` / `var(--white)` via inline `style` on the slideshow element. No other hardcoded hex.
- **a11y gate:** `npm run a11y` (runs in `prebuild`) parses `globals.css` token pairs only. This plan does not modify `globals.css`, so the gate stays green — but run it to confirm.
- **Copy discipline:** "Sign in", "Assignments" never "Homework". No mastery-band/risk numbers anywhere in this UI (it's pre-auth or shell). All strings inlined (no i18n system in V2).
- **Auth env var names:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. No new env vars in Phase 1 (client flows use `window.location.origin`).
- **DB roles:** `teacher | student | parent | school_admin | school_sysadmin | platform_admin` (`src/lib/auth/roles.ts` `Role`). Route-group `data-role` values differ: `school_admin`/`school_sysadmin` → the `(school-admin)` group (`data-role="admin"`), `platform_admin` → `(super-admin)`.
- **Testing:** component/page tests start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`. Route-handler/middleware/lib tests use the default `node` env (no header). Mock `next/navigation` as `vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }), useSearchParams: () => new URLSearchParams(), redirect: vi.fn() }))`. Commit after each task.
- **Branch:** all work on `feat/auth-entry-ui` (already created).

---

### Task 1: `ROLE_HOME` map + `homeForRole` helper

**Files:**
- Create: `src/lib/auth/roleHome.ts`
- Test: `src/lib/auth/__tests__/roleHome.test.ts`

**Interfaces:**
- Consumes: `Role` from `@/lib/auth/roles`.
- Produces: `ROLE_HOME: Record<Role, string>`; `homeForRole(role: string | null | undefined): string` (returns the role's home path, or `/login` for unknown/null).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/__tests__/roleHome.test.ts
import { describe, it, expect } from 'vitest';
import { ROLE_HOME, homeForRole } from '../roleHome';

describe('roleHome', () => {
  it('maps every DB role to a path', () => {
    expect(ROLE_HOME.teacher).toBe('/today');
    expect(ROLE_HOME.platform_admin).toBe('/provision');
    expect(ROLE_HOME.school_admin).toBe('/admin-home');
    expect(ROLE_HOME.school_sysadmin).toBe('/admin-home');
    expect(ROLE_HOME.student).toBe('/student-home');
    expect(ROLE_HOME.parent).toBe('/parent-home');
  });

  it('homeForRole returns the mapped path for a known role', () => {
    expect(homeForRole('teacher')).toBe('/today');
    expect(homeForRole('platform_admin')).toBe('/provision');
  });

  it('homeForRole falls back to /login for null/unknown', () => {
    expect(homeForRole(null)).toBe('/login');
    expect(homeForRole(undefined)).toBe('/login');
    expect(homeForRole('nope')).toBe('/login');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/__tests__/roleHome.test.ts`
Expected: FAIL — cannot resolve `../roleHome`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/auth/roleHome.ts
import type { Role } from '@/lib/auth/roles';

/** Post-auth landing path per DB role (V2 route-group URLs — no role prefix). */
export const ROLE_HOME: Record<Role, string> = {
  teacher: '/today',
  student: '/student-home',
  parent: '/parent-home',
  school_admin: '/admin-home',
  school_sysadmin: '/admin-home',
  platform_admin: '/provision',
};

/** Home path for a (possibly unknown) role string; /login when unresolved. */
export function homeForRole(role: string | null | undefined): string {
  if (role && role in ROLE_HOME) return ROLE_HOME[role as Role];
  return '/login';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/__tests__/roleHome.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/roleHome.ts src/lib/auth/__tests__/roleHome.test.ts
git commit -m "feat(auth): ROLE_HOME map + homeForRole helper"
```

---

### Task 2: `requireRole` server-layout guard

**Files:**
- Create: `src/lib/auth/requireRole.ts`
- Test: `src/lib/auth/__tests__/requireRole.test.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient` (`@/lib/supabase/server`), `homeForRole` (Task 1), `redirect` (`next/navigation`), `Role` (`@/lib/auth/roles`).
- Produces: `interface AuthedContext { userId: string; role: Role; schoolId: string | null }`; `async function requireRole(allowed: readonly Role[]): Promise<AuthedContext>`. Redirects (throws `NEXT_REDIRECT`) to `/login?expired=true` (no user), `/login` (no role row), `/trial-expired` (school trial expired), or `homeForRole(role)` (role not allowed). Returns the context when allowed.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/auth/__tests__/requireRole.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { requireRole } from '../requireRole';

/** Build a mock supabase whose getUser + table reads are scripted. */
function mockSupabase(opts: {
  user: { id: string } | null;
  profile?: { role: string | null; school_id: string | null } | null;
  school?: { trial_status: string } | null;
}) {
  const from = vi.fn((table: string) => {
    const row = table === 'users' ? opts.profile : opts.school;
    return {
      select: () => ({ eq: () => ({ single: async () => ({ data: row ?? null }) }) }),
    };
  });
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: opts.user } }) },
    from,
  } as never);
}

describe('requireRole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redirects to /login?expired=true when no user', async () => {
    mockSupabase({ user: null });
    await expect(requireRole(['teacher'])).rejects.toThrow('REDIRECT:/login?expired=true');
  });

  it('redirects to /login when the user has no role row', async () => {
    mockSupabase({ user: { id: 'u1' }, profile: { role: null, school_id: null } });
    await expect(requireRole(['teacher'])).rejects.toThrow('REDIRECT:/login');
  });

  it('redirects to /trial-expired when the school trial is expired', async () => {
    mockSupabase({
      user: { id: 'u1' },
      profile: { role: 'teacher', school_id: 's1' },
      school: { trial_status: 'expired' },
    });
    await expect(requireRole(['teacher'])).rejects.toThrow('REDIRECT:/trial-expired');
  });

  it('redirects a wrong-role user to their own home', async () => {
    mockSupabase({
      user: { id: 'u1' },
      profile: { role: 'student', school_id: null },
    });
    await expect(requireRole(['teacher'])).rejects.toThrow('REDIRECT:/student-home');
  });

  it('returns context for an allowed role', async () => {
    mockSupabase({
      user: { id: 'u1' },
      profile: { role: 'teacher', school_id: 's1' },
      school: { trial_status: 'active' },
    });
    const ctx = await requireRole(['teacher']);
    expect(ctx).toEqual({ userId: 'u1', role: 'teacher', schoolId: 's1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/__tests__/requireRole.test.ts`
Expected: FAIL — cannot resolve `../requireRole`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/auth/requireRole.ts
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { homeForRole } from '@/lib/auth/roleHome';
import type { Role } from '@/lib/auth/roles';

export interface AuthedContext {
  userId: string;
  role: Role;
  schoolId: string | null;
}

/**
 * Server-layout authorization guard. Resolves the session via getUser(),
 * enforces the role allow-list, and applies the trial-expiry gate.
 * Redirects (throws NEXT_REDIRECT) on any failure; returns the context when allowed.
 */
export async function requireRole(allowed: readonly Role[]): Promise<AuthedContext> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?expired=true');

  const { data: profile } = await supabase
    .from('users').select('role, school_id').eq('id', user.id).single();
  const role = (profile?.role ?? null) as Role | null;
  if (!role) redirect('/login');

  const schoolId = (profile?.school_id ?? null) as string | null;
  if (schoolId) {
    const { data: school } = await supabase
      .from('schools').select('trial_status').eq('id', schoolId).single();
    if (school?.trial_status === 'expired') redirect('/trial-expired');
  }

  if (!allowed.includes(role)) redirect(homeForRole(role));

  return { userId: user.id, role, schoolId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/__tests__/requireRole.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/requireRole.ts src/lib/auth/__tests__/requireRole.test.ts
git commit -m "feat(auth): requireRole server-layout guard (role + trial-expiry gate)"
```

---

### Task 3: Supabase middleware helper + root `middleware.ts`

**Files:**
- Create: `src/lib/supabase/middleware.ts`
- Create: `middleware.ts` (repo root)
- Test: `src/lib/supabase/__tests__/middleware.test.ts`

**Interfaces:**
- Consumes: `createServerClient` (`@supabase/ssr`), `NextResponse`/`NextRequest` (`next/server`), `homeForRole` (Task 1).
- Produces: `async function updateSession(request: NextRequest): Promise<NextResponse>`. Behavior: refreshes the session cookie; authed on `/` or `/login` → redirect to `homeForRole(role)`; unauthed on `/` or a non-public route → redirect to `/login?expired=true`; otherwise pass through with refreshed cookies. Public prefixes: `/login`, `/set-password`, `/logout`, `/auth`, `/trial-expired`.

> **Verify first:** read `node_modules/next/dist/docs/01-app/` middleware docs and the `@supabase/ssr` cookie pattern (mirrors `src/lib/supabase/server.ts`'s `getAll`/`setAll`). The "no code between `createServerClient` and `getUser()`" rule is load-bearing.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/supabase/__tests__/middleware.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const from = vi.fn(() => ({
  select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'teacher' } }) }) }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser }, from })),
}));

import { NextRequest } from 'next/server';
import { updateSession } from '../middleware';

function req(path: string): NextRequest {
  return new NextRequest(new URL(`https://app.test${path}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'pk';
});

describe('updateSession', () => {
  it('passes through a public route when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(req('/login'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects unauthenticated user on a protected route to /login?expired=true', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(req('/today'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/login?expired=true');
  });

  it('redirects unauthenticated user on / to /login', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await updateSession(req('/'));
    expect(res.headers.get('location')).toBe('https://app.test/login');
  });

  it('redirects authenticated user away from /login to role home', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await updateSession(req('/login'));
    expect(res.headers.get('location')).toBe('https://app.test/today');
  });

  it('passes through a protected route when authenticated', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await updateSession(req('/today'));
    expect(res.headers.get('location')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/supabase/__tests__/middleware.test.ts`
Expected: FAIL — cannot resolve `../middleware`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { homeForRole } from '@/lib/auth/roleHome';

const PUBLIC_PREFIXES = ['/login', '/set-password', '/logout', '/auth', '/trial-expired'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** Refresh the Supabase session cookie and apply coarse login/home redirects. */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options));
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  // Helper: build a redirect that carries the refreshed cookies.
  const redirectTo = (path: string, search = '') => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = search;
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (user && (pathname === '/' || pathname === '/login')) {
    const { data: profile } = await supabase
      .from('users').select('role').eq('id', user.id).single();
    return redirectTo(homeForRole(profile?.role ?? null));
  }

  if (!user && pathname === '/') return redirectTo('/login');
  if (!user && !isPublic(pathname)) return redirectTo('/login', '?expired=true');

  return response;
}
```

```ts
// middleware.ts  (repo root)
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on everything except Next internals and static image assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images/).*)'],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/supabase/__tests__/middleware.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/middleware.ts middleware.ts src/lib/supabase/__tests__/middleware.test.ts
git commit -m "feat(auth): session-refresh middleware + login/home redirects"
```

---

### Task 4: Extend `/auth/callback` with the `token_hash` branch

**Files:**
- Modify: `src/app/auth/callback/route.ts`
- Test: `src/app/auth/__tests__/callback.test.ts` (extend existing)

**Interfaces:**
- Consumes: `createServerSupabaseClient`, existing `isSafeRedirectPath`.
- Produces: `GET` now also handles `token_hash` + `type`: `verifyOtp({ type, token_hash })` → success → redirect to safe `next` (default `/`); failure → `/login?error=reset_expired`. The existing `code` branch is unchanged.

- [ ] **Step 1: Write the failing test (append to the existing describe block)**

```ts
// add to src/app/auth/__tests__/callback.test.ts

  function mockVerifySuccess() {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { verifyOtp: vi.fn().mockResolvedValue({ error: null }) },
    } as never);
  }
  function mockVerifyError() {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { verifyOtp: vi.fn().mockResolvedValue({ error: new Error('expired') }) },
    } as never);
  }
  function makeOtpRequest(base: string, tokenHash: string, type: string, next?: string): Request {
    const url = new URL(base);
    url.searchParams.set('token_hash', tokenHash);
    url.searchParams.set('type', type);
    if (next) url.searchParams.set('next', next);
    return new Request(url);
  }

  it('verifyOtp success with next=/set-password redirects there', async () => {
    mockVerifySuccess();
    const res = await GET(makeOtpRequest('https://localhost:3000/auth/callback', 'th', 'recovery', '/set-password'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://localhost:3000/set-password');
  });

  it('verifyOtp success without next redirects to /', async () => {
    mockVerifySuccess();
    const res = await GET(makeOtpRequest('https://localhost:3000/auth/callback', 'th', 'magiclink'));
    expect(res.headers.get('location')).toBe('https://localhost:3000/');
  });

  it('verifyOtp failure redirects to /login?error=reset_expired', async () => {
    mockVerifyError();
    const res = await GET(makeOtpRequest('https://localhost:3000/auth/callback', 'bad', 'recovery', '/set-password'));
    expect(res.headers.get('location')).toBe('https://localhost:3000/login?error=reset_expired');
  });

  it('rejects an unsafe next in the token_hash branch', async () => {
    mockVerifySuccess();
    const res = await GET(makeOtpRequest('https://localhost:3000/auth/callback', 'th', 'recovery', '//evil.com'));
    expect(res.headers.get('location')).toBe('https://localhost:3000/');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/auth/__tests__/callback.test.ts`
Expected: FAIL — token_hash requests currently fall through to `/auth/auth-code-error`.

- [ ] **Step 3: Write minimal implementation (replace the file)**

```ts
// src/app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';

function isSafeRedirectPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('://') && !path.includes('\\');
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const nextParam = searchParams.get('next') ?? '/';
  const next = isSafeRedirectPath(nextParam) ? nextParam : '/';

  // Recovery / magic-link / email-confirm via token_hash.
  if (tokenHash && type) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=reset_expired`);
  }

  // OAuth / magic-link PKCE exchange.
  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/auth/__tests__/callback.test.ts`
Expected: PASS (all original + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/app/auth/callback/route.ts src/app/auth/__tests__/callback.test.ts
git commit -m "feat(auth): callback token_hash branch (recovery/magic-link verifyOtp)"
```

---

### Task 5: Port slideshow assets + `BackgroundRotator`

**Files:**
- Create (copy): `public/images/login/login-classroom-ai.jpg`, `login-student-before-after.jpg`, `login-brain-ai.jpg`, `login-learning-paths.jpg`, `login-student-discovery.jpg`
- Create: `src/app/login/_components/BackgroundRotator.tsx`
- Test: `src/app/login/_components/__tests__/BackgroundRotator.test.tsx`

**Interfaces:**
- Produces: default-exported `BackgroundRotator` (`'use client'`), no props. Renders a full-size rotating photo backdrop with 5 captions and 5 nav dots (`role="tablist"`, each dot a `button`), cycling every 7000 ms; current caption has `data-active="true"`. Captions (in order): `["The future of education is brilliantly personal.","Every student has the potential to transform.","Intelligence flows in every direction.","Every mind is an explosion waiting to happen.","Learning is the most colorful adventure."]`.

- [ ] **Step 1: Copy the image assets**

```bash
mkdir -p public/images/login
cp "C:/users/inteliflow/core/public/images/login/login-classroom-ai.jpg" \
   "C:/users/inteliflow/core/public/images/login/login-student-before-after.jpg" \
   "C:/users/inteliflow/core/public/images/login/login-brain-ai.jpg" \
   "C:/users/inteliflow/core/public/images/login/login-learning-paths.jpg" \
   "C:/users/inteliflow/core/public/images/login/login-student-discovery.jpg" \
   public/images/login/
ls public/images/login/
```
Expected: 5 `.jpg` files listed.

- [ ] **Step 2: Write the failing test**

```tsx
// src/app/login/_components/__tests__/BackgroundRotator.test.tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import BackgroundRotator from '../BackgroundRotator';

afterEach(() => vi.useRealTimers());

describe('BackgroundRotator', () => {
  it('renders the first caption active on mount', () => {
    render(<BackgroundRotator />);
    expect(screen.getByText('The future of education is brilliantly personal.')).toBeInTheDocument();
  });

  it('renders five navigation dots', () => {
    render(<BackgroundRotator />);
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });

  it('advances the active caption after the interval', () => {
    vi.useFakeTimers();
    render(<BackgroundRotator />);
    act(() => { vi.advanceTimersByTime(7000); });
    const active = screen.getByRole('tab', { selected: true });
    expect(active).toHaveAttribute('aria-label', expect.stringContaining('2'));
  });

  it('jumps to a slide when its dot is clicked', () => {
    vi.useFakeTimers();
    render(<BackgroundRotator />);
    const dots = screen.getAllByRole('tab');
    act(() => { dots[3].click(); });
    expect(dots[3]).toHaveAttribute('aria-selected', 'true');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/login/_components/__tests__/BackgroundRotator.test.tsx`
Expected: FAIL — cannot resolve `../BackgroundRotator`.

- [ ] **Step 4: Write minimal implementation**

```tsx
// src/app/login/_components/BackgroundRotator.tsx
'use client';

import { useEffect, useRef, useState } from 'react';

const SLIDES = [
  { src: '/images/login/login-classroom-ai.jpg', caption: 'The future of education is brilliantly personal.' },
  { src: '/images/login/login-student-before-after.jpg', caption: 'Every student has the potential to transform.' },
  { src: '/images/login/login-brain-ai.jpg', caption: 'Intelligence flows in every direction.' },
  { src: '/images/login/login-learning-paths.jpg', caption: 'Every mind is an explosion waiting to happen.' },
  { src: '/images/login/login-student-discovery.jpg', caption: 'Learning is the most colorful adventure.' },
];
const INTERVAL = 7000;

export default function BackgroundRotator() {
  const [current, setCurrent] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timer.current = setTimeout(() => setCurrent((c) => (c + 1) % SLIDES.length), INTERVAL);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [current]);

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ backgroundColor: 'var(--ink-950)' }}>
      {SLIDES.map((s, i) => (
        <div
          key={s.src}
          aria-hidden
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000"
          style={{ backgroundImage: `url(${s.src})`, opacity: i === current ? 1 : 0 }}
        />
      ))}
      {/* Scrim for caption legibility (Tier-1 primitive — sanctioned per spec G3). */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, var(--ink-950) 0%, transparent 55%)' }}
      />
      <p
        className="absolute bottom-16 left-8 right-8 text-lg font-display"
        data-active="true"
        style={{ color: 'var(--white)', textShadow: '0 1px 8px rgb(0 0 0 / 0.6)' }}
      >
        {SLIDES[current].caption}
      </p>
      <div role="tablist" aria-label="Slideshow" className="absolute bottom-8 left-8 flex gap-2">
        {SLIDES.map((s, i) => (
          <button
            key={s.src}
            role="tab"
            type="button"
            aria-selected={i === current}
            aria-label={`Slide ${i + 1} of ${SLIDES.length}`}
            onClick={() => setCurrent(i)}
            className="h-1.5 rounded-full transition-all"
            style={{
              width: i === current ? '20px' : '6px',
              backgroundColor: 'var(--white)',
              opacity: i === current ? 0.9 : 0.35,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes + commit**

Run: `npx vitest run src/app/login/_components/__tests__/BackgroundRotator.test.tsx`
Expected: PASS (4 tests).

```bash
git add public/images/login src/app/login/_components/BackgroundRotator.tsx src/app/login/_components/__tests__/BackgroundRotator.test.tsx
git commit -m "feat(login): port slideshow assets + BackgroundRotator"
```

---

### Task 6: `/login` split-panel page

**Files:**
- Create: `src/app/login/page.tsx`
- Test: `src/app/login/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `createBrowserSupabaseClient` (`@/lib/supabase/client`), `useRouter`/`useSearchParams` (`next/navigation`), `ROLE_HOME`/`homeForRole` (Task 1), `BackgroundRotator` (Task 5).
- Produces: default-exported page (Suspense-wrapped client component). Three modes via a `mode` state (`'signin'|'magic'|'forgot'`). Email input always; password input (with show/hide) in signin; submit button labelled per mode. On signin success: read `users.role` → `router.push(homeForRole(role))` + `router.refresh()`. Magic: `signInWithOtp({ email, options: { emailRedirectTo: \`${window.location.origin}/auth/callback\` } })`. Forgot: `resetPasswordForEmail(email, { redirectTo: \`${window.location.origin}/auth/callback?next=/set-password\` })`. Reads `?error=`/`?expired=true` for a banner.

> **Test note:** mock `next/navigation` (`useRouter` → `{ push, refresh }`, `useSearchParams` → `new URLSearchParams()`) and `@/lib/supabase/client`. Because the page uses `<Suspense>`, the default export renders the inner client component; test the inner component directly OR render the default export (both work since the mock makes it synchronous).

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/login/__tests__/page.test.tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
const refresh = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => searchParams,
}));

const signInWithPassword = vi.fn();
const signInWithOtp = vi.fn();
const resetPasswordForEmail = vi.fn();
const single = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { signInWithPassword, signInWithOtp, resetPasswordForEmail },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}));

import LoginPage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
});

describe('LoginPage', () => {
  it('renders email + password fields and the sign-in button by default', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in to core/i })).toBeInTheDocument();
  });

  it('signs in and routes to the role home', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    single.mockResolvedValue({ data: { role: 'teacher' } });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.edu' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in to core/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/today'));
  });

  it('shows an error banner on bad credentials', async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.edu' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in to core/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('switches to magic-link mode and calls signInWithOtp', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /magic link/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
  });

  it('switches to forgot mode and calls resetPasswordForEmail', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /forgot/i }));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled());
  });

  it('shows the session-expired banner when ?expired=true', () => {
    searchParams = new URLSearchParams('expired=true');
    render(<LoginPage />);
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/login/__tests__/page.test.tsx`
Expected: FAIL — cannot resolve `../page`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/app/login/page.tsx
'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { homeForRole } from '@/lib/auth/roleHome';
import BackgroundRotator from './_components/BackgroundRotator';

type Mode = 'signin' | 'magic' | 'forgot';

const ERROR_COPY: Record<string, string> = {
  auth_failed: 'Sign-in failed. Please try again.',
  reset_expired: 'That reset link has expired. Request a new one below.',
  not_provisioned: 'No CORE account found for that email.',
};

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = createBrowserSupabaseClient();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(ERROR_COPY[params.get('error') ?? ''] ?? null);
  const [success, setSuccess] = useState<string | null>(null);
  const expired = params.get('expired') === 'true';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setSuccess(null);
    try {
      if (mode === 'signin') {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setError(error.message); return; }
        const { data: profile } = await supabase
          .from('users').select('role').eq('id', data.user!.id).single();
        router.push(homeForRole(profile?.role ?? null));
        router.refresh();
      } else if (mode === 'magic') {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) { setError(error.message); return; }
        setSuccess('Check your email for a one-click sign-in link.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/set-password`,
        });
        if (error) { setError(error.message); return; }
        setSuccess('Check your email for a password-reset link.');
      }
    } finally {
      setLoading(false);
    }
  }

  const submitLabel = loading ? 'Please wait…'
    : mode === 'signin' ? 'Sign in to CORE'
    : mode === 'magic' ? 'Send magic link'
    : 'Send reset link';

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-bg">
      <div className="relative hidden md:block">
        <BackgroundRotator />
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm rounded-lg bg-surface p-8 shadow-pop">
          <div className="mb-6">
            <span className="font-display font-bold text-brand text-2xl tracking-tight">◆ CORE</span>
            <p className="mt-1 text-sm text-fg-muted">Learning Intelligence</p>
          </div>

          {/* Mode toggle (hidden in forgot) */}
          {mode !== 'forgot' && (
            <div className="mb-5 inline-flex rounded bg-bg p-1" role="tablist">
              <button type="button" onClick={() => setMode('signin')}
                className={`px-3 py-1 text-sm rounded ${mode === 'signin' ? 'bg-surface text-fg shadow' : 'text-fg-muted'}`}>
                Password
              </button>
              <button type="button" onClick={() => setMode('magic')}
                className={`px-3 py-1 text-sm rounded ${mode === 'magic' ? 'bg-surface text-fg shadow' : 'text-fg-muted'}`}>
                Magic Link
              </button>
            </div>
          )}

          {expired && (
            <div role="status" className="mb-4 rounded bg-warn-surface text-warn-fg px-3 py-2 text-sm">
              Your session expired — please sign in again.
            </div>
          )}
          {error && (
            <div role="alert" className="mb-4 rounded bg-risk-surface text-risk-fg px-3 py-2 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div role="status" className="mb-4 rounded bg-ok-surface text-ok-fg px-3 py-2 text-sm">
              {success}
            </div>
          )}

          {mode === 'forgot' && (
            <button type="button" onClick={() => setMode('signin')}
              className="mb-3 text-sm text-fg-muted hover:text-brand">← Back to sign in</button>
          )}

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-fg">
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email" placeholder="you@school.edu"
                className="rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg" />
            </label>

            {mode === 'signin' && (
              <label className="flex flex-col gap-1 text-sm text-fg">
                <span className="flex items-center justify-between">
                  Password
                  <button type="button" onClick={() => setMode('forgot')}
                    className="text-xs text-fg-muted hover:text-brand">Forgot?</button>
                </span>
                <span className="relative">
                  <input type={showPw ? 'text' : 'password'} required value={password}
                    onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                    className="w-full rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg" />
                  <button type="button" onClick={() => setShowPw((s) => !s)}
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-fg-muted">
                    {showPw ? 'Hide' : 'Show'}
                  </button>
                </span>
              </label>
            )}

            {mode === 'magic' && (
              <p className="text-sm text-fg-muted">We&apos;ll email you a one-click link. No password needed.</p>
            )}

            <button type="submit" disabled={loading}
              className="rounded bg-brand px-4 py-2 font-medium text-fg-on-brand disabled:opacity-60">
              {submitLabel}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-fg-muted">CORE · Inteliflow AI · FERPA compliant</p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg" />}>
      <LoginInner />
    </Suspense>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/login/__tests__/page.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/login/page.tsx src/app/login/__tests__/page.test.tsx
git commit -m "feat(login): split-panel /login page (password + magic + forgot)"
```

---

### Task 7: `/set-password` page

**Files:**
- Create: `src/app/set-password/page.tsx`
- Test: `src/app/set-password/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `createBrowserSupabaseClient`, `useRouter`.
- Produces: default-exported `'use client'` page. On mount: `getSession()`; if a session exists → `ready=true`; also `onAuthStateChange` listener flips `ready` on `PASSWORD_RECOVERY`/`SIGNED_IN`. Until ready shows "Verifying your reset link…". Form: password + confirm; validates ≥8 and match; `updateUser({ password })`; on success shows confirmation then `router.push('/login')`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/set-password/__tests__/page.test.tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const getSession = vi.fn();
const updateUser = vi.fn();
const onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getSession, updateUser, onAuthStateChange } }),
}));

import SetPasswordPage from '../page';

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
});

describe('SetPasswordPage', () => {
  it('shows the form once a session is present', async () => {
    render(<SetPasswordPage />);
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeInTheDocument());
  });

  it('rejects a password shorter than 8 chars', async () => {
    render(<SetPasswordPage />);
    await waitFor(() => screen.getByLabelText(/new password/i));
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords', async () => {
    render(<SetPasswordPage />);
    await waitFor(() => screen.getByLabelText(/new password/i));
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'different1' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('calls updateUser and redirects on success', async () => {
    updateUser.mockResolvedValue({ error: null });
    render(<SetPasswordPage />);
    await waitFor(() => screen.getByLabelText(/new password/i));
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'longenough1' } });
    fireEvent.change(screen.getByLabelText(/confirm/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'longenough1' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/set-password/__tests__/page.test.tsx`
Expected: FAIL — cannot resolve `../page`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/app/set-password/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export default function SetPasswordPage() {
  const router = useRouter();
  const [supabase] = useState(() => createBrowserSupabaseClient());
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); return; }
    setDone(true);
    setTimeout(() => router.push('/login'), 1500);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-lg bg-surface p-8 shadow-pop">
        <span className="font-display font-bold text-brand text-2xl tracking-tight">◆ CORE</span>
        <h1 className="mt-4 mb-1 text-lg font-display text-fg">Set your password</h1>
        {!ready ? (
          <p className="text-sm text-fg-muted">Verifying your reset link…</p>
        ) : done ? (
          <p role="status" className="rounded bg-ok-surface text-ok-fg px-3 py-2 text-sm">
            Password updated! Redirecting…
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
            {error && (
              <div role="alert" className="rounded bg-risk-surface text-risk-fg px-3 py-2 text-sm">{error}</div>
            )}
            <label className="flex flex-col gap-1 text-sm text-fg">
              New password
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" className="rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-fg">
              Confirm password
              <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password" className="rounded border border-fg-muted bg-bg px-3 py-2 text-base text-fg" />
            </label>
            <button type="submit" className="rounded bg-brand px-4 py-2 font-medium text-fg-on-brand">Set password</button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes + commit**

Run: `npx vitest run src/app/set-password/__tests__/page.test.tsx`
Expected: PASS (4 tests).

```bash
git add src/app/set-password/page.tsx src/app/set-password/__tests__/page.test.tsx
git commit -m "feat(auth): /set-password page (updateUser on recovery session)"
```

---

### Task 8: `/logout`, `/auth/auth-code-error`, `/trial-expired`, root redirect, role placeholders

**Files:**
- Create: `src/app/logout/route.ts`
- Create: `src/app/auth/auth-code-error/page.tsx`
- Create: `src/app/trial-expired/page.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/app/(student)/student-home/page.tsx`, `src/app/(parent)/parent-home/page.tsx`, `src/app/(school-admin)/admin-home/page.tsx`
- Test: `src/app/logout/__tests__/route.test.ts`, `src/app/__tests__/root-redirect.test.ts`

**Interfaces:**
- Consumes: `createServerSupabaseClient`, `homeForRole`, `redirect`/`NextResponse`.
- Produces: `logout` route `POST`+`GET` → `signOut()` → 307 to `/login`. `auth-code-error`, `trial-expired`, and the three `*-home` pages are server components rendering a token-styled card. Root `page.tsx` becomes an async server component: `getUser()` → authed → `redirect(homeForRole(role))`, else `redirect('/login')`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/logout/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { POST, GET } from '../route';

beforeEach(() => vi.clearAllMocks());

function mockSignOut() {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  vi.mocked(createServerSupabaseClient).mockResolvedValue({ auth: { signOut } } as never);
  return signOut;
}

describe('logout route', () => {
  it('POST signs out and redirects to /login', async () => {
    const signOut = mockSignOut();
    const res = await POST(new Request('https://app.test/logout', { method: 'POST' }));
    expect(signOut).toHaveBeenCalled();
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/login');
  });

  it('GET also signs out and redirects', async () => {
    mockSignOut();
    const res = await GET(new Request('https://app.test/logout'));
    expect(res.headers.get('location')).toBe('https://app.test/login');
  });
});
```

```ts
// src/app/__tests__/root-redirect.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((p: string) => { throw new Error(`REDIRECT:${p}`); }),
}));
import { createServerSupabaseClient } from '@/lib/supabase/server';
import Home from '../page';

beforeEach(() => vi.clearAllMocks());

it('redirects an unauthenticated visitor to /login', async () => {
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: null } }) },
  } as never);
  await expect(Home()).rejects.toThrow('REDIRECT:/login');
});

it('redirects an authenticated teacher to /today', async () => {
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'teacher' } }) }) }) }),
  } as never);
  await expect(Home()).rejects.toThrow('REDIRECT:/today');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/logout/__tests__/route.test.ts src/app/__tests__/root-redirect.test.ts`
Expected: FAIL — modules not found / root page not async.

- [ ] **Step 3: Write the implementations**

```ts
// src/app/logout/route.ts
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

async function handle(request: Request) {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url));
}
export const POST = handle;
export const GET = handle;
```

```tsx
// src/app/page.tsx
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { homeForRole } from '@/lib/auth/roleHome';

export default async function Home() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  redirect(homeForRole(profile?.role ?? null));
}
```

```tsx
// src/app/auth/auth-code-error/page.tsx
import Link from 'next/link';

export default function AuthCodeError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-lg bg-surface p-8 shadow-pop text-center">
        <span className="font-display font-bold text-brand text-2xl tracking-tight">◆ CORE</span>
        <h1 className="mt-4 mb-2 text-lg font-display text-fg">That link didn&apos;t work</h1>
        <p className="mb-6 text-sm text-fg">Your sign-in link may have expired. Request a new one.</p>
        <Link href="/login" className="inline-block rounded bg-brand px-4 py-2 font-medium text-fg-on-brand">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
```

```tsx
// src/app/trial-expired/page.tsx
import Link from 'next/link';

export default function TrialExpired() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md rounded-lg bg-surface p-8 shadow-pop text-center">
        <span className="font-display font-bold text-brand text-2xl tracking-tight">◆ CORE</span>
        <h1 className="mt-4 mb-2 text-xl font-display text-fg">Your trial has ended</h1>
        <p className="mb-6 text-sm text-fg">
          Thanks for trying CORE. To keep your class&apos;s insights, reach out and we&apos;ll get you set up.
        </p>
        <Link href="mailto:hello@inteliflowai.com" className="inline-block rounded bg-brand px-4 py-2 font-medium text-fg-on-brand">
          Contact us
        </Link>
        <p className="mt-6"><Link href="/logout" className="text-sm text-fg-muted hover:text-brand">Sign out</Link></p>
      </div>
    </div>
  );
}
```

```tsx
// src/app/(student)/student-home/page.tsx
export default function StudentHome() {
  return (
    <div className="p-8">
      <div className="rounded-lg bg-surface p-8 shadow">
        <h1 className="font-display text-fg text-xl">Your CORE space is being set up</h1>
        <p className="mt-2 text-fg">Check back soon — your learning view is on the way.</p>
      </div>
    </div>
  );
}
```

```tsx
// src/app/(parent)/parent-home/page.tsx
export default function ParentHome() {
  return (
    <div className="p-8">
      <div className="rounded-lg bg-surface p-8 shadow">
        <h1 className="font-display text-fg text-xl">Your CORE space is being set up</h1>
        <p className="mt-2 text-fg">Check back soon — your family view is on the way.</p>
      </div>
    </div>
  );
}
```

```tsx
// src/app/(school-admin)/admin-home/page.tsx
export default function AdminHome() {
  return (
    <div className="p-8">
      <div className="rounded-lg bg-surface p-8 shadow">
        <h1 className="font-display text-fg text-xl">Your CORE space is being set up</h1>
        <p className="mt-2 text-fg">Check back soon — your school view is on the way.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/logout/__tests__/route.test.ts src/app/__tests__/root-redirect.test.ts`
Expected: PASS (4 tests). (The `*-home`, `auth-code-error`, `trial-expired` pages are static and covered by the Task 9 layout-guard tests + the full build.)

- [ ] **Step 5: Commit**

```bash
git add src/app/logout src/app/auth/auth-code-error src/app/trial-expired src/app/page.tsx \
  "src/app/(student)/student-home" "src/app/(parent)/parent-home" "src/app/(school-admin)/admin-home" \
  src/app/__tests__/root-redirect.test.ts
git commit -m "feat(auth): logout, auth-code-error, trial-expired, root redirect, role placeholders"
```

---

### Task 9: Wire `requireRole` into the 5 route-group layouts

**Files:**
- Modify: `src/app/(teacher)/layout.tsx`, `src/app/(student)/layout.tsx`, `src/app/(parent)/layout.tsx`, `src/app/(school-admin)/layout.tsx`, `src/app/(super-admin)/layout.tsx`
- Test: `src/app/(teacher)/__tests__/layout.guard.test.tsx`

**Interfaces:**
- Consumes: `requireRole` (Task 2). Each layout becomes an `async` Server Component that `await requireRole([...])` before rendering its existing `RoleLayout` shell. Allow-lists: teacher → `['teacher']`; student → `['student']`; parent → `['parent']`; school-admin → `['school_admin','school_sysadmin','platform_admin']`; super-admin → `['platform_admin']`. **Preserve each layout's existing `RoleLayout` role prop, nav, and children.** Also: in `(super-admin)/layout.tsx`, add a working `/provision` nav link (the existing `/platform/*` links are dead until that console is built).

> **First read each layout file** — only `(teacher)` composes `TeacherNav` + `ClassSwitcherPill`; the others differ. Add the guard without disturbing the shell. `requireRole` redirects internally, so just `await` it.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/(teacher)/__tests__/layout.guard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireRole = vi.fn();
vi.mock('@/lib/auth/requireRole', () => ({ requireRole }));
// Stub child components so the layout renders in isolation (node env).
vi.mock('@/components/core/RoleLayout', () => ({ RoleLayout: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('../_components/TeacherNav', () => ({ TeacherNav: () => null }));
vi.mock('../_components/ClassSwitcherPill', () => ({ ClassSwitcherPill: () => null }));

import TeacherLayout from '../layout';

beforeEach(() => vi.clearAllMocks());

it('calls requireRole with the teacher allow-list', async () => {
  requireRole.mockResolvedValue({ userId: 'u1', role: 'teacher', schoolId: 's1' });
  await TeacherLayout({ children: null });
  expect(requireRole).toHaveBeenCalledWith(['teacher']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/(teacher)/__tests__/layout.guard.test.tsx"`
Expected: FAIL — `TeacherLayout` is not async / does not call `requireRole`.

- [ ] **Step 3: Modify the teacher layout (template for the rest)**

```tsx
// src/app/(teacher)/layout.tsx
import { RoleLayout } from '@/components/core/RoleLayout';
import { requireRole } from '@/lib/auth/requireRole';
import { TeacherNav } from './_components/TeacherNav';
import { ClassSwitcherPill } from './_components/ClassSwitcherPill';

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  await requireRole(['teacher']);
  return (
    <RoleLayout role="teacher" nav={<><TeacherNav /><ClassSwitcherPill /></>}>
      {children}
    </RoleLayout>
  );
}
```

Apply the same pattern to the other four (read each first; keep its `role=` and `nav=`):
- `(student)/layout.tsx` → `await requireRole(['student']);`
- `(parent)/layout.tsx` → `await requireRole(['parent']);`
- `(school-admin)/layout.tsx` → `await requireRole(['school_admin', 'school_sysadmin', 'platform_admin']);`
- `(super-admin)/layout.tsx` → `await requireRole(['platform_admin']);` AND add a `/provision` nav `<a>` (alongside or replacing the dead `/platform/*` links):

```tsx
// inside (super-admin)/layout.tsx nav
<a href="/provision" className="text-[var(--fg)] hover:text-[var(--brand)] px-3 py-1">Provision</a>
```

- [ ] **Step 4: Run test + full suite to verify**

Run: `npx vitest run "src/app/(teacher)/__tests__/layout.guard.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(teacher)/layout.tsx" "src/app/(student)/layout.tsx" "src/app/(parent)/layout.tsx" \
  "src/app/(school-admin)/layout.tsx" "src/app/(super-admin)/layout.tsx" \
  "src/app/(teacher)/__tests__/layout.guard.test.tsx"
git commit -m "feat(auth): server-layout role guards on all 5 route groups"
```

---

### Task 10: Whole-feature verification

**Files:** none (verification only).

- [ ] **Step 1: Type-check + build**

Run: `npx tsc --noEmit`
Expected: no errors. (Then `npm run build` if time permits — it also type-checks.)

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all suites pass (existing 982 + the new auth tests).

- [ ] **Step 3: a11y gate**

Run: `npm run a11y`
Expected: all pairs pass (this plan didn't touch `globals.css`).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Manual smoke (optional, needs `.env.local` + real Supabase)**

`npm run dev` → visit `/` (→ `/login`), sign in with a demo account, confirm role-home redirect; hit a protected route while logged out (→ `/login?expired=true`).

---

## Self-Review (completed by plan author)

- **Spec coverage:** §2 routes → Tasks 4,5,6,7,8 (+ middleware T3, guards T9). §3 decisions D1–D7 → split-panel (T6), no SSO buttons (T6 omits them), magic-link (T6), middleware+guards (T3,T9), placeholders (T8), tokens/fonts (T6 constraints). §4 protection → T2,T3,T9. §4.3 ROLE_HOME → T1. §5.1–5.7 → T5,T6,T7,T8. §7 testing → every task is TDD + T10. ✓
- **Placeholder scan:** no TBD/"handle errors"/"similar to" — every code step is complete. ✓
- **Type consistency:** `homeForRole`/`ROLE_HOME` (T1) consumed identically in T2/T3/T6/T8; `requireRole(allowed)` signature consistent T2↔T9; `AuthedContext` shape consistent; `createBrowserSupabaseClient`/`createServerSupabaseClient` names match the real factories. ✓
- **Known follow-ups (out of Phase 1, noted in spec):** SSO buttons + routes + migration (Phase 2); the super-admin `/platform/*` console pages remain unbuilt (T9 adds a working `/provision` link so the group isn't a dead end).
