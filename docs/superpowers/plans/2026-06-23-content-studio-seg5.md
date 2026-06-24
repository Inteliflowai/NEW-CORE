# Content Studio Segment 5 — Student Drawing Canvas + Teacher Review-of-Submitted-Work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a student answer an assignment task with a **drawing** (lean canvas) or a **photo**, stored privately, and let the teacher **see the actual submitted answers + drawings** in the gradebook drill-in (which today shows only the grade).

**Architecture:** The student answer contract already carries `responses.tasks[step].image_url` (autosave, submit, the completeness gate, and the AI grader all already consume it) — so this segment (1) produces a stored image and writes its URL into that existing slot, and (2) adds a read surface for the teacher. Drawings live in a **private `student-drawings` bucket** (migration 0021, mirrors `lesson-uploads`); a small **auth'd image-proxy route** serves them, so the value persisted in `image_url` is a stable proxy link (`/api/attempts/drawing?path=…`), never an expiring signed URL. The teacher panel fetches answers **on-demand** (a new route) so the per-cell gradebook payload stays light.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 (token-only), native HTML5 Canvas (no new dependency), Supabase Storage (admin client), Vitest 4 (+ jsdom/RTL).

## Global Constraints

Every task implicitly includes these (verbatim from CLAUDE.md / grounding):

- **Student answer contract is FIXED:** `type ResponsesShape = { tasks: Record<string, { text: string; image_url: string | null }> }`. Do NOT reshape it. A drawing/photo populates `image_url`; text stays in `text`. The submit gate (`homework-submit/route.ts`) and grader already accept `text OR image_url` per task.
- **Auth chains (exact):**
  - Student attempt routes: `await createServerSupabaseClient()` → `auth.getUser()` (401) → `createAdminSupabaseClient()` → **object-level ownership guard** `homework_attempts … .eq('id', attemptId).eq('student_id', user.id)` (RLS is NOT the backstop).
  - Teacher routes: `getUser()` (401) → role ∈ `STAFF_ROLES` (admin lookup → 403) → IDOR guard (`guardClassAccess(classId)` or `guardStudentAccess(studentId)`); if it returns a value, return it. Mirror `src/app/api/teacher/gradebook/trend/route.ts`.
