# GC Segment 5 — Google Drive Doc Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let teachers import a Google Docs, Slides, or PDF from their own Google Drive into the Content Studio using their already-connected OAuth token — no public sharing required.

**Architecture:** The client detects Drive URLs via `parseDriveUrl()` (runs while the teacher types) and routes them to a new `POST /api/teacher/lessons/import-drive` endpoint. That endpoint uses `getValidAccessTokenForTeacher` (the `drive.readonly` scope is already granted at Seg-1 connect) to call the Drive v3 API, extracts text, runs the existing `parseLesson` pipeline, and inserts a lesson with `source='google_drive'`. The existing generic URL import path is completely unchanged.

**Tech Stack:** Next.js 16.2.9 App Router, React 19, TypeScript strict, Vitest 4.x, `unpdf` (existing dep — dynamic import, same pattern as `parseUpload.ts`), `@testing-library/react`

## Global Constraints

- Next.js 16.2.9 App Router, React 19, TypeScript strict — no `as any` escape hatches
- No new npm dependencies — use existing `unpdf` for PDF extraction via `await import('unpdf')`
- Drive API token via `getValidAccessTokenForTeacher(admin, userId): Promise<string>` only — never log, return, or expose tokens
- All routes: `createServerSupabaseClient()` → `auth.getUser()` → `STAFF_ROLES.includes(role)` check → `guardClassAccess(classId)` → `createAdminSupabaseClient()` for token fetch
- Token-only Tailwind (`text-fg`, `bg-surface`, `border-sidebar-edge`, `shadow-sticker`, `bg-warn-surface`, `bg-ok-surface`) — no hardcoded hex values
- Content text: `text-fg` (not `text-fg-muted`)
- React component tests: `// @vitest-environment jsdom` header then `import '@/test/setup-dom';`
- No DB migration — `lessons.source` is a free-text column (confirmed migration 0019)
- Strings → `STRINGS-FOR-BARB.md §GC Seg 5` (note the section; do not gate build on Barb approval)
- `npm test` must pass; `npx tsc --noEmit` must pass; `npm run build` must pass (a11y + tokens gates run in prebuild)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/google/errors.ts` | CREATE | Pure error classes — `DriveUnsupportedTypeError`, `DriveFileNotFoundError`, `DriveAccessDeniedError`. No imports; client-safe. |
| `src/lib/google/drive.ts` | CREATE | `parseDriveUrl(url): string\|null` (client-safe, URL API only) + `extractTextFromGoogleDriveFile(fileId, accessToken): Promise<string>` (server-only, Drive API + unpdf) |
| `src/lib/google/__tests__/drive.test.ts` | CREATE | Unit tests: `parseDriveUrl` × 6 URL formats + `extractTextFromGoogleDriveFile` × Docs/PDF/binary/404/403/truncation |
| `src/app/api/teacher/lessons/import-drive/route.ts` | CREATE | `POST /api/teacher/lessons/import-drive` — full auth chain, drive extraction, lesson insert |
| `src/app/api/teacher/lessons/import-drive/__tests__/route.test.ts` | CREATE | Route tests: 401 / 403 / 400 missing params / IDOR / connected:false / not-found / access-denied / unsupported-type / success |
| `src/app/(teacher)/upload/_components/UrlImportStudio.tsx` | MODIFY | Drive URL detection on input change; branched fetch to `/import-drive` vs `/import-url`; `not_connected` phase + reconnect CTA |
| `src/app/(teacher)/upload/_components/__tests__/UrlImportStudio.test.tsx` | MODIFY | Add Drive-branch tests (callout visible, correct endpoint called, `connected:false` → CTA, regression non-Drive → existing path) |
| `STRINGS-FOR-BARB.md` | MODIFY | Append `§GC Seg 5` section with all user-facing Drive import strings |

---

## Task 1: Drive error classes + Drive text extraction lib

**Files:**
- Create: `src/lib/google/errors.ts`
- Create: `src/lib/google/drive.ts`
- Test: `src/lib/google/__tests__/drive.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (foundational)
- Produces:
  - `parseDriveUrl(url: string): string | null` — exported from `drive.ts`; client-safe
  - `extractTextFromGoogleDriveFile(fileId: string, accessToken: string): Promise<string>` — exported from `drive.ts`; server-only
  - `DriveUnsupportedTypeError`, `DriveFileNotFoundError`, `DriveAccessDeniedError` — exported from `errors.ts`

**Note on client-safety of `drive.ts`:** `UrlImportStudio` (a `'use client'` component) imports `parseDriveUrl` from `drive.ts`. This is safe because `drive.ts` has no top-level Node.js imports — the `await import('unpdf')` is inside a function body and will never execute in the browser (the client only calls `parseDriveUrl`). Turbopack tree-shakes the unused export.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/google/__tests__/drive.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseDriveUrl, extractTextFromGoogleDriveFile } from '../drive';
import { DriveUnsupportedTypeError, DriveFileNotFoundError, DriveAccessDeniedError } from '../errors';

vi.mock('unpdf', () => ({
  extractText: vi.fn().mockResolvedValue({ text: ['PDF page one', 'PDF page two'] }),
}));

const TOKEN = 'fake-access-token';
const FILE_ID = 'file123';

function metaRes(mimeType: string, status = 200) {
  return new Response(JSON.stringify({ mimeType, name: 'Test File' }), { status });
}

