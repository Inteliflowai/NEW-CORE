# Support Tickets — Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-06-26-support-tickets.md`  
> **Branch:** `feat/support-tickets` (create off `main`)  
> **Date:** 2026-06-26

---

## Pre-code grounding summary

| Item | Finding |
|---|---|
| Next migration | **0030** — last applied is `0029_parent_narratives.sql` |
| Avatar proxy pattern | `src/app/api/profile/avatar/route.ts` — mirrors exactly for screenshot proxy |
| Guard pattern | `src/lib/auth/guards.ts` — `guardPlatformAdmin()` for admin routes; `resolveCaller()` (internal) pattern for per-user checks |
| Admin client | `createAdminSupabaseClient()` (synchronous) for all writes/reads that bypass RLS |
| Deny-by-default RLS model | `0026_audit_logs.sql` + `0027_google_publications.sql` — service_role ALL, authenticated SELECT with policy, no anon grant |
| Layout wiring | Teacher uses `TeacherShell`; school-admin uses `AdminShell`; student + parent use `RoleLayout`; super-admin uses `RoleLayout` + inline nav JSX |
| `HelpButton` is `"use client"` | Fixed-position client component; all 4 target layouts are Server Components → import is fine (RSC can render client components) |
| Screenshot bucket prefix | Store `support-uploads/${userId}/${uuid}.ext` in `screenshot_path` so the proxy can verify bucket membership via a `startsWith('support-uploads/')` check before stripping the prefix for the `.download()` call |

---

## File manifest

### New files (14)
```
supabase/migrations/0030_support_tickets.sql
src/app/api/support/tickets/route.ts
src/app/api/support/tickets/__tests__/route.test.ts
src/app/api/support/tickets/[id]/route.ts
src/app/api/support/tickets/[id]/__tests__/route.test.ts
src/app/api/support/tickets/[id]/messages/route.ts
src/app/api/support/tickets/[id]/messages/__tests__/route.test.ts
src/app/api/support/screenshot/route.ts
src/app/api/support/screenshot/__tests__/route.test.ts
src/components/core/HelpButton.tsx
src/components/core/HelpTicketModal.tsx
src/components/core/__tests__/HelpButton.test.tsx
src/app/(super-admin)/platform/support/page.tsx
src/app/(super-admin)/platform/support/_components/TicketInbox.tsx
src/app/(super-admin)/platform/support/_components/TicketDetail.tsx
src/app/(super-admin)/platform/support/__tests__/TicketInbox.test.tsx
```

### Modified files (7)
```
supabase/migrations/__tests__/migrations.test.ts  — add describe('0030 support_tickets')
src/app/(teacher)/layout.tsx                      — add <HelpButton />
src/app/(school-admin)/layout.tsx                 — add <HelpButton />
src/app/(student)/layout.tsx                      — add <HelpButton />
src/app/(parent)/layout.tsx                       — add <HelpButton />
src/app/(super-admin)/layout.tsx                  — add <HelpButton /> + /platform/support nav link
STRINGS-FOR-BARB.md                               — add §Support Tickets
```

---

## Task breakdown (7 tasks, 4 dependency waves)

---

### Task 1 — Migration 0030 + test assertions

**Wave 1 — no dependencies.**

**Files to produce:**
- `supabase/migrations/0030_support_tickets.sql` (CREATE)
- `supabase/migrations/__tests__/migrations.test.ts` (MODIFY — append describe block)

---

#### SQL contract

