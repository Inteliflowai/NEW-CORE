# Google Classroom — Segment 1: Connect + Token Vault — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a teacher connect their own Google account via OAuth and store the resulting tokens **encrypted at rest** in a locked-down per-teacher table, with refresh + scope-check + disconnect — the spine every later GC segment depends on.

**Architecture:** Per-teacher OAuth (V1 model). A `google_connections` table (RLS deny-by-default, admin-client only) holds AES-256-GCM-encrypted access/refresh tokens. One centralized token-manager exchanges/refreshes/decrypts; all Google HTTP is raw `fetch` (zero new deps, mirrors V1 + SPARK). Routes obey V2's auth chain (`getUser` → `STAFF_ROLES` → admin client). Spec: `docs/superpowers/specs/2026-06-23-google-classroom-design.md`; grounding: `docs/superpowers/plans/grounding/2026-06-23-google-classroom/2026-06-23-google-classroom-current-code.md`.

**Tech Stack:** Next.js 16 App Router (async `cookies()`), TypeScript, `node:crypto` (no `googleapis`/`google-auth-library`/`jsonwebtoken`), Supabase (server + admin clients), Vitest 4 (+ jsdom for the UI task), Tailwind v4 token-only.

## Global Constraints

- **Zero new npm dependencies.** Google HTTP is raw `fetch`; crypto/HMAC is `node:crypto` (`import { ... } from 'crypto'`, matching `src/lib/spark/signLaunchJwt.ts:4`).
- **Per-teacher OAuth** (D3): tokens belong to a teacher (`google_connections.user_id`); GC calls run as the linked teacher.
- **Encrypt tokens at rest** (D4): access + refresh tokens are AES-256-GCM ciphertext; **plaintext tokens are NEVER logged, NEVER returned to the client**, only decrypted inside the token-manager.
- **Auth chain on every protected route:** `await createServerSupabaseClient()` → `auth.getUser()` (401) → `users.role` ∈ `STAFF_ROLES` (403; teacher-scoped routes additionally require `role === 'teacher'` OR allow staff — see each task) → `createAdminSupabaseClient()` (synchronous; bypasses RLS) for the RLS-locked `google_connections` reads/writes. RLS is NOT the IDOR backstop.
- **New tables RLS-enabled, deny-by-default** (only `is_platform_admin()` policy; all real access via the admin client), mirroring `external_identities`/`platform_links` in `0008_platform.sql`.
- **Migrations are static-text-asserted** in `supabase/migrations/__tests__/migrations.test.ts` — every new table/column/RLS/grant gets an assertion. Next migration number is **`0022`**.
- **`.env.example` rule:** the config test asserts every non-comment line is `KEY=` with an **empty** value (`src/lib/__tests__/config.test.ts:69-85`). New keys are added as `KEY=` (empty) and to the `requiredKeys` list.
- **Token-only styling**, deep-ink (`text-fg` not `text-fg-muted` for content), WCAG-AA; strings are DRAFT → `STRINGS-FOR-BARB.md`.
- **Gates (run before each commit / at task end):** `npx tsc --noEmit` (0), `npx vitest run <touched files>` (green), and at segment end `npm run build` (0, incl. a11y + tokens). React component tests start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`.
- **GOOGLE_REDIRECT_URI** (already an env placeholder) must resolve to the callback route path `/api/auth/google/callback` and be registered in the Google Cloud project (build-time/ops item, not code).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/google/config.ts` | env reads (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI/TOKEN_ENC_KEY`) + scope constants (`GC_SCOPES`, `GC_REQUIRED_SCOPES`) |
| `src/lib/google/crypto.ts` | `encryptToken` / `decryptToken` (AES-256-GCM via `node:crypto`) |
| `src/lib/google/oauthUrls.ts` | `buildConnectAuthUrl(state)` — the authorize URL |
| `src/lib/google/tokens.ts` | `exchangeCodeForTokens`, `storeConnection`, `getValidAccessTokenForTeacher`, types |
| `src/lib/google/profile.ts` | `getGoogleProfile(accessToken)` |
| `supabase/migrations/0022_google_connections.sql` | the token-vault table + RLS + grants |
| `src/app/api/teacher/google/connect/route.ts` | GET — start OAuth (CSRF cookie + redirect) |
| `src/app/api/auth/google/callback/route.ts` | GET — exchange code, fetch profile, store encrypted connection |
| `src/app/api/teacher/google/scope-check/route.ts` | GET — connected/needsReconnect/missing |
| `src/app/api/teacher/google/disconnect/route.ts` | POST — delete the caller's own connection |
| `src/app/(teacher)/settings/google/page.tsx` + `_components/GoogleConnectCard.tsx` | teacher connect/reconnect/disconnect UI |

Test files live beside each module under `__tests__/` (repo convention).

---

### Task 1: Config + scopes + env

**Files:**
- Create: `src/lib/google/config.ts`
- Create: `src/lib/google/__tests__/config.test.ts`
- Modify: `.env.example` (add `GOOGLE_TOKEN_ENC_KEY=`)
- Modify: `src/lib/__tests__/config.test.ts` (add `GOOGLE_TOKEN_ENC_KEY` to `requiredKeys`)

**Interfaces:**
- Produces: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI: string`; `GC_SCOPES: string[]` (7); `GC_REQUIRED_SCOPES: string[]` (the reconnect-check subset). `GOOGLE_TOKEN_ENC_KEY` is read inside `crypto.ts` at call-time (Task 2), NOT exported here.

- [ ] **Step 1: Write the failing test** — `src/lib/google/__tests__/config.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { GC_SCOPES, GC_REQUIRED_SCOPES } from '@/lib/google/config';

describe('google/config scopes', () => {
  it('GC_SCOPES is the 7-scope connect set incl. drive.readonly', () => {
    for (const s of [
      'openid', 'email', 'profile',
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.rosters.readonly',
      'https://www.googleapis.com/auth/classroom.profile.emails',
      'https://www.googleapis.com/auth/classroom.coursework.students',
      'https://www.googleapis.com/auth/classroom.courseworkmaterials',
      'https://www.googleapis.com/auth/drive.readonly',
    ]) expect(GC_SCOPES).toContain(s);
  });
  it('GC_REQUIRED_SCOPES is the write+roster subset (no drive, no login triplet)', () => {
    expect(GC_REQUIRED_SCOPES).not.toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(GC_REQUIRED_SCOPES).not.toContain('openid');
    expect(GC_REQUIRED_SCOPES).toContain('https://www.googleapis.com/auth/classroom.coursework.students');
    expect(GC_REQUIRED_SCOPES).toContain('https://www.googleapis.com/auth/classroom.rosters.readonly');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/lib/google/__tests__/config.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/lib/google/config.ts`

```typescript
// src/lib/google/config.ts
// Google Classroom integration config. Mirrors the repo env idiom (src/lib/spark/config.ts):
// read process.env at module top-level with a default. GOOGLE_TOKEN_ENC_KEY is read at call-time
// inside crypto.ts (so tests can set it per-case), NOT here.
export const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
export const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
export const GOOGLE_REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || '').trim();

const GC = 'https://www.googleapis.com/auth';

// Requested at connect (7) — incl. drive.readonly (Drive import is in epic scope).
export const GC_SCOPES: string[] = [
  'openid', 'email', 'profile',
  `${GC}/classroom.courses.readonly`,
  `${GC}/classroom.rosters.readonly`,
  `${GC}/classroom.profile.emails`,
  `${GC}/classroom.coursework.students`,
  `${GC}/classroom.courseworkmaterials`,
  `${GC}/drive.readonly`,
];

// The reconnect-check set: the write + roster scopes CORE actually requires to function.
// Omits the login triplet (openid/email/profile) and drive.readonly (import is best-effort).
export const GC_REQUIRED_SCOPES: string[] = [
  `${GC}/classroom.courses.readonly`,
  `${GC}/classroom.rosters.readonly`,
  `${GC}/classroom.profile.emails`,
  `${GC}/classroom.coursework.students`,
  `${GC}/classroom.courseworkmaterials`,
];
```

- [ ] **Step 4: Add the env key** — in `.env.example`, under the `# Google` section (after `GOOGLE_REDIRECT_URI=`), add a line: `GOOGLE_TOKEN_ENC_KEY=` (empty value, no spaces).

- [ ] **Step 5: Add to the env-keys assertion** — in `src/lib/__tests__/config.test.ts`, add `'GOOGLE_TOKEN_ENC_KEY',` to the `requiredKeys` array inside the `// Google` group (after `'GOOGLE_REDIRECT_URI',`).

- [ ] **Step 6: Run tests** — `npx vitest run src/lib/google/__tests__/config.test.ts src/lib/__tests__/config.test.ts` → PASS. Then `npx tsc --noEmit` → 0.

- [ ] **Step 7: Commit** — `git add src/lib/google/config.ts src/lib/google/__tests__/config.test.ts .env.example src/lib/__tests__/config.test.ts && git commit -m "feat(gc): google config + scope constants + token-enc-key env"`

---

### Task 2: Token encryption (AES-256-GCM)

**Files:**
- Create: `src/lib/google/crypto.ts`
- Create: `src/lib/google/__tests__/crypto.test.ts`

**Interfaces:**
- Produces: `encryptToken(plaintext: string): string` → `iv.tag.ciphertext` (3 base64url parts). `decryptToken(blob: string): string` → throws on tamper/format/missing-key. Reads `process.env.GOOGLE_TOKEN_ENC_KEY` (32 bytes base64) at call time.

- [ ] **Step 1: Write the failing test** — `src/lib/google/__tests__/crypto.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';
import { encryptToken, decryptToken } from '@/lib/google/crypto';

beforeEach(() => { process.env.GOOGLE_TOKEN_ENC_KEY = randomBytes(32).toString('base64'); });

describe('google/crypto', () => {
  it('round-trips a token through encrypt/decrypt', () => {
    const secret = 'ya29.a0AfH-EXAMPLE-refresh-token';
    const blob = encryptToken(secret);
    expect(blob.split('.')).toHaveLength(3);     // iv.tag.ciphertext
    expect(blob).not.toContain(secret);          // ciphertext, not plaintext
    expect(decryptToken(blob)).toBe(secret);
  });
  it('produces a different ciphertext each call (random IV)', () => {
    expect(encryptToken('x')).not.toBe(encryptToken('x'));
  });
  it('throws when the auth tag is tampered', () => {
    const blob = encryptToken('hello');
    const [iv, , ct] = blob.split('.');
    const forgedTag = randomBytes(16).toString('base64url');
    expect(() => decryptToken(`${iv}.${forgedTag}.${ct}`)).toThrow();
  });
  it('throws on a malformed blob', () => {
    expect(() => decryptToken('not-a-valid-blob')).toThrow();
  });
  it('throws when GOOGLE_TOKEN_ENC_KEY is missing', () => {
    delete process.env.GOOGLE_TOKEN_ENC_KEY;
    expect(() => encryptToken('x')).toThrow(/GOOGLE_TOKEN_ENC_KEY/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/lib/google/__tests__/crypto.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/lib/google/crypto.ts`

```typescript
// src/lib/google/crypto.ts
// AES-256-GCM token-at-rest encryption (node:crypto, zero deps). Format: iv.tag.ciphertext (base64url).
// The key (GOOGLE_TOKEN_ENC_KEY) is read at call-time so tests/runtime can set it per-process.
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function encKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENC_KEY;
  if (!raw) throw new Error('GOOGLE_TOKEN_ENC_KEY is not configured');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_TOKEN_ENC_KEY must decode to 32 bytes');
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

export function decryptToken(blob: string): string {
  const parts = blob.split('.');
  if (parts.length !== 3) throw new Error('malformed encrypted token');
  const [ivB, tagB, ctB] = parts;
  const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/google/__tests__/crypto.test.ts` → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/lib/google/crypto.ts src/lib/google/__tests__/crypto.test.ts && git commit -m "feat(gc): AES-256-GCM token-at-rest crypto"`

---

### Task 3: Migration 0022 — `google_connections` table

**Files:**
- Create: `supabase/migrations/0022_google_connections.sql`
- Modify: `supabase/migrations/__tests__/migrations.test.ts` (append a `describe('0022 google_connections', …)` block)

**Interfaces:**
- Produces a table `public.google_connections` with columns: `user_id uuid PK → users`, `school_id uuid → schools`, `google_id text`, `email text`, `access_token_enc text`, `refresh_token_enc text`, `token_expiry timestamptz`, `granted_scopes text[]`, `connected_at timestamptz DEFAULT now()`, `last_refresh_at timestamptz`. RLS enabled, deny-by-default (only `is_platform_admin()`), `GRANT ALL ... TO authenticated, anon, service_role`.

- [ ] **Step 1: Write the failing test** — append to `supabase/migrations/__tests__/migrations.test.ts`

```typescript
describe('0022 google_connections', () => {
  const s = () => sql('0022_google_connections.sql');
  it('creates the per-teacher token vault with user_id PK', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.google_connections/);
    expect(s()).toMatch(/user_id\s+uuid\s+PRIMARY KEY\s+REFERENCES public\.users\(id\)/);
  });
  it('has encrypted token columns + expiry + scopes (no plaintext token columns)', () => {
    for (const c of ['access_token_enc', 'refresh_token_enc', 'token_expiry', 'granted_scopes', 'google_id', 'email']) {
      expect(s(), `missing column ${c}`).toContain(c);
    }
    expect(s()).not.toMatch(/access_token\s+text/);   // must be _enc, never plaintext
  });
  it('enables RLS deny-by-default (platform-admin policy only) + grants', () => {
    expect(s()).toMatch(/ALTER TABLE public\.google_connections\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/CREATE POLICY [^\n]*google_connections[^\n]*USING \(public\.is_platform_admin\(\)\)/);
    expect(s()).toMatch(/GRANT ALL ON public\.google_connections\s+TO authenticated, anon, service_role/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run supabase/migrations/__tests__/migrations.test.ts` → FAIL (file not found / regex no match).

- [ ] **Step 3: Implement** — `supabase/migrations/0022_google_connections.sql`

```sql
-- 0022_google_connections.sql
-- Google Classroom epic, Segment 1: per-teacher OAuth token vault.
-- Tokens are AES-256-GCM ciphertext (access_token_enc/refresh_token_enc) written by the
-- token-manager (src/lib/google/tokens.ts) — NEVER plaintext. RLS deny-by-default; all real
-- access is via the service-role admin client behind the route auth chain (RLS is not the
-- IDOR backstop). Mirrors the platform tables in 0008.
CREATE TABLE IF NOT EXISTS public.google_connections (
  user_id           uuid        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  school_id         uuid        REFERENCES public.schools(id) ON DELETE CASCADE,
  google_id         text,
  email             text,
  access_token_enc  text,
  refresh_token_enc text,
  token_expiry      timestamptz,
  granted_scopes    text[],
  connected_at      timestamptz NOT NULL DEFAULT now(),
  last_refresh_at   timestamptz
);

ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_connections_platform_all ON public.google_connections;
CREATE POLICY google_connections_platform_all ON public.google_connections FOR ALL
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

GRANT ALL ON public.google_connections TO authenticated, anon, service_role;
```

- [ ] **Step 4: Run tests** — `npx vitest run supabase/migrations/__tests__/migrations.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add supabase/migrations/0022_google_connections.sql supabase/migrations/__tests__/migrations.test.ts && git commit -m "feat(gc): migration 0022 google_connections token vault"`

> **NOTE (controller):** do NOT apply 0022 to the live DB during the build. Migration application is a separate, explicitly-authorized step at segment merge (per the project's migration discipline).

---

### Task 4: OAuth authorize-URL builder

**Files:**
- Create: `src/lib/google/oauthUrls.ts`
- Create: `src/lib/google/__tests__/oauthUrls.test.ts`

**Interfaces:**
- Consumes: `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `GC_SCOPES` from `config.ts`.
- Produces: `buildConnectAuthUrl(state: string): string`.

- [ ] **Step 1: Write the failing test** — `src/lib/google/__tests__/oauthUrls.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
  process.env.GOOGLE_REDIRECT_URI = 'https://newcore.inteliflowai.com/api/auth/google/callback';
});

describe('buildConnectAuthUrl', () => {
  it('builds the consent URL with offline access, prompt=consent, scopes and state', async () => {
    const { buildConnectAuthUrl } = await import('@/lib/google/oauthUrls');
    const u = new URL(buildConnectAuthUrl('state-abc'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('state')).toBe('state-abc');
    expect(u.searchParams.get('redirect_uri')).toBe('https://newcore.inteliflowai.com/api/auth/google/callback');
    expect(u.searchParams.get('scope')).toContain('classroom.coursework.students');
    expect(u.searchParams.get('scope')).toContain('drive.readonly');
  });
});
```

> Note: `config.ts` reads env at module load, so the test `import()`s `oauthUrls` lazily AFTER setting env (matches the repo's `vi.resetModules`-free lazy-import idiom used in route tests).

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/lib/google/__tests__/oauthUrls.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/google/oauthUrls.ts`

```typescript
// src/lib/google/oauthUrls.ts
// Builds the Google OAuth consent URL for the per-teacher classroom connect (offline + consent).
import { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, GC_SCOPES } from '@/lib/google/config';

export function buildConnectAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GC_SCOPES.join(' '),
    state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/google/__tests__/oauthUrls.test.ts` → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/lib/google/oauthUrls.ts src/lib/google/__tests__/oauthUrls.test.ts && git commit -m "feat(gc): OAuth connect authorize-URL builder"`

---

### Task 5: Token exchange + Google profile

**Files:**
- Create: `src/lib/google/tokens.ts` (this task adds `exchangeCodeForTokens` + the `GoogleTokenResponse` type)
- Create: `src/lib/google/profile.ts`
- Create: `src/lib/google/__tests__/tokens.test.ts`
- Create: `src/lib/google/__tests__/profile.test.ts`

**Interfaces:**
- Produces: `type GoogleTokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string }`. `exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse>` (POST `oauth2.googleapis.com/token`, throws on non-200). `getGoogleProfile(accessToken: string): Promise<{ id: string; email: string; name?: string; verified_email?: boolean }>`.

- [ ] **Step 1: Write the failing tests**

`src/lib/google/__tests__/tokens.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'csec';
  process.env.GOOGLE_REDIRECT_URI = 'https://x/api/auth/google/callback';
});
describe('exchangeCodeForTokens', () => {
  it('POSTs the code and returns the token response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: 'a b' }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { exchangeCodeForTokens } = await import('@/lib/google/tokens');
    const out = await exchangeCodeForTokens('auth-code');
    expect(out.access_token).toBe('at'); expect(out.refresh_token).toBe('rt'); expect(out.expires_in).toBe(3599);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect((init as RequestInit).method).toBe('POST');
    expect(String((init as RequestInit).body)).toContain('grant_type=authorization_code');
  });
  it('throws on a non-200 exchange', async () => {
    globalThis.fetch = vi.fn(async () => new Response('bad', { status: 400 })) as unknown as typeof fetch;
    const { exchangeCodeForTokens } = await import('@/lib/google/tokens');
    await expect(exchangeCodeForTokens('x')).rejects.toThrow();
  });
});
```

`src/lib/google/__tests__/profile.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
describe('getGoogleProfile', () => {
  it('GETs userinfo with the bearer token and returns the profile', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'g1', email: 'a@b.edu', name: 'A B', verified_email: true }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { getGoogleProfile } = await import('@/lib/google/profile');
    const p = await getGoogleProfile('access-tok');
    expect(p).toEqual({ id: 'g1', email: 'a@b.edu', name: 'A B', verified_email: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/oauth2/v2/userinfo');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer access-tok' });
  });
  it('throws on a non-200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    const { getGoogleProfile } = await import('@/lib/google/profile');
    await expect(getGoogleProfile('x')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run src/lib/google/__tests__/tokens.test.ts src/lib/google/__tests__/profile.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/google/tokens.ts` (exchange portion) and `src/lib/google/profile.ts`

```typescript
// src/lib/google/tokens.ts  (Task 5 portion — storeConnection + getValid* added in Tasks 6-7)
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } from '@/lib/google/config';

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  return (await res.json()) as GoogleTokenResponse;
}
```

```typescript
// src/lib/google/profile.ts
export interface GoogleProfile { id: string; email: string; name?: string; verified_email?: boolean }

export async function getGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`google userinfo failed: ${res.status}`);
  const j = (await res.json()) as GoogleProfile;
  return { id: j.id, email: j.email, name: j.name, verified_email: j.verified_email };
}
```

- [ ] **Step 4: Run tests** — both files PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/lib/google/tokens.ts src/lib/google/profile.ts src/lib/google/__tests__/tokens.test.ts src/lib/google/__tests__/profile.test.ts && git commit -m "feat(gc): code->token exchange + google profile fetch"`

---

### Task 6: Store an encrypted connection (upsert)

**Files:**
- Modify: `src/lib/google/tokens.ts` (add `storeConnection`)
- Create: `src/lib/google/__tests__/storeConnection.test.ts`

**Interfaces:**
- Consumes: `encryptToken` (Task 2); `GoogleTokenResponse` (Task 5); a Supabase admin client (`createAdminSupabaseClient()` return type — duck-typed in tests).
- Produces: `storeConnection(admin, args): Promise<void>` where `args = { userId: string; schoolId: string | null; googleId: string; email: string; tokens: GoogleTokenResponse }`. Upserts `google_connections` on `user_id`, encrypting access + refresh tokens, computing `token_expiry`, recording `granted_scopes` (split on space). **Only overwrites `refresh_token_enc` when a new refresh token is present** (Google omits it on re-consent sometimes).

- [ ] **Step 1: Write the failing test** — `src/lib/google/__tests__/storeConnection.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';
import { decryptToken } from '@/lib/google/crypto';

beforeEach(() => { process.env.GOOGLE_TOKEN_ENC_KEY = randomBytes(32).toString('base64'); });

function fakeAdmin() {
  const calls: { table: string; row: Record<string, unknown>; onConflict?: string }[] = [];
  return {
    calls,
    from(table: string) {
      return { upsert: (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
        calls.push({ table, row, onConflict: opts?.onConflict });
        return Promise.resolve({ error: null });
      } };
    },
  };
}

describe('storeConnection', () => {
  it('upserts an encrypted connection keyed on user_id', async () => {
    const admin = fakeAdmin();
    const { storeConnection } = await import('@/lib/google/tokens');
    await storeConnection(admin as never, {
      userId: 'u1', schoolId: 's1', googleId: 'g1', email: 'a@b.edu',
      tokens: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'openid x y' },
    });
    expect(admin.calls).toHaveLength(1);
    const { table, row, onConflict } = admin.calls[0];
    expect(table).toBe('google_connections');
    expect(onConflict).toBe('user_id');
    expect(row.user_id).toBe('u1');
    expect(row.access_token_enc).not.toBe('AT');               // encrypted
    expect(decryptToken(row.access_token_enc as string)).toBe('AT');
    expect(decryptToken(row.refresh_token_enc as string)).toBe('RT');
    expect(row.granted_scopes).toEqual(['openid', 'x', 'y']);
    expect(typeof row.token_expiry).toBe('string');            // ISO timestamp
  });
  it('omits refresh_token_enc when Google returns no refresh token', async () => {
    const admin = fakeAdmin();
    const { storeConnection } = await import('@/lib/google/tokens');
    await storeConnection(admin as never, {
      userId: 'u1', schoolId: null, googleId: 'g1', email: 'a@b.edu',
      tokens: { access_token: 'AT', expires_in: 3600 },
    });
    expect('refresh_token_enc' in admin.calls[0].row).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (no `storeConnection`).

- [ ] **Step 3: Implement** — append to `src/lib/google/tokens.ts`

```typescript
import { encryptToken } from '@/lib/google/crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StoreConnectionArgs {
  userId: string;
  schoolId: string | null;
  googleId: string;
  email: string;
  tokens: GoogleTokenResponse;
}

export async function storeConnection(admin: SupabaseClient, args: StoreConnectionArgs): Promise<void> {
  const { tokens } = args;
  const row: Record<string, unknown> = {
    user_id: args.userId,
    school_id: args.schoolId,
    google_id: args.googleId,
    email: args.email,
    access_token_enc: encryptToken(tokens.access_token),
    token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    granted_scopes: tokens.scope ? tokens.scope.split(' ') : [],
    last_refresh_at: new Date().toISOString(),
  };
  // Only overwrite the refresh token when Google actually returns one (re-consent may omit it).
  if (tokens.refresh_token) row.refresh_token_enc = encryptToken(tokens.refresh_token);
  const { error } = await admin.from('google_connections').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(`storeConnection failed: ${error.message}`);
}
```

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/lib/google/tokens.ts src/lib/google/__tests__/storeConnection.test.ts && git commit -m "feat(gc): storeConnection (encrypt + upsert token vault)"`

---

### Task 7: Get a valid access token (refresh on expiry)

**Files:**
- Modify: `src/lib/google/tokens.ts` (add `getValidAccessTokenForTeacher` + `GoogleNotConnectedError`)
- Create: `src/lib/google/__tests__/getValidAccessToken.test.ts`

**Interfaces:**
- Consumes: `decryptToken`/`encryptToken` (Task 2); admin client.
- Produces: `class GoogleNotConnectedError extends Error`. `getValidAccessTokenForTeacher(admin, teacherId: string): Promise<string>` — reads the row; if none → throws `GoogleNotConnectedError`; if `token_expiry > now()+60s` → returns the decrypted access token; else refreshes via `grant_type=refresh_token`, persists the new encrypted access token + expiry (NOT the refresh token), returns the new access token.

- [ ] **Step 1: Write the failing test** — `src/lib/google/__tests__/getValidAccessToken.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';
import { encryptToken } from '@/lib/google/crypto';

beforeEach(() => {
  process.env.GOOGLE_TOKEN_ENC_KEY = randomBytes(32).toString('base64');
  process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'csec';
});

function adminWith(row: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    from() {
      return {
        select() { return { eq() { return { maybeSingle: async () => ({ data: row, error: null }) }; } }; },
        update(vals: Record<string, unknown>) { updates.push(vals); return { eq: async () => ({ error: null }) }; },
      };
    },
  };
}

describe('getValidAccessTokenForTeacher', () => {
  it('throws GoogleNotConnectedError when there is no connection', async () => {
    const { getValidAccessTokenForTeacher, GoogleNotConnectedError } = await import('@/lib/google/tokens');
    await expect(getValidAccessTokenForTeacher(adminWith(null) as never, 'u1'))
      .rejects.toBeInstanceOf(GoogleNotConnectedError);
  });
  it('returns the decrypted token when not expired (no refresh call)', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const admin = adminWith({ access_token_enc: encryptToken('LIVE'), refresh_token_enc: encryptToken('RT'), token_expiry: future });
    const { getValidAccessTokenForTeacher } = await import('@/lib/google/tokens');
    expect(await getValidAccessTokenForTeacher(admin as never, 'u1')).toBe('LIVE');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refreshes + persists when expired', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ access_token: 'FRESH', expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch;
    const past = new Date(Date.now() - 60_000).toISOString();
    const admin = adminWith({ access_token_enc: encryptToken('OLD'), refresh_token_enc: encryptToken('RT'), token_expiry: past });
    const { getValidAccessTokenForTeacher } = await import('@/lib/google/tokens');
    expect(await getValidAccessTokenForTeacher(admin as never, 'u1')).toBe('FRESH');
    expect(admin.updates).toHaveLength(1);
    expect('access_token_enc' in admin.updates[0]).toBe(true);
    expect('refresh_token_enc' in admin.updates[0]).toBe(false);  // refresh token not re-persisted
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — append to `src/lib/google/tokens.ts`

```typescript
import { decryptToken } from '@/lib/google/crypto';

export class GoogleNotConnectedError extends Error {
  constructor() { super('google_not_connected'); this.name = 'GoogleNotConnectedError'; }
}

const SKEW_MS = 60_000; // refresh a minute before expiry

export async function getValidAccessTokenForTeacher(admin: SupabaseClient, teacherId: string): Promise<string> {
  const { data: row } = await admin
    .from('google_connections')
    .select('access_token_enc, refresh_token_enc, token_expiry')
    .eq('user_id', teacherId)
    .maybeSingle();
  if (!row) throw new GoogleNotConnectedError();

  const notExpired = row.token_expiry && new Date(row.token_expiry).getTime() - Date.now() > SKEW_MS;
  if (notExpired && row.access_token_enc) return decryptToken(row.access_token_enc);

  if (!row.refresh_token_enc) throw new GoogleNotConnectedError();
  const refreshToken = decryptToken(row.refresh_token_enc);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) throw new Error(`google token refresh failed: ${res.status}`);
  const fresh = (await res.json()) as GoogleTokenResponse;
  await admin.from('google_connections').update({
    access_token_enc: encryptToken(fresh.access_token),
    token_expiry: new Date(Date.now() + fresh.expires_in * 1000).toISOString(),
    last_refresh_at: new Date().toISOString(),
  }).eq('user_id', teacherId);
  return fresh.access_token;
}
```

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/lib/google/tokens.ts src/lib/google/__tests__/getValidAccessToken.test.ts && git commit -m "feat(gc): getValidAccessTokenForTeacher (lazy refresh + persist)"`

---

### Task 8: Connect route — `GET /api/teacher/google/connect`

**Files:**
- Create: `src/app/api/teacher/google/connect/route.ts`
- Create: `src/app/api/teacher/google/connect/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `buildConnectAuthUrl` (Task 4); auth chain (`createServerSupabaseClient`, `STAFF_ROLES`).
- Produces: `GET` → 401 (no user), 403 (non-staff), else a 302 redirect to the Google consent URL with a `g_oauth_state` httpOnly cookie set to a random uuid that is also the `state` param.

- [ ] **Step 1: Write the failing test** — `src/app/api/teacher/google/connect/__tests__/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}));
beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'cid';
  process.env.GOOGLE_REDIRECT_URI = 'https://x/api/auth/google/callback';
  getUser.mockReset(); single.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
});
const req = () => new NextRequest('http://x/api/teacher/google/connect');

describe('GET /api/teacher/google/connect', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('@/app/api/teacher/google/connect/route');
    expect((await GET(req())).status).toBe(401);
  });
  it('403 for a non-staff role', async () => {
    single.mockResolvedValue({ data: { role: 'student', school_id: 's1' }, error: null });
    const { GET } = await import('@/app/api/teacher/google/connect/route');
    expect((await GET(req())).status).toBe(403);
  });
  it('302 to Google consent with a state cookie that matches the state param', async () => {
    const { GET } = await import('@/app/api/teacher/google/connect/route');
    const res = await GET(req());
    expect(res.status).toBe(307); // NextResponse.redirect default
    const loc = res.headers.get('location')!;
    expect(loc).toContain('accounts.google.com/o/oauth2/v2/auth');
    const stateParam = new URL(loc).searchParams.get('state')!;
    const cookie = res.cookies.get('g_oauth_state')!;
    expect(cookie.value).toBe(stateParam);
    expect(cookie.httpOnly).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/app/api/teacher/google/connect/route.ts`

```typescript
// GET /api/teacher/google/connect — start the per-teacher Google OAuth consent.
// Sets a CSRF state cookie (verified by the callback) and redirects to Google.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { buildConnectAuthUrl } from '@/lib/google/oauthUrls';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !new Set(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const state = randomUUID();
  const res = NextResponse.redirect(buildConnectAuthUrl(state));
  res.cookies.set('g_oauth_state', state, {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600,
  });
  return res;
}
```

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/app/api/teacher/google/connect && git commit -m "feat(gc): teacher google connect route (state cookie + consent redirect)"`

---

### Task 9: Connect callback — `GET /api/auth/google/callback`

**Files:**
- Create: `src/app/api/auth/google/callback/route.ts`
- Create: `src/app/api/auth/google/callback/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `exchangeCodeForTokens`, `storeConnection` (Tasks 5/6), `getGoogleProfile` (Task 5), auth chain + admin client.
- Produces: `GET` — verifies `state` query param equals the `g_oauth_state` cookie (CSRF); requires a logged-in staff user; exchanges the code; fetches the Google profile; `storeConnection` for `user.id`; redirects to `/settings/google?connected=1` on success, `/settings/google?error=<reason>` on failure. Clears the state cookie.

- [ ] **Step 1: Write the failing test** — `src/app/api/auth/google/callback/__tests__/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const exchangeCodeForTokens = vi.fn();
const getGoogleProfile = vi.fn();
const storeConnection = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/google/tokens', () => ({ exchangeCodeForTokens: (...a: unknown[]) => exchangeCodeForTokens(...a), storeConnection: (...a: unknown[]) => storeConnection(...a) }));
vi.mock('@/lib/google/profile', () => ({ getGoogleProfile: (...a: unknown[]) => getGoogleProfile(...a) }));

beforeEach(() => {
  for (const m of [getUser, single, exchangeCodeForTokens, getGoogleProfile, storeConnection]) m.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  exchangeCodeForTokens.mockResolvedValue({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'openid x' });
  getGoogleProfile.mockResolvedValue({ id: 'g1', email: 'a@b.edu', verified_email: true });
  storeConnection.mockResolvedValue(undefined);
});
function req(stateParam: string, cookieState: string | null, code = 'the-code') {
  const r = new NextRequest(`http://x/api/auth/google/callback?code=${code}&state=${stateParam}`);
  if (cookieState) r.cookies.set('g_oauth_state', cookieState);
  return r;
}

describe('GET /api/auth/google/callback', () => {
  it('redirects to an error when state does not match (CSRF)', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(req('aaa', 'bbb'));
    expect(res.headers.get('location')).toContain('/settings/google?error=state');
    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
  });
  it('exchanges + stores + redirects connected=1 on the happy path', async () => {
    const { GET } = await import('@/app/api/auth/google/callback/route');
    const res = await GET(req('s', 's'));
    expect(exchangeCodeForTokens).toHaveBeenCalledWith('the-code');
    expect(storeConnection).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'u1', googleId: 'g1', email: 'a@b.edu' }));
    expect(res.headers.get('location')).toContain('/settings/google?connected=1');
  });
  it('401 when no logged-in user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('@/app/api/auth/google/callback/route');
    expect((await GET(req('s', 's'))).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/app/api/auth/google/callback/route.ts`

```typescript
// GET /api/auth/google/callback — the single registered Google redirect URI.
// Verifies CSRF state, requires the current logged-in staff user, exchanges the code, fetches the
// Google profile, and stores the ENCRYPTED connection for that teacher. Never creates a session.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { exchangeCodeForTokens, storeConnection } from '@/lib/google/tokens';
import { getGoogleProfile } from '@/lib/google/profile';

function back(origin: string, qs: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/settings/google?${qs}`);
  res.cookies.delete('g_oauth_state');
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const cookieState = req.cookies.get('g_oauth_state')?.value ?? null;

  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !new Set(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!code || !state || !cookieState || state !== cookieState) return back(origin, 'error=state');

  try {
    const tokens = await exchangeCodeForTokens(code);
    const gp = await getGoogleProfile(tokens.access_token);
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

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/app/api/auth/google/callback && git commit -m "feat(gc): connect callback — exchange, profile, store encrypted connection"`

---

### Task 10: Scope-check route — `GET /api/teacher/google/scope-check`

**Files:**
- Create: `src/app/api/teacher/google/scope-check/route.ts`
- Create: `src/app/api/teacher/google/scope-check/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `getValidAccessTokenForTeacher` + `GoogleNotConnectedError` (Task 7), `GC_REQUIRED_SCOPES` (Task 1), auth chain + admin client.
- Produces: `GET` → `{ connected: boolean, needsReconnect: boolean, missing: string[] }`. No connection → `{connected:false, needsReconnect:false, missing:[]}`. Connected → refresh-if-needed, call `tokeninfo`, diff live scopes vs `GC_REQUIRED_SCOPES`.

- [ ] **Step 1: Write the failing test** — `src/app/api/teacher/google/scope-check/__tests__/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const getValid = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({}),
}));
vi.mock('@/lib/google/tokens', async () => {
  class GoogleNotConnectedError extends Error {}
  return { getValidAccessTokenForTeacher: (...a: unknown[]) => getValid(...a), GoogleNotConnectedError };
});
beforeEach(() => {
  getUser.mockReset(); single.mockReset(); getValid.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
});
const req = () => new NextRequest('http://x/api/teacher/google/scope-check');

describe('GET /api/teacher/google/scope-check', () => {
  it('connected:false when not connected', async () => {
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    getValid.mockRejectedValue(new GoogleNotConnectedError());
    const { GET } = await import('@/app/api/teacher/google/scope-check/route');
    expect(await (await GET(req())).json()).toEqual({ connected: false, needsReconnect: false, missing: [] });
  });
  it('connected with no missing scopes', async () => {
    getValid.mockResolvedValue('AT');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ scope:
      'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.rosters.readonly https://www.googleapis.com/auth/classroom.profile.emails https://www.googleapis.com/auth/classroom.coursework.students https://www.googleapis.com/auth/classroom.courseworkmaterials' }), { status: 200 })) as unknown as typeof fetch;
    const { GET } = await import('@/app/api/teacher/google/scope-check/route');
    const body = await (await GET(req())).json();
    expect(body.connected).toBe(true); expect(body.needsReconnect).toBe(false); expect(body.missing).toEqual([]);
  });
  it('needsReconnect when a required scope is missing', async () => {
    getValid.mockResolvedValue('AT');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ scope: 'https://www.googleapis.com/auth/classroom.courses.readonly' }), { status: 200 })) as unknown as typeof fetch;
    const { GET } = await import('@/app/api/teacher/google/scope-check/route');
    const body = await (await GET(req())).json();
    expect(body.connected).toBe(true); expect(body.needsReconnect).toBe(true);
    expect(body.missing).toContain('https://www.googleapis.com/auth/classroom.coursework.students');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/app/api/teacher/google/scope-check/route.ts`

```typescript
// GET /api/teacher/google/scope-check — is this teacher connected, and do they still hold the
// scopes CORE needs? Refreshes the token if needed, reads live scopes from tokeninfo, diffs.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { getValidAccessTokenForTeacher, GoogleNotConnectedError } from '@/lib/google/tokens';
import { GC_REQUIRED_SCOPES } from '@/lib/google/config';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !new Set(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  let accessToken: string;
  try {
    accessToken = await getValidAccessTokenForTeacher(admin, user.id);
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ connected: false, needsReconnect: false, missing: [] });
    return NextResponse.json({ connected: false, needsReconnect: true, missing: [] });
  }

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!res.ok) return NextResponse.json({ connected: true, needsReconnect: true, missing: GC_REQUIRED_SCOPES });
  const info = (await res.json()) as { scope?: string };
  const live = new Set((info.scope ?? '').split(' '));
  const missing = GC_REQUIRED_SCOPES.filter((s) => !live.has(s));
  return NextResponse.json({ connected: true, needsReconnect: missing.length > 0, missing });
}
```

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/app/api/teacher/google/scope-check && git commit -m "feat(gc): scope-check route (tokeninfo diff vs required scopes)"`