beforeEach(() => { vi.restoreAllMocks(); });

// ── parseDriveUrl ──────────────────────────────────────────────────────────────

describe('parseDriveUrl', () => {
  it.each([
    ['Docs edit URL',        'https://docs.google.com/document/d/DOC_ID/edit',         'DOC_ID'],
    ['Sheets edit URL',      'https://docs.google.com/spreadsheets/d/SHEET_ID/edit',   'SHEET_ID'],
    ['Slides edit URL',      'https://docs.google.com/presentation/d/SLIDE_ID/edit',   'SLIDE_ID'],
    ['Drive file/d/ URL',    'https://drive.google.com/file/d/DRIVE_ID/view',          'DRIVE_ID'],
    ['Drive open?id= URL',   'https://drive.google.com/open?id=OPEN_ID',               'OPEN_ID'],
    ['googleapis.com URL',   'https://www.googleapis.com/drive/v3/files/API_ID',       'API_ID'],
  ])('extracts file ID from %s', (_label, url, expected) => {
    expect(parseDriveUrl(url)).toBe(expected);
  });

  it.each([
    'https://example.com/file.pdf',
    'not-a-url',
    'https://docs.google.com/',
    'https://docs.google.com/forms/d/FORM_ID/edit',  // forms — no path match
  ])('returns null for non-Drive URL: %s', (url) => {
    expect(parseDriveUrl(url)).toBeNull();
  });
});

// ── extractTextFromGoogleDriveFile ─────────────────────────────────────────────

describe('extractTextFromGoogleDriveFile', () => {
  it('exports text from a Google Docs file via the export endpoint', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('application/vnd.google-apps.document'))
      .mockResolvedValueOnce(new Response('Document text content', { status: 200 })) as typeof fetch;

    const result = await extractTextFromGoogleDriveFile(FILE_ID, TOKEN);
    expect(result).toBe('Document text content');
  });

  it('exports text from a Google Slides file via the export endpoint', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('application/vnd.google-apps.presentation'))
      .mockResolvedValueOnce(new Response('Slide text content', { status: 200 })) as typeof fetch;

    const result = await extractTextFromGoogleDriveFile(FILE_ID, TOKEN);
    expect(result).toBe('Slide text content');
  });

  it('extracts text from a PDF via unpdf', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('application/pdf'))
      .mockResolvedValueOnce(new Response(new ArrayBuffer(8), { status: 200 })) as typeof fetch;

    const result = await extractTextFromGoogleDriveFile(FILE_ID, TOKEN);
    expect(result).toBe('PDF page one\n\nPDF page two');
  });

  it('throws DriveUnsupportedTypeError for image/png', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('image/png')) as typeof fetch;

    await expect(extractTextFromGoogleDriveFile(FILE_ID, TOKEN))
      .rejects.toThrow(DriveUnsupportedTypeError);
  });

  it('throws DriveUnsupportedTypeError for video/mp4', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('video/mp4')) as typeof fetch;

    await expect(extractTextFromGoogleDriveFile(FILE_ID, TOKEN))
      .rejects.toThrow(DriveUnsupportedTypeError);
  });

  it('throws DriveFileNotFoundError when Drive returns 404', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 })) as typeof fetch;

    await expect(extractTextFromGoogleDriveFile(FILE_ID, TOKEN))
      .rejects.toThrow(DriveFileNotFoundError);
  });

  it('throws DriveAccessDeniedError when Drive returns 403', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 })) as typeof fetch;

    await expect(extractTextFromGoogleDriveFile(FILE_ID, TOKEN))
      .rejects.toThrow(DriveAccessDeniedError);
  });

  it('truncates export text to 32000 chars and emits console.warn', async () => {
    const longText = 'x'.repeat(40_000);
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(metaRes('application/vnd.google-apps.document'))
      .mockResolvedValueOnce(new Response(longText, { status: 200 })) as typeof fetch;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await extractTextFromGoogleDriveFile(FILE_ID, TOKEN);
    expect(result.length).toBe(32_000);
    expect(warnSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/lib/google/__tests__/drive.test.ts
```

Expected: FAIL with "Cannot find module '../drive'" and "Cannot find module '../errors'"

- [ ] **Step 3: Create `src/lib/google/errors.ts`**

```typescript
// src/lib/google/errors.ts
// Typed Drive API error classes for the import-drive route.
// Pure — no imports. Client-safe (no Node.js APIs).

export class DriveUnsupportedTypeError extends Error {
  constructor(public readonly mimeType: string) {
    super(`drive_unsupported_type: ${mimeType}`);
    this.name = 'DriveUnsupportedTypeError';
  }
}

export class DriveFileNotFoundError extends Error {
  constructor() {
    super('drive_file_not_found');
    this.name = 'DriveFileNotFoundError';
  }
}

export class DriveAccessDeniedError extends Error {
  constructor() {
    super('drive_access_denied');
    this.name = 'DriveAccessDeniedError';
  }
}
```

- [ ] **Step 4: Create `src/lib/google/drive.ts`**

```typescript
// src/lib/google/drive.ts
// Google Drive text extraction for POST /api/teacher/lessons/import-drive.
//
// parseDriveUrl — client-safe (URL API only, no Node.js imports). Both
// UrlImportStudio ('use client') and the server route use this function.
//
// extractTextFromGoogleDriveFile — server-only (uses dynamic import('unpdf')).
// The client never calls this function, so the dynamic import never executes
// in the browser even though the module is imported client-side for parseDriveUrl.
import { DriveUnsupportedTypeError, DriveFileNotFoundError, DriveAccessDeniedError } from '@/lib/google/errors';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const MAX_TEXT_CHARS = 32_000;

// Google Workspace MIME types that support export to text/plain
const WORKSPACE_EXPORTABLE = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.spreadsheet',
]);

// Binary-only MIME prefixes — cannot be extracted as lesson text
const BINARY_PREFIXES = ['image/', 'video/', 'audio/'];
const BINARY_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

/**
 * Extract the Drive file ID from any of these URL forms:
 * - https://docs.google.com/document/d/{id}/edit
 * - https://docs.google.com/spreadsheets/d/{id}/edit
 * - https://docs.google.com/presentation/d/{id}/edit
 * - https://drive.google.com/file/d/{id}/view
 * - https://drive.google.com/open?id={id}
 * - https://www.googleapis.com/drive/v3/files/{id}
 *
 * Returns null for non-Drive URLs → UrlImportStudio falls through to existing /import-url path.
 */
export function parseDriveUrl(url: string): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }

  if (u.hostname === 'docs.google.com') {
    const m = u.pathname.match(/\/(?:document|spreadsheets|presentation)\/d\/([^/]+)/);
    return m ? m[1] : null;
  }
  if (u.hostname === 'drive.google.com') {
    const m = u.pathname.match(/\/file\/d\/([^/]+)/);
    if (m) return m[1];
    return u.searchParams.get('id');
  }
  if (u.hostname === 'www.googleapis.com') {
    const m = u.pathname.match(/\/drive\/v3\/files\/([^/?]+)/);
    return m ? m[1] : null;
  }
  return null;
}