```sql
-- 0030_support_tickets.sql
-- Any authenticated user may submit a support ticket; platform_admin triages.
-- Two tables + a private storage bucket. Deny-by-default RLS (service_role writes,
-- platform_admin + submitter read — no authenticated write policy).

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by      uuid        NOT NULL REFERENCES public.users(id),
  submitted_by_role text        NOT NULL,    -- snapshot at submission time
  school_id         uuid        REFERENCES public.schools(id),  -- null = parent w/o school
  subject           text        NOT NULL,
  description       text        NOT NULL,
  category          text        NOT NULL DEFAULT 'general'
                    CHECK (category IN ('general','bug','feature','account','data','other')),
  priority          text        NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low','normal','high','urgent')),
  status            text        NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','in_progress','resolved')),
  screenshot_path   text,       -- full path including bucket prefix, e.g. support-uploads/{userId}/{uuid}.ext
  assigned_to       uuid        REFERENCES public.users(id),
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_st_submitted_by    ON public.support_tickets (submitted_by);
CREATE INDEX IF NOT EXISTS idx_st_status_created  ON public.support_tickets (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid        NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id   uuid        NOT NULL REFERENCES public.users(id),
  message     text        NOT NULL,
  is_internal boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stm_ticket ON public.support_ticket_messages (ticket_id, created_at ASC);

-- RLS: support_tickets
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "st_service_role_all" ON public.support_tickets;
CREATE POLICY "st_service_role_all" ON public.support_tickets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "st_platform_admin_read" ON public.support_tickets;
CREATE POLICY "st_platform_admin_read" ON public.support_tickets
  FOR SELECT TO authenticated USING (public.is_platform_admin());

DROP POLICY IF EXISTS "st_submitter_read" ON public.support_tickets;
CREATE POLICY "st_submitter_read" ON public.support_tickets
  FOR SELECT TO authenticated USING (submitted_by = auth.uid());

-- RLS: support_ticket_messages
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stm_service_role_all" ON public.support_ticket_messages;
CREATE POLICY "stm_service_role_all" ON public.support_ticket_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "stm_platform_admin_read" ON public.support_ticket_messages;
CREATE POLICY "stm_platform_admin_read" ON public.support_ticket_messages
  FOR SELECT TO authenticated USING (public.is_platform_admin());

-- Non-admin submitter: own ticket messages only, internal notes filtered out
DROP POLICY IF EXISTS "stm_submitter_read" ON public.support_ticket_messages;
CREATE POLICY "stm_submitter_read" ON public.support_ticket_messages
  FOR SELECT TO authenticated
  USING (
    is_internal = false
    AND ticket_id IN (
      SELECT id FROM public.support_tickets WHERE submitted_by = auth.uid()
    )
  );

-- Table-level grants (house pattern: authenticated gets SELECT via policies; service_role gets ALL)
GRANT SELECT ON public.support_tickets         TO authenticated;
GRANT ALL    ON public.support_tickets         TO service_role;
GRANT SELECT ON public.support_ticket_messages TO authenticated;
GRANT ALL    ON public.support_ticket_messages TO service_role;

-- Private bucket: screenshots must never be publicly accessible (minors + PII risk)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('support-uploads', 'support-uploads', false)
  ON CONFLICT (id) DO UPDATE SET public = excluded.public;
```

---

#### Migration test assertions (append to migrations.test.ts)

```typescript
describe('0030 support_tickets', () => {
  const s = () => sql('0030_support_tickets.sql');

  it('creates support_tickets + support_ticket_messages', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.support_tickets/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.support_ticket_messages/);
  });

  it('support_tickets has required columns + category/priority/status CHECKs', () => {
    expect(s()).toMatch(/submitted_by\s+uuid\s+NOT NULL REFERENCES public\.users\(id\)/);
    expect(s()).toMatch(/submitted_by_role\s+text\s+NOT NULL/);
    expect(s()).toMatch(/screenshot_path\s+text/);
    expect(s()).toMatch(/category.*CHECK \(category IN \('general','bug','feature','account','data','other'\)\)/);
    expect(s()).toMatch(/priority.*CHECK \(priority IN \('low','normal','high','urgent'\)\)/);
    expect(s()).toMatch(/status.*CHECK \(status IN \('open','in_progress','resolved'\)\)/);
  });

  it('support_tickets.school_id is nullable (parent without school affiliation)', () => {
    // school_id must NOT have NOT NULL
    expect(s()).toMatch(/school_id\s+uuid\s+REFERENCES public\.schools\(id\)/);
    expect(s()).not.toMatch(/school_id\s+uuid\s+NOT NULL REFERENCES public\.schools/);
  });

  it('support_ticket_messages cascades on ticket delete + has is_internal NOT NULL', () => {
    expect(s()).toMatch(
      /ticket_id\s+uuid\s+NOT NULL REFERENCES public\.support_tickets\(id\) ON DELETE CASCADE/
    );
    expect(s()).toMatch(/is_internal\s+boolean\s+NOT NULL DEFAULT false/);
  });

  it('enables RLS on both tables', () => {
    expect(s()).toMatch(/ALTER TABLE public\.support_tickets\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.support_ticket_messages\s+ENABLE ROW LEVEL SECURITY/);
  });

  it('has service_role_all + platform_admin_read + submitter_read on support_tickets', () => {
    expect(s()).toMatch(/st_service_role_all/);
    expect(s()).toMatch(/st_platform_admin_read/);
    expect(s()).toMatch(/st_submitter_read[\s\S]*submitted_by = auth\.uid\(\)/);
  });

  it('stm_submitter_read filters is_internal = false (non-admin never sees internal notes)', () => {
    expect(s()).toMatch(/stm_submitter_read/);
    expect(s()).toMatch(/is_internal = false/);
  });

  it('provisions the private support-uploads bucket (public = false)', () => {
    expect(s()).toMatch(/INSERT INTO storage\.buckets[\s\S]*'support-uploads'[\s\S]*false/i);
  });

  it('uses DROP POLICY IF EXISTS before CREATE POLICY (re-runnable)', () => {
    expect(s()).toMatch(/DROP POLICY IF EXISTS/);
    expect(s()).toMatch(/CREATE POLICY/);
  });

  it('grants SELECT to authenticated + ALL to service_role on both tables (house pattern)', () => {
    expect(s()).toMatch(/GRANT SELECT ON public\.support_tickets\s+TO authenticated/);
    expect(s()).toMatch(/GRANT ALL\s+ON public\.support_tickets\s+TO service_role/);
    expect(s()).toMatch(/GRANT SELECT ON public\.support_ticket_messages\s+TO authenticated/);
    expect(s()).toMatch(/GRANT ALL\s+ON public\.support_ticket_messages\s+TO service_role/);
  });

  it('no anon grant (deny-by-default house pattern — mirrors 0026/0027)', () => {
    expect(s()).not.toMatch(/TO authenticated, anon, service_role/);
  });
});
```

