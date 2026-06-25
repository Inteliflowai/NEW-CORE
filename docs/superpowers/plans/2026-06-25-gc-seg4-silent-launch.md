# Google Classroom Segment 4 — Student Silent-SSO Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student tapping the public Open-CORE link pinned in Google Classroom (`${APP_BASE_URL}/?gc=<quiz|assignment>&id=<id>`) lands authenticated in CORE with no password — their Google identity (already signed in for Classroom) authenticates them, maps via `external_identities` to their CORE student, mints a Supabase session, and deep-links to the work.

**Architecture:** Reuse the Seg-1 OAuth code flow (`exchangeCodeForTokens` → `getGoogleProfile` → `verified_email`) in *silent* mode (`prompt=none`, identity scopes only). The public link carries NO identity — only a destination (`gc`/`id`), a one-time nonce, and a 10-min expiry inside an **HMAC-signed launch state** (`GOOGLE_LAUNCH_STATE_SECRET`). The existing `/api/auth/google/callback` branches on the `launch:` state prefix: the launch branch verifies the state + nonce, establishes identity from Google, derives the candidate school from the launched resource, calls `resolveExternalIdentity`, mints a session via `generateLink`+`verifyOtp` (V1's mechanism, mirrors `/auth/callback`), and deep-links. No match → friendly `/launch/unmatched`; never auto-creates. The proxy carve-out is minimal: the initiator is public, the callback is let through **only** when it carries a `launch:` state, and an unauthenticated `/?gc=…` is diverted to the initiator.

**Tech Stack:** Next.js 16.2.9 App Router (async `params`/`searchParams`/`cookies()`), React 19, TypeScript strict, `node:crypto` (zero new deps), Supabase (`@supabase/ssr` + service-role admin), Vitest 4.

## Global Constraints

- **Security posture (binding — this is the security-critical segment):** identity comes ONLY from Google's verified profile, NEVER from a link param. Sign launch state with HMAC-SHA256 + a one-time nonce (httpOnly + sameSite=lax cookie) + 10-min TTL + **timing-safe** compare. Reject `verified_email === false`. Confirm the resolved user's `role === 'student'` **AND that the student has an ACTIVE enrollment in the launched resource's class** (`enrollments WHERE student_id=resolved AND class_id=<resource class> AND is_active=true`) before minting — spec §6 / grounding §6-D6 (school + class). **Never auto-create** an account on the launch path. Allow-list every redirect destination to internal `/student` paths only (reject `//`, `://`, `\`, CRLF, and `/../` traversal).
- **Nonce-cookie hardening (M1):** the nonce travels in the (signed-but-not-encrypted) state too, so it is NOT secret — the replay/CSRF defense rests on the attacker not being able to set the cookie. CORE runs sibling apps under `*.inteliflowai.com`; to stop a sibling setting `Domain=.inteliflowai.com`, the nonce cookie uses the **`__Host-` prefix in production** (forbids a `Domain` attribute → no sibling can set or shadow it) with `Secure: true` always; plain name only on local http (`NODE_ENV !== 'production'`). `httpOnly`, `sameSite='lax'`, `path='/'`, no `domain`.
- **Minimal proxy carve-out:** make ONLY the launch initiator (`/api/auth/google/launch`) and `/launch/unmatched` public. The callback (`/api/auth/google/callback`) stays NON-public — the proxy lets it through ONLY when `?state` starts with `launch:` (the handler HMAC-verifies). Never make the callback fully public; the teacher-connect path is unchanged.
- **Reuse Seg-1/2 primitives — zero new dependencies:** `exchangeCodeForTokens`, `getGoogleProfile`, `resolveExternalIdentity`, `createServerSupabaseClient`/`createAdminSupabaseClient`, `homeForRole`. No `jose`/`google-auth-library`/`jsonwebtoken`. HMAC via `node:crypto` mirroring `src/lib/spark/signLaunchJwt.ts`.
- **Session minting (V1-proven):** `admin.auth.admin.generateLink({type:'magiclink', email})` → `token_hash = data.properties.hashed_token` → `serverClient.auth.verifyOtp({type:'magiclink', token_hash})`. This mirrors the live `/auth/callback` route (the proof that `verifyOtp` sets cookies that survive a returned `NextResponse.redirect`).
- **Launch scopes = identity only:** `['openid','email','profile']` — NEVER GC_SCOPES (students never grant classroom scopes; requesting them would force a consent wall).
- **Deep-link (locked):** `?gc=assignment&id=<lessonId>` → the student's OWN `assignments` row (`student_id=resolved AND lesson_id=<id>`) → `/student/assignments/<row.id>` (the lookup IS the ownership proof; none → `/student/assignments`). `?gc=quiz&id=<quizId>` → `/student/quiz` (param-less page; per-quiz deep-link is a deferred follow-up).
- **`GOOGLE_LAUNCH_STATE_SECRET` is read at call-time** inside `launchState.ts` (so tests set it per-case), mirroring how `crypto.ts` reads `GOOGLE_TOKEN_ENC_KEY`. Fail-closed: `verifyLaunchState` returns `null` if the secret is missing; `signLaunchState` throws (the initiator catches → `/login?error=launch`).
- **NO migration** — reuses `external_identities`, `google_connections`, `assignments`, `quizzes`, `lessons`, `classes`.
- **Token-only Tailwind** on the one UI page (`/launch/unmatched`): use token classes already used by existing pages (`bg-surface`, `text-fg`, `bg-brand`, `text-fg-on-brand`, `border-surface`); `npm run a11y` must pass.
- **Test env headers:** library + route tests default to the node env. The ONE component/page test (`/launch/unmatched`) must start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`.
- **Gates (whole branch):** `npx tsc --noEmit` → 0, `npx vitest run` → green, `npm run build` → 0 (a11y + tokens).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/lib/google/launchState.ts` (create) | Sign/verify the HMAC launch state; `safeStudentDest` allow-list. Pure. | 1 |
| `src/lib/google/config.ts` (modify) | Add `LAUNCH_SCOPES` (identity-only). | 2 |
| `src/lib/google/oauthUrls.ts` (modify) | Add `buildLaunchAuthUrl(state, mode)`. | 2 |
| `src/lib/google/launchResolve.ts` (create) | `deriveResourceSchool` (resource→school) + `resolveGcDeepLink` (student's own dest). DB readers. | 3 |
| `src/app/api/auth/google/launch/route.ts` (create) | Silent-SSO initiator: nonce cookie + signed state + Google redirect; silent vs interactive. | 4 |
| `src/app/api/auth/google/callback/route.ts` (modify) | Branch on `launch:` state → the student-launch flow. Teacher path untouched. | 5 |
| `src/proxy.ts` (modify) | Public the initiator + unmatched page; divert `/?gc=`; let the launch callback through on signed state. | 6 |
| `src/app/page.tsx` (modify) | Authenticated `/?gc=` → deep-link a logged-in student directly (no Google). | 7 |
| `src/app/launch/unmatched/page.tsx` (create) | Friendly public no-match page. | 8 |

---

### Task 1: Launch-state signer/verifier + path allow-list

**Files:**
- Create: `src/lib/google/launchState.ts`
- Test: `src/lib/google/__tests__/launchState.test.ts`

**Interfaces:**
- Produces: `signLaunchState(input: {gc: LaunchGc; id: string; nonce: string; mode: LaunchMode}, nowSeconds?: number, ttlSeconds?: number): string`; `verifyLaunchState(state: string | null | undefined, nowSeconds?: number): LaunchPayload | null`; `safeStudentDest(path: string): string`; `LAUNCH_STATE_PREFIX = 'launch:'`; `LAUNCH_TTL_SECONDS = 600`; `NONCE_COOKIE_NAME` (the `__Host-`-prefixed nonce cookie name, M1 — imported by both routes); types `LaunchGc = 'quiz'|'assignment'`, `LaunchMode = 'silent'|'interactive'`, `LaunchPayload = {gc, id, nonce, mode, exp}`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/google/__tests__/launchState.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signLaunchState, verifyLaunchState, safeStudentDest, LAUNCH_STATE_PREFIX } from '@/lib/google/launchState';

const SECRET = 'test-launch-secret-0123456789abcdef';
beforeEach(() => { process.env.GOOGLE_LAUNCH_STATE_SECRET = SECRET; });
afterEach(() => { delete process.env.GOOGLE_LAUNCH_STATE_SECRET; });

describe('signLaunchState / verifyLaunchState', () => {
  it('round-trips a valid state', () => {
    const s = signLaunchState({ gc: 'assignment', id: 'L1', nonce: 'n1', mode: 'silent' });
    expect(s.startsWith(LAUNCH_STATE_PREFIX)).toBe(true);
    const p = verifyLaunchState(s);
    expect(p).toMatchObject({ gc: 'assignment', id: 'L1', nonce: 'n1', mode: 'silent' });
    expect(typeof p!.exp).toBe('number');
  });
  it('rejects a tampered signature', () => {
    const s = signLaunchState({ gc: 'quiz', id: 'Q1', nonce: 'n1', mode: 'silent' });
    const bad = s.slice(0, -2) + (s.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyLaunchState(bad)).toBeNull();
  });
  it('rejects a non-launch prefix', () => {
    expect(verifyLaunchState('csrf-abc')).toBeNull();
    expect(verifyLaunchState(null)).toBeNull();
  });
  it('rejects an expired state', () => {
    const expired = signLaunchState({ gc: 'quiz', id: 'Q1', nonce: 'n1', mode: 'silent' }, 1000, 1); // exp=1001
    expect(verifyLaunchState(expired)).toBeNull(); // default now = real wall-clock >> 1001
  });
  it('rejects invalid fields (gc / empty id / empty nonce / mode)', () => {
    // forge a structurally valid signature over a bad payload using the same secret
    const { createHmac } = require('crypto') as typeof import('crypto');
    const mk = (obj: object) => {
      const body = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
      const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
      return `${LAUNCH_STATE_PREFIX}${body}.${sig}`;
    };
    const now = Math.floor(Date.now() / 1000) + 100;
    expect(verifyLaunchState(mk({ gc: 'nope', id: 'x', nonce: 'n', mode: 'silent', exp: now }))).toBeNull();
    expect(verifyLaunchState(mk({ gc: 'quiz', id: '', nonce: 'n', mode: 'silent', exp: now }))).toBeNull();
    expect(verifyLaunchState(mk({ gc: 'quiz', id: 'x', nonce: '', mode: 'silent', exp: now }))).toBeNull();
    expect(verifyLaunchState(mk({ gc: 'quiz', id: 'x', nonce: 'n', mode: 'bogus', exp: now }))).toBeNull();
  });
  it('returns null when the secret is missing (fail-closed, no throw)', () => {
    const s = signLaunchState({ gc: 'quiz', id: 'Q1', nonce: 'n1', mode: 'silent' });
    delete process.env.GOOGLE_LAUNCH_STATE_SECRET;
    expect(verifyLaunchState(s)).toBeNull();
  });
});

describe('safeStudentDest', () => {
  it('passes internal /student paths', () => {
    expect(safeStudentDest('/student/assignments/abc')).toBe('/student/assignments/abc');
    expect(safeStudentDest('/student/quiz')).toBe('/student/quiz');
    expect(safeStudentDest('/student')).toBe('/student');
  });
  it('falls back for non-/student or unsafe paths', () => {
    expect(safeStudentDest('/teacher/x')).toBe('/student/dashboard');
    expect(safeStudentDest('//evil.com')).toBe('/student/dashboard');
    expect(safeStudentDest('https://evil.com')).toBe('/student/dashboard');
    expect(safeStudentDest('/student\\..\\x')).toBe('/student/dashboard');
    expect(safeStudentDest('/student/../admin')).toBe('/student/dashboard'); // forward-slash traversal (m4)
    expect(safeStudentDest('/student/x\nSet-Cookie: y')).toBe('/student/dashboard');
    expect(safeStudentDest('/studentfoo')).toBe('/student/dashboard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/google/__tests__/launchState.test.ts`
Expected: FAIL — cannot resolve `@/lib/google/launchState`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/google/launchState.ts
// Signed launch-state for the PUBLIC Open-CORE silent-SSO link (GC Seg 4). Zero-dep HMAC-SHA256
// (mirrors signLaunchJwt.ts). The state rides in the OAuth `state` param, so it carries NO
// identity — only the destination (gc/id), a one-time nonce (matched against an httpOnly cookie),
// a mode (silent vs interactive), and a 10-min expiry. Identity is established ONLY by Google's
// verified profile in the callback.
import { createHmac, timingSafeEqual } from 'crypto';

export const LAUNCH_STATE_PREFIX = 'launch:';
export const LAUNCH_TTL_SECONDS = 600; // 10 minutes

// The one-time nonce cookie name. The __Host- prefix (production) forbids a Domain attribute, so a
// sibling *.inteliflowai.com app cannot set or shadow it (M1); plain name on local http where the
// __Host- mandatory-Secure flag can't be honored. NODE_ENV is read once at module load.
export const NONCE_COOKIE_NAME = process.env.NODE_ENV === 'production' ? '__Host-g_launch_nonce' : 'g_launch_nonce';

export type LaunchGc = 'quiz' | 'assignment';
export type LaunchMode = 'silent' | 'interactive';

export interface LaunchPayload {
  gc: LaunchGc;
  id: string;
  nonce: string;
  mode: LaunchMode;
  exp: number; // epoch SECONDS
}

class LaunchSecretMissingError extends Error {
  constructor() { super('GOOGLE_LAUNCH_STATE_SECRET not set'); this.name = 'LaunchSecretMissingError'; }
}
function getSecret(): string {
  const s = (process.env.GOOGLE_LAUNCH_STATE_SECRET || '').trim();
  if (!s) throw new LaunchSecretMissingError();
  return s;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

/** Sign a launch state. `nowSeconds`/`ttlSeconds` are injectable for tests. Throws if the secret
 *  is unset (the initiator catches and falls back to /login). */
export function signLaunchState(
  input: { gc: LaunchGc; id: string; nonce: string; mode: LaunchMode },
  nowSeconds: number = Math.floor(Date.now() / 1000),
  ttlSeconds: number = LAUNCH_TTL_SECONDS,
): string {
  const payload: LaunchPayload = { ...input, exp: nowSeconds + ttlSeconds };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${LAUNCH_STATE_PREFIX}${body}.${sig}`;
}

/** Verify + parse a launch state. Returns null on ANY failure (fail-closed): bad prefix, missing
 *  secret, tampered/length-mismatched signature, malformed payload, expired, or invalid fields. */
export function verifyLaunchState(
  state: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): LaunchPayload | null {
  if (!state || !state.startsWith(LAUNCH_STATE_PREFIX)) return null;
  const rest = state.slice(LAUNCH_STATE_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);

  let expected: string;
  try { expected = createHmac('sha256', getSecret()).update(body).digest('base64url'); }
  catch { return null; } // secret missing → fail-closed

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: LaunchPayload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LaunchPayload; }
  catch { return null; }

  if (payload.gc !== 'quiz' && payload.gc !== 'assignment') return null;
  if (typeof payload.id !== 'string' || payload.id.length === 0) return null;
  if (typeof payload.nonce !== 'string' || payload.nonce.length === 0) return null;
  if (payload.mode !== 'silent' && payload.mode !== 'interactive') return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  return payload;
}

/** Allow-list a final redirect destination to internal /student paths only. Rejects
 *  protocol-relative (//), scheme (://), backslash, and CRLF. Returns /student/dashboard for
 *  anything not an allowed /student path. */
export function safeStudentDest(path: string): string {
  const FALLBACK = '/student/dashboard';
  if (typeof path !== 'string') return FALLBACK;
  if (path.startsWith('//')) return FALLBACK;
  if (path.includes('://') || path.includes('\\') || path.includes('\n') || path.includes('\r')) return FALLBACK;
  if (path.includes('/../') || path.endsWith('/..')) return FALLBACK; // forward-slash traversal (m4)
  if (path !== '/student' && !path.startsWith('/student/') && !path.startsWith('/student?')) return FALLBACK;
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/google/__tests__/launchState.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/google/launchState.ts src/lib/google/__tests__/launchState.test.ts
git commit -m "feat(gc-seg4): signed launch-state (HMAC + nonce + 10-min TTL) + /student path allow-list"
```

---

### Task 2: Launch OAuth URL builder + identity-only scopes

**Files:**
- Modify: `src/lib/google/config.ts` (add `LAUNCH_SCOPES`)
- Modify: `src/lib/google/oauthUrls.ts` (add `buildLaunchAuthUrl`)
- Test: `src/lib/google/__tests__/oauthUrls.launch.test.ts`

**Interfaces:**
- Consumes: `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI` (config.ts).
- Produces: `LAUNCH_SCOPES: string[]` (config.ts); `buildLaunchAuthUrl(state: string, mode: 'silent'|'interactive'): string` (oauthUrls.ts).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/google/__tests__/oauthUrls.launch.test.ts
import { describe, it, expect } from 'vitest';
import { buildLaunchAuthUrl } from '@/lib/google/oauthUrls';
import { LAUNCH_SCOPES } from '@/lib/google/config';

describe('buildLaunchAuthUrl', () => {
  it('identity scopes only (no classroom scopes)', () => {
    expect(LAUNCH_SCOPES).toEqual(['openid', 'email', 'profile']);
    const url = buildLaunchAuthUrl('launch:abc', 'silent');
    const sp = new URL(url).searchParams;
    expect(sp.get('scope')).toBe('openid email profile');
    expect(sp.get('scope')).not.toContain('classroom');
  });
  it('silent mode uses prompt=none', () => {
    const sp = new URL(buildLaunchAuthUrl('launch:abc', 'silent')).searchParams;
    expect(sp.get('prompt')).toBe('none');
    expect(sp.get('response_type')).toBe('code');
    expect(sp.get('state')).toBe('launch:abc');
  });
  it('interactive mode uses prompt=select_account', () => {
    const sp = new URL(buildLaunchAuthUrl('launch:abc', 'interactive')).searchParams;
    expect(sp.get('prompt')).toBe('select_account');
  });
  it('targets the Google consent endpoint', () => {
    expect(buildLaunchAuthUrl('launch:abc', 'silent')).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/google/__tests__/oauthUrls.launch.test.ts`
Expected: FAIL — `buildLaunchAuthUrl` / `LAUNCH_SCOPES` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/google/config.ts`, append after the `GC_REQUIRED_SCOPES` block:

```ts
// Silent-SSO launch (Seg 4) requests IDENTITY scopes only — students never grant classroom
// scopes, and requesting them would force a consent wall on the silent launch.
export const LAUNCH_SCOPES: string[] = ['openid', 'email', 'profile'];
```

In `src/lib/google/oauthUrls.ts`, update the import and append the function:

```ts
import { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, GC_SCOPES, LAUNCH_SCOPES } from '@/lib/google/config';

// (existing buildConnectAuthUrl unchanged) ...

/** Build the silent-SSO launch consent URL. `silent` → prompt=none (no UI for a Classroom student
 *  already in their Google session); `interactive` → prompt=select_account (the one retry when
 *  Google returns interaction_required). Identity scopes only; the signed launch state rides in
 *  `state`. Same registered redirect_uri as the teacher connect (the one Google callback). */
export function buildLaunchAuthUrl(state: string, mode: 'silent' | 'interactive'): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: LAUNCH_SCOPES.join(' '),
    state,
    prompt: mode === 'silent' ? 'none' : 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
```

(Keep the existing `buildConnectAuthUrl`; `GC_SCOPES` stays imported for it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/google/__tests__/oauthUrls.launch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google/config.ts src/lib/google/oauthUrls.ts src/lib/google/__tests__/oauthUrls.launch.test.ts
git commit -m "feat(gc-seg4): buildLaunchAuthUrl (prompt=none/select_account) + identity-only LAUNCH_SCOPES"
```

---

### Task 3: Resource→school derivation + student deep-link resolution

**Files:**
- Create: `src/lib/google/launchResolve.ts`
- Test: `src/lib/google/__tests__/launchResolve.test.ts`

**Interfaces:**
- Consumes: `LaunchGc` (from `@/lib/google/launchState`); a Supabase admin client.
- Produces: `deriveResourceSchool(admin, gc: LaunchGc, id: string): Promise<{schoolId: string; classId: string} | null>` (returns the class too — the callback needs it for the active-enrollment gate, M2); `resolveGcDeepLink(admin, args: {studentId: string; gc: LaunchGc; id: string}): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/google/__tests__/launchResolve.test.ts
import { describe, it, expect, vi } from 'vitest';
import { deriveResourceSchool, resolveGcDeepLink } from '@/lib/google/launchResolve';

// Chainable query stub: every builder method returns `this`; maybeSingle resolves to `result`.
function chain(result: unknown) {
  const o: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) o[m] = vi.fn(() => o);
  o.maybeSingle = vi.fn(async () => ({ data: result }));
  return o;
}
// Admin whose from() returns each queued chain result in order.
function adminWith(results: unknown[]) {
  const queue = [...results];
  return { from: vi.fn(() => chain(queue.shift())) } as never;
}

describe('deriveResourceSchool', () => {
  it('quiz → quizzes.class_id → classes.school_id', async () => {
    const admin = adminWith([{ class_id: 'c1' }, { school_id: 's1' }]);
    expect(await deriveResourceSchool(admin, 'quiz', 'Q1')).toEqual({ schoolId: 's1', classId: 'c1' });
  });
  it('assignment → lessons.class_id → classes.school_id', async () => {
    const admin = adminWith([{ class_id: 'c2' }, { school_id: 's9' }]);
    expect(await deriveResourceSchool(admin, 'assignment', 'L1')).toEqual({ schoolId: 's9', classId: 'c2' });
  });
  it('returns null when the resource is missing', async () => {
    expect(await deriveResourceSchool(adminWith([null]), 'quiz', 'Q1')).toBeNull();
  });
  it('returns null when the class is missing', async () => {
    expect(await deriveResourceSchool(adminWith([{ class_id: 'c1' }, null]), 'quiz', 'Q1')).toBeNull();
  });
});

describe('resolveGcDeepLink', () => {
  it('assignment with the student\'s own row → /student/assignments/<id>', async () => {
    const admin = adminWith([{ id: 'A1' }]);
    expect(await resolveGcDeepLink(admin, { studentId: 'stu1', gc: 'assignment', id: 'L1' })).toBe('/student/assignments/A1');
  });
  it('assignment with no row → the list', async () => {
    const admin = adminWith([null]);
    expect(await resolveGcDeepLink(admin, { studentId: 'stu1', gc: 'assignment', id: 'L1' })).toBe('/student/assignments');
  });
  it('quiz → /student/quiz', async () => {
    const admin = adminWith([]); // no DB read for quiz
    expect(await resolveGcDeepLink(admin, { studentId: 'stu1', gc: 'quiz', id: 'Q1' })).toBe('/student/quiz');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/google/__tests__/launchResolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/google/launchResolve.ts
// Two service-role DB readers for the silent-SSO launch (Seg 4). The link id is NEVER trusted for
// identity — these only DERIVE the candidate school (to scope resolveExternalIdentity) and the
// student's OWN deep-link target. Callers pair these with the launch-state + Google-identity gates.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LaunchGc } from '@/lib/google/launchState';

/** Derive the class + school that own the launched resource. The school scopes identity
 *  resolution; the class is the active-enrollment gate (M2). quiz → quizzes.class_id; assignment
 *  (lesson) → lessons.class_id; then classes.school_id. Returns null when the resource or its
 *  class doesn't exist. */
export async function deriveResourceSchool(
  admin: SupabaseClient,
  gc: LaunchGc,
  id: string,
): Promise<{ schoolId: string; classId: string } | null> {
  const table = gc === 'quiz' ? 'quizzes' : 'lessons';
  const { data: res } = await admin.from(table).select('class_id').eq('id', id).maybeSingle();
  const classId = (res as { class_id?: string } | null)?.class_id;
  if (!classId) return null;
  const { data: cls } = await admin.from('classes').select('school_id').eq('id', classId).maybeSingle();
  const schoolId = (cls as { school_id?: string } | null)?.school_id;
  return schoolId ? { schoolId, classId } : null;
}

/** Resolve the student's OWN deep-link destination for a launched resource.
 *  assignment → the student's assignments row for that lesson → /student/assignments/<rowId>
 *    (the lookup IS an ownership proof; none → the list). quiz → /student/quiz (param-less page).
 *  LIMITATION (m8): a lesson can fan out to multiple per-student assignment rows (multi-day, or an
 *  A.2 Reinforce easier-work row mastery_band='reteach'); GC publish is lesson-keyed so the link
 *  can't distinguish them — this resolves to the MOST-RECENT row for the lesson, else the list.
 *  Always the student's OWN row (four-audience safe).
 *  The result is always an internal /student path; callers still run safeStudentDest. */
export async function resolveGcDeepLink(
  admin: SupabaseClient,
  args: { studentId: string; gc: LaunchGc; id: string },
): Promise<string> {
  if (args.gc === 'assignment') {
    const { data } = await admin
      .from('assignments')
      .select('id')
      .eq('student_id', args.studentId)
      .eq('lesson_id', args.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const rowId = (data as { id?: string } | null)?.id;
    return rowId ? `/student/assignments/${rowId}` : '/student/assignments';
  }
  return '/student/quiz';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/google/__tests__/launchResolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google/launchResolve.ts src/lib/google/__tests__/launchResolve.test.ts
git commit -m "feat(gc-seg4): launchResolve — derive resource school + student's own deep-link target"
```

---

### Task 4: Silent-SSO launch initiator route

**Files:**
- Create: `src/app/api/auth/google/launch/route.ts`
- Test: `src/app/api/auth/google/launch/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `signLaunchState` (Task 1), `buildLaunchAuthUrl` (Task 2).
- Produces: `GET` handler. Behavior: validates `gc`∈{quiz,assignment} + non-empty `id`; sets a one-time httpOnly nonce cookie `g_launch_nonce`; redirects (307) to Google with a signed launch state. `interactive=1` → interactive mode. Invalid link → `/login`. Missing secret → `/login?error=launch`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/auth/google/launch/__tests__/route.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

beforeEach(() => { process.env.GOOGLE_LAUNCH_STATE_SECRET = 'test-secret-abcdefghijklmnop'; });
afterEach(() => { delete process.env.GOOGLE_LAUNCH_STATE_SECRET; });

function req(qs: string) { return new NextRequest(`https://app.test/api/auth/google/launch${qs}`); }

describe('GET /api/auth/google/launch', () => {
  it('redirects an invalid gc to /login', async () => {
    const { GET } = await import('@/app/api/auth/google/launch/route');
    const res = await GET(req('?gc=bogus&id=X'));
    expect(res.headers.get('location')).toBe('https://app.test/login');
  });
  it('redirects to Google with prompt=none and sets an httpOnly nonce cookie (silent)', async () => {
    const { GET } = await import('@/app/api/auth/google/launch/route');
    const res = await GET(req('?gc=assignment&id=L1'));
    const loc = res.headers.get('location')!;
    expect(loc).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc).toContain('prompt=none');
    expect(decodeURIComponent(loc)).toContain('state=launch:');
    const c = res.cookies.get('g_launch_nonce');
    expect(c?.value).toBeTruthy();
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe('lax');
  });
  it('uses prompt=select_account when interactive=1', async () => {
    const { GET } = await import('@/app/api/auth/google/launch/route');
    const res = await GET(req('?gc=quiz&id=Q1&interactive=1'));
    expect(res.headers.get('location')).toContain('prompt=select_account');
  });
  it('falls back to /login?error=launch when the secret is missing', async () => {
    delete process.env.GOOGLE_LAUNCH_STATE_SECRET;
    const { GET } = await import('@/app/api/auth/google/launch/route');
    const res = await GET(req('?gc=quiz&id=Q1'));
    expect(res.headers.get('location')).toBe('https://app.test/login?error=launch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/auth/google/launch/__tests__/route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/api/auth/google/launch/route.ts
// GET /api/auth/google/launch?gc=<quiz|assignment>&id=<id>[&interactive=1]
// The silent-SSO initiator for the PUBLIC Open-CORE Classroom link (GC Seg 4). Sets a one-time
// nonce cookie and redirects to Google's consent with a signed launch state. Public (no CORE
// session yet — see PUBLIC_PREFIXES). Identity is established only by Google in the callback.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { signLaunchState, NONCE_COOKIE_NAME, type LaunchGc } from '@/lib/google/launchState';
import { buildLaunchAuthUrl } from '@/lib/google/oauthUrls';

export const runtime = 'nodejs';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(req.url);
  const gc = (searchParams.get('gc') ?? '').trim();
  const id = (searchParams.get('id') ?? '').trim();
  const interactive = searchParams.get('interactive') === '1';

  // Shape-only validation (identity/ownership is enforced post-Google). Bad link → normal login.
  if ((gc !== 'quiz' && gc !== 'assignment') || !id) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const nonce = randomUUID();
  const mode: 'silent' | 'interactive' = interactive ? 'interactive' : 'silent';
  let state: string;
  try {
    state = signLaunchState({ gc: gc as LaunchGc, id, nonce, mode });
  } catch {
    // GOOGLE_LAUNCH_STATE_SECRET unset → can't sign → fall back to login (observable).
    return NextResponse.redirect(`${origin}/login?error=launch`);
  }

  const res = NextResponse.redirect(buildLaunchAuthUrl(state, mode));
  // __Host- prefix in prod (Secure mandatory there) + sibling-subdomain shadow protection (M1).
  res.cookies.set(NONCE_COOKIE_NAME, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/auth/google/launch/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/google/launch/route.ts src/app/api/auth/google/launch/__tests__/route.test.ts
git commit -m "feat(gc-seg4): silent-SSO launch initiator (nonce cookie + signed state + Google redirect)"
```

---

### Task 5: Callback student-launch branch

**Files:**
- Modify: `src/app/api/auth/google/callback/route.ts`
- Test (new file, leaves the teacher test untouched): `src/app/api/auth/google/callback/__tests__/route.launch.test.ts`

**Interfaces:**
- Consumes: `verifyLaunchState`, `safeStudentDest` (Task 1); `deriveResourceSchool`, `resolveGcDeepLink` (Task 3); `exchangeCodeForTokens` (`@/lib/google/tokens`), `getGoogleProfile` (`@/lib/google/profile`), `resolveExternalIdentity` (`@/lib/google/resolveExternalIdentity`); `createServerSupabaseClient`/`createAdminSupabaseClient`.
- Produces: the same `GET` handler, now branching on a `launch:`-prefixed `state`. The teacher-connect path is byte-for-byte unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/auth/google/callback/__tests__/route.launch.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signLaunchState } from '@/lib/google/launchState';

const exchangeCodeForTokens = vi.fn();
const getGoogleProfile = vi.fn();
const deriveResourceSchool = vi.fn();
const resolveGcDeepLink = vi.fn();
const resolveExternalIdentity = vi.fn();
const verifyOtp = vi.fn();
const generateLink = vi.fn();
const usersMaybeSingle = vi.fn();
const enrollMaybeSingle = vi.fn();

vi.mock('@/lib/google/tokens', () => ({
  exchangeCodeForTokens: (...a: unknown[]) => exchangeCodeForTokens(...a),
  storeConnection: vi.fn(),
}));
vi.mock('@/lib/google/profile', () => ({ getGoogleProfile: (...a: unknown[]) => getGoogleProfile(...a) }));
vi.mock('@/lib/google/launchResolve', () => ({
  deriveResourceSchool: (...a: unknown[]) => deriveResourceSchool(...a),
  resolveGcDeepLink: (...a: unknown[]) => resolveGcDeepLink(...a),
}));
vi.mock('@/lib/google/resolveExternalIdentity', () => ({
  resolveExternalIdentity: (...a: unknown[]) => resolveExternalIdentity(...a),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: vi.fn(), verifyOtp } }),
  createAdminSupabaseClient: () => ({
    auth: { admin: { generateLink } },
    from: (table: string) => {
      const terminal = table === 'enrollments' ? enrollMaybeSingle : usersMaybeSingle;
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q; q.maybeSingle = terminal; // chainable (multiple .eq())
      return q;
    },
  }),
}));

const SECRET = 'launch-test-secret-0123456789';
beforeEach(() => {
  process.env.GOOGLE_LAUNCH_STATE_SECRET = SECRET;
  for (const m of [exchangeCodeForTokens, getGoogleProfile, deriveResourceSchool, resolveGcDeepLink, resolveExternalIdentity, verifyOtp, generateLink, usersMaybeSingle, enrollMaybeSingle]) m.mockReset();
  exchangeCodeForTokens.mockResolvedValue({ access_token: 'AT', expires_in: 3600 });
  getGoogleProfile.mockResolvedValue({ id: 'G1', email: 's@x.edu', verified_email: true });
  deriveResourceSchool.mockResolvedValue({ schoolId: 'school1', classId: 'class1' });
  resolveExternalIdentity.mockResolvedValue('stu1');
  usersMaybeSingle.mockResolvedValue({ data: { email: 's@x.edu', role: 'student' } });
  enrollMaybeSingle.mockResolvedValue({ data: { id: 'e1' } }); // active enrollment exists by default
  generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'TH' } }, error: null });
  verifyOtp.mockResolvedValue({ error: null });
  resolveGcDeepLink.mockResolvedValue('/student/assignments/A1');
});
afterEach(() => { delete process.env.GOOGLE_LAUNCH_STATE_SECRET; });

function launchReq(state: string, nonce: string | null, extra = '&code=abc') {
  const r = new NextRequest(`https://app.test/api/auth/google/callback?state=${encodeURIComponent(state)}${extra}`);
  if (nonce) r.cookies.set('g_launch_nonce', nonce);
  return r;
}
const validState = (mode: 'silent' | 'interactive' = 'silent', gc: 'quiz' | 'assignment' = 'assignment') =>
  signLaunchState({ gc, id: 'L1', nonce: 'N1', mode });

describe('GET /api/auth/google/callback — student launch branch', () => {
  it('happy path → mints a session and deep-links to the student\'s assignment', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 's@x.edu' });
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'magiclink', token_hash: 'TH' });
    expect(res.headers.get('location')).toBe('https://app.test/student/assignments/A1');
  });
  it('tampered state → /login?error=launch, no exchange', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const s = validState();
    const res = await GET(launchReq(s.slice(0, -2) + 'zz', 'N1'));
    expect(res.headers.get('location')).toContain('/login?error=launch');
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });
  it('nonce mismatch → /login?error=launch', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'WRONG'));
    expect(res.headers.get('location')).toContain('/login?error=launch');
  });
  it('silent Google error → retries interactively at the initiator', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState('silent'), 'N1', '&error=interaction_required'));
    const loc = res.headers.get('location')!;
    expect(loc).toContain('/api/auth/google/launch?gc=assignment&id=L1&interactive=1');
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });
  it('interactive Google error → /login?error=google', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState('interactive'), 'N1', '&error=access_denied'));
    expect(res.headers.get('location')).toContain('/login?error=google');
  });
  it('unverified Google email → /launch/unmatched', async () => {
    getGoogleProfile.mockResolvedValue({ id: 'G1', email: 's@x.edu', verified_email: false });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/launch/unmatched');
    expect(generateLink).not.toHaveBeenCalled();
  });
  it('no external-identity match → /launch/unmatched, never auto-creates', async () => {
    resolveExternalIdentity.mockResolvedValue(null);
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/launch/unmatched');
    expect(generateLink).not.toHaveBeenCalled();
  });
  it('resolved user is not a student → /launch/unmatched', async () => {
    usersMaybeSingle.mockResolvedValue({ data: { email: 't@x.edu', role: 'teacher' } });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/launch/unmatched');
    expect(generateLink).not.toHaveBeenCalled();
  });
  it('resolved student not actively enrolled in the resource class → /launch/unmatched (M2)', async () => {
    enrollMaybeSingle.mockResolvedValue({ data: null });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/launch/unmatched');
    expect(generateLink).not.toHaveBeenCalled();
  });
  it('session mint fails (no token_hash) → /login?error=session', async () => {
    generateLink.mockResolvedValue({ data: { properties: {} }, error: null });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    expect(res.headers.get('location')).toContain('/login?error=session');
    expect(verifyOtp).not.toHaveBeenCalled();
  });
  it('clears the nonce cookie on exit', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(launchReq(validState(), 'N1'));
    // a delete writes an expired Set-Cookie for the nonce
    expect(res.cookies.get('g_launch_nonce')?.value ?? '').toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/auth/google/callback/__tests__/route.launch.test.ts`
Expected: FAIL — the launch branch doesn't exist (state is treated as a teacher CSRF mismatch).

- [ ] **Step 3: Write the implementation**

Replace `src/app/api/auth/google/callback/route.ts` with the following. The **teacher-connect body is unchanged** — only the new imports, the launch helpers, and the branch at the top of `GET` are added.

```ts
// GET /api/auth/google/callback — the single registered Google redirect URI, shared by two flows:
//  • teacher connect (Seg 1): CSRF cookie + getUser + role; stores the encrypted token vault.
//  • student silent-SSO launch (Seg 4): branch on a `launch:`-prefixed HMAC-signed state; verifies
//    the state + one-time nonce, establishes identity from Google's verified profile, maps via
//    external_identities, mints a Supabase session, and deep-links. Never creates an account.
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { exchangeCodeForTokens, storeConnection } from '@/lib/google/tokens';
import { getGoogleProfile, type GoogleProfile } from '@/lib/google/profile';
import { verifyLaunchState, safeStudentDest, LAUNCH_STATE_PREFIX, NONCE_COOKIE_NAME } from '@/lib/google/launchState';
import { deriveResourceSchool, resolveGcDeepLink } from '@/lib/google/launchResolve';
import { resolveExternalIdentity } from '@/lib/google/resolveExternalIdentity';

export const runtime = 'nodejs';

function back(origin: string, qs: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/settings/google?${qs}`);
  res.cookies.delete('g_oauth_state');
  return res;
}

// Every launch-branch exit clears the one-time nonce (session cookies from verifyOtp ride along
// via next/headers, as proven by the live /auth/callback route).
function launchExit(origin: string, path: string): NextResponse {
  const res = NextResponse.redirect(`${origin}${path}`);
  res.cookies.delete(NONCE_COOKIE_NAME);
  return res;
}

function nonceMatches(cookieVal: string | undefined, stateNonce: string): boolean {
  if (!cookieVal) return false;
  const a = Buffer.from(cookieVal);
  const b = Buffer.from(stateNonce);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleLaunch(req: NextRequest, origin: string, state: string): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);

  const payload = verifyLaunchState(state);
  if (!payload) return launchExit(origin, '/login?error=launch');

  // One-time nonce: replay/CSRF protection (the cookie was set by the initiator).
  if (!nonceMatches(req.cookies.get(NONCE_COOKIE_NAME)?.value, payload.nonce)) {
    return launchExit(origin, '/login?error=launch');
  }

  // Google silent-auth failure → exactly one interactive retry, then give up.
  const gErr = searchParams.get('error');
  if (gErr) {
    if (payload.mode === 'silent') {
      return launchExit(
        origin,
        `/api/auth/google/launch?gc=${encodeURIComponent(payload.gc)}&id=${encodeURIComponent(payload.id)}&interactive=1`,
      );
    }
    return launchExit(origin, '/login?error=google');
  }

  const code = searchParams.get('code');
  if (!code) return launchExit(origin, '/login?error=google');

  let profile: GoogleProfile;
  try {
    const tokens = await exchangeCodeForTokens(code);
    profile = await getGoogleProfile(tokens.access_token);
  } catch {
    return launchExit(origin, '/login?error=google');
  }
  if (!profile.verified_email) return launchExit(origin, '/launch/unmatched');

  const admin = createAdminSupabaseClient();

  // Scope identity resolution to the class + school that own the launched resource.
  const resource = await deriveResourceSchool(admin, payload.gc, payload.id);
  if (!resource) return launchExit(origin, '/launch/unmatched');

  const studentId = await resolveExternalIdentity(admin, {
    schoolId: resource.schoolId, provider: 'google', externalId: profile.id, email: profile.email,
  });
  if (!studentId) return launchExit(origin, '/launch/unmatched');

  // Defense-in-depth: only mint a session for an actual student.
  const { data: u } = await admin.from('users').select('email, role').eq('id', studentId).maybeSingle();
  const email = (u as { email?: string } | null)?.email;
  const role = (u as { role?: string } | null)?.role;
  if (!email || role !== 'student') return launchExit(origin, '/launch/unmatched');

  // Four-audience (M2, spec §6): the resolved student must be ACTIVELY enrolled in the launched
  // resource's class. Closes stale-link re-entry for a soft-unenrolled (is_active=false) student
  // whose users row + external_identity still exist.
  const { data: enr } = await admin
    .from('enrollments')
    .select('id')
    .eq('student_id', studentId)
    .eq('class_id', resource.classId)
    .eq('is_active', true)
    .maybeSingle();
  if (!enr) return launchExit(origin, '/launch/unmatched');

  // Mint a real Supabase session (passwordless) — V1's mechanism; mirrors /auth/callback.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = (link as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
  if (linkErr || !tokenHash) return launchExit(origin, '/login?error=session');

  const supabase = await createServerSupabaseClient();
  const { error: otpErr } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (otpErr) return launchExit(origin, '/login?error=session');

  const dest = safeStudentDest(await resolveGcDeepLink(admin, { studentId, gc: payload.gc, id: payload.id }));
  return launchExit(origin, dest);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(req.url);
  const state = searchParams.get('state');

  // Branch: student silent-SSO launch (HMAC-signed `launch:` state) vs teacher connect (CSRF
  // cookie). The teacher path below is unchanged.
  if (state && state.startsWith(LAUNCH_STATE_PREFIX)) {
    return handleLaunch(req, origin, state);
  }

  const code = searchParams.get('code');
  const cookieState = req.cookies.get('g_oauth_state')?.value ?? null;

  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    const res = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    res.cookies.delete('g_oauth_state');
    return res;
  }
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (role !== 'teacher') {
    const res = NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    res.cookies.delete('g_oauth_state');
    return res;
  }

  // CSRF first: every callback (success OR Google ?error=) carries state + the cookie.
  if (!state || !cookieState || state !== cookieState) return back(origin, 'error=state');

  const oauthError = searchParams.get('error');
  if (oauthError) return back(origin, 'error=denied');   // user cancelled consent (valid state, no code)

  if (!code) return back(origin, 'error=state');

  try {
    const tokens = await exchangeCodeForTokens(code);
    const gp = await getGoogleProfile(tokens.access_token);
    if (!gp.verified_email) return back(origin, 'error=unverified');
    const admin = createAdminSupabaseClient();
    await storeConnection(admin, {
      userId: user.id, schoolId: profile?.school_id ?? null,
      googleId: gp.id, email: gp.email, tokens,
    });
    return back(origin, 'connected=1');
  } catch {
    return back(origin, 'error=exchange');
  }
}
```

- [ ] **Step 4: Run both callback tests to verify they pass**

Run: `npx vitest run src/app/api/auth/google/callback/__tests__/`
Expected: PASS — the new launch tests AND the existing teacher `route.test.ts` (teacher branch unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/google/callback/route.ts src/app/api/auth/google/callback/__tests__/route.launch.test.ts
git commit -m "feat(gc-seg4): callback student-launch branch (verify state+nonce → Google identity → mint session → deep-link)"
```

---

### Task 6: Proxy carve-out

**Files:**
- Modify: `src/proxy.ts`
- Test: `src/__tests__/proxy.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: nothing new (no DB beyond the existing `users.role` read).
- Produces: `PUBLIC_PREFIXES` gains `/api/auth/google/launch` and `/launch/unmatched`; an unauthenticated `/?gc=<quiz|assignment>&id=…` is diverted (307) to `/api/auth/google/launch?gc=…&id=…`; the launch callback is let through only when `?state` starts with `launch:`; an authenticated student's `/?gc=…` falls through to `page.tsx`.

- [ ] **Step 1: Write the failing test (append these cases to `src/__tests__/proxy.test.ts`)**

```ts
  it('diverts an unauthenticated /?gc= link to the launch initiator', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/?gc=assignment&id=L1'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://app.test/api/auth/google/launch?gc=assignment&id=L1');
  });
  it('an invalid gc on / still goes to /login', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/?gc=bogus&id=L1'));
    expect(res.headers.get('location')).toBe('https://app.test/login');
  });
  it('lets the launch callback through when it carries a launch: state', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/api/auth/google/callback?state=launch:abc&code=x'));
    expect(res.headers.get('location')).toBeNull();
  });
  it('still gates the callback (no launch state) to /login?expired=true', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/api/auth/google/callback?state=csrf&code=x'));
    expect(res.headers.get('location')).toBe('https://app.test/login?expired=true');
  });
  it('passes /launch/unmatched through unauthenticated (public)', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await proxy(req('/launch/unmatched'));
    expect(res.headers.get('location')).toBeNull();
  });
  it('an authenticated student\'s /?gc= falls through to page.tsx (no role redirect)', async () => {
    userRole = 'student';
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await proxy(req('/?gc=assignment&id=L1'));
    expect(res.headers.get('location')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/proxy.test.ts`
Expected: FAIL — the divert/bypass/public additions don't exist yet.

- [ ] **Step 3: Write the implementation**

In `src/proxy.ts`, extend `PUBLIC_PREFIXES`:

```ts
const PUBLIC_PREFIXES = ['/login', '/set-password', '/logout', '/auth', '/trial-expired', '/api/auth/google/launch', '/launch/unmatched'];
```

Replace the routing block (lines that currently start at `const { pathname } = request.nextUrl;` through the final `return supabaseResponse;`) with:

```ts
  const { pathname } = request.nextUrl;

  // Build a redirect that carries the refreshed cookies (so the session survives).
  const redirectTo = (path: string, search = '') => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = search;
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  // The Seg-4 Open-CORE deep-link: /?gc=<quiz|assignment>&id=<id>.
  const gc = request.nextUrl.searchParams.get('gc');
  const gcId = request.nextUrl.searchParams.get('id');
  const isGcLink = (gc === 'quiz' || gc === 'assignment') && !!gcId;

  if (user && (pathname === '/' || pathname === '/login')) {
    // An authenticated student's ?gc= deep-link is handled by page.tsx (not role-home).
    if (pathname === '/' && isGcLink) return supabaseResponse;
    const { data: profile } = await supabase
      .from('users').select('role').eq('id', user.id).single();
    const home = homeForRole(profile?.role ?? null);
    // Guard against a redirect loop: a role-less authed user resolves to /login.
    if (home !== pathname) return redirectTo(home);
  }

  // Unauthenticated Open-CORE link → the silent-SSO initiator (not /login).
  if (!user && pathname === '/' && isGcLink) {
    return redirectTo('/api/auth/google/launch', `?gc=${encodeURIComponent(gc!)}&id=${encodeURIComponent(gcId!)}`);
  }
  if (!user && pathname === '/') return redirectTo('/login');
  if (!user && !isPublic(pathname)) {
    // The launch callback: Google redirects here with NO CORE session. Let it through ONLY when it
    // carries a signed launch state (the handler HMAC-verifies). The callback stays gated for the
    // teacher path.
    if (
      pathname === '/api/auth/google/callback' &&
      request.nextUrl.searchParams.get('state')?.startsWith('launch:')
    ) {
      return supabaseResponse;
    }
    return redirectTo('/login', '?expired=true');
  }

  return supabaseResponse;
```

(In the current `src/proxy.ts`, `redirectTo` is already defined at lines 40–47 — i.e. INSIDE the range you are replacing (lines 37–60, from `const { pathname }` through the final `return supabaseResponse;`). The replacement block re-declares `pathname` and `redirectTo` exactly once; there is no separate copy "lower down" to remove — do not add a second one.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/proxy.test.ts`
Expected: PASS — the 6 new cases plus all existing cases.

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts src/__tests__/proxy.test.ts
git commit -m "feat(gc-seg4): proxy carve-out — public initiator + unmatched, divert /?gc=, callback bypass on launch state"
```

---

### Task 7: Authenticated `/?gc=` deep-link on the root page

**Files:**
- Modify: `src/app/page.tsx`
- Test: `src/app/__tests__/page.gc.test.tsx`

**Interfaces:**
- Consumes: `resolveGcDeepLink`, `safeStudentDest` (Tasks 3/1); `createAdminSupabaseClient`; existing `homeForRole`.
- Produces: when a session exists, `?gc=<quiz|assignment>&id=…` is present, and the user is a student → `redirect(safeStudentDest(resolveGcDeepLink(...)))`; otherwise the existing role-home redirect.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/__tests__/page.gc.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const single = vi.fn();
const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
const resolveGcDeepLink = vi.fn();

vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/google/launchResolve', () => ({ resolveGcDeepLink: (...a: unknown[]) => resolveGcDeepLink(...a) }));

beforeEach(() => {
  for (const m of [getUser, single, redirect, resolveGcDeepLink]) m.mockReset();
  redirect.mockImplementation((url: string) => { throw new Error(`REDIRECT:${url}`); });
});

async function run(search: Record<string, string>) {
  const { default: Home } = await import('@/app/page');
  return Home({ searchParams: Promise.resolve(search) } as never);
}

describe('Home /?gc= deep-link', () => {
  it('redirects an unauthenticated visitor to /login', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(run({})).rejects.toThrow('REDIRECT:/login');
  });
  it('deep-links an authenticated student to their assignment', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'stu1' } } });
    single.mockResolvedValue({ data: { role: 'student' } });
    resolveGcDeepLink.mockResolvedValue('/student/assignments/A1');
    await expect(run({ gc: 'assignment', id: 'L1' })).rejects.toThrow('REDIRECT:/student/assignments/A1');
    expect(resolveGcDeepLink).toHaveBeenCalledWith(expect.anything(), { studentId: 'stu1', gc: 'assignment', id: 'L1' });
  });
  it('a teacher with ?gc= goes to role home (no deep-link)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 't1' } } });
    single.mockResolvedValue({ data: { role: 'teacher' } });
    await expect(run({ gc: 'assignment', id: 'L1' })).rejects.toThrow('REDIRECT:/today');
    expect(resolveGcDeepLink).not.toHaveBeenCalled();
  });
  it('a student with no ?gc= goes to the student dashboard', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'stu1' } } });
    single.mockResolvedValue({ data: { role: 'student' } });
    await expect(run({})).rejects.toThrow('REDIRECT:/student/dashboard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/__tests__/page.gc.test.tsx`
Expected: FAIL — `page.tsx` ignores `?gc=` (the student-with-gc case redirects to the dashboard, not the assignment).

- [ ] **Step 3: Write the implementation**

Replace `src/app/page.tsx` with:

```ts
import { redirect } from 'next/navigation';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { homeForRole } from '@/lib/auth/roleHome';
import { resolveGcDeepLink } from '@/lib/google/launchResolve';
import { safeStudentDest } from '@/lib/google/launchState';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ gc?: string; id?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  const role = profile?.role ?? null;

  // An already-logged-in student following the Open-CORE deep-link goes straight to the work
  // (their OWN row — four-audience). resolveGcDeepLink finds only assignments where student_id =
  // the caller, so no school derivation is needed here.
  const gc = (sp.gc ?? '').trim();
  const id = (sp.id ?? '').trim();
  if (role === 'student' && (gc === 'quiz' || gc === 'assignment') && id) {
    const admin = createAdminSupabaseClient();
    const dest = safeStudentDest(await resolveGcDeepLink(admin, { studentId: user.id, gc, id }));
    redirect(dest);
  }

  redirect(homeForRole(role));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/__tests__/page.gc.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/__tests__/page.gc.test.tsx
git commit -m "feat(gc-seg4): authenticated /?gc= deep-link a logged-in student straight to the work"
```

---

### Task 8: Friendly no-match page

**Files:**
- Create: `src/app/launch/unmatched/page.tsx`
- Test: `src/app/launch/unmatched/__tests__/page.test.tsx`

**Interfaces:**
- Produces: a public server component rendering the no-match message + a link to `/login`. No auth (it's in `PUBLIC_PREFIXES`). Token classes only.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LaunchUnmatched from '@/app/launch/unmatched/page';

describe('/launch/unmatched', () => {
  it('shows the no-match message and a sign-in link to /login', () => {
    render(<LaunchUnmatched />);
    expect(screen.getByRole('heading')).toHaveTextContent(/couldn.t match/i);
    const link = screen.getByRole('link', { name: /sign in/i });
    expect(link).toHaveAttribute('href', '/login');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/launch/unmatched/__tests__/page.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/app/launch/unmatched/page.tsx
// Public no-match page for the silent-SSO launch (GC Seg 4). Shown when a student's Google account
// can't be matched to a CORE student. Coach-posture: plain, reassuring, never reveals whether an
// account exists. Public — see PUBLIC_PREFIXES in src/proxy.ts.
import React from 'react';
import Link from 'next/link';

export default function LaunchUnmatched(): React.JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-surface bg-surface p-8 flex flex-col gap-4 text-center">
        <h1 className="font-display text-2xl font-semibold text-fg">We couldn’t match your Google account</h1>
        <p className="text-sm leading-relaxed text-fg">
          We couldn’t connect this Google account to your CORE account yet. You can sign in with your
          CORE password, or ask your teacher to add you.
        </p>
        <Link
          href="/login"
          className="self-center rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-fg-on-brand"
        >
          Sign in with CORE
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run test + the a11y gate**

Run: `npx vitest run src/app/launch/unmatched/__tests__/page.test.tsx`
Expected: PASS.
Run: `npm run a11y`
Expected: PASS (all token combos used here — `border-surface`/`bg-surface`/`text-fg`/`bg-brand`/`text-fg-on-brand` — are already used elsewhere and pass the WCAG-AA gate).

- [ ] **Step 5: Commit**

```bash
git add src/app/launch/unmatched/page.tsx src/app/launch/unmatched/__tests__/page.test.tsx
git commit -m "feat(gc-seg4): friendly /launch/unmatched no-match page"
```

---

## Scope notes & deferred (from the pre-code review)

- **Course-level pin lands on `/login`, not silent SSO (m7 — by design).** Seg 3 publishes the course-level Open-CORE material as a bare `${APP_BASE_URL}/` (no `?gc=`), so the proxy `isGcLink` divert does NOT fire — an unauthenticated student clicking the course pin gets the normal password login. Silent SSO is intentionally scoped to the per-item `/?gc=<type>&id=<id>` resource links this segment (Marvin's D-decisions). Making the course pin silent (e.g. publishing it as `/?gc=home`) is a deferred follow-up. The Playwright/preview pass must explicitly check the course-pin click (it should reach `/login`, not error).
- **No rate limiter on the two public launch surfaces (m5 — deferred, with rationale).** The review recommended wiring `src/lib/rateLimit.ts` onto the initiator + callback launch branch. Deferred for this segment because: (a) the initiator is I/O-free (HMAC sign + redirect — no outbound call), so flooding it is cheap-to-serve; (b) the callback's expensive path (`exchangeCodeForTokens` → Google) requires a fresh single-use Google `code` each time, which an attacker must drive through a real Google round-trip — self-limiting, not a cheap replay; (c) the only available limiter is IP-keyed, and a whole class behind one school NAT clicking at the start of a lesson would trip a tight per-IP ceiling (false-throttle) — calibrating a NAT-safe ceiling is guesswork. Revisit with a generous, dedicated per-IP launch limiter if abuse is observed. (Logged as a deferred minor; mirrors how the repo has deferred similar limits.)

## Post-build (controller — not a task)

1. **Whole-gate run (alone):** `npx tsc --noEmit && npx vitest run && npm run build`. Kill any running dev/preview server first (a live server in the suite caused a false contention failure in Seg 3).
2. **Go-live env:** set `GOOGLE_LAUNCH_STATE_SECRET` (32+ random bytes) in Vercel (prod + preview, encrypted). No migration. The Google OAuth client + redirect URI (`…/api/auth/google/callback`) are already registered from Seg 1 — `prompt=none` is a request param, not a new registration; confirm a real silent launch works in the Playwright/preview pass.
3. **Playwright preview:** the `/launch/unmatched` page renders; a simulated launch (or a real Classroom link with a GC-mapped demo class) signs in silently and lands on the assignment. Demo classes are not GC-mapped by default — temporarily set a `google_course_id` on a demo class to exercise the full path, then unset. Also verify the **course-level pin** (bare `${APP_BASE_URL}/`) lands on `/login` (m7 — not silent SSO, by design), and that a removed (soft-unenrolled) student's stale `?gc=` link lands on `/launch/unmatched` (M2 enrollment gate).
4. Marvin merge call → `git merge --no-ff` to `main` → push (Marvin authorizes the prod push) → set the secret → live.
5. Update CLAUDE.md + the `v2-gc-seg4-silent-launch` memory (mark DONE + LIVE).

---

## Self-Review (against the spec)

- **Spec coverage:** §5 build-shape items 1–8 map to Tasks 1–8. §2 flow (proxy divert → initiator → callback branch → verify state+nonce → exchange/profile/verified_email → resolve → no-match/mint → deep-link) is realized across Tasks 4/5/6. §3 decisions D1 (silent OAuth reuse, identity scopes — Tasks 2/5), D2 (generateLink+verifyOtp — Task 5), D3 (`/launch/unmatched`, no auto-create — Tasks 5/8), D4 (assignments deep-link now, quiz→/student/quiz — Tasks 3/5/7), D5/D6 (proxy carve-out, signed state, school-from-resource, allow-list — Tasks 1/3/5/6) all covered.
- **Placeholder scan:** every code + test step carries full code; no TBD/"handle errors"/"similar to".
- **Type consistency:** `LaunchGc`/`LaunchMode`/`LaunchPayload` defined in Task 1 and consumed unchanged in Tasks 3/4/5; `signLaunchState`/`verifyLaunchState`/`safeStudentDest` signatures match across consumers; `deriveResourceSchool`/`resolveGcDeepLink` signatures match Tasks 5/7; `token_hash = data.properties.hashed_token` matches the Supabase generateLink shape.
- **Security invariants:** identity only from Google (`getGoogleProfile` + `verified_email`), never link params (Task 5); signed state + nonce + TTL + timing-safe + `__Host-` cookie (Tasks 1/4/5); minimal proxy carve-out — callback never fully public (Task 6); role==='student' **+ active-enrollment-in-class gate** + no auto-create (Task 5); `/student` allow-list incl. forward-slash traversal (Tasks 1/5/7).
- **Pre-code review (2026-06-25) folded:** M1 `__Host-` nonce cookie, M2 active-enrollment gate, M3 `profile: GoogleProfile` type, m4 traversal guard, m6 proxy note, m7 course-pin scope, m8 fan-out note — all applied above. m5 (rate limiter) deferred with rationale (see Scope notes). Verdict was READY-TO-BUILD.