- **Storage:** new bucket is **private** (`public=false`, mirror migration 0019 `lesson-uploads`). Upload via `admin.storage.from(bucket).upload(path, buffer, { contentType, upsert: true })`; read via `admin.storage.from(bucket).download(path)` (admin bypasses RLS — no storage policies needed). Path = `${student_id}/${attempt_id}/…` so the proxy can authorize by parsing the student id.
- **Privacy:** drawings are student work. NEVER store a public URL or a long-lived signed URL in the DB. Persist the **proxy path link**; access is gated per-request by the proxy route (student-owns OR staff-with-access).
- **Four-audience / leak discipline:** the teacher review panel is TEACHER-ONLY (showing the student's own answers + the AI feedback is fine); surrounding prose stays banned-word-free (`leakGuard.ts`); no band enum / risk number. "Assignments", never "Homework".
- **Tokens:** Tailwind v4 token classes only — no hardcoded hex, no arbitrary `[var(--..)]`. Pop-art chrome (`border-2 border-sidebar-edge`, `shadow-sticker`/`-lg`), deep-ink `text-fg`, visible focus (`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`), `role="dialog"`+focus-trap+Escape for overlays (mirror `GradebookDrillIn`), `prefers-reduced-motion` respected. Do NOT invent a token. Do NOT add NEW arbitrary `text-[10px]`/`tracking-[…]` values.
- **TDD:** test first, watch fail, minimal code, commit per step. Component tests start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`. Route tests mock `@/lib/supabase/server` + guards + use `vi.resetModules()`-free dynamic import where `instanceof` is asserted (the lessons/parse convention). **jsdom note:** `HTMLCanvasElement.getContext` returns `null` in jsdom — the canvas component must null-guard every `getContext('2d')` call so it mounts in tests; tests assert the toolbar/controls + the save→`onComplete(blob)` callback, NOT pixel drawing.
- **Migration:** `supabase/migrations/0021_<desc>.sql`, additive + idempotent. **0021 is pre-authorized by Marvin to apply to live NEW CORE.**
- **Gates before merge:** `npx tsc --noEmit` 0 · `npm test` all green · `npm run build` 0 (a11y + tokens via prebuild).

---

## File Structure

**New files**
- `supabase/migrations/0021_student_drawings.sql` — private `student-drawings` bucket.
- `src/app/(student)/student/assignments/[id]/play/_components/DrawingCanvas.tsx` — lean canvas (pen/eraser, colors, widths, undo, clear, mouse+touch) → PNG blob. + test.
- `src/app/api/attempts/drawing/route.ts` — `POST` (upload a drawing/photo) + `GET` (auth'd image proxy). + test.
- `src/app/api/teacher/gradebook/attempt/route.ts` — `GET` on-demand attempt detail (tasks + responses + ai_feedback) for the review panel. + test.

**Modified files**
- `src/app/(student)/student/assignments/[id]/play/_components/TaskCard.tsx` — add the drawing/photo affordance + preview/remove.
- `src/app/(student)/student/assignments/[id]/play/_components/AssignmentPlayer.tsx` — `handleTaskImage`, drawing upload, `canvasUsedRef` (flip the hardcoded `canvasUsed:false`), and **accept `image_url` as a complete answer** in `answered`/`canSubmit`.
- `src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx` — add the "Student's work" section (on-demand fetch + per-task text/image + AI feedback + enlarge).
- `STRINGS-FOR-BARB.md` — §Content Studio — Seg 5.

**Dependency waves**
- **Wave A (parallel):** Task 1 (migration), Task 2 (DrawingCanvas).
- **Wave B (after A; parallel):** Task 3 (drawing upload+proxy route), Task 4 (teacher attempt route).
- **Wave C (after B):** Task 5 (TaskCard) → Task 6 (AssignmentPlayer wiring).
- **Wave D (after B):** Task 7 (GradebookDrillIn review section). (Independent of C — different files; can run alongside C.)
- **Wave E:** Task 8 (strings + gates). Playwright preview for Marvin before merge.

---

### Task 1: Migration 0021 — private `student-drawings` bucket

**Files:** Create `supabase/migrations/0021_student_drawings.sql`; Test `src/lib/engine/__tests__/migration0021.test.ts`.

**Interfaces:** Produces the private Storage bucket `student-drawings`. No table/column changes (drawings persist as a proxy URL inside the existing `homework_attempts.responses` jsonb).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/engine/__tests__/migration0021.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0021_student_drawings.sql'), 'utf-8');
describe('migration 0021', () => {
  it('creates a PRIVATE student-drawings bucket, idempotently', () => {
    expect(sql).toMatch(/insert into storage\.buckets/i);
    expect(sql).toMatch(/'student-drawings'/);
    expect(sql).toMatch(/false/);                         // public=false
    expect(sql).toMatch(/on conflict \(id\) do update/i); // idempotent
  });
});
```

- [ ] **Step 2: Run → FAIL (ENOENT).** `npx vitest run src/lib/engine/__tests__/migration0021.test.ts`

- [ ] **Step 3: Write the migration** (mirror 0019 verbatim)

```sql
-- 0021_student_drawings.sql
-- Content Studio Seg 5: a private bucket for student drawing/photo answers.
-- Private (public=false); the service-role admin client bypasses RLS, so NO
-- storage.objects policies are needed (mirrors 0019 lesson-uploads). The image-proxy
-- route (/api/attempts/drawing) authorizes each read (student-owns OR staff-with-access).
-- Drawings persist as a proxy URL inside homework_attempts.responses — no table change.
insert into storage.buckets (id, name, public)
  values ('student-drawings', 'student-drawings', false)
  on conflict (id) do update set public = excluded.public;
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(content-studio): migration 0021 — private student-drawings bucket`

---

### Task 2: `DrawingCanvas` — lean draw pad → PNG blob

**Files:** Create `src/app/(student)/student/assignments/[id]/play/_components/DrawingCanvas.tsx`; Test `…/__tests__/DrawingCanvas.test.tsx`.

**Interfaces:**
- Produces: `interface DrawingCanvasProps { onComplete: (blob: Blob) => void; onCancel: () => void; onDraw?: () => void; width?: number; height?: number }`; default export `DrawingCanvas`.
- Lean toolset: **pen / eraser**, 4 stroke colors, 3 widths, **Undo**, **Clear**, **Use this drawing** (→ `canvas.toBlob('image/png')` → `onComplete`), **Cancel**. Mouse + touch (pointer events). `onDraw` fires once on the first stroke (lets the player flip `canvasUsed`). Every `getContext('2d')` is null-guarded so it mounts under jsdom.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DrawingCanvas from '../DrawingCanvas';

describe('DrawingCanvas', () => {
  it('renders the lean toolbar (pen, eraser, undo, clear) + actions', () => {
    render(<DrawingCanvas onComplete={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /pen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /eraser/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use this drawing/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });
  it('Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    render(<DrawingCanvas onComplete={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
  it('Use this drawing calls onComplete with a Blob (toBlob is stubbed in jsdom)', async () => {
    const onComplete = vi.fn();
    // jsdom HTMLCanvasElement.toBlob may be absent — stub it to invoke the callback with a PNG blob.
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(['x'], { type: 'image/png' })); };
    render(<DrawingCanvas onComplete={onComplete} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /use this drawing/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toBeInstanceOf(Blob);
  });
});
```

- [ ] **Step 2: Run → FAIL (module not found).**

- [ ] **Step 3: Write the component**

```tsx
'use client';

/**
 * DrawingCanvas — a lean draw pad for a student answer: pen/eraser, a few colors + widths,
 * undo, clear. Native HTML5 canvas (no dependency); mouse + touch via pointer events.
 * "Use this drawing" exports a PNG Blob the player uploads. Token-only; deep-ink.
 * jsdom-safe: every getContext('2d') is null-guarded so the component mounts in tests.
 */
import React, { useEffect, useRef, useState } from 'react';

export interface DrawingCanvasProps {
  onComplete: (blob: Blob) => void;
  onCancel: () => void;
  onDraw?: () => void;
  width?: number;
  height?: number;
}

const COLORS = ['#1b1b1f', '#2563eb', '#dc2626', '#16a34a']; // ink/cobalt/red/green — canvas pixels, not UI tokens
const WIDTHS = [2, 4, 7];
const MAX_UNDO = 20;

export function DrawingCanvas({ onComplete, onCancel, onDraw, width = 560, height = 340 }: DrawingCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drewOnce = useRef(false);
  const undoStack = useRef<ImageData[]>([]);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[1]);

  // Prime a white background so the exported PNG isn't transparent.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }, [width, height]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  }
  function pushUndo() {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    try {
      undoStack.current.push(ctx.getImageData(0, 0, width, height));
      if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    } catch { /* jsdom getImageData unsupported — skip */ }
  }
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    pushUndo();
    drawing.current = true;
    if (!drewOnce.current) { drewOnce.current = true; onDraw?.(); }
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvasRef.current?.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.lineWidth = tool === 'eraser' ? strokeWidth * 6 : strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function onPointerUp() { drawing.current = false; }

  function undo() {
    const ctx = canvasRef.current?.getContext('2d');
    const prev = undoStack.current.pop();
    if (ctx && prev) { try { ctx.putImageData(prev, 0, 0); } catch { /* jsdom */ } }
  }
  function clear() {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    pushUndo();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  function complete() {
    const c = canvasRef.current;
    if (!c) { return; }
    c.toBlob((blob) => { if (blob) onComplete(blob); }, 'image/png');
  }

  const toolBtn = (active: boolean) =>
    `rounded-md border-2 border-sidebar-edge px-3 py-1 text-sm font-bold shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${active ? 'bg-brand text-fg-on-brand' : 'bg-surface text-fg'}`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-sidebar-edge bg-surface p-3 shadow-sticker">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')} className={toolBtn(tool === 'pen')}>Pen</button>
        <button type="button" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')} className={toolBtn(tool === 'eraser')}>Eraser</button>
        <span className="mx-1 inline-flex gap-1" role="group" aria-label="Color">
          {COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-fg' : 'border-sidebar-edge'} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`} />
          ))}
        </span>
        <span className="mx-1 inline-flex gap-1" role="group" aria-label="Stroke width">
          {WIDTHS.map((w) => (
            <button key={w} type="button" aria-label={`Width ${w}`} aria-pressed={strokeWidth === w} onClick={() => setStrokeWidth(w)} className={toolBtn(strokeWidth === w)}>{w}</button>
          ))}
        </span>
        <button type="button" onClick={undo} className={toolBtn(false)}>Undo</button>
        <button type="button" onClick={clear} className={toolBtn(false)}>Clear</button>
      </div>

      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        aria-label="Drawing canvas"
        className="w-full touch-none rounded-md border-2 border-sidebar-edge bg-bg"
        style={{ aspectRatio: `${width} / ${height}` }}
      />

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={complete} className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-2 text-sm font-bold text-fg-on-brand shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Use this drawing</button>
        <button type="button" onClick={onCancel} className="rounded-md border-2 border-sidebar-edge bg-surface px-4 py-2 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Cancel</button>
      </div>
    </div>
  );
}