**Gate:** `npx vitest run supabase/migrations/__tests__/migrations.test.ts` — new describe block passes.

---

### Task 2 — POST /api/support/tickets + GET /api/support/tickets

**Wave 2 — depends on Task 1 schema.**

**Files:**
- `src/app/api/support/tickets/route.ts` (CREATE)
- `src/app/api/support/tickets/__tests__/route.test.ts` (CREATE)

---

#### POST handler — any authenticated user

```
auth:  createServerSupabaseClient() → auth.getUser() → 401 if no user
body:  { subject: string, description: string, category?: string, priority?: string, screenshotPath?: string }
```

Implementation steps:
1. `createServerSupabaseClient()` → `auth.getUser()` → 401 if no user
2. Parse body; validate required fields: `subject` (non-empty string) and `description` (non-empty string) → 400 if missing
3. Validate `category` against `['general','bug','feature','account','data','other']`; coerce to `'general'` if absent; 400 if present but invalid
4. Validate `priority` against `['low','normal','high','urgent']`; coerce to `'normal'` if absent; 400 if present but invalid
5. Validate `screenshotPath`: if present, must be a non-empty string starting with `'support-uploads/'` — 400 if format invalid (do NOT trust the client; a malicious client could pass a path to another bucket)
6. `admin = createAdminSupabaseClient()`
7. `admin.from('users').select('role, school_id').eq('id', userId).single()` → snapshot `submitted_by_role` and `school_id` (null OK for parents)
8. `admin.from('support_tickets').insert({ submitted_by: userId, submitted_by_role, school_id: school_id ?? null, subject, description, category, priority, screenshot_path: screenshotPath ?? null }).select('id').single()`
9. Return `{ ticketId: id }` with status 201

#### GET handler — platform_admin (all) or any authenticated user (own tickets with ?mine=1)

```
platform_admin:  GET /api/support/tickets?status=open&page=0  → all tickets filtered by status
non-admin:       GET /api/support/tickets?mine=1               → own tickets only
other:           → 403
```

Implementation steps:
1. `createServerSupabaseClient()` → `auth.getUser()` → 401
2. `admin.from('users').select('role').eq('id', userId).single()` → get role
3. Branch:
   - If `role === 'platform_admin'`: paginated query with optional `status` filter
     - `page = parseInt(searchParams.get('page') ?? '0', 10)`; PAGE_SIZE = 20
     - `query = admin.from('support_tickets').select('id, subject, category, priority, status, submitted_by_role, school_id, created_at, assigned_to').order('created_at', { ascending: false })`
     - If `status` param present and valid: `.eq('status', status)`
     - `.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)`
     - Return `{ tickets, page, hasMore: tickets.length === PAGE_SIZE }`
   - Else if `searchParams.get('mine') === '1'`: own tickets
     - `admin.from('support_tickets').select('id, subject, category, status, created_at').eq('submitted_by', userId).order('created_at', { ascending: false })`
     - Return `{ tickets }`
   - Else: return 403

Note: own-ticket view deliberately does NOT return `priority` (spec: priority visible to platform_admin only, not shown to submitters in their ticket view).

#### Tests (`route.test.ts`)

Mock both `createServerSupabaseClient` and `createAdminSupabaseClient`. Tests:
- POST: unauthenticated → 401
- POST: missing `subject` → 400
- POST: invalid `category` value → 400
- POST: valid body → 201 with `{ticketId}`; verify insert called with `submitted_by_role` = caller's role
- POST: parent user with null `school_id` → insert with `school_id: null` (not an error)
- POST: `screenshotPath` not starting with `support-uploads/` → 400
- GET: unauthenticated → 401
- GET: non-admin without `?mine=1` → 403
- GET: non-admin with `?mine=1` → 200; verify query has `.eq('submitted_by', userId)` and NO `priority` in select
- GET: platform_admin without status filter → 200 all tickets
- GET: platform_admin with `?status=open` → 200 filtered