async function driveRequest(url: string, accessToken: string, label: string): Promise<Response> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 404) throw new DriveFileNotFoundError();
  if (res.status === 403) throw new DriveAccessDeniedError();
  if (!res.ok) throw new Error(`${label} failed: ${res.status}`); // status only — never leak body
  return res;
}

/**
 * Fetch plain text from a Drive file using the teacher's access token.
 *
 * Routing:
 * - Google Workspace Docs/Slides/Sheets → export as text/plain (Drive export endpoint)
 * - application/pdf → download binary → unpdf extraction
 * - text/* and unknown → download as text (best-effort)
 * - image/video/audio/zip/octet-stream → throw DriveUnsupportedTypeError
 *
 * Text is truncated to MAX_TEXT_CHARS (32 KB) with a console.warn if over limit.
 */
export async function extractTextFromGoogleDriveFile(
  fileId: string,
  accessToken: string,
): Promise<string> {
  // 1. Get file metadata to determine extraction path
  const metaRes = await driveRequest(
    `${DRIVE_BASE}/files/${fileId}?fields=mimeType%2Cname`,
    accessToken,
    'drive metadata',
  );
  const meta = (await metaRes.json()) as { mimeType: string; name: string };
  const { mimeType } = meta;

  // 2. Reject binary-only types before any download
  if (BINARY_PREFIXES.some((p) => mimeType.startsWith(p)) || BINARY_TYPES.has(mimeType)) {
    throw new DriveUnsupportedTypeError(mimeType);
  }

  // 3. Google Workspace native → export as text/plain
  if (WORKSPACE_EXPORTABLE.has(mimeType)) {
    const exportRes = await driveRequest(
      `${DRIVE_BASE}/files/${fileId}/export?mimeType=text%2Fplain`,
      accessToken,
      'drive export',
    );
    const text = await exportRes.text();
    if (text.length > MAX_TEXT_CHARS) {
      console.warn(`[gc/drive] ${fileId} export truncated from ${text.length} to ${MAX_TEXT_CHARS} chars`);
    }
    return text.slice(0, MAX_TEXT_CHARS);
  }

  // 4. PDF → download binary buffer → unpdf
  if (mimeType === 'application/pdf') {
    const dlRes = await driveRequest(
      `${DRIVE_BASE}/files/${fileId}?alt=media`,
      accessToken,
      'drive download pdf',
    );
    const buffer = Buffer.from(await dlRes.arrayBuffer());
    const { extractText } = await import('unpdf');
    const { text: pages } = await extractText(new Uint8Array(buffer));
    const combined = pages.join('\n\n');
    if (combined.length > MAX_TEXT_CHARS) {
      console.warn(`[gc/drive] pdf ${fileId} truncated from ${combined.length} to ${MAX_TEXT_CHARS} chars`);
    }
    return combined.slice(0, MAX_TEXT_CHARS);
  }

  // 5. text/* or anything else → download as text (best-effort)
  const dlRes = await driveRequest(
    `${DRIVE_BASE}/files/${fileId}?alt=media`,
    accessToken,
    'drive download',
  );
  const text = await dlRes.text();
  if (text.length > MAX_TEXT_CHARS) {
    console.warn(`[gc/drive] ${fileId} text truncated from ${text.length} to ${MAX_TEXT_CHARS} chars`);
  }
  return text.slice(0, MAX_TEXT_CHARS);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx vitest run src/lib/google/__tests__/drive.test.ts
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/google/errors.ts src/lib/google/drive.ts src/lib/google/__tests__/drive.test.ts
git commit -m "feat(gc-seg5): Drive URL parser + text extraction lib (errors.ts, drive.ts)"
```

---

## Task 2: `POST /api/teacher/lessons/import-drive` route

**Files:**
- Create: `src/app/api/teacher/lessons/import-drive/route.ts`
- Test: `src/app/api/teacher/lessons/import-drive/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `getValidAccessTokenForTeacher(admin, userId)` + `GoogleNotConnectedError` from `@/lib/google/tokens`; `extractTextFromGoogleDriveFile` + `parseDriveUrl` (not used here) from `@/lib/google/drive`; `DriveFileNotFoundError` + `DriveAccessDeniedError` + `DriveUnsupportedTypeError` from `@/lib/google/errors`; `gcErrorResponse` from `@/lib/google/errorEnvelope`; `parseLesson` from `@/lib/engine/lessonParse`; `respondEngineError` from `@/app/api/_lib/errorEnvelope`; `STAFF_ROLES` from `@/lib/auth/roles`; `guardClassAccess` from `@/lib/auth/guards`
- Request body: `{ file_id: string; class_id: string }`
- Success response: `{ lesson_id: string; parsed_content: ParsedLesson }` (HTTP 200)
- Error responses: HTTP 401 / 403 / 400 `{error,code}` / 404 `{error,code}` / HTTP 200 `{connected:false}` (not connected) / 503 (LLM exhausted)

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/teacher/lessons/import-drive/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/teacher/lessons/import-drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Minimal Supabase query chain builder
function chain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c['select'] = vi.fn().mockReturnValue(c);
  c['eq'] = vi.fn().mockReturnValue(c);
  c['insert'] = vi.fn().mockReturnValue(c);
  c['single'] = vi.fn().mockResolvedValue({ data, error });
  c['maybeSingle'] = vi.fn().mockResolvedValue({ data, error });
  c['then'] = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(resolve);
  return c;
}

