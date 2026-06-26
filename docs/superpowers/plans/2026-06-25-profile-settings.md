# Profile Settings (name + password + avatar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A `/profile` page (any authenticated role) to edit display name, change password, and upload an avatar — wired into the teacher shell's user-card.

**Architecture:** `/profile` is a top-level authenticated route. Name is saved via an auth'd admin-client route scoped to the caller's own `users` row; password uses the client `supabase.auth.updateUser` (same as set-password); avatar uses a **private `avatars` bucket + auth proxy** (mirrors `student-drawings` — minors' photos must never be on a public URL). `users.avatar_url` (column already exists since 0001) stores the proxy link.

**Tech Stack:** Next 16 App Router, React 19, TS-strict, Supabase storage, Vitest 4.

## Global Constraints
- **Avatars are private** — bucket `public=false`, served only via the auth proxy (own avatar only in v1). Reject non-image types (png/jpeg/webp), cap size. Mirror `src/app/api/attempts/drawing/route.ts` exactly for the upload+proxy shape.
- **Auth chain:** every route `getUser()` first; the name + avatar writes use `createAdminSupabaseClient()` scoped to `user.id` (never trust a body id). The avatar GET authorizes `user.id === ownerId` (path segment 0).
- **Email is read-only** (Google/identity-sourced — matches V1); show it, don't edit it.
- **Token-only Tailwind**; `npm run a11y` passes. Password rules match set-password (≥8 chars, confirm match).
- **Tests:** route tests = node env; component/page tests = `// @vitest-environment jsdom` + `import '@/test/setup-dom';`.
- Gates: tsc 0, vitest green, build 0.

---

### Task 1: Migration 0028 — private avatars bucket

**Files:** Create `supabase/migrations/0028_avatars.sql`. (No test — DDL; applied to NEW CORE at merge, Marvin-gated.)

- [ ] **Step 1: Write the migration**
```sql
-- 0028_avatars.sql
-- Profile avatars: a PRIVATE bucket (minors' photos must never sit on a public URL).
-- Service-role admin bypasses RLS → no storage.objects policies needed (mirrors 0021 student-drawings).
-- users.avatar_url (column exists since 0001) stores a proxy link to GET /api/profile/avatar — never a
-- public/expiring URL.
insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', false)
  on conflict (id) do update set public = excluded.public;
```
- [ ] **Step 2: Commit** — `git commit -m "feat(profile): migration 0028 — private avatars bucket"`

---

### Task 2: Avatar upload + proxy route

**Files:** Create `src/app/api/profile/avatar/route.ts`; Test `src/app/api/profile/avatar/__tests__/route.test.ts`.

**Interfaces:** `POST` (FormData `file`) → `{ avatar_url }` (also writes `users.avatar_url`); `GET ?path=` → image bytes (own avatar only).

- [ ] **Step 1: Write the failing test** — mirror `src/app/api/attempts/drawing/__tests__/route.test.ts`'s structure. Cases: POST 401 (no user); POST 415 (bad mime); POST happy → returns `avatar_url` matching `/api/profile/avatar?path=` AND calls `admin.from('users').update({avatar_url})`; GET 401; GET 400 (path with `..`); GET 403 (path owner ≠ caller); GET happy → 200 with image bytes + `X-Content-Type-Options: nosniff`. Mock `@/lib/supabase/server` (createServerSupabaseClient → {auth:{getUser}}, createAdminSupabaseClient → {storage:{from:()=>({upload,download})}, from:()=>({update:()=>({eq})})}).

- [ ] **Step 2: Run, watch fail.** `npx vitest run src/app/api/profile/avatar/__tests__/route.test.ts`

- [ ] **Step 3: Implement** `src/app/api/profile/avatar/route.ts`
```ts
// src/app/api/profile/avatar/route.ts
// POST — upload the caller's OWN avatar. GET — auth'd proxy serving the caller's OWN avatar.
// Private 'avatars' bucket; users.avatar_url stores a proxy link to GET (never public). Mirrors the
// student-drawings image-proxy pattern. Own-avatar only in v1 (cross-user display is a later add).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
const BUCKET = 'avatars';
const MAX_BYTES = 4 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
function contentTypeForPath(path: string): string {
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  const ext = EXT[file.type];
  if (!ext) return NextResponse.json({ error: 'Only PNG, JPEG, or WebP images are allowed.' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That image is too large (max 4 MB).' }, { status: 413 });

  const path = `${user.id}/avatar-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const admin = createAdminSupabaseClient();
  const { data, error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr || !data) return NextResponse.json({ error: 'Upload failed — try again.' }, { status: 500 });

  const avatarUrl = `/api/profile/avatar?path=${encodeURIComponent(path)}`;
  const { error: updErr } = await admin.from('users').update({ avatar_url: avatarUrl }).eq('id', user.id);
  if (updErr) return NextResponse.json({ error: 'Could not save your photo — try again.' }, { status: 500 });
  return NextResponse.json({ avatar_url: avatarUrl });
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const path = new URL(req.url).searchParams.get('path');
  if (!path || path.includes('..')) return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  const segs = path.split('/');
  if (segs.length < 2 || !segs[0]) return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  if (user.id !== segs[0]) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const bytes = Buffer.from(await data.arrayBuffer());
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentTypeForPath(path),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    },
  });
}
```
- [ ] **Step 4: Run, watch pass.** **Step 5: Commit** — `git commit -m "feat(profile): avatar upload + own-avatar auth proxy (private bucket)"`

---

### Task 3: Name-update route

**Files:** Create `src/app/api/profile/route.ts`; Test `src/app/api/profile/__tests__/route.test.ts`.

**Interfaces:** `POST { full_name }` → `{ ok, full_name }` (updates `users.full_name` for the caller).

- [ ] **Step 1: Failing test** — POST 401 (no user); 400 (empty name); happy → calls `admin.from('users').update({full_name}).eq('id', user.id)` and returns `{ok:true, full_name}`. Mock `@/lib/supabase/server` as in Task 2.
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement** `src/app/api/profile/route.ts`
```ts
// src/app/api/profile/route.ts — update the caller's OWN display name (users.full_name).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { full_name?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const fullName = (body.full_name ?? '').trim();
  if (!fullName) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  if (fullName.length > 120) return NextResponse.json({ error: 'Name is too long.' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from('users').update({ full_name: fullName }).eq('id', user.id);
  if (error) return NextResponse.json({ error: 'Could not save — try again.' }, { status: 500 });
  return NextResponse.json({ ok: true, full_name: fullName });
}
```
- [ ] **Step 4: Run, watch pass.** **Step 5: Commit** — `git commit -m "feat(profile): name-update route"`

---

### Task 4: Profile page + form

**Files:** Create `src/app/profile/page.tsx` (server) + `src/app/profile/_components/ProfileForm.tsx` (client); Test `src/app/profile/_components/__tests__/ProfileForm.test.tsx`.

- [ ] **Step 1: Failing test** (jsdom) — render `<ProfileForm initialName="Dana" email="d@x.edu" avatarUrl={null} />`: the name input shows "Dana"; the email shows read-only "d@x.edu"; there's a "Save name" button, an avatar file input, and password + confirm fields with a "Change password" button. (Behavior tests can mock `fetch` + `createBrowserSupabaseClient`; keep this test to presence + the name-save fetch call.)
- [ ] **Step 2: Run, watch fail.**
- [ ] **Step 3: Implement.**

`src/app/profile/page.tsx`:
```ts
import { redirect } from 'next/navigation';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { ProfileForm } from './_components/ProfileForm';

export default async function ProfilePage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const admin = createAdminSupabaseClient();
  const { data } = await admin.from('users').select('full_name, email, avatar_url').eq('id', user.id).maybeSingle();
  const p = (data ?? {}) as { full_name?: string; email?: string; avatar_url?: string | null };
  return <ProfileForm initialName={p.full_name ?? ''} email={p.email ?? ''} avatarUrl={p.avatar_url ?? null} />;
}
```

`src/app/profile/_components/ProfileForm.tsx` — a `'use client'` form: avatar (preview + file input → POST `/api/profile/avatar`), name (input + "Save name" → POST `/api/profile`), email (read-only), password (new + confirm + "Change password" → `createBrowserSupabaseClient().auth.updateUser({password})` with the ≥8 + match validation from set-password). Token classes only; each section shows a `role="status"` success or `role="alert"` error. Include a back link to `/today`. Use `useState` for fields + per-section status. (Model the inputs/validation on `src/app/set-password/page.tsx`; model the avatar upload on the student `MicButton`/drawing upload fetch pattern.)

- [ ] **Step 4: Run, watch pass.** **Step 5: Commit** — `git commit -m "feat(profile): /profile page + settings form (name + password + avatar)"`

---

### Task 5: Wire avatar + entry link into the teacher shell

**Files:** Modify `src/app/(teacher)/_components/TeacherShell.tsx` (load + pass `avatarUrl`), `TeacherSidebar.tsx` (user-card → avatar img/initials + Link to `/profile`), `TeacherTopbar.tsx` (avatar img/initials). Tests: update `TeacherTopbar` test if needed; add a sidebar render test if cheap.

- [ ] **Step 1:** Read `TeacherShell.tsx` to find where `userName` is loaded (the `users` query) — add `avatar_url` to that select and thread `avatarUrl` to `<TeacherSidebar>` + `<TeacherTopbar>`.
- [ ] **Step 2:** In `TeacherSidebar`, replace the initials `<span>` in the footer user-card: if `avatarUrl` render `<img src={avatarUrl} alt="" className="size-8 rounded-full object-cover" />` else the initials span; wrap the whole user-card in `<Link href="/profile">`. In `TeacherTopbar`, same avatar-or-initials swap on the right-side circle. Add `avatarUrl?: string | null` to both component props.
- [ ] **Step 3:** `npx tsc --noEmit` 0; run the teacher-component tests; then the controller runs the full suite + build.
- [ ] **Step 4: Commit** — `git commit -m "feat(profile): show avatar + link user-card to /profile in the teacher shell"`

---

## Self-Review
- Coverage: name (Task 3), password (Task 4 client), avatar upload+serve (Tasks 1-2), page/form (Task 4), display+entry (Task 5). Email read-only (Task 4).
- Security: avatar private bucket + own-only proxy (Task 2); all writes admin-client scoped to `user.id`; non-image rejected; size-capped.
- Deferred (note in ledger): wiring the avatar/entry-link into the OTHER role shells (student/parent/admin/super-admin) — they're placeholders; `/profile` works for them but has no visible link yet. Cross-user avatar display (staff seeing student photos). Migration 0028 applied at merge (Marvin-gated).