---

### Task 3 — PATCH /api/support/tickets/[id] + message routes

**Wave 3 — depends on Task 2 (ticket creation must exist for messages to work).**

**Files:**
- `src/app/api/support/tickets/[id]/route.ts` (CREATE)
- `src/app/api/support/tickets/[id]/__tests__/route.test.ts` (CREATE)
- `src/app/api/support/tickets/[id]/messages/route.ts` (CREATE)
- `src/app/api/support/tickets/[id]/messages/__tests__/route.test.ts` (CREATE)

---

#### PATCH /api/support/tickets/[id] — platform_admin only

1. `const guard = await guardPlatformAdmin(); if (guard) return guard;`
2. Parse `params`: `const { id } = await params;` (Next 16 async params)
3. Parse body: `{ status?: string, assigned_to?: string | null }`
4. Validate `status` ∈ `['open','in_progress','resolved']` if present → 400 if invalid
5. Build update payload; if `status === 'resolved'` → include `resolved_at: new Date().toISOString()`; if status changes away from `'resolved'` → include `resolved_at: null`
6. `admin.from('support_tickets').update(payload).eq('id', id).select('id').single()`
7. If no row matched → 404; else 200 `{ ok: true }`

#### POST /api/support/tickets/[id]/messages — submitter or platform_admin

1. `createServerSupabaseClient()` → `auth.getUser()` → 401
2. Parse `params`: `const { id: ticketId } = await params;`
3. `admin.from('support_tickets').select('submitted_by').eq('id', ticketId).maybeSingle()` → 404 if not found
4. `admin.from('users').select('role').eq('id', userId).single()` → get caller role
5. Gate: `ticket.submitted_by === userId || role === 'platform_admin'` → 403 otherwise
6. Parse body: `{ message: string, is_internal?: boolean }`
7. Validate `message` is non-empty string → 400
8. **App-layer enforcement:** `is_internal = role === 'platform_admin' ? (body.is_internal === true) : false` — non-admin is ALWAYS false regardless of what was sent
9. `admin.from('support_ticket_messages').insert({ ticket_id: ticketId, sender_id: userId, message, is_internal })`
10. Return 201 `{ ok: true }`

#### GET /api/support/tickets/[id]/messages — submitter (non-internal) or platform_admin (all)

1. `createServerSupabaseClient()` → `auth.getUser()` → 401
2. Get ticket: `admin.from('support_tickets').select('submitted_by').eq('id', ticketId).maybeSingle()` → 404 if not found
3. Get caller role
4. Gate: submitter or platform_admin → 403 otherwise
5. Build query: `admin.from('support_ticket_messages').select('id, sender_id, message, is_internal, created_at').eq('ticket_id', ticketId).order('created_at', { ascending: true })`
6. If NOT platform_admin: `.eq('is_internal', false)` (app-layer filter — belt-and-suspenders on top of RLS)
7. Return `{ messages }`

#### Tests for [id]/route.test.ts
- PATCH: non-platform-admin → 403 (via guard)
- PATCH: invalid status value → 400
- PATCH: status `'resolved'` → `resolved_at` included in update payload
- PATCH: status `'open'` → `resolved_at: null` in payload
- PATCH: unknown ticket id → 404

#### Tests for [id]/messages/route.test.ts
- POST: unauthenticated → 401
- POST: non-participant (not submitter, not platform_admin) → 403
- POST: submitter sends message → 201; `is_internal` forced to `false` even if body says `true`
- POST: platform_admin sends message with `is_internal: true` → 201; `is_internal` preserved as `true`
- POST: empty message → 400
- GET: submitter → only `is_internal = false` rows (mock verifies `.eq('is_internal', false)` applied)
- GET: platform_admin → no `is_internal` filter (verify `.eq('is_internal', false)` NOT called)

---

### Task 4 — Screenshot upload route + auth proxy GET

**Wave 2 — independent of Tasks 2 and 3.**

**Files:**
- `src/app/api/support/screenshot/route.ts` (CREATE)
- `src/app/api/support/screenshot/__tests__/route.test.ts` (CREATE)

---

#### POST /api/support/screenshot — upload

```
runtime = 'nodejs'
```

1. `createServerSupabaseClient()` → `auth.getUser()` → 401
2. Parse multipart: `form = await req.formData(); file = form.get('file')` → 400 if not a Blob
3. MIME check: `file.type.startsWith('image/')` → 415 "Only image files are accepted." if false
4. Size check: `file.size > 5 * 1024 * 1024` → 413 "Screenshot is too large (max 5 MB)."
5. Derive extension from MIME:
   ```
   const EXT: Record<string, string> = {
     'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
     'image/webp': 'webp', 'image/heic': 'heic',
   };
   const ext = EXT[file.type] ?? 'img';
   ```