---

### Task 11: Disconnect route — `POST /api/teacher/google/disconnect`

**Files:**
- Create: `src/app/api/teacher/google/disconnect/route.ts`
- Create: `src/app/api/teacher/google/disconnect/__tests__/route.test.ts`

**Interfaces:**
- Consumes: auth chain + admin client.
- Produces: `POST` → deletes the caller's OWN `google_connections` row (`user_id = user.id`), returns `{ ok: true }`. 401/403 gated. (Self-scoped: no cross-user object guard needed — the delete is keyed to `user.id`.)

- [ ] **Step 1: Write the failing test** — `src/app/api/teacher/google/disconnect/__tests__/route.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const single = vi.fn();
const del = vi.fn();
const eq = vi.fn(() => del());
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }),
  createAdminSupabaseClient: () => ({ from: () => ({ delete: () => ({ eq }) }) }),
}));
beforeEach(() => {
  getUser.mockReset(); single.mockReset(); del.mockReset(); eq.mockClear();
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  single.mockResolvedValue({ data: { role: 'teacher', school_id: 's1' }, error: null });
  del.mockResolvedValue({ error: null });
});
const req = () => new NextRequest('http://x/api/teacher/google/disconnect', { method: 'POST' });

describe('POST /api/teacher/google/disconnect', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/teacher/google/disconnect/route');
    expect((await POST(req())).status).toBe(401);
  });
  it('deletes the caller own connection', async () => {
    const { POST } = await import('@/app/api/teacher/google/disconnect/route');
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `src/app/api/teacher/google/disconnect/route.ts`

```typescript
// POST /api/teacher/google/disconnect — remove the caller's own stored Google connection.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role, school_id').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !new Set(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from('google_connections').delete().eq('user_id', user.id);
  if (error) return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests** — PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit** — `git add src/app/api/teacher/google/disconnect && git commit -m "feat(gc): disconnect route (delete own connection)"`