function serverMock(user: { id: string } | null, role: string | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : new Error('no session'),
      }),
    },
    from: vi.fn().mockReturnValue(chain(role ? { role } : null)),
  };
}

function adminMock(lessonId: string | null, insertErr: unknown = null) {
  const c = chain(lessonId ? { id: lessonId } : null, insertErr);
  return { from: vi.fn().mockReturnValue(c) };
}

// ── Module mocks ────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const mockGuard = vi.fn();
vi.mock('@/lib/auth/guards', () => ({
  guardClassAccess: (...a: unknown[]) => mockGuard(...a),
}));

const mockGetToken = vi.fn();
vi.mock('@/lib/google/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google/tokens')>();
  return { ...actual, getValidAccessTokenForTeacher: (...a: unknown[]) => mockGetToken(...a) };
});

const mockExtract = vi.fn();
vi.mock('@/lib/google/drive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/google/drive')>();
  return { ...actual, extractTextFromGoogleDriveFile: (...a: unknown[]) => mockExtract(...a) };
});

const mockParseLesson = vi.fn();
vi.mock('@/lib/engine/lessonParse', () => ({
  parseLesson: (...a: unknown[]) => mockParseLesson(...a),
}));

// ── Tests ───────────────────────────────────────────────────────────────────────

const PARSED = {
  title: 'Drive Lesson', key_concepts: ['concept'], objectives: [],
  vocabulary: [], misconception_risks: [], grade_level: '7th', subject: 'English', summary: 'x',
};