6. Sub-path: `const subPath = \`${userId}/${crypto.randomUUID()}.${ext}\``
7. Full stored path: `const storedPath = \`support-uploads/${subPath}\``  ← this is what goes in `screenshot_path`
8. `buffer = Buffer.from(await file.arrayBuffer())`
9. `admin.storage.from('support-uploads').upload(subPath, buffer, { contentType: file.type, upsert: false })`
10. Return `{ path: storedPath }` (201)

The caller stores `storedPath` in POST /api/support/tickets as `screenshotPath`. The format `support-uploads/${userId}/...` lets the proxy do the bucket-prefix check.

#### GET /api/support/screenshot?path=… — proxy

```
runtime = 'nodejs'
```

1. `createServerSupabaseClient()` → `auth.getUser()` → 401
2. `rawPath = searchParams.get('path')` → 400 if missing
3. Path guards:
   - `rawPath.includes('..')` → 400 "Bad path"
   - `!rawPath.startsWith('support-uploads/')` → 400 "Bad path" (prevents referencing avatars or other buckets)
4. `subPath = rawPath.slice('support-uploads/'.length)` — strip prefix for storage `.download()` call
5. `admin.from('users').select('role').eq('id', userId).single()` → get caller role
6. If `role !== 'platform_admin'`:
   - `admin.from('support_tickets').select('submitted_by').eq('screenshot_path', rawPath).maybeSingle()` → 404 if no ticket
   - `ticket.submitted_by !== userId` → 403
7. `admin.storage.from('support-uploads').download(subPath)` → 404 if storage error
8. `bytes = Buffer.from(await data.arrayBuffer())`
9. Derive content-type from subPath extension (same helper as avatar proxy):
   ```typescript
   function contentTypeForPath(p: string): string {
     if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
     if (p.endsWith('.webp')) return 'image/webp';
     if (p.endsWith('.gif')) return 'image/gif';
     return 'image/png';
   }
   ```
10. Return `new NextResponse(bytes, { status: 200, headers: { 'Content-Type': contentTypeForPath(subPath), 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } })`

#### Tests

- POST: `image/png` → 201, `{path}` starts with `support-uploads/${userId}/`
- POST: `application/pdf` → 415
- POST: `text/plain` → 415
- POST: `image/png` but size > 5 MB → 413
- POST: no auth → 401
- POST: no file field → 400
- GET: no path param → 400
- GET: path contains `..` → 400
- GET: path does not start with `support-uploads/` (e.g. `avatars/abc/photo.png`) → 400
- GET: no auth → 401
- GET: platform_admin with any valid path → 200 (no DB ownership check)
- GET: submitter with own screenshot path → 200
- GET: non-admin, non-submitter user → 403
- GET: path doesn't match any ticket's screenshot_path → 404

---

### Task 5 — HelpButton.tsx + HelpTicketModal.tsx

**Wave 2 — independent; no route dependency (routes are mocked in tests).**

**Files:**
- `src/components/core/HelpButton.tsx` (CREATE, `"use client"`)
- `src/components/core/HelpTicketModal.tsx` (CREATE, `"use client"`)
- `src/components/core/__tests__/HelpButton.test.tsx` (CREATE, jsdom)

---

#### HelpButton.tsx

```tsx
'use client';
import { useState } from 'react';
import { HelpTicketModal } from './HelpTicketModal';

export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-brand text-bg shadow-sticker
                   flex items-center justify-center text-xl font-bold
                   focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        aria-label="Get help or report an issue"
      >
        ?
      </button>
      {open && <HelpTicketModal onClose={() => setOpen(false)} />}
    </>
  );
}
```

Tokens used: `bg-brand`, `text-bg`, `shadow-sticker`, `focus-visible:outline-brand` — all Tier-2. No hardcoded hex.

---

#### HelpTicketModal.tsx

Fields:
| Field | Type | Required | Notes |
|---|---|---|---|
| Subject | text input | Yes | max 200 chars |
| Description | textarea | Yes | min 20 chars recommended, max 2000 |
| Category | `<select>` | Yes (defaults to General inquiry) | General inquiry / Bug report / Feature request / Account issue / Data question / Other |
| Priority | `<select>` | Yes (defaults to Normal) | Low / Normal / High / Urgent |
| Screenshot | `<input type="file" accept="image/*">` | No | Shown as "Attach a screenshot (optional, max 5 MB)" |