---

### Task 12: Teacher connect UI

**Files:**
- Create: `src/app/(teacher)/settings/google/page.tsx` (server)
- Create: `src/app/(teacher)/settings/google/_components/GoogleConnectCard.tsx` (client)
- Create: `src/app/(teacher)/settings/google/_components/__tests__/GoogleConnectCard.test.tsx`
- Modify: `STRINGS-FOR-BARB.md` (append a `## Google Classroom — Seg 1` section with the connect-card strings)

**Interfaces:**
- Consumes: `GET /api/teacher/google/scope-check` (status), `GET /api/teacher/google/connect` (navigation), `POST /api/teacher/google/disconnect`.
- Produces: a status card — **Not connected** (a "Connect Google Classroom" link to `/api/teacher/google/connect`), **Connected** (a "Disconnect" button), **Needs reconnect** (a "Reconnect" link). Token-only, deep-ink, `role="status"` for the state line.

- [ ] **Step 1: Write the failing test** — `src/app/(teacher)/settings/google/_components/__tests__/GoogleConnectCard.test.tsx`

```typescript
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GoogleConnectCard from '../GoogleConnectCard';

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks(); });

function mockScope(body: object) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

describe('GoogleConnectCard', () => {
  it('shows a Connect action when not connected', async () => {
    mockScope({ connected: false, needsReconnect: false, missing: [] });
    render(<GoogleConnectCard />);
    await waitFor(() => expect(screen.getByRole('link', { name: /connect google classroom/i })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /connect google classroom/i })).toHaveAttribute('href', '/api/teacher/google/connect');
  });
  it('shows a Disconnect button when connected', async () => {
    mockScope({ connected: true, needsReconnect: false, missing: [] });
    render(<GoogleConnectCard />);
    await waitFor(() => expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument());
  });
  it('shows a Reconnect action when reconnect is needed', async () => {
    mockScope({ connected: true, needsReconnect: true, missing: ['x'] });
    render(<GoogleConnectCard />);
    await waitFor(() => expect(screen.getByRole('link', { name: /reconnect/i })).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** — `GoogleConnectCard.tsx` then the page

```tsx
'use client';
// GoogleConnectCard — teacher Google Classroom connect/reconnect/disconnect status card.
// Reads /scope-check on mount; token-only; deep-ink. Strings DRAFT → Barb.
import React, { useEffect, useState } from 'react';

