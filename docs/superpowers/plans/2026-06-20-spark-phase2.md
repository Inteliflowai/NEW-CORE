# SPARK Phase 2 — Student Launch + Super-Admin Provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the SPARK loop's student half + make SPARK schools provisionable from Super-Admin — porting V1's proven flows into V2 with V2's upgrades. Spec: `docs/superpowers/specs/2026-06-20-spark-phase2-design.md`. Grounding: `docs/superpowers/plans/grounding/2026-06-20-spark-phase2/` (V2 `P1`–`P6`; V1 `V1-*`).

**Architecture:** Two repos. **V2** (`C:/users/inteliflow/NEW-CORE`, branch `feat/spark-phase2`, `src/`): a launch lib + route, a student assignments surface, a super-admin school list + spark-enable route + a SPARK-school provisioning client. **SPARK** (`C:/users/inteliflow/spark-platform`, App Router top-level `app/ lib/`, NO `src/`, its own branch): one new provisioning endpoint + a one-line allow-list add. **No new DB migration** (V2 grants `spark_experiences` via existing `school_licenses.feature_overrides`; uses `spark_attempt_id` from `0012`. SPARK uses existing tables.)

**Tech:** Next.js 16, TS, Supabase, Node `crypto` (hand-rolled HS256 — no `jsonwebtoken` dep), Vitest 4 (+ jsdom for components).

## Global Constraints (binding)

- **V1 is the spec; V2 is the upgrade (canonical where better).** Port V1's behavior; the deliberate divergences are the four-audience presentation + the §"V2 upgrades" items (hand-rolled JWT, session-gated provisioning, automated SPARK-side link, push status, "Assignments" naming).
- **Four-audience.** The student surface shows the student's own assignment content + a Launch card + a soft completion state. **NEVER** raw transfer scores, rubric dims, mastery enums, CL verbs, or risk numbers (teacher-only). Run `leakGuard.assertNoLeak` on any derived student copy.
- **"Assignments"/"Challenge", never "Homework"** in new UI strings (DB identifiers exempt). V2's student route is `/student/assignments` (V1's is `/student/homework`).
- **Auth chain.** Student routes: role gate in `(student)/layout.tsx` (`requireRole(['student'])`); the launch route does `auth.getUser()` → object-level ownership (`assignment.student_id === user.id`) → admin client. Super-admin: `guardPlatformAdmin()` (API) / `requireRole(['platform_admin'])` (page). SPARK provision endpoint: constant-time Bearer `CORE_SPARK_API_SECRET` (machine).
- **The launch JWT contract (SPARK verifies, verbatim):** HS256; secret `CORE_SPARK_API_SECRET`; 3 base64url parts; header `{"alg":"HS256","typ":"JWT"}`; claims `core_user_id` (req), `core_school_id` (req), `exp` (req, **epoch SECONDS**, 30s skew), optional `iss` (if present MUST be `"inteliflow-core"`), `spark_attempt_id`, `return_url`; launch URL `{SPARK_API_URL}/api/integration/auth?token=<jwt>&redirect=<urlenc(/student/experiment/{spark_attempt_id})>`; `return_url` rides INSIDE the JWT.
- **Tokens-only / WCAG-AA; admin client bypasses RLS (guards are the backstop); never fabricate student outcomes (cold-start otherwise).**

## Build order
SP-A first (provisioning): **T1 → T2 → T3 → T4**. Then SP-B (launch): **T5 → T6 → T7 → T8 → T9**. T1/T5 are in the SPARK repo; the rest in V2.

---

## Task 1 [SPARK repo]: `POST /api/integration/provision-school`