Submission flow:
1. Validate subject and description non-empty (client-side; also server validates)
2. If screenshot file selected:
   a. POST `/api/support/screenshot` with `FormData({ file })`
   b. On error: show inline error, abort submission
   c. On success: capture `path`
3. POST `/api/support/tickets` with `{ subject, description, category, priority, screenshotPath: path ?? undefined }`
4. On success: show "Your message has been sent. We'll be in touch soon." + a "Close" button
5. On error: show "Something went wrong — please try again." inline; modal stays open

Accessibility:
- `role="dialog"` + `aria-modal="true"` + `aria-labelledby="help-modal-title"`
- First field gets `autoFocus` on open
- Escape key handler: `useEffect(() => { const fn = (e) => { if (e.key === 'Escape') onClose(); }; ... }`
- Error messages: `role="alert"` so screen readers announce them
- Submit button: disabled + shows "Sending…" during request (`aria-busy="true"`)
- All labels `for`/`htmlFor` wired; no placeholder-only labels

Overlay: `fixed inset-0 z-[100] bg-fg/20 flex items-center justify-center`  
Card: `bg-bg text-fg shadow-sticker-lg rounded-lg w-full max-w-lg mx-4 p-6`

Note: `text-fg` (deep-ink) for all content text; form borders use `border-line`; no hardcoded hex.

#### Tests (`HelpButton.test.tsx`)

```typescript
// @vitest-environment jsdom
import '@/test/setup-dom';
```

- Renders the `?` button with correct `aria-label`
- Click opens modal (asserts `role="dialog"` appears in DOM)
- Pressing Escape closes the modal
- Form has all 5 fields (subject, description, category, priority, file input)
- Submit with valid data calls `fetch` POST `/api/support/tickets`
- Submit while category is invalid selection → does not call fetch (validation)
- Screenshot field triggers POST `/api/support/screenshot` before ticket POST when a file is attached
- Success state renders confirmation message; error state renders error text

---

### Task 6 — Wire HelpButton into all 4 role layouts + super-admin nav

**Wave 4 — depends on Task 5 (`HelpButton` must exist).**

**Files modified:** 5 layout files.

---

#### `src/app/(teacher)/layout.tsx`

Add import; wrap return in a Fragment:

```tsx
import { HelpButton } from '@/components/core/HelpButton';

// return:
return (
  <>
    <TeacherShell userName={fullName} alertCount={alertCount} avatarUrl={avatarUrl}>
      {children}
    </TeacherShell>
    <HelpButton />
  </>
);
```

#### `src/app/(school-admin)/layout.tsx`

```tsx
import { HelpButton } from '@/components/core/HelpButton';

return (
  <>
    <AdminShell
      userName={fullName}
      avatarUrl={(avatarRow?.avatar_url ?? null) as string | null}
      roleLabel={ROLE_LABEL[role] ?? 'Administrator'}
      canSeeStudentAttention={caps.canSeeStudentAttention}
    >
      {children}
    </AdminShell>
    <HelpButton />
  </>
);
```

#### `src/app/(student)/layout.tsx`

```tsx
import { HelpButton } from '@/components/core/HelpButton';

return (
  <>
    <RoleLayout role="student" nav={nav}>
      {children}
    </RoleLayout>
    <HelpButton />
  </>
);
```

#### `src/app/(parent)/layout.tsx`

```tsx
import { HelpButton } from '@/components/core/HelpButton';

return (
  <>
    <RoleLayout role="parent" nav={nav}>
      {children}
    </RoleLayout>
    <HelpButton />
  </>
);
```

#### `src/app/(super-admin)/layout.tsx`

Add nav link + HelpButton:

```tsx
import { HelpButton } from '@/components/core/HelpButton';

const nav = (
  <>
    <a href="/provision" className="text-fg hover:text-brand px-3 py-1">Provision</a>
    <a href="/schools" className="text-fg hover:text-brand px-3 py-1">Schools</a>
    <a href="/platform/support" className="text-fg hover:text-brand px-3 py-1">Support</a>
  </>
);

return (
  <>
    <RoleLayout role="super-admin" nav={nav}>
      {children}
    </RoleLayout>
    <HelpButton />
  </>
);
```

#### Tests

Each role's existing `layout.guard.test.tsx` may test auth guarding but likely not rendering. Add a simple rendering assertion to each existing guard test file, or create thin companion test files (one per layout). Assert that after wiring, the layout renders a `<button aria-label="Get help or report an issue">` in the output.

Since layouts are Server Components, use `renderToString` or check that `HelpButton` is imported in the layout source file. The simpler path: add a single static import-presence assertion to the existing guard test files.

---

### Task 7 — Platform-admin inbox /platform/support

**Wave 4 — depends on Tasks 2 and 3 (routes must exist for the client to call).**