type Status = { connected: boolean; needsReconnect: boolean; missing: string[] } | null;

export default function GoogleConnectCard(): React.JSX.Element {
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/teacher/google/scope-check')
      .then((r) => r.json())
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { if (alive) setStatus({ connected: false, needsReconnect: false, missing: [] }); });
    return () => { alive = false; };
  }, []);

  async function disconnect() {
    setBusy(true);
    try { await fetch('/api/teacher/google/disconnect', { method: 'POST' }); setStatus({ connected: false, needsReconnect: false, missing: [] }); }
    finally { setBusy(false); }
  }

  const linkCls = 'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';
  const btnCls = 'inline-flex items-center rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50';

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-5 shadow-sticker">
      <h2 className="font-display text-lg font-extrabold text-fg">Google Classroom</h2>
      {status === null ? (
        <p role="status" className="text-fg text-sm">Checking your connection…</p>
      ) : status.needsReconnect ? (
        <>
          <p role="status" className="text-fg text-sm">Your Google access needs renewing.</p>
          <a href="/api/teacher/google/connect" className={linkCls}>Reconnect Google Classroom</a>
        </>
      ) : status.connected ? (
        <>
          <p role="status" className="text-fg text-sm">Connected.</p>
          <button type="button" onClick={disconnect} disabled={busy} className={btnCls}>Disconnect</button>
        </>
      ) : (
        <>
          <p role="status" className="text-fg text-sm">Connect your Google account to import rosters and sync assignments.</p>
          <a href="/api/teacher/google/connect" className={linkCls}>Connect Google Classroom</a>
        </>
      )}
    </div>
  );
}
```

```tsx
// src/app/(teacher)/settings/google/page.tsx
import GoogleConnectCard from './_components/GoogleConnectCard';