describe('POST /api/teacher/lessons/import-drive', () => {
  beforeEach(() => {
    mockGuard.mockReset().mockResolvedValue(null);
    mockGetToken.mockReset().mockResolvedValue('fake-token');
    mockExtract.mockReset().mockResolvedValue('Extracted lesson text from Drive');
    mockParseLesson.mockReset().mockResolvedValue(PARSED);
  });

  it('returns 401 when unauthenticated', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock(null, null) as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is a student', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'student') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 when file_id is missing', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);

    const { POST } = await import('../route');
    const res = await POST(makeReq({ class_id: 'cid' }));
    expect(res.status).toBe(400);
  });

  it('returns 403 when guardClassAccess rejects (IDOR)', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);
    const { NextResponse } = await import('next/server');
    mockGuard.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(403);
  });

  it('returns HTTP 200 with connected:false when teacher has no Google connection', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);
    const { GoogleNotConnectedError } = await import('@/lib/google/tokens');
    mockGetToken.mockRejectedValueOnce(new GoogleNotConnectedError());

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connected).toBe(false);
  });

  it('returns 404 with drive_not_found code when Drive returns 404', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);
    const { DriveFileNotFoundError } = await import('@/lib/google/errors');
    mockExtract.mockRejectedValueOnce(new DriveFileNotFoundError());

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('drive_not_found');
  });

  it('returns 400 with drive_access_denied when file is not shared with teacher', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);
    const { DriveAccessDeniedError } = await import('@/lib/google/errors');
    mockExtract.mockRejectedValueOnce(new DriveAccessDeniedError());

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('drive_access_denied');
  });

  it('returns 400 with drive_unsupported_type for binary files', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'u1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock(null) as never);
    const { DriveUnsupportedTypeError } = await import('@/lib/google/errors');
    mockExtract.mockRejectedValueOnce(new DriveUnsupportedTypeError('image/png'));

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('drive_unsupported_type');
  });

  it('returns 200 with lesson_id and source=google_drive on success', async () => {
    const { createServerSupabaseClient, createAdminSupabaseClient } = await import('@/lib/supabase/server');
    vi.mocked(createServerSupabaseClient).mockResolvedValue(serverMock({ id: 'teacher-1' }, 'teacher') as never);
    vi.mocked(createAdminSupabaseClient).mockReturnValue(adminMock('new-lesson-id') as never);

    const { POST } = await import('../route');
    const res = await POST(makeReq({ file_id: 'fid', class_id: 'cid' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lesson_id).toBe('new-lesson-id');
    expect(body.parsed_content.title).toBe('Drive Lesson');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/app/api/teacher/lessons/import-drive/__tests__/route.test.ts
```

Expected: FAIL with "Cannot find module '../route'"

- [ ] **Step 3: Create `src/app/api/teacher/lessons/import-drive/route.ts`**

```typescript
// POST /api/teacher/lessons/import-drive
// Import a Google Drive file (Docs/Slides/PDF) as a lesson using the teacher's
// already-connected OAuth token (drive.readonly granted at Seg-1 connect).
// Auth chain mirrors publish/route.ts exactly. No DB migration needed.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { getValidAccessTokenForTeacher, GoogleNotConnectedError } from '@/lib/google/tokens';
import { GoogleScopeError } from '@/lib/google/classroom';
import { extractTextFromGoogleDriveFile } from '@/lib/google/drive';
import { DriveFileNotFoundError, DriveAccessDeniedError, DriveUnsupportedTypeError } from '@/lib/google/errors';
import { gcErrorResponse } from '@/lib/google/errorEnvelope';
import { parseLesson } from '@/lib/engine/lessonParse';
import { respondEngineError } from '@/app/api/_lib/errorEnvelope';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth chain ─────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single();
  if (!STAFF_ROLES.includes((profile as { role?: string } | null)?.role as typeof STAFF_ROLES[number])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { file_id?: string; class_id?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Bad Request' }, { status: 400 });
  }

  const fileId = (body?.file_id ?? '').trim();
  const classId = (body?.class_id ?? '').trim();
  if (!fileId || !classId) {
    return NextResponse.json({ error: 'Missing file_id or class_id' }, { status: 400 });
  }

  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  // ── Drive extraction + lesson insert (token fetch INSIDE try — mirrors publish/route.ts M5) ──
  const admin = createAdminSupabaseClient();

  try {
    const accessToken = await getValidAccessTokenForTeacher(admin, user.id);
    const text = await extractTextFromGoogleDriveFile(fileId, accessToken);

    if (!text.trim()) {
      return NextResponse.json(
        { error: 'No readable text in that Drive file.', code: 'drive_empty' },
        { status: 400 },
      );
    }

    const parsed = await parseLesson(text);

    const { data: lesson, error: insErr } = await admin
      .from('lessons')
      .insert({
        class_id: classId,
        teacher_id: user.id,
        title: parsed.title || 'Imported from Google Drive',
        parsed_content: parsed,
        subject: parsed.subject,
        grade_level: parsed.grade_level,
        status: 'pending_review',
        source: 'google_drive',
      })
      .select('id')
      .single();

    if (insErr || !lesson) {
      console.error('[teacher/lessons/import-drive] persist error:', insErr ?? 'no row returned');
      return respondEngineError(new Error('Failed to persist lesson'));
    }

    return NextResponse.json({
      lesson_id: (lesson as { id: string }).id,
      parsed_content: parsed,
    });
  } catch (err) {
    // Drive-specific typed errors → structured 4xx responses
    if (err instanceof DriveFileNotFoundError) {
      return NextResponse.json(
        { error: "We couldn't find that file in Google Drive.", code: 'drive_not_found' },
        { status: 404 },
      );
    }
    if (err instanceof DriveAccessDeniedError) {
      return NextResponse.json(
        { error: "This file isn't shared with your Google account.", code: 'drive_access_denied' },
        { status: 400 },
      );
    }
    if (err instanceof DriveUnsupportedTypeError) {
      return NextResponse.json(
        {
          error: "This file type can't be imported as a lesson. Try exporting it as a PDF first.",
          code: 'drive_unsupported_type',
        },
        { status: 400 },
      );
    }
    // Google auth errors → connected:false / needsReconnect (HTTP 200, same as other GC routes)
    if (err instanceof GoogleNotConnectedError || err instanceof GoogleScopeError) {
      return gcErrorResponse(err);
    }
    // LlmExhaustedError → 503; all other errors → 500
    console.error('[teacher/lessons/import-drive] error:', err instanceof Error ? err.message : 'unknown');
    return respondEngineError(err);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx vitest run src/app/api/teacher/lessons/import-drive/__tests__/route.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/teacher/lessons/import-drive/route.ts \
        src/app/api/teacher/lessons/import-drive/__tests__/route.test.ts
git commit -m "feat(gc-seg5): POST /api/teacher/lessons/import-drive (Drive text extract + lesson insert)"
```

---

## Task 3: Modify `UrlImportStudio` — Drive URL detection branch

**Files:**
- Modify: `src/app/(teacher)/upload/_components/UrlImportStudio.tsx`
- Modify: `src/app/(teacher)/upload/_components/__tests__/UrlImportStudio.test.tsx`

**Interfaces:**
- Consumes: `parseDriveUrl` from `@/lib/google/drive`
- Produces: Modified component that:
  - Calls `parseDriveUrl(url)` on every input change; stores non-null result in `driveFileId` state
  - Shows a "Google Drive file detected" callout when `driveFileId` is non-null
  - On Import click: calls `/api/teacher/lessons/import-drive` with `{file_id, class_id}` if `driveFileId` is non-null, else calls `/api/teacher/lessons/import-url` unchanged
  - Adds `'not_connected'` to the `Phase` union; renders a reconnect CTA (`/settings/google`) when phase is `'not_connected'`
  - All existing tests continue to pass (non-Drive URL path is untouched)

- [ ] **Step 1: Add new Drive-branch tests to the existing test file**

Append the following `describe` block to `src/app/(teacher)/upload/_components/__tests__/UrlImportStudio.test.tsx` (after the existing closing brace of the first `describe`):

```typescript
// ── Drive URL branch ──────────────────────────────────────────────────────────

describe('UrlImportStudio — Drive URL branch', () => {
  it('shows the "Google Drive file detected" callout when a Drive URL is typed', () => {
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), {
      target: { value: 'https://docs.google.com/document/d/FILEID/edit' },
    });
    expect(screen.getByText(/Google Drive file detected/i)).toBeInTheDocument();
  });

  it('hides the callout when the URL is cleared back to a non-Drive URL', () => {
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    const input = screen.getByLabelText(/link|url|web address/i);
    fireEvent.change(input, { target: { value: 'https://docs.google.com/document/d/FILEID/edit' } });
    expect(screen.getByText(/Google Drive file detected/i)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'https://example.com' } });
    expect(screen.queryByText(/Google Drive file detected/i)).toBeNull();
  });

  it('calls /import-drive (not /import-url) and sends file_id when a Drive URL is submitted', async () => {
    mockFetch({
      '/import-drive': () =>
        new Response(
          JSON.stringify({ lesson_id: 'LD1', parsed_content: { title: 'Drive Doc', key_concepts: [] } }),
          { status: 200 },
        ),
      '/quizzes/generate': () => new Response(JSON.stringify({ quiz_id: 'QD1' }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), {
      target: { value: 'https://docs.google.com/document/d/FILEID/edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());

    const driveCall = calls.find((c) => c.url.includes('/import-drive'));
    expect(driveCall).toBeDefined();
    expect((driveCall?.body as Record<string, unknown>)?.file_id).toBe('FILEID');
    expect((driveCall?.body as Record<string, unknown>)?.class_id).toBe('c1');
    expect(calls.some((c) => c.url.includes('/import-url'))).toBe(false);
  });

  it('shows the reconnect CTA when the drive route returns { connected: false }', async () => {
    mockFetch({
      '/import-drive': () =>
        new Response(JSON.stringify({ connected: false }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), {
      target: { value: 'https://docs.google.com/document/d/FILEID/edit' },
    });
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/connect your google account/i);
    expect(screen.getByRole('link', { name: /connect google/i })).toHaveAttribute('href', '/settings/google');
  });

  it('non-Drive URL still calls /import-url and does NOT show the Drive callout (regression)', async () => {
    mockFetch({
      '/import-url': () =>
        new Response(
          JSON.stringify({ lesson_id: 'LU1', parsed_content: { title: 'Web Page', key_concepts: [] } }),
          { status: 200 },
        ),
      '/quizzes/generate': () => new Response(JSON.stringify({ quiz_id: 'QU1' }), { status: 200 }),
    });
    render(<UrlImportStudio classId="c1" existingLessons={[]} />);
    fireEvent.change(screen.getByLabelText(/link|url|web address/i), {
      target: { value: 'https://example.com/lesson' },
    });
    expect(screen.queryByText(/Google Drive/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(screen.getByTestId('upload-done')).toBeInTheDocument());
    expect(calls[0].url).toContain('/import-url');
    expect(calls.some((c) => c.url.includes('/import-drive'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```
npx vitest run src/app/(teacher)/upload/_components/__tests__/UrlImportStudio.test.tsx
```

Expected: the new Drive-branch tests FAIL; the original 4 tests still PASS

- [ ] **Step 3: Replace `UrlImportStudio.tsx` with the Drive-aware version**

Replace the entire content of `src/app/(teacher)/upload/_components/UrlImportStudio.tsx`:

```tsx
'use client';

/**
 * UrlImportStudio — the "From a URL" tab. Imports a public/link-shared URL OR a
 * Google Drive file into a lesson, runs the fuzzy-duplicate gate, then drafts a quiz.
 * Drive URLs are detected client-side via parseDriveUrl() and routed to /import-drive;
 * all other URLs use the existing /import-url path unchanged.
 * Token-only; deep-ink; strings DRAFT → Barb (§GC Seg 5).
 */
import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { detectDuplicates, type LessonRowLite } from '@/lib/lessons/duplicateDetect';
import { DupModal } from './DupModal';
import { readErrorMessage } from './errorMessage';
import type { UploadLessonLite } from './UploadStudio';
import { SectionLabel } from '../../_components/SectionLabel';
import { parseDriveUrl } from '@/lib/google/drive';

export interface UrlImportStudioProps {
  classId: string;
  existingLessons: UploadLessonLite[];
}

type Phase = 'idle' | 'importing' | 'checking' | 'building' | 'done' | 'error' | 'not_connected';

const INPUT = 'rounded-md border-2 border-sidebar-edge bg-bg px-3 py-2 text-fg text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

export function UrlImportStudio({ classId, existingLessons }: UrlImportStudioProps): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [driveFileId, setDriveFileId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fuzzyMatch, setFuzzyMatch] = useState<LessonRowLite | null>(null);
  const lessonIdRef = useRef<string | null>(null);

  const lessonsHref = `/library/lessons?class=${encodeURIComponent(classId)}`;
  const quizzesHref = `/library/quizzes?class=${encodeURIComponent(classId)}`;
  const busy = phase === 'importing' || phase === 'checking' || phase === 'building';

  function fail(message: string) { setError(message); setPhase('error'); }

  function handleUrlChange(value: string) {
    setUrl(value);
    setDriveFileId(parseDriveUrl(value));
  }

  function archivePendingLesson() {
    const lessonId = lessonIdRef.current;
    if (!lessonId) return;
    void fetch('/api/teacher/lessons/manage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson_id: lessonId, action: 'archive' }),
    }).catch(() => {});
  }

  async function doGenerate(lessonId: string) {
    setPhase('building');
    const res = await fetch('/api/teacher/quizzes/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lesson_id: lessonId }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      fail(readErrorMessage(errBody, "The quiz didn't draft — try the link again."));
      return;
    }
    setPhase('done');
  }

  async function onImport() {
    if (!url.trim() || busy) return;
    setError(null); setFuzzyMatch(null);
    setPhase('importing');

    // Branch: Drive URL → /import-drive (file_id); generic URL → /import-url (url)
    const endpoint = driveFileId
      ? '/api/teacher/lessons/import-drive'
      : '/api/teacher/lessons/import-url';
    const requestBody = driveFileId
      ? { file_id: driveFileId, class_id: classId }
      : { url: url.trim(), class_id: classId };

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch { fail("We couldn't reach that link."); return; }

    if (res.ok) {
      const body = await res.json().catch(() => null);
      const resp = body as Record<string, unknown> | null;

      // gcErrorResponse from /import-drive returns HTTP 200 with { connected: false }
      // when the teacher hasn't connected Google (or refresh failed).
      if (driveFileId && resp?.['connected'] === false) {
        setPhase('not_connected');
        return;
      }

      const parsed = resp as { lesson_id?: string; parsed_content?: { title?: string | null; key_concepts?: string[] } } | null;
      if (!parsed?.lesson_id) { fail("That didn't import — try again."); return; }
      lessonIdRef.current = parsed.lesson_id;
      const parsedContent = parsed.parsed_content ?? {};

      setPhase('checking');
      const candidate = {
        title: parsedContent.title ?? null,
        concept_tags: Array.isArray(parsedContent.key_concepts) ? parsedContent.key_concepts : [],
      };
      const matches = detectDuplicates(candidate, existingLessons as LessonRowLite[]);
      if (matches.length > 0) { setFuzzyMatch(matches[0].lesson); setPhase('idle'); return; }
      await doGenerate(parsed.lesson_id);
    } else {
      const body = await res.json().catch(() => null);
      fail(readErrorMessage(body, "That didn't import — check the link and try again."));
    }
  }

  function onCreateAnyway() {
    const lessonId = lessonIdRef.current;
    setFuzzyMatch(null);
    if (lessonId) void doGenerate(lessonId).catch(() => fail("The quiz didn't draft — try the link again."));
  }
  function onCancelFuzzy() { archivePendingLesson(); setFuzzyMatch(null); setPhase('idle'); }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="font-display text-sm font-extrabold text-fg">Paste a link</span>
        <span className="text-fg text-sm">
          A public web page, a shared Google Doc, or a file from your Google Drive.
          We&apos;ll read it and draft a quiz.
        </span>
        <input
          className={INPUT} type="url" inputMode="url" value={url} aria-label="Link or web address"
          onChange={(e) => handleUrlChange(e.target.value)} placeholder="https://…"
        />
      </label>

      {driveFileId && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border-2 border-sidebar-edge bg-surface px-3 py-2 text-fg text-sm shadow-sticker"
        >
          <SectionLabel tone="brand">Google Drive</SectionLabel>
          <span>Google Drive file detected — uses your connected Google account.</span>
        </div>
      )}

      <div>
        <button
          type="button" onClick={onImport} disabled={!url.trim() || busy}
          className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >Import</button>
      </div>

      {busy && (
        <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-4 shadow-sticker">
          <SectionLabel tone="brand">Working</SectionLabel>
          <span className="text-fg text-sm">
            {phase === 'importing' ? 'Reading that link…' : phase === 'checking' ? 'Checking your library…' : 'Building a quiz…'}
          </span>
        </div>
      )}

      {phase === 'not_connected' && (
        <p role="alert" className="rounded-lg border-2 border-sidebar-edge bg-warn-surface p-4 text-fg text-sm shadow-sticker">
          Connect your Google account to import Drive files.{' '}
          <Link href="/settings/google" className="font-bold underline">Connect Google</Link>
        </p>
      )}

      {phase === 'error' && error && (
        <p role="alert" className="rounded-lg border-2 border-sidebar-edge bg-warn-surface p-4 text-fg text-sm shadow-sticker">{error}</p>
      )}

      {phase === 'done' && (
        <div data-testid="upload-done" className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-ok-surface p-5 shadow-sticker">
          <SectionLabel tone="ok">Quiz ready</SectionLabel>
          <p className="font-display text-base font-bold text-fg">Lesson imported and a quiz is drafted.</p>
          <p className="text-fg text-sm">Review and publish the quiz when it&apos;s ready for students.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={quizzesHref} className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker">
              Open the Quiz Library
            </Link>
            <Link href={lessonsHref} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">
              Back to the Lesson Library
            </Link>
          </div>
        </div>
      )}

      {fuzzyMatch && (
        <DupModal testId="fuzzy-dup-modal" title="This looks a lot like a lesson you already have." onClose={onCancelFuzzy}>
          <p className="text-fg text-sm">It&apos;s close to <span className="font-bold">{fuzzyMatch.title ?? 'an existing lesson'}</span>.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={lessonsHref} onClick={archivePendingLesson} className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 font-display text-sm font-bold text-fg-on-brand shadow-sticker">Use that one</Link>
            <button type="button" onClick={onCreateAnyway} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">Create anyway</button>
            <button type="button" onClick={onCancelFuzzy} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 font-display text-sm font-bold text-fg shadow-sticker">Cancel</button>
          </div>
        </DupModal>
      )}
    </div>
  );
}

export default UrlImportStudio;
```

- [ ] **Step 4: Run the full UrlImportStudio test suite**

```
npx vitest run src/app/(teacher)/upload/_components/__tests__/UrlImportStudio.test.tsx
```

Expected: ALL 8 tests PASS (4 original + 4 new Drive-branch)

- [ ] **Step 5: Commit**

```bash
git add src/app/(teacher)/upload/_components/UrlImportStudio.tsx \
        src/app/(teacher)/upload/_components/__tests__/UrlImportStudio.test.tsx
git commit -m "feat(gc-seg5): UrlImportStudio Drive URL detection + branched import path"
```

---

## Task 4: STRINGS-FOR-BARB.md + final gates

**Files:**
- Modify: `STRINGS-FOR-BARB.md`

**Interfaces:**
- Consumes: nothing from earlier tasks (administrative)
- Produces: `§GC Seg 5` section in `STRINGS-FOR-BARB.md`; all test and type gates green

- [ ] **Step 1: Append the §GC Seg 5 section to `STRINGS-FOR-BARB.md`**

Add the following to the end of `STRINGS-FOR-BARB.md`:

```markdown
---

## GC Seg 5 — Google Drive Import (2026-06-26) — DRAFT strings for Barb

Teacher-facing strings in the URL import tab and route error responses. All DRAFT.

### UrlImportStudio — Drive detection callout

| State | Current draft |
|---|---|
| Drive URL detected (badge label) | "Google Drive" |
| Drive URL detected (inline note) | "Google Drive file detected — uses your connected Google account." |
| Not connected alert | "Connect your Google account to import Drive files." |
| Not connected link text | "Connect Google" |
| Hint text (URL input sub-label update) | "A public web page, a shared Google Doc, or a file from your Google Drive. We'll read it and draft a quiz." |

### Route error messages (user-facing, returned in `error` field)

| `code` | Current draft |
|---|---|
| `drive_not_found` | "We couldn't find that file in Google Drive." |
| `drive_access_denied` | "This file isn't shared with your Google account." |
| `drive_unsupported_type` | "This file type can't be imported as a lesson. Try exporting it as a PDF first." |
| `drive_empty` | "No readable text in that Drive file." |
| `connected: false` (not error string — CTA in component) | "Connect your Google account to import Drive files." → links to `/settings/google` |
```

- [ ] **Step 2: Run the full test suite**

```
npm test
```

Expected: all tests PASS (count increases by the new tests in Tasks 1–3)

- [ ] **Step 3: Type-check**

```
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 4: Production build (runs a11y + tokens gates)**

```
npm run build
```

Expected: build succeeds with 0 errors (a11y contrast gate + token-drift check pass)

- [ ] **Step 5: Final commit**

```bash
git add STRINGS-FOR-BARB.md
git commit -m "feat(gc-seg5): STRINGS-FOR-BARB §GC Seg 5 + verify all gates green"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered |
|---|---|
| D1: UI as sub-option inside "From a URL" tab (no 4th tab) | Task 3 — Drive branch inline in UrlImportStudio, no new tab |
| D2: Google Docs/Slides → export text/plain; PDF → extractPdfText; other text → best-effort; binary → error | Task 1 `extractTextFromGoogleDriveFile` |
| D3: Missing connection → inline reconnect CTA to `/settings/google` | Task 3 `not_connected` phase |
| D4: `drive.readonly` already granted; reconnect only on `GoogleNotConnectedError` | Task 2 — `gcErrorResponse` handles it; `GC_SCOPES` already includes `drive.readonly` |
| 6 URL patterns in `parseDriveUrl` | Task 1 — all 6 patterns + tests |
| Security: cap text at 32 KB with `console.warn` | Task 1 — `MAX_TEXT_CHARS = 32_000` + warn |
| Security: no SSRF risk (Drive API is public IP; auth token is the gate) | Task 1 — calls only `www.googleapis.com`, no SSRF guard needed |
| Error states: not connected / not found / access denied / binary / API error | Tasks 1+2 — typed errors + route mappings |
| No migration | Confirmed — `lessons.source` is free-text |
| Test plan: parseDriveUrl 6 formats, extractTextFromGoogleDriveFile Docs/PDF/binary/404/403, route auth/connected/success, component Drive/non-Drive/callout | Tasks 1–3 |
| Gates: tsc 0 · vitest green · build 0 | Task 4 |
| Strings → STRINGS-FOR-BARB.md §GC Seg 5 | Task 4 |