**Repo:** `C:/users/inteliflow/spark-platform` (branch `feat/core-v2-provisioning` off its default).
**Files:** Create `app/api/integration/provision-school/route.ts`; Test `app/api/integration/provision-school/__tests__/route.test.ts` (match SPARK's existing test idiom — inspect a sibling integration test first).

**Interfaces — Produces:** `POST` Bearer `CORE_SPARK_API_SECRET`; body `{ core_school_id, name, core_base_url? }`; idempotent; returns `{ success, spark_school_id, core_spark_link_id, created }`.

**Behavior (mirror `scripts/link-eduflux-pilot.ts:91-145`):** auth via `bearerMatches(authHeader, process.env.CORE_SPARK_API_SECRET)` (`lib/auth/timingSafe.ts`); `createAdminSupabaseClient()`; **idempotent:** if a `core_spark_links` row exists for `core_school_id` (enabled), reuse its `spark_school_id`; else create a dedicated `spark_schools` row (`school_id = randomUUID()`, `name`, `status:'active'`, `feature_flags:{ core_integration:true }`) and a `core_spark_links` row (`core_school_id`, `spark_school_id`, `core_base_url`, `enabled:true`). Always ensure `feature_flags.core_integration=true` on the spark school + set `core_base_url`. Never 5xx for business outcomes; 401 bad bearer; 400 missing fields.

- [ ] **Step 1: Inspect a sibling test** — read `app/api/integration/webhooks/core/__tests__/` (or the nearest existing integration route test) to copy SPARK's mock/test idiom. Then write the failing test: 401 (bad bearer), 400 (missing `core_school_id`/`name`), first call creates spark_schools + link (assert `core_integration:true` + `core_base_url`), second call idempotent (reuses spark_school_id).

- [ ] **Step 2: Run it — expect FAIL** (route missing). SPARK test command: check `spark-platform/package.json` (likely `vitest run` or `jest`); run the single file.

- [ ] **Step 3: Implement `route.ts`**

```ts
// app/api/integration/provision-school/route.ts
// CORE→SPARK provisioning: idempotently create/ensure a dedicated SPARK school + core_spark_links
// for a CORE school, and enable the core_integration feature flag. Bearer CORE_SPARK_API_SECRET.
// Net-new in Phase 2 (V1 left this a manual ops step). Mirrors scripts/link-eduflux-pilot.ts.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { bearerMatches } from "@/lib/auth/timingSafe";
import { createAdminSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!bearerMatches(request.headers.get("authorization"), process.env.CORE_SPARK_API_SECRET)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  let body: { core_school_id?: string; name?: string; core_base_url?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Malformed JSON" }, { status: 400 });
  }
  const coreSchoolId = body.core_school_id;
  const name = body.name;
  const coreBaseUrl = body.core_base_url ?? null;
  if (!coreSchoolId || !name) {
    return NextResponse.json({ success: false, error: "Missing core_school_id or name" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  try {
    // Idempotent: reuse the existing link's spark school if present.
    const { data: existingLink } = await admin
      .from("core_spark_links")
      .select("id, spark_school_id")
      .eq("core_school_id", coreSchoolId)
      .maybeSingle();

    let sparkSchoolId: string;
    let created = false;
    if (existingLink) {
      sparkSchoolId = existingLink.spark_school_id as string;
    } else {
      sparkSchoolId = randomUUID(); // SPARK-internal canonical id (UNIQUE, NOT the CORE id)
      const { error: schoolErr } = await admin.from("spark_schools").insert({
        school_id: sparkSchoolId,
        name,
        status: "active",
        feature_flags: { core_integration: true },
      });
      if (schoolErr) {
        return NextResponse.json({ success: false, error: `spark_schools insert: ${schoolErr.message}` }, { status: 200 });
      }
      created = true;
    }

    // Ensure core_integration flag is on (in case the school pre-existed without it).
    await admin.from("spark_schools").update({ feature_flags: { core_integration: true } }).eq("school_id", sparkSchoolId);

    const { data: link, error: linkErr } = await admin
      .from("core_spark_links")
      .upsert(
        { core_school_id: coreSchoolId, spark_school_id: sparkSchoolId, core_base_url: coreBaseUrl, enabled: true },
        { onConflict: "core_school_id" },
      )
      .select("id")
      .single();
    if (linkErr) {
      return NextResponse.json({ success: false, error: `core_spark_links upsert: ${linkErr.message}` }, { status: 200 });
    }

    return NextResponse.json({ success: true, spark_school_id: sparkSchoolId, core_spark_link_id: link.id, created });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 200 });
  }
}
```

> Verify `feature_flags` merge: SPARK's `spark_schools.feature_flags` is a flat jsonb; the `update({ feature_flags: {core_integration:true} })` replaces the object. If the school carries OTHER flags, read-merge instead. For a freshly-created school it's exact; for a pre-existing one, the implementer should read `feature_flags`, spread, set `core_integration:true`, write back (only if other flags exist — check the seed). Keep idempotent.

- [ ] **Step 4: Run the test — expect PASS.**
- [ ] **Step 5: Commit** (in the SPARK repo): `feat(integration): provision-school endpoint (CORE→SPARK school + link + core_integration)`.

---

## Task 2 [V2]: `provisionSparkSchool` lib (calls the SPARK endpoint)

**Files:** Create `src/lib/spark/provisionSparkSchool.ts`; Test `src/lib/spark/__tests__/provisionSparkSchool.test.ts`.

**Interfaces — Consumes:** `SPARK_API_URL`, `CORE_SPARK_API_SECRET` (`@/lib/spark/config`). **Produces:** `provisionSparkSchool({ coreSchoolId, name, coreBaseUrl }): Promise<{ success; sparkSchoolId?; error? }>`.

- [ ] **Step 1: Failing test** (fetch stub, like `notifyAssignmentCreated.test.ts`): POSTs to `${SPARK_API_URL}/api/integration/provision-school` with Bearer + `{core_school_id,name,core_base_url}`; maps `{success, spark_school_id}`; never throws (returns `{success:false,error}` on non-OK / throw).

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
describe('provisionSparkSchool', () => {
  beforeEach(() => { process.env.SPARK_API_URL='https://spark.test'; process.env.CORE_SPARK_API_SECRET='sek'; vi.resetModules(); });
  afterEach(() => vi.restoreAllMocks());
  it('POSTs with Bearer + body and returns sparkSchoolId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, spark_school_id: 'ss-1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const { provisionSparkSchool } = await import('../provisionSparkSchool');
    const r = await provisionSparkSchool({ coreSchoolId: 'cs-1', name: 'Demo', coreBaseUrl: 'https://newcore.inteliflowai.com' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://spark.test/api/integration/provision-school');
    expect(init.headers.Authorization).toBe('Bearer sek');
    expect(JSON.parse(init.body)).toMatchObject({ core_school_id: 'cs-1', name: 'Demo', core_base_url: 'https://newcore.inteliflowai.com' });
    expect(r).toMatchObject({ success: true, sparkSchoolId: 'ss-1' });
  });
  it('returns success:false on non-OK / throw (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const { provisionSparkSchool } = await import('../provisionSparkSchool');
    expect((await provisionSparkSchool({ coreSchoolId: 'x', name: 'y' })).success).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    const { provisionSparkSchool: p2 } = await import('../provisionSparkSchool');
    expect((await p2({ coreSchoolId: 'x', name: 'y' })).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**

```ts
// src/lib/spark/provisionSparkSchool.ts — V2→SPARK provisioning call (creates the dedicated SPARK
// school + core_spark_links so the SPARK side is ready). Pairs with provisionSparkLink (V2 side).
import { SPARK_API_URL, CORE_SPARK_API_SECRET } from './config';

export interface ProvisionSparkSchoolInput {
  coreSchoolId: string;
  name: string;
  coreBaseUrl?: string | null;
}
export interface ProvisionSparkSchoolResult {
  success: boolean;
  sparkSchoolId?: string;
  error?: string;
}

export async function provisionSparkSchool(input: ProvisionSparkSchoolInput): Promise<ProvisionSparkSchoolResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const res = await fetch(`${SPARK_API_URL}/api/integration/provision-school`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CORE_SPARK_API_SECRET}` },
      body: JSON.stringify({ core_school_id: input.coreSchoolId, name: input.name, core_base_url: input.coreBaseUrl ?? null }),
      signal: controller.signal,
    });
    if (!res.ok) return { success: false, error: `SPARK HTTP ${res.status}` };
    const json = (await res.json()) as { success?: boolean; spark_school_id?: string; error?: string };
    return { success: json.success === true, sparkSchoolId: json.spark_school_id, error: json.error };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit:** `feat(spark): provisionSparkSchool lib (V2→SPARK provisioning call)`.

---

## Task 3 [V2]: `POST /api/admin/spark-enable` (one-click both-sided)

**Files:** Create `src/app/api/admin/spark-enable/route.ts`; Test `src/app/api/admin/spark-enable/__tests__/route.test.ts`.

**Interfaces — Consumes:** `guardPlatformAdmin` (`@/lib/auth/guards`), `createAdminSupabaseClient`, `provisionSparkSchool` (T2), `provisionSparkLink` (existing `@/lib/spark/sparkLink`). **Produces:** `POST { school_id }` → `{ ok, spark_school_id, steps: { spark, link, license } }`.

**Behavior:** `guardPlatformAdmin()` gate; load `schools` row (id, name) → 404 if missing; `provisionSparkSchool({ coreSchoolId: school.id, name: school.name, coreBaseUrl: 'https://newcore.inteliflowai.com' })`; `provisionSparkLink(admin, { schoolId, apiKey: <generate>, coreBaseUrl: 'https://newcore.inteliflowai.com', label })`; grant the license feature — read `school_licenses.feature_overrides`, set `spark_experiences:true`, write back (V1-parity). Idempotent; report per-step. If the SPARK call fails, report it but still write the V2-side rows (so a retry only needs SPARK).

- [ ] **Step 1: Failing test** (node idiom; mock `@/lib/auth/guards` guardPlatformAdmin → null; mock admin client; mock `provisionSparkSchool` + `provisionSparkLink`): 401/403 when guard returns a NextResponse; 200 + steps when authed; idempotent.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**

```ts
// src/app/api/admin/spark-enable/route.ts
// Super-admin one-click SPARK enablement for a school: provisions the SPARK side (dedicated school +
// core_spark_links), writes the V2 platform_links row, and grants the spark_experiences license
// feature (V1-parity). Session-gated (guardPlatformAdmin) — a V2 upgrade over V1's env-secret gate.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { guardPlatformAdmin } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { provisionSparkSchool } from '@/lib/spark/provisionSparkSchool';
import { provisionSparkLink } from '@/lib/spark/sparkLink';

const CORE_BASE_URL = 'https://newcore.inteliflowai.com';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardPlatformAdmin();
  if (guard) return guard;

  let body: { school_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 }); }
  const schoolId = body.school_id;
  if (!schoolId) return NextResponse.json({ error: 'Missing school_id' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: school } = await admin.from('schools').select('id, name').eq('id', schoolId).maybeSingle();
  if (!school) return NextResponse.json({ error: 'Unknown school_id' }, { status: 404 });

  const steps: Record<string, string> = {};

  // 1. SPARK side (dedicated spark school + link + core_integration flag).
  const sparkRes = await provisionSparkSchool({ coreSchoolId: school.id as string, name: school.name as string, coreBaseUrl: CORE_BASE_URL });
  steps.spark = sparkRes.success ? `ok (${sparkRes.sparkSchoolId})` : `failed: ${sparkRes.error}`;

  // 2. V2 platform_links row (the gate).
  try {
    await provisionSparkLink(admin, { schoolId: school.id as string, apiKey: `core_spark_${randomUUID()}`, coreBaseUrl: CORE_BASE_URL, label: 'SPARK' });
    steps.link = 'ok';
  } catch (e) { steps.link = `failed: ${(e as Error).message}`; }

  // 3. License feature grant (V1-parity): school_licenses.feature_overrides.spark_experiences = true.
  try {
    const { data: lic } = await admin.from('school_licenses').select('feature_overrides').eq('school_id', school.id).maybeSingle();
    const overrides = { ...(lic?.feature_overrides ?? {}), spark_experiences: true };
    if (lic) {
      await admin.from('school_licenses').update({ feature_overrides: overrides }).eq('school_id', school.id);
      steps.license = 'ok';
    } else {
      steps.license = 'skipped (no license row)';
    }
  } catch (e) { steps.license = `failed: ${(e as Error).message}`; }

  return NextResponse.json({ ok: sparkRes.success && steps.link === 'ok', spark_school_id: sparkRes.sparkSchoolId ?? null, steps });
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit:** `feat(spark): super-admin spark-enable route (SPARK + platform_links + license)`.

---

## Task 4 [V2]: Super-admin school list + Enable-SPARK action

**Files:** Create `src/app/(super-admin)/schools/page.tsx`; Create `src/app/(super-admin)/schools/_components/SparkEnableButton.tsx` (`'use client'`); Test the button (jsdom) + (optionally) the page server logic. Confirm the `(super-admin)/layout.tsx` already gates `requireRole(['platform_admin'])` (P1 — it does).

**Behavior:** server page (`requireRole` via layout) → admin client reads `schools` (id, name, demo_mode) + each one's SPARK status via `getSparkLink`. Render a list; each row shows name + SPARK status (Enabled / Not enabled) + the `SparkEnableButton` (when not enabled). Button POSTs `/api/admin/spark-enable { school_id }`, shows result. Tokens-only; "SPARK" naming.

- [ ] **Step 1: Read `(super-admin)/provision/page.tsx` + `(super-admin)/layout.tsx`** to mirror the layout/auth + token styling.
- [ ] **Step 2: jsdom test for `SparkEnableButton`** — renders "Enable SPARK"; on click POSTs and shows a success/fail state (mock `fetch`).
- [ ] **Step 3: Implement the button**

```tsx
// src/app/(super-admin)/schools/_components/SparkEnableButton.tsx
'use client';
import { useState } from 'react';

export function SparkEnableButton({ schoolId, enabled }: { schoolId: string; enabled: boolean }) {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>(enabled ? 'done' : 'idle');
  const [msg, setMsg] = useState('');
  if (state === 'done') return <span className="text-ok-fg text-sm font-semibold">SPARK enabled</span>;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={state === 'working'}
        onClick={async () => {
          setState('working');
          try {
            const res = await fetch('/api/admin/spark-enable', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ school_id: schoolId }),
            });
            const json = await res.json();
            if (res.ok && json.ok) { setState('done'); }
            else { setState('error'); setMsg(json.steps ? JSON.stringify(json.steps) : (json.error ?? 'failed')); }
          } catch (e) { setState('error'); setMsg((e as Error).message); }
        }}
        className="rounded-lg border border-surface bg-brand px-3 py-1.5 text-sm font-bold text-fg-on-brand disabled:opacity-60"
      >
        {state === 'working' ? 'Enabling…' : 'Enable SPARK'}
      </button>
      {state === 'error' && <span className="text-risk-fg text-xs">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Implement the page** (server; mirror roster/provision pattern):

```tsx
// src/app/(super-admin)/schools/page.tsx
// Super-admin school list. Role gate is in (super-admin)/layout.tsx (requireRole(['platform_admin'])).
import React from 'react';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { getSparkLink } from '@/lib/spark/sparkLink';
import { SparkEnableButton } from './_components/SparkEnableButton';

export default async function SchoolsPage(): Promise<React.JSX.Element> {
  const admin = createAdminSupabaseClient();
  const { data: schools } = await admin.from('schools').select('id, name, demo_mode').order('name');
  const rows = await Promise.all(
    (schools ?? []).map(async (s) => ({ ...s, sparkEnabled: (await getSparkLink(admin, s.id as string)) !== null })),
  );
  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-2xl text-fg font-semibold">Schools</h1>
      <div className="flex flex-col gap-2">
        {rows.map((s) => (
          <div key={s.id as string} className="flex items-center justify-between gap-4 rounded border border-surface bg-surface px-4 py-3">
            <div className="flex flex-col">
              <span className="text-fg text-sm font-semibold">{s.name as string}{s.demo_mode ? ' (demo)' : ''}</span>
              <span className="text-fg text-xs">{s.sparkEnabled ? 'SPARK enabled' : 'SPARK not enabled'}</span>
            </div>
            <SparkEnableButton schoolId={s.id as string} enabled={s.sparkEnabled} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests + `tsc` — PASS/clean.** **Step 6: Commit:** `feat(spark): super-admin school list + Enable SPARK action`.

---

## Task 5 [SPARK repo]: `isValidReturnUrl` += `newcore.inteliflowai.com`

**Repo:** `spark-platform` (same branch as T1). **File:** Modify `app/api/integration/auth/route.ts` (the `isValidReturnUrl` function, ~lines 208-232).

- [ ] **Step 1: Failing test** — add/extend a unit test asserting `isValidReturnUrl('https://newcore.inteliflowai.com/student/assignments/x')` is `true` (and a non-allowed host is `false`). If `isValidReturnUrl` isn't exported, either export it for the test or test via the route's redirect behavior — match SPARK's existing test approach.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Add one line** in `isValidReturnUrl`, beside the `app.inteliflowai.com` check:

```ts
    if (url.hostname === "app.inteliflowai.com") return true;
    if (url.hostname === "newcore.inteliflowai.com") return true; // CORE V2 prod
    if (url.hostname === "eduflux.datanex.ai") return true;
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit** (SPARK repo): `fix(integration): allow newcore.inteliflowai.com return_url (CORE V2)`.

---

## Task 6 [V2]: `signLaunchJwt` lib (hand-rolled HS256)

**Files:** Create `src/lib/spark/signLaunchJwt.ts`; Test `src/lib/spark/__tests__/signLaunchJwt.test.ts`.

**Interfaces — Produces:** `signLaunchJwt(claims, ttlSeconds=900): string` (3-part base64url HS256 JWT signed with `CORE_SPARK_API_SECRET`). Adds `iat`/`exp` (epoch seconds).

- [ ] **Step 1: Failing test** — sign sample claims, then **independently verify** the signature exactly as SPARK does (the test re-computes `createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')` and asserts equality), decode the payload, assert `core_user_id`/`core_school_id`/`exp` (number, ~now+900)/`iss==='inteliflow-core'`, and header `{alg:'HS256',typ:'JWT'}`.

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
beforeEach(() => { process.env.CORE_SPARK_API_SECRET = 'sek'; });
describe('signLaunchJwt', () => {
  it('produces a SPARK-verifiable HS256 JWT with the right claims', async () => {
    const { signLaunchJwt } = await import('../signLaunchJwt');
    const tok = signLaunchJwt({ core_user_id: 'u1', core_school_id: 's1', spark_attempt_id: 'a1', return_url: 'https://newcore.inteliflowai.com/student/assignments/x' });
    const [h, p, sig] = tok.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(createHmac('sha256', 'sek').update(`${h}.${p}`).digest('base64url')).toBe(sig);
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload).toMatchObject({ core_user_id: 'u1', core_school_id: 's1', spark_attempt_id: 'a1', iss: 'inteliflow-core' });
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp - payload.iat).toBe(900);
  });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**

```ts
// src/lib/spark/signLaunchJwt.ts — hand-rolled HS256 JWT for the SPARK student launch handoff.
// Matches SPARK's verifier (verifyCoreJWT): header {alg:HS256,typ:JWT}, base64url parts, exp in
// epoch SECONDS, iss must be 'inteliflow-core'. No jsonwebtoken dependency (V2 choice).
import { createHmac } from 'crypto';
import { CORE_SPARK_API_SECRET } from './config';

export interface LaunchClaims {
  core_user_id: string;
  core_school_id: string;
  spark_attempt_id?: string;
  email?: string;
  full_name?: string;
  grade?: string;
  return_url?: string;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

export function signLaunchJwt(claims: LaunchClaims, ttlSeconds = 900): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ ...claims, iss: 'inteliflow-core', iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', CORE_SPARK_API_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
```

- [ ] **Step 4: Run — PASS.** **Step 5: Commit:** `feat(spark): signLaunchJwt (hand-rolled HS256 launch token)`.

---

## Task 7 [V2]: `POST /api/attempts/spark-launch` (port V1)

**Files:** Create `src/app/api/attempts/spark-launch/route.ts`; Test `src/app/api/attempts/spark-launch/__tests__/route.test.ts`.

**Interfaces — Consumes:** `signLaunchJwt` (T6), `SPARK_API_URL`/`CORE_SPARK_API_SECRET` (config), `createServerSupabaseClient`+`createAdminSupabaseClient`. **Produces:** `POST { assignment_id }` → `{ launch_url }`.

**Behavior (port V1 `spark-launch`):** `getUser()` → 401; admin client load `assignments` (id, student_id, spark_attempt_id, content) → 404 if missing; **403 if `student_id !== user.id`**; **400 if no `spark_attempt_id`**; load `users` (id, full_name, email, school_id) → 404; **400 if `school_id` null** ("school not linked"); grade from `enrollments` (`class:classes(grade_level)`, `is_active`); 500 if no secret; `return_url = ${origin}/student/assignments/${assignment_id}`; sign JWT; `launch_url = ${SPARK_API_URL}/api/integration/auth?token=${token}&redirect=${encodeURIComponent('/student/experiment/'+spark_attempt_id)}`.

- [ ] **Step 1: Failing test** (node idiom; mock supabase server + signLaunchJwt or verify the URL shape): 401 (no user), 403 (not your assignment), 400 (no spark_attempt_id), 400 (null school_id), 200 + `launch_url` (assert it starts with `${SPARK_API_URL}/api/integration/auth?token=` and contains `redirect=` urlenc of `/student/experiment/<id>`).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** (full route — `origin` from `req.headers.get('origin') || req.nextUrl.origin`):

```ts
// src/app/api/attempts/spark-launch/route.ts — student → SPARK launch handoff (port of V1).
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { signLaunchJwt } from '@/lib/spark/signLaunchJwt';
import { SPARK_API_URL, CORE_SPARK_API_SECRET } from '@/lib/spark/config';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { assignment_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 }); }
  const assignmentId = body.assignment_id;
  if (!assignmentId) return NextResponse.json({ error: 'Missing assignment_id' }, { status: 400 });

  if (!CORE_SPARK_API_SECRET) return NextResponse.json({ error: 'Spark integration not configured' }, { status: 500 });

  const admin = createAdminSupabaseClient();
  const { data: assignment } = await admin
    .from('assignments').select('id, student_id, spark_attempt_id').eq('id', assignmentId).maybeSingle();
  if (!assignment) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  if (assignment.student_id !== user.id) return NextResponse.json({ error: 'Not your assignment' }, { status: 403 });
  if (!assignment.spark_attempt_id) return NextResponse.json({ error: 'Spark not provisioned for this assignment' }, { status: 400 });

  const { data: student } = await admin.from('users').select('id, full_name, email, school_id').eq('id', user.id).maybeSingle();
  if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  if (!student.school_id) return NextResponse.json({ error: 'School not linked' }, { status: 400 });

  const { data: enrollment } = await admin
    .from('enrollments').select('class:classes(grade_level)').eq('student_id', user.id).eq('is_active', true).limit(1).maybeSingle();
  const grade = (enrollment?.class as { grade_level?: string } | null)?.grade_level || '';

  const origin = req.headers.get('origin') || req.nextUrl.origin;
  const returnUrl = `${origin}/student/assignments/${assignment.id}`;
  const token = signLaunchJwt({
    core_user_id: student.id as string,
    core_school_id: student.school_id as string,
    spark_attempt_id: assignment.spark_attempt_id as string,
    email: (student.email as string) ?? undefined,
    full_name: (student.full_name as string) ?? undefined,
    grade,
    return_url: returnUrl,
  });
  const redirectPath = `/student/experiment/${assignment.spark_attempt_id}`;
  const launch_url = `${SPARK_API_URL}/api/integration/auth?token=${token}&redirect=${encodeURIComponent(redirectPath)}`;
  return NextResponse.json({ launch_url });
}
```

> The `enrollments`→`classes(grade_level)` join may hit Supabase's nested-type inference (the T7-Phase-1 `GenericStringError` lesson) — cast the result if `tsc` complains. Run `tsc`.

- [ ] **Step 4: Run test + `tsc` — PASS/clean.** **Step 5: Commit:** `feat(spark): student spark-launch route (JWT handoff, port of V1)`.

---

## Task 8 [V2]: Student assignments list

**Files:** Create `src/lib/spark/loadStudentAssignments.ts` + test; Create `src/app/(student)/assignments/page.tsx`. Confirm `(student)/layout.tsx` gates `requireRole(['student'])` (P3/P6 — it does, but discards context; the page re-resolves the user).

**Behavior:** loader `loadStudentAssignments(admin, studentId)` → the student's assignments (id, content.title, spark_status). Page: `requireRole(['student'])` (to get `userId`), admin client, render list (title + a "Spark Challenge" badge when `spark_status !== 'none'`), link each to `/student/assignments/[id]`. Cold-start EmptyState when none. Four-audience: no scores.

- [ ] **Step 1: Failing loader test** (admin mock): returns mapped `{ id, title, sparkStatus }[]`; empty → `[]`.
- [ ] **Step 2: Implement loader**

```ts
// src/lib/spark/loadStudentAssignments.ts — the student's own assignments (caller passes the
// authenticated studentId; admin client + student_id filter is the ownership guard).
import type { SupabaseClient } from '@supabase/supabase-js';
export interface StudentAssignmentRow { id: string; title: string; sparkStatus: string; }
export async function loadStudentAssignments(admin: SupabaseClient, studentId: string): Promise<StudentAssignmentRow[]> {
  const { data } = await admin
    .from('assignments').select('id, content, spark_status').eq('student_id', studentId)
    .order('created_at', { ascending: false }).limit(200);
  return ((data ?? []) as unknown as { id: string; content: { title?: string } | null; spark_status: string | null }[])
    .map((a) => ({ id: a.id, title: a.content?.title ?? 'Assignment', sparkStatus: a.spark_status ?? 'none' }));
}
```

- [ ] **Step 3: Implement the page** (mirror roster pattern; `requireRole(['student'])` returns `{ userId }`):

```tsx
// src/app/(student)/assignments/page.tsx
import React from 'react';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadStudentAssignments } from '@/lib/spark/loadStudentAssignments';
import { EmptyState } from '@/components/core/EmptyState';
import Link from 'next/link';

export default async function StudentAssignmentsPage(): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const rows = await loadStudentAssignments(admin, userId);
  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-2xl text-fg font-semibold">My Assignments</h1>
      {rows.length === 0 ? (
        <EmptyState variant="just-getting-started" titleOverride="No assignments yet" bodyOverride="New assignments from your teacher will show up here." />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <Link key={r.id} href={`/student/assignments/${r.id}`} className="flex items-center justify-between gap-4 rounded border border-surface bg-surface px-4 py-3">
              <span className="text-fg text-sm font-semibold">{r.title}</span>
              {r.sparkStatus !== 'none' && <span className="text-brand text-xs font-bold">Spark Challenge</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run loader test + `tsc` — PASS/clean.** **Step 5: Commit:** `feat(student): assignments list (student-scoped)`.

---

## Task 9 [V2]: Student assignment detail + SPARK Launch card

**Files:** Create `src/app/(student)/assignments/[id]/page.tsx`; Create `src/app/(student)/assignments/[id]/_components/SparkLaunchCard.tsx` (`'use client'`); Test the card (jsdom) + a leak-audit test.

**Behavior:** detail page (`requireRole(['student'])` + ownership: load the assignment by id, 404/redirect if `student_id !== userId`); render the assignment framing (title + instructions from `content`); if `spark_status !== 'none'` render `SparkLaunchCard`. Card: shows status from `spark_status` (`created/notified` → "Ready to launch"; `in_progress` → "In progress"; `completed` → soft "Challenge complete" — **NO transfer number**); "Launch Challenge" button → `POST /api/attempts/spark-launch { assignment_id }` → `window.open(launch_url, '_blank')`. Four-audience: leak-audit the card's strings.

- [ ] **Step 1: jsdom test for `SparkLaunchCard`** — renders "Launch Challenge" when not completed; on click POSTs + window.open (mock both); completed → soft text, NO digits/% (assert `container.textContent` has no `%` and no raw score); terminology has no "Homework".
- [ ] **Step 2: Implement the card**

```tsx
// src/app/(student)/assignments/[id]/_components/SparkLaunchCard.tsx
'use client';
import { useState } from 'react';

const STATUS_TEXT: Record<string, string> = {
  none: '', notified: 'Your Spark Challenge is getting ready…', created: 'Your Spark Challenge is ready.',
  in_progress: 'You started this challenge — pick up where you left off.', completed: 'Challenge complete. Nice work!',
};

export function SparkLaunchCard({ assignmentId, sparkStatus }: { assignmentId: string; sparkStatus: string }) {
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');
  const completed = sparkStatus === 'completed';
  return (
    <div className="flex flex-col gap-3 rounded border border-surface bg-surface p-5">
      <span className="text-fg font-display text-lg font-semibold">Spark Challenge</span>
      <span className="text-fg text-sm">{STATUS_TEXT[sparkStatus] ?? 'Your Spark Challenge is ready.'}</span>
      {!completed && (
        <button
          type="button" disabled={working}
          onClick={async () => {
            setWorking(true); setErr('');
            try {
              const res = await fetch('/api/attempts/spark-launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignment_id: assignmentId }) });
              const json = await res.json();
              if (res.ok && json.launch_url) window.open(json.launch_url, '_blank');
              else setErr(json.error ?? 'Could not open the challenge.');
            } catch { setErr('Could not open the challenge.'); } finally { setWorking(false); }
          }}
          className="self-start rounded-lg border border-surface bg-brand px-4 py-2 text-sm font-bold text-fg-on-brand disabled:opacity-60"
        >
          {working ? 'Opening…' : 'Launch Challenge'}
        </button>
      )}
      {err && <span className="text-risk-fg text-xs">{err}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Implement the detail page**

```tsx
// src/app/(student)/assignments/[id]/page.tsx
import React from 'react';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/core/EmptyState';
import { SparkLaunchCard } from './_components/SparkLaunchCard';

export default async function StudentAssignmentDetail({ params }: { params: Promise<{ id: string }> }): Promise<React.JSX.Element> {
  const { id } = await params;
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const { data: row } = await admin.from('assignments').select('id, student_id, content, spark_status').eq('id', id).maybeSingle();
  if (!row || row.student_id !== userId) {
    return <div className="p-6"><EmptyState variant="just-getting-started" titleOverride="Assignment not found" bodyOverride="Head back to your assignments list." /></div>;
  }
  const content = (row.content ?? {}) as { title?: string; instructions?: string };
  const sparkStatus = (row.spark_status as string) ?? 'none';
  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-2xl text-fg font-semibold">{content.title ?? 'Assignment'}</h1>
      {content.instructions && <p className="text-fg text-sm leading-relaxed">{content.instructions}</p>}
      {sparkStatus !== 'none' && <SparkLaunchCard assignmentId={row.id as string} sparkStatus={sparkStatus} />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests + `tsc` — PASS/clean.** **Step 5: Commit:** `feat(student): assignment detail + SPARK Launch card`.

---

## Gates (after T9)
- Full suite `npm test` · `npx tsc --noEmit` · `npm run a11y` (49 pairs — no token added) · `npm run build`. SPARK repo: its own test + build for T1/T5.

## Build & merge sequence
1. SPARK repo (T1, T5) on `feat/core-v2-provisioning` → its gates → **review + merge + deploy SPARK** (the provision endpoint + allow-list must be live for V2's spark-enable + launch return to work end-to-end).
2. V2 (T2-T4, T6-T9) on `feat/spark-phase2` → gates green → **adversarial whole-branch review** (Workflow; lens = four-audience leak on the student surface, the launch JWT correctness/secret handling, IDOR on launch + detail, provisioning idempotency + auth) → fix → **finishing-a-development-branch → merge to main → push → deploy**.
3. Ops: with both deployed, Super-Admin → Schools → **Enable SPARK** for a real school provisions both sides (no more manual SQL). Rotate `CORE_SPARK_API_SECRET` remains the standing recommendation.

## Self-Review
- **Spec coverage:** SP-A → T1 (SPARK endpoint), T2 (V2 call), T3 (spark-enable: SPARK+link+license), T4 (super-admin UI). SP-B → T5 (allow-list), T6 (JWT), T7 (launch route), T8 (list), T9 (detail+card). ✅
- **No placeholders:** complete code per task; UI pages mirror the grounded roster/EmptyState pattern. ✅
- **Type consistency:** `LaunchClaims` (T6) consumed by T7; `provisionSparkSchool` result (T2) consumed by T3; `getSparkLink`/`provisionSparkLink` (existing) reused; `spark_status` drives T8/T9. ✅
- **Four-audience:** student surfaces (T8/T9) show no scores/rubrics; leak-audit in T9. ✅
- **Cross-repo:** T1/T5 in SPARK (own branch/test/commit/deploy first); rest in V2. ✅