export default function GoogleSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <GoogleConnectCard />
    </div>
  );
}
```

- [ ] **Step 4: Run tests** — `npx vitest run "src/app/(teacher)/settings/google/_components/__tests__/GoogleConnectCard.test.tsx"` → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Append strings to `STRINGS-FOR-BARB.md`** — a `## Google Classroom — Seg 1 (connect)` section listing: "Google Classroom", "Checking your connection…", "Connected.", "Your Google access needs renewing.", "Connect your Google account to import rosters and sync assignments.", "Connect Google Classroom", "Reconnect Google Classroom", "Disconnect".

- [ ] **Step 6: Commit** — `git add "src/app/(teacher)/settings/google" STRINGS-FOR-BARB.md && git commit -m "feat(gc): teacher connect/reconnect/disconnect UI"`

---

## Segment-end verification

- [ ] `npx tsc --noEmit` → 0
- [ ] `npx vitest run` → all green (record the count)
- [ ] `npm run build` → 0 (a11y + token gates pass)
- [ ] Whole-segment adversarial review (5-lens Workflow): OAuth/CSRF correctness, token-crypto correctness (IV/tag/key handling, no plaintext leak), RLS/auth-chain on every route, refresh-race + expiry-skew, test hygiene. Fix confirmed Critical/Important, re-verify.
- [ ] Playwright preview of the connect card states (not-connected / connected / needs-reconnect) for Marvin.
- [ ] Marvin merge call → merge → **then** apply migration 0022 with explicit authorization → deploy verify.