export default DrawingCanvas;
```

- [ ] **Step 4: Run → PASS (3/3).** **Step 5: Commit** `feat(content-studio): DrawingCanvas (lean pen/eraser canvas → PNG blob)`

---

### Task 3: `POST` + `GET /api/attempts/drawing` — upload a drawing/photo, and serve it (auth'd proxy)

**Files:** Create `src/app/api/attempts/drawing/route.ts`; Test `…/__tests__/route.test.ts`.

**Interfaces:**
- `POST` (multipart `file`, `attempt_id`, `step`): student-owned, `in_progress` attempt only; uploads to `student-drawings` at `${user.id}/${attempt_id}/task-${step}-${Date.now()}.${ext}`; returns `{ image_url: "/api/attempts/drawing?path=<encoded path>" }`. Accept `image/png|jpeg|webp`, ≤ 8 MB. Consumed by Task 6 (player upload) — and that proxy URL is what gets written into `responses.tasks[step].image_url`.
- `GET ?path=`: serves the bytes. Auth: `getUser` (401) → **student-owns** (`user.id === path.split('/')[0]`) OR **staff + `guardStudentAccess(studentId)`**. Consumed by `<img src>` in the player (Task 5/6) and the teacher panel (Task 7).
- The path's first segment is the student id (set by POST), so the proxy authorizes by parsing it — a student can only pass the student-branch for their own id.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/attempts/drawing/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const guardStudentAccess = vi.fn();
const uploads: Array<{ path: string }> = [];
let ATTEMPT: unknown; let ROLE: string; let DOWNLOAD: { data: Blob | null; error: unknown };

vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const }));
vi.mock('@/lib/auth/guards', () => ({ guardStudentAccess }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLE } }) }) }) };
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ATTEMPT }) }) }) }) };
    },
    storage: { from: () => ({
      upload: async (path: string) => { uploads.push({ path }); return { error: null }; },
      download: async () => DOWNLOAD,
    }) },
  }),
}));

async function load() { return await import('@/app/api/teacher/../attempts/drawing/route' as string).catch(async () => await import('@/app/api/attempts/drawing/route')); }
function postReq(form: FormData) { return new NextRequest('http://x/api/attempts/drawing', { method: 'POST', body: form }); }
function getReq(path: string) { return new NextRequest(`http://x/api/attempts/drawing?path=${encodeURIComponent(path)}`); }

beforeEach(() => {
  getUser.mockReset(); guardStudentAccess.mockReset(); uploads.length = 0;
  ROLE = 'teacher'; ATTEMPT = { id: 'A1', student_id: 'stu1', status: 'in_progress' };
  DOWNLOAD = { data: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), error: null };
  getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
  guardStudentAccess.mockResolvedValue(null);
});

function fd(over: Record<string, string | Blob> = {}) {
  const f = new FormData();
  f.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'd.png');
  f.append('attempt_id', 'A1'); f.append('step', '1');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

describe('POST /api/attempts/drawing', () => {
  it('401 without a user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('@/app/api/attempts/drawing/route');
    expect((await POST(postReq(fd()))).status).toBe(401);
  });
  it('404 when the attempt is not the caller\'s in_progress row', async () => {
    ATTEMPT = null;
    const { POST } = await import('@/app/api/attempts/drawing/route');
    expect((await POST(postReq(fd()))).status).toBe(404);
  });
  it('uploads under {student}/{attempt}/… and returns a proxy image_url', async () => {
    const { POST } = await import('@/app/api/attempts/drawing/route');
    const res = await POST(postReq(fd()));
    expect(res.status).toBe(200);
    expect(uploads[0].path).toMatch(/^stu1\/A1\/task-1-\d+\.png$/);
    const body = await res.json();
    expect(body.image_url).toBe(`/api/attempts/drawing?path=${encodeURIComponent(uploads[0].path)}`);
  });
  it('415 on a non-image file', async () => {
    const { POST } = await import('@/app/api/attempts/drawing/route');
    expect((await POST(postReq(fd({ file: new Blob(['x'], { type: 'application/pdf' }) })))).status).toBe(415);
  });
});