**Files:**
- `src/app/(super-admin)/platform/support/page.tsx` (CREATE)
- `src/app/(super-admin)/platform/support/_components/TicketInbox.tsx` (CREATE, `"use client"`)
- `src/app/(super-admin)/platform/support/_components/TicketDetail.tsx` (CREATE, `"use client"`)
- `src/app/(super-admin)/platform/support/__tests__/TicketInbox.test.tsx` (CREATE, jsdom)

---

#### page.tsx (Server Component)

```tsx
// src/app/(super-admin)/platform/support/page.tsx
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/requireRole';
import { TicketInbox } from './_components/TicketInbox';

export default async function SupportInboxPage() {
  await requireRole(['platform_admin']);
  const admin = createAdminSupabaseClient();
  const { data: tickets } = await admin
    .from('support_tickets')
    .select('id, subject, category, priority, status, submitted_by_role, school_id, created_at, assigned_to')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(20);
  return <TicketInbox initialTickets={tickets ?? []} />;
}
```

---

#### TicketInbox.tsx (Client Component)

State:
- `tab`: `'open' | 'in_progress' | 'resolved'` (default `'open'`)
- `tickets`: array of ticket summaries (seeded from `initialTickets` prop)
- `loading`: boolean
- `selectedId`: string | null

Behavior:
- On tab change: fetch `GET /api/support/tickets?status=${tab}` → update `tickets`
- On ticket row click: set `selectedId` → renders `<TicketDetail ticketId={selectedId} />`
- On status change in TicketDetail: refresh the ticket list (callback prop `onTicketUpdated`)

Layout: two-column on wide screens (list left, detail right); single-column stacked on narrow; detail panel uses `aria-live="polite"` for message updates.

Ticket row shows: subject, category badge, priority badge (platform-admin only surface — safe to show here), `submitted_by_role`, age ("2h ago" format), assigned-to initials if assigned.

Priority badge colors (tokens only):
- `urgent` → `bg-error text-bg`
- `high` → `bg-warn text-bg`  
- `normal` → `bg-surface text-fg`
- `low` → `bg-surface text-fg-muted`

Status tabs: Tab bar with "Open", "In Progress", "Resolved" — standard ARIA tablist.

---

#### TicketDetail.tsx (Client Component)

Props: `{ ticketId: string; onStatusChange?: () => void }`

On mount + on `ticketId` change:
- `GET /api/support/tickets/${ticketId}/messages` → render thread
- `GET /api/support/tickets` with specific ticket ID... 

Actually, to get full ticket details (subject, description, status, category, priority, screenshot_path), the component needs to fetch the ticket itself. Options:
1. Add a GET `/api/support/tickets/[id]` endpoint that returns a single ticket (platform_admin only)
2. Pass ticket data down from TicketInbox

Best option: pass the selected ticket object down from TicketInbox (already loaded in the list), plus fetch messages separately. The `description` field is NOT in the list query — add it to the list query, or load it lazily.

Simpler: TicketInbox passes the full ticket object (include `description` in the select query in page.tsx and in tab-change fetches), TicketDetail receives `ticket` prop + fetches messages.

Thread display:
- Each message: sender role label + timestamp + message text
- Internal notes: visually distinct — `bg-surface-alt` (surface tint) + italic "Internal note" label in `text-fg-muted`; shown only on this admin-only page
- Submitter messages: aligned left; admin replies: aligned right (or top-label differentiation — whatever feels natural)

Reply form:
- Textarea + "Send reply" button
- "Internal note" checkbox (labeled "Mark as internal — not visible to submitter")
- `POST /api/support/tickets/${ticketId}/messages` on submit

Status management buttons (contextual — show what makes sense for current status):
- `open` → "Mark in progress" + "Resolve"
- `in_progress` → "Resolve" + "Reopen"
- `resolved` → "Reopen"
- Each calls `PATCH /api/support/tickets/${ticketId}` + calls `onStatusChange()` on success

Screenshot display:
- If `ticket.screenshot_path` is set: show a thumbnail `<img>` sourced from `/api/support/screenshot?path=${encodeURIComponent(ticket.screenshot_path)}`; click opens full-size in a new tab or a lightbox
- The `src` attribute uses the auth proxy — the browser will send the session cookie automatically for same-origin requests

Assigned-to: free text display of `assigned_to` UUID (no name lookup this epic — can be a deferred enhancement).

#### Tests (TicketInbox.test.tsx)

```typescript
// @vitest-environment jsdom
import '@/test/setup-dom';
```

- Renders with `initialTickets` showing subject and category
- Tab click fetches with correct `?status=` param
- Clicking a ticket row sets selectedId (renders TicketDetail)
- Priority badge renders for `urgent` ticket