---

## Self-Review (vs spec §4–§8)

1. **Spec coverage:** token vault table (§4 `google_connections`) → Task 3 ✓; encryption (§8) → Task 2 ✓; per-teacher OAuth + connect/callback (§6) → Tasks 4/8/9 ✓; centralized token-manager / single refresh (§2 default) → Tasks 5–7 ✓; scope-check/reconnect (§6) → Task 10 ✓; disconnect + UI → Tasks 11/12 ✓; new env key `GOOGLE_TOKEN_ENC_KEY` (§5) → Task 1 ✓. **Deferred out of Seg 1 (documented):** `external_identities` email/last_seen_at columns + resolve helper (land in Seg 2, their first consumer); `schools.state` population (open item #13 — value source undecided; not built here); `GOOGLE_LAUNCH_STATE_SECRET` (Seg 4).
2. **Placeholder scan:** no TBD/"handle errors"/"similar to" — every code step is complete. ✓
3. **Type consistency:** `GoogleTokenResponse` (Task 5) reused in Tasks 6/7; `storeConnection(admin, args)` signature consistent across Task 6 def and Task 9 call; `getValidAccessTokenForTeacher(admin, teacherId)` consistent across Tasks 7/10; `GoogleNotConnectedError` thrown in Task 7, caught in Task 10. ✓