describe('GET /api/attempts/drawing', () => {
  it('serves bytes to the student who owns the path', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'stu1' } }, error: null });
    const { GET } = await import('@/app/api/attempts/drawing/route');
    const res = await GET(getReq('stu1/A1/task-1-1.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/png/);
  });
  it('lets a staff member with access view another student\'s drawing', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'teacher1' } }, error: null }); ROLE = 'teacher';
    const { GET } = await import('@/app/api/attempts/drawing/route');
    expect((await GET(getReq('stu1/A1/task-1-1.png'))).status).toBe(200);
    expect(guardStudentAccess).toHaveBeenCalledWith('stu1');
  });
  it('403 for a non-staff non-owner', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'other' } }, error: null }); ROLE = 'student';
    const { GET } = await import('@/app/api/attempts/drawing/route');
    expect((await GET(getReq('stu1/A1/task-1-1.png'))).status).toBe(403);
  });
  it('403 when guardStudentAccess denies a staff caller', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'teacher1' } }, error: null }); ROLE = 'teacher';
    guardStudentAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const { GET } = await import('@/app/api/attempts/drawing/route');
    expect((await GET(getReq('stu1/A1/task-1-1.png'))).status).toBe(403);
  });
});
```

(Delete the stray `load()` helper line above if your reviewer flags it — the tests import `POST`/`GET` directly.)

- [ ] **Step 2: Run → FAIL (route not found).**

- [ ] **Step 3: Write the route**

```ts
// src/app/api/attempts/drawing/route.ts
// POST — a student uploads a drawing/photo for one task of their in-progress attempt.
// GET  — auth'd image proxy: serves a stored drawing (student-owns OR staff-with-access).
// Drawings live in the PRIVATE 'student-drawings' bucket; the persisted image_url is a proxy
// link to THIS GET (never a public/expiring URL). Path = {student_id}/{attempt_id}/task-{step}-{ts}.ext.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardStudentAccess } from '@/lib/auth/guards';

const BUCKET = 'student-drawings';
const MAX_BYTES = 8 * 1024 * 1024;
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
  const attemptId = String(form.get('attempt_id') ?? '');
  const step = String(form.get('step') ?? '');
  if (!(file instanceof Blob) || !attemptId || !step) return NextResponse.json({ error: 'Missing file, attempt_id, or step' }, { status: 400 });
  const ext = EXT[file.type];
  if (!ext) return NextResponse.json({ error: 'Only PNG, JPEG, or WebP images are allowed.' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That image is too large (max 8 MB).' }, { status: 413 });

  const admin = createAdminSupabaseClient();
  const { data: attempt } = await admin.from('homework_attempts')
    .select('id, student_id, status').eq('id', attemptId).eq('student_id', user.id).maybeSingle();
  const a = attempt as { id: string; status: string } | null;
  if (!a) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
  if (a.status !== 'in_progress') return NextResponse.json({ error: 'Attempt not editable' }, { status: 409 });

  const path = `${user.id}/${attemptId}/task-${step}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: 'Upload failed — try again.' }, { status: 500 });

  return NextResponse.json({ image_url: `/api/attempts/drawing?path=${encodeURIComponent(path)}` });
}

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const path = new URL(req.url).searchParams.get('path');
  if (!path || path.includes('..')) return NextResponse.json({ error: 'Bad path' }, { status: 400 });
  const ownerId = path.split('/')[0];

  const admin = createAdminSupabaseClient();
  if (user.id !== ownerId) {
    // Not the owning student → must be staff WITH access to that student.
    const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
    const role = (roleRow as { role?: string } | null)?.role;
    if (!role || !new Set<string>(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const guard = await guardStudentAccess(ownerId);
    if (guard) return guard;
  }

  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const bytes = Buffer.from(await data.arrayBuffer());
  return new NextResponse(bytes, {
    status: 200,
    headers: { 'Content-Type': contentTypeForPath(path), 'Cache-Control': 'private, max-age=300' },
  });
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(content-studio): /api/attempts/drawing upload + auth'd image proxy`

---

### Task 4: `GET /api/teacher/gradebook/attempt` — on-demand submitted-work detail

**Files:** Create `src/app/api/teacher/gradebook/attempt/route.ts`; Test `…/__tests__/route.test.ts`.

**Interfaces:**
- `GET ?attemptId=`: auth mirrors `gradebook/trend` (getUser → STAFF_ROLES) then IDOR via the attempt's assignment → `guardClassAccess(class_id)`. Returns `{ tasks: {step,description}[], responses: ResponsesShape, ai_feedback: { overall?: string } | null, status: string }`. Consumed by Task 7. (Image URLs inside `responses` are proxy links the teacher's `<img>` resolves via Task 3's GET.)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/teacher/gradebook/attempt/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const getUser = vi.fn();
const guardClassAccess = vi.fn();
let ROLE: string; let ATTEMPT: unknown; let ASSIGNMENT: unknown;

vi.mock('@/lib/auth/roles', () => ({ STAFF_ROLES: ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const }));
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (t: string) => {
      if (t === 'users') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLE } }) }) }) };
      if (t === 'homework_attempts') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ATTEMPT }) }) }) };
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: ASSIGNMENT }) }) }) }; // assignments
    },
  }),
}));

const req = (q: string) => new NextRequest(`http://x/api/teacher/gradebook/attempt?${q}`);

beforeEach(() => {
  getUser.mockReset(); guardClassAccess.mockReset(); ROLE = 'teacher';
  ATTEMPT = { id: 'A1', assignment_id: 'AS1', responses: { tasks: { '1': { text: 'my answer', image_url: '/api/attempts/drawing?path=stu1%2FA1%2Ftask-1-1.png' } } }, ai_feedback: { overall: 'Nice reasoning.' }, status: 'graded' };
  ASSIGNMENT = { id: 'AS1', class_id: 'c1', content: { tasks: [{ step: 1, description: 'Explain Newton 1.' }] } };
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  guardClassAccess.mockResolvedValue(null);
});