Add `TicketDetail.test.tsx`:
- Renders thread messages in order
- Internal note is visually marked (has "Internal note" text)
- Reply form submit calls `POST /api/support/tickets/${id}/messages`
- Resolve button calls `PATCH` with `{status: 'resolved'}`
- `onStatusChange` callback called after status change

---

## Dependency graph

```
Wave 1:   Task 1 (migration + tests)
Wave 2:   Task 2 (ticket CRUD routes)   Task 4 (screenshot routes)   Task 5 (HelpButton components)
Wave 3:   Task 3 (patch + messages)
Wave 4:   Task 6 (layout wiring)   Task 7 (admin inbox)
```

Wave 2 tasks are independent of each other and can run in parallel.  
Wave 4 tasks are independent of each other.

---

## Non-obvious implementation notes

### 1. school_id pull (Task 2 POST)

Do NOT use `school_id` from the Supabase auth JWT — it is not reliably set. Pull from `users` table via admin client. Parent users may have `null` — this is valid and must not error.

### 2. submitted_by_role snapshot (Task 2 POST)

Snapshot the role at submission time (`submitted_by_role`). This is immutable after insert. Never re-derive from the current user profile when reading the ticket.

### 3. is_internal defense-in-depth (Task 3 messages POST)

The RLS `stm_submitter_read` policy already filters `is_internal = false` for non-admins. **Also** enforce it at the app layer in the message-INSERT route handler: `is_internal = role === 'platform_admin' ? body.is_internal === true : false`. Two independent layers.

### 4. Screenshot path scheme and traversal guard (Tasks 2 + 4)

- **Upload** stores the path as `support-uploads/${userId}/${uuid}.ext` (includes bucket prefix)
- **Ticket POST** validates `screenshotPath` starts with `'support-uploads/'` before inserting
- **Proxy GET** checks `rawPath.startsWith('support-uploads/')` and `!rawPath.includes('..')` before ANY DB or storage call
- **Proxy GET** strips the `support-uploads/` prefix before calling `admin.storage.from('support-uploads').download(subPath)` — the `.from()` bucket is hardcoded, the sub-path is what storage expects

### 5. HelpButton and `z-index` layering

`fixed bottom-6 right-6 z-50` for the button. Modal overlay: `z-[100]` (above the button and all app chrome). Confirm no existing fixed elements use `z-50` or higher in the teacher shell that would clip the button — if discovered, raise to `z-[60]`.

### 6. Priority not shown in own-ticket view (Task 2 GET + Task 7)

The GET handler's own-ticket branch deliberately omits `priority` from the select. The admin inbox shows it. The modal lets the submitter set it on submission only (consistent with V1 — the submitter signals urgency without seeing the admin's internal prioritization later).

### 7. Pagination in admin GET (Task 2)

Use Supabase's `.range(from, to)` for offset pagination. Return `{ tickets, page, hasMore }` where `hasMore = tickets.length === PAGE_SIZE`. TicketInbox client can show a "Load more" button. Not infinite-scroll — keep it simple.

### 8. async params in Next 16 (Tasks 3, 7)

```typescript
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ...
}
```

Next 16 `params` is a Promise. The bundled docs at `node_modules/next/dist/docs/` are the canonical reference.

### 9. Strings to Barb (all tasks)

Every piece of user-visible copy in this epic goes to `STRINGS-FOR-BARB.md §Support Tickets`. This includes:
- HelpButton `aria-label` and visible label if added
- Modal title ("Get help" / "Report an issue")
- Field labels + placeholder text
- Category and priority option labels
- Success confirmation ("Your message has been sent…")
- Error messages ("Something went wrong…", "Screenshot is too large…")
- Inbox column headers, status tab labels, priority badge text
- Internal note marker label

---

## Final gates

Before opening a PR:
- `npx tsc --noEmit` → 0 errors
- `npm test` → all vitest green (check both migration assertions + new route/component tests)
- `npm run build` → 0 errors (a11y gate + token drift gate both pass)
- Spot-check: migration SQL text matches the test assertions exactly (copy–paste sync risk)

---

## Deferred (logged, not in scope)

- **Assigned-to name display** in TicketDetail (shows UUID only; need a join or lookup — deferred enhancement)
- **Email notifications** when a new ticket is submitted or a reply arrives
- **School-admin ticket visibility** (D4 decision: platform_admin only for now)
- **Ticket pagination in TicketInbox** client-side "Load more" (Task 7 can ship without it; admin can filter by status)
- **Rate limiter** on POST /api/support/tickets (any user can submit tickets in a loop; Upstash-backed limiter already exists in `src/lib/rateLimit.ts` for voice — can be wired if needed)
- **GC Seg 4 per-IP launch rate limiter** (separate deferred from that epic; unrelated)