describe('GET /api/teacher/gradebook/attempt', () => {
  it('401 / 403 / 400 gates', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('@/app/api/teacher/gradebook/attempt/route');
    expect((await GET(req('attemptId=A1'))).status).toBe(401);
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }); ROLE = 'student';
    expect((await GET(req('attemptId=A1'))).status).toBe(403);
    ROLE = 'teacher';
    expect((await GET(req(''))).status).toBe(400);
  });
  it('403 when guardClassAccess denies', async () => {
    guardClassAccess.mockResolvedValue(new Response(null, { status: 403 }));
    const { GET } = await import('@/app/api/teacher/gradebook/attempt/route');
    expect((await GET(req('attemptId=A1'))).status).toBe(403);
  });
  it('returns tasks + responses + ai_feedback for an authorized teacher', async () => {
    const { GET } = await import('@/app/api/teacher/gradebook/attempt/route');
    const res = await GET(req('attemptId=A1'));
    expect(res.status).toBe(200);
    expect(guardClassAccess).toHaveBeenCalledWith('c1');
    const body = await res.json();
    expect(body.tasks[0].description).toMatch(/Newton/);
    expect(body.responses.tasks['1'].text).toBe('my answer');
    expect(body.ai_feedback.overall).toMatch(/reasoning/);
  });
  it('404 when the attempt is missing', async () => {
    ATTEMPT = null;
    const { GET } = await import('@/app/api/teacher/gradebook/attempt/route');
    expect((await GET(req('attemptId=A1'))).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Write the route**

```ts
// src/app/api/teacher/gradebook/attempt/route.ts
// GET ?attemptId= — on-demand detail for the gradebook drill-in's "Student's work" panel:
// the assignment tasks + the student's per-task answers (text + drawing proxy URLs) + AI feedback.
// Kept OFF the main gradebook loader so per-cell payloads stay light. Auth mirrors gradebook/trend:
// getUser → STAFF_ROLES → guardClassAccess(class_id) (IDOR; RLS is NOT the backstop).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { normalizeContent, type AssignmentContent } from '@/lib/assignments/loadAssignmentForPlay';

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const attemptId = new URL(req.url).searchParams.get('attemptId');
  if (!attemptId) return NextResponse.json({ error: 'Missing attemptId' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (roleRow as { role?: string } | null)?.role;
  if (!role || !new Set<string>(STAFF_ROLES).has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: attempt } = await admin.from('homework_attempts')
    .select('id, assignment_id, responses, ai_feedback, status').eq('id', attemptId).maybeSingle();
  const a = attempt as { id: string; assignment_id: string; responses: unknown; ai_feedback: unknown; status: string } | null;
  if (!a) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

  const { data: asg } = await admin.from('assignments').select('id, class_id, content').eq('id', a.assignment_id).maybeSingle();
  const assignment = asg as { class_id: string; content: AssignmentContent | null } | null;
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

  const guard = await guardClassAccess(assignment.class_id);
  if (guard) return guard;

  const content = normalizeContent(assignment.content);
  const tasks = (content.tasks ?? []).map((t) => ({ step: t.step, description: t.description }));
  const responses = (a.responses as { tasks?: Record<string, { text?: string; image_url?: string | null }> } | null) ?? { tasks: {} };
  const aiFeedback = (a.ai_feedback as { overall?: string } | null) ?? null;

  return NextResponse.json({ tasks, responses, ai_feedback: aiFeedback, status: a.status });
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(content-studio): GET /api/teacher/gradebook/attempt (submitted-work detail)`

---

### Task 5: `TaskCard` — drawing/photo affordance + preview/remove

**Files:** Modify `src/app/(student)/student/assignments/[id]/play/_components/TaskCard.tsx`; Test `…/__tests__/TaskCard.test.tsx` (create if absent).

**Interfaces:**
- Extend `TaskCardProps` with: `imageUrl: string | null; onSaveImage: (blob: Blob) => Promise<void>; onRemoveImage: () => void; onCanvasUsed?: () => void`. Consumes `DrawingCanvas` (Task 2).
- Behavior: keep the textarea. Add an image area: when `imageUrl` is set → show a bounded preview `<img src={imageUrl}>` + **Remove**; else → **Add a drawing** (opens `DrawingCanvas` inline) and **Add a photo** (a file input, `accept="image/png,image/jpeg,image/webp"`). On canvas `onComplete(blob)` or a chosen photo file → `await onSaveImage(blob)` (show a saving state); canvas first stroke fires `onCanvasUsed`.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskCard } from '../TaskCard';

const base = { step: 1, description: 'Sketch the force diagram.', value: '', onChange: () => {}, onFirstInput: () => {} };

describe('TaskCard image affordance', () => {
  it('offers drawing + photo when no image is attached', () => {
    render(<TaskCard {...base} imageUrl={null} onSaveImage={async () => {}} onRemoveImage={() => {}} />);
    expect(screen.getByRole('button', { name: /add a drawing/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/add a photo/i)).toBeInTheDocument();
  });
  it('shows a preview + Remove when an image is attached', () => {
    const onRemoveImage = vi.fn();
    render(<TaskCard {...base} imageUrl="/api/attempts/drawing?path=stu1%2FA1%2Ftask-1-1.png" onSaveImage={async () => {}} onRemoveImage={onRemoveImage} />);
    expect(screen.getByRole('img', { name: /your drawing or photo/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemoveImage).toHaveBeenCalled();
  });
  it('opening the canvas and using a drawing calls onSaveImage with a Blob', async () => {
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(['x'], { type: 'image/png' })); };
    const onSaveImage = vi.fn(async () => {});
    render(<TaskCard {...base} imageUrl={null} onSaveImage={onSaveImage} onRemoveImage={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /add a drawing/i }));
    fireEvent.click(await screen.findByRole('button', { name: /use this drawing/i }));
    await waitFor(() => expect(onSaveImage).toHaveBeenCalledTimes(1));
    expect(onSaveImage.mock.calls[0][0]).toBeInstanceOf(Blob);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Rewrite `TaskCard.tsx`**

```tsx
'use client';

/**
 * TaskCard — one assignment task: prompt (MathText) + a typed open-response, and an OPTIONAL
 * drawing/photo answer. A task is answerable by text, by image, or both (the submit gate accepts
 * either). The drawing canvas + photo write into the responses contract's existing `image_url`.
 * Token-only styling.
 */
import React, { useRef, useState } from 'react';
import { MathText } from '@/components/core/MathText';
import { DrawingCanvas } from './DrawingCanvas';

export interface TaskCardProps {
  step: number;
  description: string;
  value: string;
  onChange: (v: string) => void;
  onFirstInput: () => void;
  imageUrl: string | null;
  onSaveImage: (blob: Blob) => Promise<void>;
  onRemoveImage: () => void;
  onCanvasUsed?: () => void;
}

const IMG_TYPES = 'image/png,image/jpeg,image/webp';

export function TaskCard({ step, description, value, onChange, onFirstInput, imageUrl, onSaveImage, onRemoveImage, onCanvasUsed }: TaskCardProps) {
  const hasInputtedRef = useRef(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imgError, setImgError] = useState<string | null>(null);

  function fireFirstInput() {
    if (!hasInputtedRef.current) { hasInputtedRef.current = true; onFirstInput(); }
  }
  async function save(blob: Blob) {
    setSaving(true); setImgError(null);
    try { await onSaveImage(blob); setShowCanvas(false); }
    catch { setImgError("That didn't attach — try again."); }
    finally { setSaving(false); }
  }
  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void save(f);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-fg-on-brand text-sm font-bold">{step}</span>
        <div className="text-fg text-base leading-relaxed font-medium pt-0.5"><MathText>{description}</MathText></div>
      </div>

      <textarea
        rows={6}
        value={value}
        onChange={(e) => { fireFirstInput(); onChange(e.target.value); }}
        onFocus={fireFirstInput}
        placeholder="Write your answer here…"
        style={{ resize: 'vertical' }}
        className="rounded-lg border-2 border-surface bg-surface text-fg px-4 py-3 text-base focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 placeholder:text-fg-muted"
        aria-label={`Answer for question ${step}`}
      />

      {/* Optional drawing / photo answer */}
      {imageUrl ? (
        <div className="flex flex-col gap-2">
          <img src={imageUrl} alt="Your drawing or photo" className="max-h-72 w-auto rounded-lg border-2 border-sidebar-edge bg-bg" />
          <div>
            <button type="button" onClick={onRemoveImage} className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Remove</button>
          </div>
        </div>
      ) : showCanvas ? (
        <DrawingCanvas onComplete={(blob) => void save(blob)} onCancel={() => setShowCanvas(false)} onDraw={onCanvasUsed} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowCanvas(true)} disabled={saving} className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50">Add a drawing</button>
          <label className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand">
            Add a photo
            <input type="file" accept={IMG_TYPES} onChange={onPhoto} disabled={saving} className="sr-only" aria-label="Add a photo" />
          </label>
          {saving && <span role="status" className="text-sm text-fg-muted">Attaching…</span>}
        </div>
      )}
      {imgError && <p role="alert" className="text-sm text-fg">{imgError}</p>}
    </div>
  );
}

export default TaskCard;
```

- [ ] **Step 4: Run → PASS (3/3).** **Step 5: Commit** `feat(content-studio): TaskCard drawing/photo affordance`

---

### Task 6: `AssignmentPlayer` — upload wiring, `canvasUsed` signal, and accept an image as a complete answer

**Files:** Modify `src/app/(student)/student/assignments/[id]/play/_components/AssignmentPlayer.tsx`; extend `…/__tests__/AssignmentPlayer.test.tsx`.

**Interfaces:** Consumes Task 3's `POST /api/attempts/drawing` + Task 5's extended `TaskCard`.

**Critical correctness fix:** today `answered`/`canSubmit`/`canAdvance` require non-empty **text**, which would BLOCK a drawing-only answer. They must accept **text OR image_url** (matching the submit route's gate).

- [ ] **Step 1: Add a failing test** (append to the existing player test)

```tsx
  it('a task answered with only a drawing counts as complete (can advance / submit)', async () => {
    // Render the player with a single task whose response has an image_url but no text.
    // Assert the Submit control is enabled (not blocked on empty text).
    // (Use the existing test's render harness + a content with one task; seed initialResponses
    //  with { tasks: { '1': { text: '', image_url: '/api/attempts/drawing?path=x' } } }.)
    // expect the submit button to be enabled.
  });
```

(Fill this in against the existing test file's harness — the assertion is: with an image-only response, the submit affordance is enabled. If the existing test file lacks a single-task harness, add one mirroring its current setup.)

- [ ] **Step 2: Run → the new test FAILS** (image-only answer is currently treated as incomplete).

- [ ] **Step 3: Edit `AssignmentPlayer.tsx`**

(a) Add an answer helper next to `textFor` (line ~61):

```ts
function imageFor(responses: ResponsesShape, step: number): string | null {
  return responses.tasks[String(step)]?.image_url ?? null;
}
function hasAnswer(responses: ResponsesShape, step: number): boolean {
  return textFor(responses, step).trim() !== '' || imageFor(responses, step) != null;
}
```

(b) Add a `canvasUsed` ref with the other refs (~line 103): `const canvasUsedRef = useRef(false);`

(c) In `buildSessionAggregates()` change the hardcoded line to: `canvasUsed: canvasUsedRef.current,  // flipped when the student draws (Seg 5)`

(d) Add the image handlers next to `handleTaskChange` (~line 251):

```ts
  function handleTaskImage(step: number, imageUrl: string | null) {
    setResponses((prev) => {
      const next: ResponsesShape = {
        tasks: { ...prev.tasks, [String(step)]: { text: prev.tasks[String(step)]?.text ?? '', image_url: imageUrl } },
      };
      scheduleAutosave(next);
      return next;
    });
  }

  async function uploadTaskImage(step: number, blob: Blob): Promise<void> {
    const form = new FormData();
    form.append('file', blob, `task-${step}.png`);
    form.append('attempt_id', attemptId);
    form.append('step', String(step));
    const res = await fetch('/api/attempts/drawing', { method: 'POST', body: form });
    if (!res.ok) throw new Error('upload failed');
    const body = (await res.json()) as { image_url: string };
    handleTaskImage(step, body.image_url);
  }
```

(e) Replace the `answered` / `canAdvance` / `canSubmit` derivations (lines ~338-348) to use `hasAnswer`:

```ts
  const answered: Record<number, boolean> = {};
  for (const t of tasks) answered[t.step] = hasAnswer(responses, t.step);
  // …
  const canAdvance = hasAnswer(responses, currentTask.step);
  const canSubmit = tasks.length > 0 && tasks.every((t) => hasAnswer(responses, t.step));
```

(f) Pass the new props to `<TaskCard>` (line ~360):

```tsx
        <TaskCard
          step={currentTask.step}
          description={currentTask.description}
          value={currentText}
          onChange={(v) => handleTaskChange(currentTask.step, v)}
          onFirstInput={handleFirstInput}
          imageUrl={imageFor(responses, currentTask.step)}
          onSaveImage={(blob) => uploadTaskImage(currentTask.step, blob)}
          onRemoveImage={() => handleTaskImage(currentTask.step, null)}
          onCanvasUsed={() => { canvasUsedRef.current = true; }}
        />
```

- [ ] **Step 4: Run → PASS** (player tests incl. the new image-only-complete test).

- [ ] **Step 5: Commit** `feat(content-studio): wire drawing/photo into the player (upload, canvasUsed, image-as-answer)`

---

### Task 7: `GradebookDrillIn` — the "Student's work" review section

**Files:** Modify `src/app/(teacher)/gradebook/_components/GradebookDrillIn.tsx`; extend `…/__tests__/GradebookDrillIn.test.tsx`.

**Interfaces:** Consumes Task 4's `GET /api/teacher/gradebook/attempt`. Adds an on-open fetch + a "Student's work" section (per-task prompt + the student's text + drawing thumbnails with click-to-enlarge + the AI's overall feedback). Renders only when `cell.attempt_id != null` and the fetch returns tasks. Teacher-only surface.

- [ ] **Step 1: Add a failing test** (append to the existing drill-in test; the existing global `fetch` mock must also answer the `/attempt` URL)

```tsx
  it('shows the student\'s submitted work (text + an enlargeable drawing) for a graded cell', async () => {
    // global fetch mock answers BOTH /trend (null ok) and /attempt:
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/teacher/gradebook/attempt')) {
        return new Response(JSON.stringify({
          tasks: [{ step: 1, description: 'Sketch the force diagram.' }],
          responses: { tasks: { '1': { text: 'Here is my reasoning.', image_url: '/api/attempts/drawing?path=stu1%2FA1%2Ftask-1-1.png' } } },
          ai_feedback: { overall: 'Clear diagram and explanation.' }, status: 'graded',
        }), { status: 200 });
      }
      return new Response('null', { status: 200 }); // /trend
    }) as unknown as typeof fetch;

    render(<GradebookDrillIn selected={gradedSelection /* attempt_id: 'A1', status: 'graded' */} onClose={() => {}} onWrite={() => {}} />);
    expect(await screen.findByText(/student's work/i)).toBeInTheDocument();
    expect(screen.getByText(/here is my reasoning/i)).toBeInTheDocument();
    const img = screen.getByRole('img', { name: /drawing for question 1/i });
    expect(img).toBeInTheDocument();
    expect(screen.getByText(/clear diagram and explanation/i)).toBeInTheDocument();
    // Enlarge: clicking the thumbnail opens the overlay dialog.
    fireEvent.click(screen.getByRole('button', { name: /enlarge the drawing for question 1/i }));
    expect(screen.getByRole('dialog', { name: /student drawing/i })).toBeInTheDocument();
  });
```

(Define `gradedSelection` from the test file's existing selection fixture with `cell.attempt_id: 'A1'`, `cell.status: 'graded'`.)

- [ ] **Step 2: Run → FAIL** (no "Student's work" section yet).

- [ ] **Step 3: Edit `GradebookDrillIn.tsx`**

(a) Add the import: `import { MathText } from '@/components/core/MathText';`

(b) Add the type + state + fetch effect (next to the `trend` state/effect, ~line 87):

```ts
interface AttemptWork {
  tasks: { step: number; description: string }[];
  responses: { tasks: Record<string, { text?: string; image_url?: string | null }> };
  ai_feedback: { overall?: string } | null;
  status: string;
}
```
```ts
  const [work, setWork] = useState<AttemptWork | null>(null);
  const [expandedImg, setExpandedImg] = useState<string | null>(null);

  useEffect(() => {
    if (!cell.attempt_id) { setWork(null); return; }
    let live = true;
    fetch(`/api/teacher/gradebook/attempt?attemptId=${encodeURIComponent(cell.attempt_id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => { if (live) setWork(w); })
      .catch(() => { if (live) setWork(null); });
    return () => { live = false; };
  }, [cell.attempt_id]);

  // Esc closes the enlarged-drawing overlay (it renders outside the panel's focus trap).
  useEffect(() => {
    if (!expandedImg) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedImg(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expandedImg]);
```

(c) Insert the section AFTER the effort line (`{effortPhrase && …}`, ~line 309) and BEFORE the no-attempt empty-state:

```tsx
        {/* Student's work — the actual submitted answers + drawings (teacher-only; fetched on open). */}
        {work && work.tasks.length > 0 && (
          <section className="flex flex-col gap-3 border-t-2 border-sidebar-edge pt-4">
            <h3 className="font-display text-sm font-extrabold uppercase tracking-wide text-fg">Student&apos;s work</h3>
            {work.tasks.map((t) => {
              const r = work.responses?.tasks?.[String(t.step)] ?? {};
              const text = (r.text ?? '').trim();
              const img = r.image_url ?? null;
              return (
                <div key={t.step} className="flex flex-col gap-1">
                  <div className="text-sm font-bold text-fg"><MathText>{t.description}</MathText></div>
                  {text ? (
                    <p className="whitespace-pre-wrap text-sm text-fg">{text}</p>
                  ) : !img ? (
                    <p className="text-sm text-fg-muted">No written answer.</p>
                  ) : null}
                  {img && (
                    <button
                      type="button"
                      onClick={() => setExpandedImg(img)}
                      aria-label={`Enlarge the drawing for question ${t.step}`}
                      className="self-start rounded-md border-2 border-sidebar-edge bg-bg p-1 shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <img src={img} alt={`Drawing for question ${t.step}`} className="max-h-40 w-auto rounded" />
                    </button>
                  )}
                </div>
              );
            })}
            {work.ai_feedback?.overall && (
              <div className="rounded-lg border-2 border-sidebar-edge bg-brand-surface p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-fg-muted">What the AI noted</p>
                <p className="text-sm text-fg">{work.ai_feedback.overall}</p>
              </div>
            )}
          </section>
        )}
```

(d) Add the enlarge overlay as a sibling AFTER `</aside>` (inside the returned fragment):

```tsx
      {expandedImg && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Student drawing"
          onClick={() => setExpandedImg(null)}
          className="fixed inset-0 z-40 flex items-center justify-center bg-fg/60 p-6"
        >
          <img src={expandedImg} alt="Student drawing, enlarged" className="max-h-[90vh] max-w-[90vw] rounded-lg border-2 border-sidebar-edge bg-bg" />
        </div>
      )}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** `feat(content-studio): gradebook drill-in "Student's work" review section`

---

### Task 8: Barb strings + full gate pass

**Files:** Modify `STRINGS-FOR-BARB.md` (§Content Studio — Seg 5).

- [ ] **Step 1: Add the DRAFT strings** under a new "Seg 5 — Drawing canvas + review of work" subsection: the canvas toolbar (Pen / Eraser / Undo / Clear / Use this drawing / Cancel), the task affordances ("Add a drawing", "Add a photo", "Remove", "Attaching…"), the attach error ("That didn't attach — try again."), and the teacher panel ("Student's work", "No written answer.", "What the AI noted"). Mark all DRAFT → Barb gates.

- [ ] **Step 2: Run the full gate suite**

```bash
npx tsc --noEmit            # 0
npm test                    # all green (existing + new)
npm run build               # 0 (a11y + tokens via prebuild)
```

- [ ] **Step 3: Commit** `docs(content-studio): Seg 5 string drafts for Barb`

---

## Deferrals & decisions (carry into the final review + the merge call)

- **Lean canvas (pen/eraser/colors/widths/undo/clear)** — V1's shapes/text/arrows toolset is intentionally NOT ported (Marvin's call). A nice-to-have follow-up, not this segment.
- **Photo upload included; URL-paste excluded** (Marvin). The upload route accepts PNG/JPEG/WebP ≤ 8 MB.
- **Private bucket + auth'd image proxy** (Marvin) — `image_url` persists a proxy link, never a public/expiring URL; the `GET /api/attempts/drawing` route authorizes every read.
- **The drawing affordance is uniform on every task** (any task can attach one image, matching V1). Auto-leading with the canvas for `type:'draw'` tasks is a deferred nicety (the `type` isn't threaded to `TaskCard` yet).
- **One image per task** (the `image_url` contract is single-valued). Multiple images/task is out of scope.
- **`canvas_data` jsonb column stays unused** (drawings live in `responses[step].image_url`); no homework_attempts column change this segment.
- **Migration 0021 apply to live NEW CORE is pre-authorized by Marvin** — apply before merge (DB ready ahead of the deploy, as with 0020).
- Deferred: an enlarge-overlay focus-trap/close-button (Escape + click-out cover it); surfacing submitted work on the One-Student profile (gradebook drill-in is the primary review surface this segment).

## Self-Review (against the locked decisions)

- **Decision coverage:** lean canvas → Task 2; photo upload → Task 3 (`POST` accepts image types) + Task 5; private bucket + proxy → Task 1 + Task 3; teacher review-of-work → Task 4 + Task 7; `canvasUsed` signal → Task 6; image-as-complete-answer fix → Task 6.
- **Contract safety:** nothing reshapes `ResponsesShape`; the drawing writes `image_url` only; autosave/submit/grader are untouched and already consume it.
- **Auth:** the upload route guards student-ownership; the proxy GET guards student-owns-OR-staff-with-access (parsing the owner id from the path); the teacher route mirrors `trend` (STAFF_ROLES) + `guardClassAccess`. RLS is never the backstop.
- **Type consistency:** `AttemptWork` (Task 7) matches the Task 4 route response; `TaskCardProps` (Task 5) matches the player's wiring (Task 6); the proxy `image_url` string format is identical in Task 3 (producer) and Tasks 5/7 (consumers).
- **Placeholder scan:** Tasks 1–5, 7 carry complete code; Task 6 is precise edits against quoted line anchors; the two test stubs (player image-only test, drill-in fixture) name exactly what to assert against the existing harness.

## Execution Handoff

**Plan saved to `docs/superpowers/plans/2026-06-23-content-studio-seg5.md`.** Recommended: **subagent-driven** — fresh implementer per task, task review between, a final 5-lens whole-branch adversarial review, then apply migration 0021 (pre-authorized), Playwright preview for Marvin, and the merge call.
