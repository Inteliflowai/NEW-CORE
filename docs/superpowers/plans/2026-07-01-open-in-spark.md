# Open in SPARK — Teacher Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher expands a SPARK challenge row in CORE and sees the student's actual work — the challenge steps, the student's per-step answers, and the AI scoring detail — read-only, without leaving CORE.

**Architecture:** One new read-only action `get_attempt_review` on SPARK's existing school-scoped server-to-server API (`POST /api/integration/core`, Bearer per-school `core_spark_links.api_key`). SPARK computes the step labels itself by reusing the pure `projectSectionsToWorkflow` projection (the same function the student runner uses), so the answers arrive pre-labeled. CORE adds an on-demand teacher route (mirrors `GET /api/teacher/gradebook/attempt`) and a "View student's work" panel in the challenges drill-in. NO teacher session in SPARK, NO migration on either side.

**Tech Stack:** SPARK = Next.js App Router at repo root (`C:/users/inteliflow/spark-platform`), vitest in `__tests__/`. CORE = Next.js 16 under `src/` (`C:/users/inteliflow/new-core`), vitest 4, Tailwind v4 token classes.

## Global Constraints

- **Two repos.** Task 1 executes in `C:/users/inteliflow/spark-platform` (branch `feat/attempt-review-action` off `master`). Tasks 2–5 execute in `C:/users/inteliflow/new-core` (branch `feat/open-in-spark` off `main`). Deploy order: SPARK first (action is additive/dead until called); CORE's fail-soft covers any gap.
- **Read-only invariant (SPARK):** the new action performs ZERO writes (the dispatcher's existing best-effort `spark_system_events` log is the only side effect). No session, no cookies, no `spark_users` mutation.
- **Tenancy (SPARK):** every query filters by `link.spark_school_id`. Not-found-in-this-school → **404** `{ error: string }`. 400 invalid input. Snake_case response keys. (Conventions of `handleGetStudentProfile`, `app/api/integration/core/route.ts:76-119`.)
- **EXCLUDE `student_profile_snapshot` from the wire** — it contains `mastery_band` etc.; it is a projection INPUT only.
- **Teli:** `teli_hint_count` only. No UI copy may imply a transcript exists (transcripts are never persisted — privacy promise).
- **Media safety (CORE):** render a drawing ONLY when its value starts with `data:image/` (student-supplied via open submit API — a `https://` value must never become an `<img src>`); observation `image_url` is a dead browser blob reference — NEVER rendered, text only.
- **Auth chain (CORE route):** `createServerSupabaseClient()` → `getUser()` → STAFF_ROLES → load assignment → `guardClassAccess(class_id)` → only then call SPARK. Admin client bypasses RLS; the guard is the backstop.
- **Fail-soft:** SPARK fetch = 10s AbortSignal timeout; failure → friendly error state; the challenges page itself never blocks (panel is on-demand).
- **Four-audience:** teacher-only surface — rubric/observations/effort allowed. Strings → `STRINGS-FOR-BARB.md §Open in SPARK review`.
- **CORE UI:** Tier-2 token classes only (`text-fg`, `text-fg-muted`, `bg-brand`…), no hardcoded hex/spacing; content text `text-fg`. React tests: `// @vitest-environment jsdom` + `import '@/test/setup-dom';` first.
- **No migration. No new env vars** (`SPARK_API_URL` + per-school `platform_links.api_key` already exist in CORE).

## Verified current-code facts (do not re-derive)

- SPARK dispatcher + `validateApiKey`: `app/api/integration/core/route.ts:11-70`; handlers take `(supabase, link, body)`.
- Step projection: `projectSectionsToWorkflow(content, studentProfile?)` in `lib/generation/projection.ts:80-106` — pure; returns `WorkflowStep[]` with `order = i+1`; skips tier-select when `studentProfile?.mastery_band` set; appends knowledge-transfer only when `content.knowledge_transfer` present.
- `step_responses[].step_index` = 0-based position in the projected array (`steps[step_index].order === step_index + 1`); extension responses use synthetic index `9999`.
- `StepResponse.value` shapes by type (`components/experiment/StepRenderer.tsx`): instruction `{acknowledged}`, prediction `{text, confidence}`, observation `{text, image_url?}` (image_url = dead `blob:`), data_entry `{data}`, drawing `{data_url}` (inline base64 PNG), multiple_choice `{selected[], rationale}`, claim_evidence `{claim, evidence, reasoning}`, comparison `{side_a, side_b, synthesis}`, reflection `{responses: Record<number,string>, prompts: string[]}`, hardware_control `{sensor_data, commands_sent}`, code_block `{code, language}`; optional `choice_id` merged in.
- Attempt row: `experiment_attempts` (`state, score, effort_label, revision_count, teli_hint_count, started_at, completed_at, evidence`). Content row: `experiment_attempt_content` (`generated_content, student_profile_snapshot, generation_status`), UNIQUE per attempt, may be absent (pre-025). Analysis: latest `spark_ai_analysis` where `analysis_type='experiment_scoring'`, `result` = `{ overall_score, content_quality, rubric_dimensions, dimension_observations, dimension_scores, effort_label, key_observations, prompt_version }`.
- CORE correlation keys: `assignments.id` (= SPARK `core_homework_id`) + `users.id` (= SPARK `core_user_id`). `ChallengeRow` already carries `assignmentId` + `studentId` (`src/lib/spark/loadChallenges.ts:6-19`).
- CORE per-school SPARK link: `getSparkLink(admin, schoolId)` → `{ api_key, enabled }` (`src/lib/spark/sparkLink.ts:12-25`); host = `SPARK_API_URL` (`src/lib/spark/config.ts:5`).
- CORE route to mirror: `src/app/api/teacher/gradebook/attempt/route.ts` (quoted in full in Task 3).
- CORE challenges UI: `ChallengesList.tsx` (client, expand-state per student), `ChallengeCard.tsx` props `{ row, onTip, onHideTip }`.

## File Structure

**SPARK (`spark-platform`):**
- Create: `lib/integration/attemptReview.ts` — pure `buildAttemptReview()` (projection-zip + payload shaping; unit-testable)
- Modify: `app/api/integration/core/route.ts` — `case "get_attempt_review"` + `handleGetAttemptReview` (queries only, delegates shaping)
- Test: `__tests__/integration/attempt-review.test.ts`

**CORE (`new-core`):**
- Create: `src/lib/spark/fetchAttemptReview.ts` — typed client (fetch + timeout + defensive mapping)
- Create: `src/lib/spark/formatStepResponse.ts` — pure per-type answer→display-segments formatter (media guards live here)
- Create: `src/app/api/teacher/challenges/attempt/route.ts` — teacher route
- Create: `src/app/(teacher)/challenges/_components/StudentWorkPanel.tsx` — client panel
- Modify: `src/app/(teacher)/challenges/_components/ChallengeCard.tsx` — "View student's work" toggle
- Modify: `STRINGS-FOR-BARB.md`
- Tests: `src/lib/spark/__tests__/fetchAttemptReview.test.ts`, `src/lib/spark/__tests__/formatStepResponse.test.ts`, `src/app/api/teacher/challenges/attempt/__tests__/route.test.ts`, `src/app/(teacher)/challenges/_components/__tests__/StudentWorkPanel.test.tsx`

---

### Task 1 (SPARK repo): `get_attempt_review` action

**Repo:** `C:/users/inteliflow/spark-platform`, branch `feat/attempt-review-action` off `master`.

**Files:**
- Create: `lib/integration/attemptReview.ts`
- Modify: `app/api/integration/core/route.ts` (add one `case` + one handler at the end)
- Test: `__tests__/integration/attempt-review.test.ts`

**Interfaces:**
- Consumes: `projectSectionsToWorkflow` (`lib/generation/projection.ts`), existing `validateApiKey`/dispatcher.
- Produces (wire shape Tasks 2–4 rely on — LOCKED):

```jsonc
// 200 response of action "get_attempt_review"
{
  "attempt": { "state": "completed", "started_at": "…", "completed_at": "…|null",
               "score": 87.5, "effort_label": "effortful_success|…|null",
               "revision_count": 2, "teli_hint_count": 1 },
  "generation_status": "ready|fallback_barb_original|pending|generating|failed|null", // null = no content row
  "steps": [ { "order": 1, "title": "The Challenge", "type": "instruction", "description": "…" } ], // null when not projectable
  "step_responses": [ { "step_index": 0, "type": "prediction", "value": {}, "completed": true } ],   // [] when none
  "analysis": { "rubric_dimensions": {}, "dimension_observations": {}, "key_observations": [],
                "content_quality": "engaged|minimal|non_engaged|null" } // null when never analyzed
}
// Errors: 400 {error:"core_homework_id (string) required"} / {error:"core_student_id (string) required"}
//         404 {error:"Student not found in SPARK"} / 404 {error:"No attempt found for this assignment"}
```

- [ ] **Step 1: Write the failing test**

`__tests__/integration/attempt-review.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAttemptReview } from "@/lib/integration/attemptReview";

const attempt = {
  state: "completed", started_at: "2026-07-01T10:00:00Z", completed_at: "2026-07-01T10:40:00Z",
  score: 87.5, effort_label: "effortful_success", revision_count: 2, teli_hint_count: 1,
  evidence: {
    step_responses: [
      { step_index: 1, type: "prediction", value: { text: "It floats", confidence: 70 }, completed: true },
    ],
    signal_summary: { total_revisions: 2 },
    submitted_at: "2026-07-01T10:40:00Z",
  },
};

// Fixture matches the REAL SparkChallengeContent shape (lib/generation/types.ts):
// tier materials are string ARRAYS; strategy_layer keys are visual/kinesthetic/
// analytical/collaborative; mastery_band uses SPARK's enum ('reteach'|'on_level'|
// 'advanced') — NOT CORE's 'on_track'. Shape reference: the known-good fixture in
// __tests__/lib/generation-projection.test.ts.
const content = {
  generation_status: "ready",
  generated_content: {
    scenario: "A boat scenario", challenge_question: "Will it float?", role_assignment: "Engineer",
    input_materials: { reteach: ["a"], grade_level: ["b"], advanced: ["c"] },
    strategy_layer: { visual: "v", kinesthetic: "k", analytical: "a", collaborative: "c" },
    output_options: [{ label: "Poster", description: "make a poster" }],
    teli_support_prompts: ["hint"], reflection_questions: ["what changed?"],
  },
  student_profile_snapshot: { mastery_band: "on_level" },
};

const analysis = {
  result: {
    overall_score: 87.5, content_quality: "engaged",
    rubric_dimensions: { reasoning_strategy: 3 },
    dimension_observations: { reasoning_strategy: "solid" },
    key_observations: ["kept revising"], prompt_version: "v3",
  },
};

describe("buildAttemptReview", () => {
  it("zips steps from the projection and never ships the profile snapshot", () => {
    const out = buildAttemptReview(attempt, content, analysis);
    expect(out.attempt).toEqual({
      state: "completed", started_at: "2026-07-01T10:00:00Z", completed_at: "2026-07-01T10:40:00Z",
      score: 87.5, effort_label: "effortful_success", revision_count: 2, teli_hint_count: 1,
    });
    expect(out.generation_status).toBe("ready");
    // mastery_band present → tier-select skipped → step order matches what the student saw
    expect(out.steps?.[0]).toMatchObject({ order: 1, title: "The Challenge", type: "instruction" });
    expect(out.steps?.[1]).toMatchObject({ order: 2, title: "Make a Prediction", type: "prediction" });
    expect(out.step_responses).toEqual(attempt.evidence.step_responses);
    expect(out.analysis).toEqual({
      rubric_dimensions: { reasoning_strategy: 3 },
      dimension_observations: { reasoning_strategy: "solid" },
      key_observations: ["kept revising"], content_quality: "engaged",
    });
    expect(JSON.stringify(out)).not.toContain("mastery_band");
    expect(JSON.stringify(out)).not.toContain("student_profile_snapshot");
  });

  it("degrades when the content row is missing (pre-025 attempts)", () => {
    const out = buildAttemptReview(attempt, null, analysis);
    expect(out.generation_status).toBeNull();
    expect(out.steps).toBeNull();
    expect(out.step_responses).toHaveLength(1);
  });

  it("degrades when never analyzed and evidence empty", () => {
    const out = buildAttemptReview({ ...attempt, evidence: {} }, null, null);
    expect(out.analysis).toBeNull();
    expect(out.step_responses).toEqual([]);
  });

  it("does not project steps for non-renderable generation states", () => {
    const out = buildAttemptReview(attempt, { ...content, generation_status: "failed" }, null);
    expect(out.generation_status).toBe("failed");
    expect(out.steps).toBeNull();
  });

  it("degrades to steps:null on malformed legacy content instead of throwing", () => {
    const malformed = {
      ...content,
      generated_content: {
        ...content.generated_content,
        input_materials: { reteach: "not-an-array", grade_level: "x", advanced: "y" },
      },
    };
    const out = buildAttemptReview(attempt, malformed, null);
    expect(out.steps).toBeNull();
    expect(out.step_responses).toHaveLength(1); // answers still ship
  });
});

// Drift-locks (house pattern: __tests__/integration/inbound-payload-direct.test.ts
// reads the route source). The tenancy + read-only invariants live in the handler,
// which the pure-shaper unit tests structurally cannot see.
describe("handleGetAttemptReview drift-locks", () => {
  const src = readFileSync(join(__dirname, "../../app/api/integration/core/route.ts"), "utf8");
  const handler = src.slice(src.indexOf("async function handleGetAttemptReview"));

  it("exists and school-scopes the student lookup", () => {
    expect(handler.length).toBeGreaterThan(0);
    expect(handler).toContain('.eq("school_id", link.spark_school_id)');
  });
  it("verifies the attempt's session school against the link (roster-churn belt-and-braces)", () => {
    expect(handler).toContain('.from("experiment_sessions")');
    expect(handler).toContain("sess?.school_id !== link.spark_school_id");
  });
  it("performs zero writes", () => {
    expect(handler).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `spark-platform`): `npx vitest run __tests__/integration/attempt-review.test.ts`
Expected: FAIL — `Cannot find module '@/lib/integration/attemptReview'`.

- [ ] **Step 3: Write the implementation**

`lib/integration/attemptReview.ts`:

```ts
// Pure payload shaper for the get_attempt_review integration action.
// Reuses the SAME projection the student runner used (including the
// persisted student_profile_snapshot, so step order matches what the
// student actually saw). The snapshot is a projection INPUT only and
// must never appear in the output (it carries mastery_band).
import { projectSectionsToWorkflow } from "@/lib/generation/projection";

interface AttemptRow {
  state: string;
  started_at: string | null;
  completed_at: string | null;
  score: number | null;
  effort_label: string | null;
  revision_count: number | null;
  teli_hint_count: number | null;
  evidence: unknown;
}

interface ContentRow {
  generation_status: string | null;
  generated_content: unknown;
  student_profile_snapshot: unknown;
}

interface AnalysisRow {
  result: unknown;
}

const PROJECTABLE = new Set(["ready", "fallback_barb_original"]);

export function buildAttemptReview(
  attempt: AttemptRow,
  content: ContentRow | null,
  analysis: AnalysisRow | null,
) {
  let steps: Array<{ order: number; title: string; type: string; description: string }> | null = null;
  if (content?.generated_content && PROJECTABLE.has(content.generation_status ?? "")) {
    try {
      steps = projectSectionsToWorkflow(
        content.generated_content as Parameters<typeof projectSectionsToWorkflow>[0],
        (content.student_profile_snapshot ?? undefined) as Parameters<typeof projectSectionsToWorkflow>[1],
      ).map((s) => ({
        order: s.order,
        title: s.title,
        type: s.type,
        description: s.description ?? "",
      }));
    } catch {
      steps = null; // malformed legacy content — answers still ship
    }
  }

  const evidence = (attempt.evidence ?? {}) as { step_responses?: unknown };
  const stepResponses = Array.isArray(evidence.step_responses) ? evidence.step_responses : [];

  const r = (analysis?.result ?? null) as Record<string, unknown> | null;
  const analysisOut = r
    ? {
        rubric_dimensions: r.rubric_dimensions ?? null,
        dimension_observations: r.dimension_observations ?? null,
        key_observations: r.key_observations ?? [],
        content_quality: r.content_quality ?? null,
      }
    : null;

  return {
    attempt: {
      state: attempt.state,
      started_at: attempt.started_at,
      completed_at: attempt.completed_at,
      score: attempt.score,
      effort_label: attempt.effort_label,
      revision_count: attempt.revision_count,
      teli_hint_count: attempt.teli_hint_count,
    },
    generation_status: content?.generation_status ?? null,
    steps,
    step_responses: stepResponses,
    analysis: analysisOut,
  };
}
```

In `app/api/integration/core/route.ts`, add to the `switch (action)`:

```ts
      case "get_attempt_review":
        return handleGetAttemptReview(supabase, link, body);
```

and append the handler (conventions of `handleGetStudentProfile` — every query school-filtered, 404 for not-in-school):

```ts
// Action: get_attempt_review — read-only, teacher-review payload for ONE
// student's attempt on ONE CORE assignment. Zero writes. Ships the projected
// steps + raw step_responses + scoring analysis; NEVER the profile snapshot.
async function handleGetAttemptReview(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  link: { spark_school_id: string },
  body: Record<string, unknown>,
) {
  const { core_homework_id, core_student_id } = body;
  if (!core_homework_id || typeof core_homework_id !== "string") {
    return NextResponse.json({ error: "core_homework_id (string) required" }, { status: 400 });
  }
  if (!core_student_id || typeof core_student_id !== "string") {
    return NextResponse.json({ error: "core_student_id (string) required" }, { status: 400 });
  }

  const { data: sparkUser } = await supabase
    .from("spark_users")
    .select("id")
    .eq("core_user_id", core_student_id)
    .eq("school_id", link.spark_school_id)
    .single();
  if (!sparkUser) {
    return NextResponse.json({ error: "Student not found in SPARK" }, { status: 404 });
  }

  const { data: attempt } = await supabase
    .from("experiment_attempts")
    .select("id, session_id, state, started_at, completed_at, score, effort_label, revision_count, teli_hint_count, evidence")
    .eq("core_homework_id", core_homework_id)
    .eq("student_id", sparkUser.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!attempt) {
    return NextResponse.json({ error: "No attempt found for this assignment" }, { status: 404 });
  }

  // Belt-and-braces school re-verification (mirrors get_attempt_result,
  // route.ts:374-385): spark_users.school_id is rebindable on roster churn
  // (the webhook upsert re-homes the row with no school filter), while old
  // attempts stay anchored to their original school via experiment_sessions.
  // 404, not 403 — the cross-school-probe house pattern (don't leak existence).
  const { data: sess } = await supabase
    .from("experiment_sessions")
    .select("school_id")
    .eq("id", attempt.session_id)
    .maybeSingle();
  if (sess?.school_id !== link.spark_school_id) {
    return NextResponse.json({ error: "No attempt found for this assignment" }, { status: 404 });
  }

  const { data: content } = await supabase
    .from("experiment_attempt_content")
    .select("generation_status, generated_content, student_profile_snapshot")
    .eq("attempt_id", attempt.id)
    .maybeSingle();

  const { data: analysis } = await supabase
    .from("spark_ai_analysis")
    .select("result")
    .eq("attempt_id", attempt.id)
    .eq("analysis_type", "experiment_scoring")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json(buildAttemptReview(attempt, content ?? null, analysis ?? null));
}
```

Add the import at the top of the route file: `import { buildAttemptReview } from "@/lib/integration/attemptReview";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/integration/attempt-review.test.ts` → PASS (all 8: 5 shaper + 3 drift-locks).
Then the full suite + typecheck: `npx vitest run && npx tsc --noEmit` → all green.

- [ ] **Step 5: Commit**

```bash
git add lib/integration/attemptReview.ts app/api/integration/core/route.ts __tests__/integration/attempt-review.test.ts
git commit -m "feat(integration): get_attempt_review action — read-only teacher-review payload for CORE"
```

---

### Task 2 (CORE): typed client `fetchAttemptReview`

**Files:**
- Create: `src/lib/spark/fetchAttemptReview.ts`
- Test: `src/lib/spark/__tests__/fetchAttemptReview.test.ts`

**Interfaces:**
- Consumes: `SPARK_API_URL` (`@/lib/spark/config`); Task 1's wire shape.
- Produces:

```ts
export interface SparkStep { order: number; title: string; type: string; description: string }
export interface SparkStepResponse { step_index: number; type: string; value: unknown; completed: boolean }
export interface SparkAnalysis {
  rubric_dimensions: Record<string, number | null> | null;
  dimension_observations: Record<string, string> | null;
  key_observations: string[];
  content_quality: string | null;
}
export interface SparkAttemptReview {
  attempt: { state: string; startedAt: string | null; completedAt: string | null;
             score: number | null; effortLabel: string | null;
             revisionCount: number | null; teliHintCount: number | null };
  generationStatus: string | null;
  steps: SparkStep[] | null;
  stepResponses: SparkStepResponse[];
  analysis: SparkAnalysis | null;
}
export type FetchReviewResult =
  | { ok: true; review: SparkAttemptReview }
  | { ok: false; reason: 'not_found' | 'unreachable' };
export async function fetchAttemptReview(args: {
  apiKey: string; coreHomeworkId: string; coreStudentId: string;
}): Promise<FetchReviewResult>
```

- [ ] **Step 1: Write the failing test**

`src/lib/spark/__tests__/fetchAttemptReview.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAttemptReview } from '@/lib/spark/fetchAttemptReview';

const WIRE = {
  attempt: { state: 'completed', started_at: 's', completed_at: 'c', score: 80,
             effort_label: 'effortful_success', revision_count: 1, teli_hint_count: 0 },
  generation_status: 'ready',
  steps: [{ order: 1, title: 'The Challenge', type: 'instruction', description: 'd' }],
  step_responses: [{ step_index: 0, type: 'instruction', value: { acknowledged: true }, completed: true }],
  analysis: { rubric_dimensions: { creativity: 4 }, dimension_observations: null,
              key_observations: ['x'], content_quality: 'engaged' },
};

describe('fetchAttemptReview', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs the action with the per-school key and maps to camelCase', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(WIRE), { status: 200 }));
    const res = await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'hw', coreStudentId: 'st' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.review.attempt.effortLabel).toBe('effortful_success');
    expect(res.review.steps?.[0].title).toBe('The Challenge');
    expect(res.review.stepResponses).toHaveLength(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain('/api/integration/core');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toMatchObject({
      action: 'get_attempt_review', core_homework_id: 'hw', core_student_id: 'st' });
  });

  it('maps 404 to not_found', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'No attempt found for this assignment' }), { status: 404 }));
    expect(await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' }))
      .toEqual({ ok: false, reason: 'not_found' });
  });

  it('maps network failure to unreachable', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' }))
      .toEqual({ ok: false, reason: 'unreachable' });
  });

  it('maps a 5xx to unreachable (never a bogus empty review)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Integration request failed' }), { status: 500 }));
    expect(await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' }))
      .toEqual({ ok: false, reason: 'unreachable' });
  });

  it('maps a non-JSON 200 body to unreachable', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('<html>gateway</html>', { status: 200 }));
    expect(await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' }))
      .toEqual({ ok: false, reason: 'unreachable' });
  });

  it('tolerates malformed wire payloads (defensive defaults, never throws)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({
        attempt: { state: 'completed' },
        steps: 'garbage',
        analysis: {
          dimension_observations: { creativity: { nested: true }, reflection: 'real prose' },
          rubric_dimensions: { creativity: 'four', reflection: 3 },
        },
      }), { status: 200 }));
    const res = await fetchAttemptReview({ apiKey: 'k', coreHomeworkId: 'h', coreStudentId: 's' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.review.steps).toBeNull();
    expect(res.review.stepResponses).toEqual([]);
    // value-level filtering: non-string observations and non-number rubric entries dropped
    expect(res.review.analysis?.dimension_observations).toEqual({ reflection: 'real prose' });
    expect(res.review.analysis?.rubric_dimensions).toEqual({ reflection: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spark/__tests__/fetchAttemptReview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`src/lib/spark/fetchAttemptReview.ts`:

```ts
// Server-only client for SPARK's get_attempt_review integration action.
// Fail-soft by contract: every failure mode maps to a typed result — the
// challenges page must never crash or hang on SPARK (10s cap, spark-client
// house pattern). Defensive mapping: unknown/malformed fields degrade to
// null/[] instead of throwing.
import { SPARK_API_URL } from '@/lib/spark/config';

export interface SparkStep { order: number; title: string; type: string; description: string }
export interface SparkStepResponse { step_index: number; type: string; value: unknown; completed: boolean }
export interface SparkAnalysis {
  rubric_dimensions: Record<string, number | null> | null;
  dimension_observations: Record<string, string> | null;
  key_observations: string[];
  content_quality: string | null;
}
export interface SparkAttemptReview {
  attempt: {
    state: string; startedAt: string | null; completedAt: string | null;
    score: number | null; effortLabel: string | null;
    revisionCount: number | null; teliHintCount: number | null;
  };
  generationStatus: string | null;
  steps: SparkStep[] | null;
  stepResponses: SparkStepResponse[];
  analysis: SparkAnalysis | null;
}
export type FetchReviewResult =
  | { ok: true; review: SparkAttemptReview }
  | { ok: false; reason: 'not_found' | 'unreachable' };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function mapSteps(v: unknown): SparkStep[] | null {
  if (!Array.isArray(v)) return null;
  const out: SparkStep[] = [];
  for (const s of v) {
    if (!s || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    if (typeof o.order !== 'number' || typeof o.title !== 'string' || typeof o.type !== 'string') continue;
    out.push({ order: o.order, title: o.title, type: o.type, description: str(o.description) ?? '' });
  }
  return out.length ? out : null;
}

function mapResponses(v: unknown): SparkStepResponse[] {
  if (!Array.isArray(v)) return [];
  const out: SparkStepResponse[] = [];
  for (const r of v) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.step_index !== 'number' || typeof o.type !== 'string') continue;
    out.push({ step_index: o.step_index, type: o.type, value: o.value, completed: o.completed === true });
  }
  return out;
}

function mapAnalysis(v: unknown): SparkAnalysis | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  // spark_ai_analysis.result is LLM-derived JSON — validate VALUES, not just
  // containers, or a non-string observation becomes a React-child crash in the panel.
  const rubric = o.rubric_dimensions && typeof o.rubric_dimensions === 'object'
    ? (Object.fromEntries(Object.entries(o.rubric_dimensions as Record<string, unknown>)
        .filter(([, val]) => typeof val === 'number' || val === null)) as Record<string, number | null>)
    : null;
  const dims = o.dimension_observations && typeof o.dimension_observations === 'object'
    ? (Object.fromEntries(Object.entries(o.dimension_observations as Record<string, unknown>)
        .filter(([, val]) => typeof val === 'string')) as Record<string, string>)
    : null;
  return {
    rubric_dimensions: rubric && Object.keys(rubric).length ? rubric : null,
    dimension_observations: dims && Object.keys(dims).length ? dims : null,
    key_observations: Array.isArray(o.key_observations)
      ? o.key_observations.filter((k): k is string => typeof k === 'string') : [],
    content_quality: str(o.content_quality),
  };
}

export async function fetchAttemptReview(args: {
  apiKey: string; coreHomeworkId: string; coreStudentId: string;
}): Promise<FetchReviewResult> {
  try {
    const res = await fetch(`${SPARK_API_URL}/api/integration/core`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.apiKey}` },
      body: JSON.stringify({
        action: 'get_attempt_review',
        core_homework_id: args.coreHomeworkId,
        core_student_id: args.coreStudentId,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (res.status === 404) return { ok: false, reason: 'not_found' };
    if (!res.ok) return { ok: false, reason: 'unreachable' };
    const raw = (await res.json()) as Record<string, unknown>;
    const a = (raw.attempt ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      review: {
        attempt: {
          state: str(a.state) ?? 'unknown',
          startedAt: str(a.started_at), completedAt: str(a.completed_at),
          score: num(a.score), effortLabel: str(a.effort_label),
          revisionCount: num(a.revision_count), teliHintCount: num(a.teli_hint_count),
        },
        generationStatus: str(raw.generation_status),
        steps: mapSteps(raw.steps),
        stepResponses: mapResponses(raw.step_responses),
        analysis: mapAnalysis(raw.analysis),
      },
    };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spark/__tests__/fetchAttemptReview.test.ts` → PASS (6/6). `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spark/fetchAttemptReview.ts src/lib/spark/__tests__/fetchAttemptReview.test.ts
git commit -m "feat(spark-review): typed fail-soft client for get_attempt_review"
```

---

### Task 3 (CORE): pure formatter + teacher route

**Files:**
- Create: `src/lib/spark/formatStepResponse.ts`
- Create: `src/app/api/teacher/challenges/attempt/route.ts`
- Test: `src/lib/spark/__tests__/formatStepResponse.test.ts`, `src/app/api/teacher/challenges/attempt/__tests__/route.test.ts`

**Interfaces:**
- Consumes: Task 2's `fetchAttemptReview` + types; `getSparkLink` (`@/lib/spark/sparkLink`); `STAFF_ROLES`, `guardClassAccess` (house).
- Produces:
  - `formatStepResponse(type: string, value: unknown): DisplaySegment[]` where `type DisplaySegment = { kind: 'text'; label: string; text: string } | { kind: 'image'; label: string; dataUrl: string }` — the ONLY path by which an answer becomes render input. Media rules enforced here: `image` segments only for `drawing.data_url` values passing `/^data:image\//`; observation `image_url` NEVER emitted; unknown types → one text segment with the JSON-safe summary `'(unrecognized answer format)'`.
  - Route: `GET /api/teacher/challenges/attempt?assignmentId=…` → 200 `{ review: SparkAttemptReview, segmentsByStep: Record<number, DisplaySegment[]> }` | 404 `{ error: 'not_started' }` (SPARK has no attempt) | 200 `{ error: 'spark_unreachable' }`-style? — **No:** unreachable → 502 `{ error: 'spark_unreachable' }`; missing link → 404 `{ error: 'spark_not_enabled' }`. Client maps statuses to friendly states.

- [ ] **Step 1: Write the failing formatter test**

`src/lib/spark/__tests__/formatStepResponse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatStepResponse } from '@/lib/spark/formatStepResponse';

describe('formatStepResponse', () => {
  it('prediction → text + confidence line', () => {
    const segs = formatStepResponse('prediction', { text: 'It floats', confidence: 70 });
    expect(segs).toEqual([
      { kind: 'text', label: 'Prediction', text: 'It floats' },
      { kind: 'text', label: 'Confidence', text: '70 / 100' },
    ]);
  });

  it('claim_evidence → three labeled texts', () => {
    expect(formatStepResponse('claim_evidence', { claim: 'c', evidence: 'e', reasoning: 'r' }))
      .toEqual([
        { kind: 'text', label: 'Claim', text: 'c' },
        { kind: 'text', label: 'Evidence', text: 'e' },
        { kind: 'text', label: 'Reasoning', text: 'r' },
      ]);
  });

  it('multiple_choice → selection + rationale, skipping empty rationale', () => {
    expect(formatStepResponse('multiple_choice', { selected: ['Poster'], rationale: '' }))
      .toEqual([{ kind: 'text', label: 'Chose', text: 'Poster' }]);
  });

  it('reflection → one segment per answered prompt, labeled by the prompt', () => {
    expect(formatStepResponse('reflection', {
      prompts: ['What changed?', 'What next?'], responses: { 0: 'My view', 1: '' },
    })).toEqual([{ kind: 'text', label: 'What changed?', text: 'My view' }]);
  });

  it('drawing → image segment ONLY for data:image/ values', () => {
    expect(formatStepResponse('drawing', { data_url: 'data:image/png;base64,AAAA' }))
      .toEqual([{ kind: 'image', label: 'Drawing', dataUrl: 'data:image/png;base64,AAAA' }]);
  });

  it('SECURITY: drawing with a non-data URL never becomes an image', () => {
    const segs = formatStepResponse('drawing', { data_url: 'https://evil.example/track.png' });
    expect(segs.every((s) => s.kind === 'text')).toBe(true);
    expect(JSON.stringify(segs)).not.toContain('evil.example');
  });

  it('SECURITY: observation image_url is never emitted; text only', () => {
    const segs = formatStepResponse('observation', { text: 'saw bubbles', image_url: 'blob:https://x/y' });
    expect(segs).toEqual([{ kind: 'text', label: 'Observation', text: 'saw bubbles' }]);
  });

  it('instruction acknowledged → empty (context step, not an answer)', () => {
    expect(formatStepResponse('instruction', { acknowledged: true })).toEqual([]);
  });

  it('comparison, data_entry, code_block, hardware_control, unknown all render safely', () => {
    expect(formatStepResponse('comparison', { side_a: 'a', side_b: 'b', synthesis: 's' })).toHaveLength(3);
    expect(formatStepResponse('data_entry', { data: { mass: '5', unit: 'kg' } })).toEqual([
      { kind: 'text', label: 'mass', text: '5' }, { kind: 'text', label: 'unit', text: 'kg' },
    ]);
    expect(formatStepResponse('code_block', { code: 'print(1)', language: 'python' })).toEqual([
      { kind: 'text', label: 'Code (python)', text: 'print(1)' },
    ]);
    expect(formatStepResponse('hardware_control', { sensor_data: { temp: 21 }, commands_sent: 3 })[0].kind).toBe('text');
    expect(formatStepResponse('wat', { anything: 1 })).toEqual([
      { kind: 'text', label: 'Answer', text: '(unrecognized answer format)' },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/spark/__tests__/formatStepResponse.test.ts` → module not found.

- [ ] **Step 3: Implement the formatter**

`src/lib/spark/formatStepResponse.ts`:

```ts
// The ONLY path by which a SPARK student answer becomes render input for the
// teacher panel. Media rules live here (house imageUrlGuard lesson): the
// submit API accepts arbitrary JSON, so value fields are attacker-influenced.
// - image segments ONLY for inline data:image/ payloads (drawings);
// - observation image_url (dead browser blob:) is NEVER emitted;
// - unknown shapes degrade to a text placeholder, never throw.
export type DisplaySegment =
  | { kind: 'text'; label: string; text: string }
  | { kind: 'image'; label: string; dataUrl: string };

const DATA_IMAGE = /^data:image\//;

const t = (label: string, v: unknown): DisplaySegment[] =>
  typeof v === 'string' && v.trim() !== '' ? [{ kind: 'text', label, text: v }] : [];

export function formatStepResponse(type: string, value: unknown): DisplaySegment[] {
  const v = (value ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'instruction':
      return [];
    case 'prediction': {
      const segs = t('Prediction', v.text);
      if (typeof v.confidence === 'number' && Number.isFinite(v.confidence)) {
        segs.push({ kind: 'text', label: 'Confidence', text: `${v.confidence} / 100` });
      }
      return segs;
    }
    case 'observation':
      return t('Observation', v.text); // image_url is a dead blob: ref — never emitted
    case 'data_entry': {
      const data = (v.data ?? {}) as Record<string, unknown>;
      return Object.entries(data).flatMap(([k, val]) =>
        typeof val === 'string' || typeof val === 'number'
          ? [{ kind: 'text' as const, label: k, text: String(val) }] : []);
    }
    case 'drawing': {
      const url = v.data_url;
      if (typeof url === 'string' && DATA_IMAGE.test(url)) {
        return [{ kind: 'image', label: 'Drawing', dataUrl: url }];
      }
      return [{ kind: 'text', label: 'Drawing', text: '(drawing could not be displayed)' }];
    }
    case 'multiple_choice': {
      const selected = Array.isArray(v.selected)
        ? v.selected.filter((s): s is string => typeof s === 'string') : [];
      const segs: DisplaySegment[] =
        selected.length ? [{ kind: 'text', label: 'Chose', text: selected.join(', ') }] : [];
      return segs.concat(t('Why', v.rationale));
    }
    case 'claim_evidence':
      return [...t('Claim', v.claim), ...t('Evidence', v.evidence), ...t('Reasoning', v.reasoning)];
    case 'comparison':
      return [...t('Side A', v.side_a), ...t('Side B', v.side_b), ...t('Synthesis', v.synthesis)];
    case 'reflection': {
      const prompts = Array.isArray(v.prompts) ? v.prompts : [];
      const responses = (v.responses ?? {}) as Record<string, unknown>;
      return prompts.flatMap((p, i) =>
        typeof p === 'string' ? t(p, responses[String(i)]) : []);
    }
    case 'hardware_control': {
      const sensors = (v.sensor_data ?? {}) as Record<string, unknown>;
      const parts = Object.entries(sensors)
        .filter(([, val]) => typeof val === 'number')
        .map(([k, val]) => `${k}: ${val}`);
      return parts.length
        ? [{ kind: 'text', label: 'Sensor data', text: parts.join(' · ') }] : [];
    }
    case 'code_block': {
      const lang = typeof v.language === 'string' ? v.language : 'code';
      return typeof v.code === 'string' && v.code.trim() !== ''
        ? [{ kind: 'text', label: `Code (${lang})`, text: v.code }] : [];
    }
    default:
      return [{ kind: 'text', label: 'Answer', text: '(unrecognized answer format)' }];
  }
}
```

- [ ] **Step 4: Run formatter tests** → PASS (9/9).

- [ ] **Step 5: Write the failing route test**

`src/app/api/teacher/challenges/attempt/__tests__/route.test.ts` — mock `@/lib/supabase/server`, `@/lib/auth/guards`, `@/lib/spark/sparkLink`, `@/lib/spark/fetchAttemptReview` (follow the mocking style of `src/app/api/teacher/gradebook/attempt/__tests__/route.test.ts`); cover: 401 no user; 403 non-staff; 400 missing assignmentId; 404 unknown assignment; guard short-circuit (guardClassAccess returns a response BEFORE fetchAttemptReview is called — assert the mock was NOT called); 404 `spark_not_enabled` when no link; 404 `not_started` on SPARK not_found; 502 `spark_unreachable`; 200 happy path returns `review` + `segmentsByStep` keyed by step_index.

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const maybeSingle = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
  createAdminSupabaseClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  }),
}));
const guardClassAccess = vi.fn();
vi.mock('@/lib/auth/guards', () => ({ guardClassAccess: (...a: unknown[]) => guardClassAccess(...a) }));
const getSparkLink = vi.fn();
vi.mock('@/lib/spark/sparkLink', () => ({ getSparkLink: (...a: unknown[]) => getSparkLink(...a) }));
const fetchAttemptReview = vi.fn();
vi.mock('@/lib/spark/fetchAttemptReview', () => ({ fetchAttemptReview: (...a: unknown[]) => fetchAttemptReview(...a) }));

import { GET } from '../route';
import { NextRequest } from 'next/server';

const req = (qs: string) => new NextRequest(`http://x/api/teacher/challenges/attempt${qs}`);

// NOTE FOR IMPLEMENTER: the admin-client mock above is a sketch — mirror the
// REAL chained-call fake used in src/app/api/teacher/gradebook/attempt/__tests__/route.test.ts
// (or src/test/fakeSupabase.ts). This route needs a THREE-table fake (the gradebook
// fake has only two): users → { role: 'teacher' }, assignments → { id: 'a1',
// class_id: 'c1', student_id: 's1', spark_status: 'created' }, classes →
// { school_id: 'sch1' }. Two traps: (1) a bare shared maybeSingle resolving
// undefined makes every test throw on destructure — give each table its row;
// (2) the assignments fixture MUST set spark_status !== 'none' or the route's
// spark gate 404s every case and the IDOR test fails 404-vs-403 for the wrong
// reason. Keep the assertions below verbatim. ALSO COVER (same idioms):
//   - 404 when the assignment row has spark_status 'none'
//   - a step_index 9999 response lands in segmentsByStep['9999']

describe('GET /api/teacher/challenges/attempt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 when unauthenticated', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(req('?assignmentId=a1'))).status).toBe(401);
  });

  it('never calls SPARK when the class guard denies (IDOR)', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 't1' } }, error: null });
    // role=teacher, assignment found with class_id c1 (fake returns per-table)
    guardClassAccess.mockResolvedValue(new Response('denied', { status: 403 }));
    const res = await GET(req('?assignmentId=a1'));
    expect(res.status).toBe(403);
    expect(fetchAttemptReview).not.toHaveBeenCalled();
  });

  it('404 spark_not_enabled when the school has no enabled link', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 't1' } }, error: null });
    guardClassAccess.mockResolvedValue(null);
    getSparkLink.mockResolvedValue(null);
    const res = await GET(req('?assignmentId=a1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'spark_not_enabled' });
  });

  it('200 happy path: review + segmentsByStep', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 't1' } }, error: null });
    guardClassAccess.mockResolvedValue(null);
    getSparkLink.mockResolvedValue({ api_key: 'k', enabled: true });
    fetchAttemptReview.mockResolvedValue({ ok: true, review: {
      attempt: { state: 'completed', startedAt: null, completedAt: null, score: 80,
                 effortLabel: null, revisionCount: 0, teliHintCount: 0 },
      generationStatus: 'ready', steps: null,
      stepResponses: [{ step_index: 1, type: 'prediction', value: { text: 'hi', confidence: 50 }, completed: true }],
      analysis: null,
    }});
    const res = await GET(req('?assignmentId=a1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.responseIndexes).toEqual([1]);
    expect(body.segmentsByStep['1'][0]).toEqual({ kind: 'text', label: 'Prediction', text: 'hi' });
  });
});
```

- [ ] **Step 6: Run to verify it fails** — route module not found.

- [ ] **Step 7: Implement the route**

`src/app/api/teacher/challenges/attempt/route.ts`:

```ts
// GET ?assignmentId= — on-demand SPARK attempt review for the challenges
// page "Student's work" panel. Auth mirrors gradebook/attempt:
// getUser → STAFF_ROLES → guardClassAccess (IDOR; RLS is NOT the backstop) →
// only THEN call SPARK server-to-server (per-school api_key, fail-soft).
// Answers are pre-formatted server-side through formatStepResponse so the
// media guards cannot be bypassed by a client rendering raw values.
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { guardClassAccess } from '@/lib/auth/guards';
import { getSparkLink } from '@/lib/spark/sparkLink';
import { fetchAttemptReview } from '@/lib/spark/fetchAttemptReview';
import { formatStepResponse, type DisplaySegment } from '@/lib/spark/formatStepResponse';

export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const assignmentId = new URL(req.url).searchParams.get('assignmentId');
  if (!assignmentId) return NextResponse.json({ error: 'Missing assignmentId' }, { status: 400 });

  const admin = createAdminSupabaseClient();
  const { data: roleRow } = await admin.from('users').select('role').eq('id', user.id).maybeSingle();
  const role = (roleRow as { role?: string } | null)?.role;
  if (!role || !new Set<string>(STAFF_ROLES).has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: asg } = await admin.from('assignments')
    .select('id, class_id, student_id, spark_status').eq('id', assignmentId).maybeSingle();
  const assignment = asg as { id: string; class_id: string; student_id: string; spark_status: string | null } | null;
  if (!assignment || (assignment.spark_status ?? 'none') === 'none') {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }

  const guard = await guardClassAccess(assignment.class_id);
  if (guard) return guard;

  const { data: cls } = await admin.from('classes')
    .select('school_id').eq('id', assignment.class_id).maybeSingle();
  const schoolId = (cls as { school_id?: string } | null)?.school_id;
  if (!schoolId) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });

  const link = await getSparkLink(admin, schoolId);
  if (!link) return NextResponse.json({ error: 'spark_not_enabled' }, { status: 404 });

  const result = await fetchAttemptReview({
    apiKey: link.api_key,
    coreHomeworkId: assignment.id,
    coreStudentId: assignment.student_id,
  });
  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'not_started' }, { status: 404 });
    }
    return NextResponse.json({ error: 'spark_unreachable' }, { status: 502 });
  }

  const segmentsByStep: Record<number, DisplaySegment[]> = {};
  for (const r of result.review.stepResponses) {
    segmentsByStep[r.step_index] = formatStepResponse(r.type, r.value);
  }
  // The raw values never leave the server — the client renders segments only.
  const { stepResponses, ...rest } = result.review;
  const responseIndexes = stepResponses.map((r) => r.step_index);

  return NextResponse.json({ review: rest, responseIndexes, segmentsByStep });
}
```

**Interface note for Task 4 (LOCKED):** the route returns `{ review: { attempt, generationStatus, steps, analysis }, responseIndexes: number[], segmentsByStep: Record<number, DisplaySegment[]> }` — raw `stepResponses` values are deliberately NOT shipped to the browser.

- [ ] **Step 8: Run route tests** → PASS. Full `npx tsc --noEmit` → 0.

- [ ] **Step 9: Commit**

```bash
git add src/lib/spark/formatStepResponse.ts src/lib/spark/__tests__/formatStepResponse.test.ts src/app/api/teacher/challenges/attempt/
git commit -m "feat(spark-review): teacher attempt route + guarded answer formatter"
```

---

### Task 4 (CORE): StudentWorkPanel + ChallengeCard wiring

**Files:**
- Create: `src/app/(teacher)/challenges/_components/StudentWorkPanel.tsx`
- Modify: `src/app/(teacher)/challenges/_components/ChallengeCard.tsx`
- Test: `src/app/(teacher)/challenges/_components/__tests__/StudentWorkPanel.test.tsx`

**Interfaces:**
- Consumes: Task 3's route response shape (`review` + `responseIndexes` + `segmentsByStep`); `DisplaySegment` type.
- Produces: `<StudentWorkPanel assignmentId={string} />` — self-fetching client component; `ChallengeCard` renders a "View student's work" toggle for rows whose `status !== 'assigned'`.

- [ ] **Step 1: Write the failing component test**

`src/app/(teacher)/challenges/_components/__tests__/StudentWorkPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import StudentWorkPanel from '../StudentWorkPanel';

const OK_BODY = {
  review: {
    attempt: { state: 'completed', startedAt: null, completedAt: '2026-07-01T10:40:00Z',
               score: 80, effortLabel: 'effortful_success', revisionCount: 2, teliHintCount: 1 },
    generationStatus: 'ready',
    steps: [
      { order: 1, title: 'The Challenge', type: 'instruction', description: 'A boat scenario.' },
      { order: 2, title: 'Make a Prediction', type: 'prediction', description: 'What do you predict?' },
    ],
    analysis: { rubric_dimensions: { creativity: 4 }, dimension_observations: { creativity: 'inventive' },
                key_observations: ['kept revising'], content_quality: 'engaged' },
  },
  responseIndexes: [1],
  segmentsByStep: { 1: [
    { kind: 'text', label: 'Prediction', text: 'It floats' },
    { kind: 'image', label: 'Drawing', dataUrl: 'data:image/png;base64,AAAA' },
  ] },
};

describe('StudentWorkPanel', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('fetches on mount and renders steps, answers and observations', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(OK_BODY), { status: 200 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    // regex, not exact: the markup renders '2. Make a Prediction' as one text run
    await waitFor(() => expect(screen.getByText(/Make a Prediction/)).toBeInTheDocument());
    expect(screen.getByText('It floats')).toBeInTheDocument();
    expect(screen.getByText('kept revising')).toBeInTheDocument();
    const img = screen.getByRole('img', { name: /drawing/i });
    expect(img.getAttribute('src')).toMatch(/^data:image\//);
  });

  it('quiet friendly state ONLY for the not_started 404 body', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_started' }), { status: 404 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/don.t see this student.s work in SPARK yet/i)).toBeInTheDocument());
  });

  it('other 404s (spark_not_enabled) get the generic state, never the false not-started claim', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'spark_not_enabled' }), { status: 404 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/couldn.t reach SPARK right now/i)).toBeInTheDocument());
    expect(screen.queryByText(/don.t see this student.s work/i)).toBeNull();
  });

  it('labels the synthetic extension index 9999 and sorts it last', async () => {
    const body = structuredClone(OK_BODY);
    body.responseIndexes = [9999, 1];
    body.segmentsByStep['9999'] = [{ kind: 'text', label: 'Claim', text: 'extension claim' }];
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/Extension problem/)).toBeInTheDocument());
    expect(screen.queryByText(/Step 10000/)).toBeNull();
    const blocks = screen.getAllByText(/Extension problem|Make a Prediction/).map((n) => n.textContent);
    expect(blocks[blocks.length - 1]).toMatch(/Extension problem/); // extension renders after step answers
  });

  it('empty answers → quiet "No written answers yet."', async () => {
    const body = structuredClone(OK_BODY);
    body.responseIndexes = [];
    body.segmentsByStep = {};
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText('No written answers yet.')).toBeInTheDocument());
  });

  it('steps:null (pre-025 / failed generation) → answers render under "Step N" fallback labels', async () => {
    const body = structuredClone(OK_BODY);
    body.review.steps = null;
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/Step 2/)).toBeInTheDocument()); // idx 1 → 'Step 2'
    expect(screen.getByText('It floats')).toBeInTheDocument();
    expect(screen.queryByText(/challenge this student saw/i)).toBeNull();
  });

  it('fail-soft state when SPARK is unreachable (502)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: 'spark_unreachable' }), { status: 502 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText(/couldn.t reach SPARK right now/i)).toBeInTheDocument());
  });

  it('never renders an img for a non-data URL even if the API is compromised', async () => {
    const evil = structuredClone(OK_BODY);
    evil.segmentsByStep[1][1] = { kind: 'image', label: 'Drawing', dataUrl: 'https://evil.example/x.png' };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(evil), { status: 200 }));
    render(<StudentWorkPanel assignmentId="a1" />);
    await waitFor(() => expect(screen.getByText('It floats')).toBeInTheDocument());
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a loading state while fetching', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<StudentWorkPanel assignmentId="a1" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement the panel**

`src/app/(teacher)/challenges/_components/StudentWorkPanel.tsx` (token classes only; follow the Card/SectionLabel idioms of the sibling components; the belt-and-braces `data:image/` re-check at render is REQUIRED):

```tsx
'use client';
// Teacher-only read-only view of one student's SPARK attempt.
// Renders pre-formatted segments from /api/teacher/challenges/attempt —
// raw answer values never reach this component. Belt-and-braces: an image
// segment is still re-checked for a data:image/ prefix before <img>.
import { useEffect, useState } from 'react';
import type { DisplaySegment } from '@/lib/spark/formatStepResponse';

interface StepInfo { order: number; title: string; type: string; description: string }
interface PanelData {
  review: {
    attempt: { state: string; completedAt: string | null; score: number | null;
               effortLabel: string | null; revisionCount: number | null; teliHintCount: number | null };
    generationStatus: string | null;
    steps: StepInfo[] | null;
    analysis: { rubric_dimensions: Record<string, number | null> | null;
                dimension_observations: Record<string, string> | null;
                key_observations: string[]; content_quality: string | null } | null;
  };
  responseIndexes: number[];
  segmentsByStep: Record<string, DisplaySegment[]>;
}
type PanelState =
  | { phase: 'loading' } | { phase: 'not_started' } | { phase: 'unreachable' }
  | { phase: 'ready'; data: PanelData };

const DATA_IMAGE = /^data:image\//;
const EXTENSION_INDEX = 9999;

// Friendly rubric-dimension labels: EXPORT and reuse the existing label map in
// ChallengeCard.tsx (Problem / Reasoning / Evidence / Creativity / Communication /
// Reflection / Collaboration) — do NOT duplicate it and never show a snake_case key.
// rubricLabel(dim) falls back to the raw key only for unknown dimensions.

export default function StudentWorkPanel({ assignmentId }: { assignmentId: string }) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/teacher/challenges/attempt?assignmentId=${encodeURIComponent(assignmentId)}`);
        if (cancelled) return;
        if (res.status === 404) {
          // Disambiguate: only SPARK's "no attempt" maps to the quiet state.
          // Other 404s (spark_not_enabled, assignment lookup) get the generic one —
          // a scored row with a disabled link must NOT claim the student never started.
          const body = await res.json().catch(() => ({} as { error?: string }));
          setState(body?.error === 'not_started' ? { phase: 'not_started' } : { phase: 'unreachable' });
          return;
        }
        if (!res.ok) { setState({ phase: 'unreachable' }); return; }
        setState({ phase: 'ready', data: (await res.json()) as PanelData });
      } catch {
        if (!cancelled) setState({ phase: 'unreachable' });
      }
    })();
    return () => { cancelled = true; };
  }, [assignmentId]);

  if (state.phase === 'loading') {
    return <p className="text-sm text-fg-muted py-2" role="status">Loading student’s work…</p>;
  }
  if (state.phase === 'not_started') {
    // Non-asserting observation: this path usually indicates a SPARK-side data
    // gap (the row only exists because a completion arrived), not student inaction.
    return <p className="text-sm text-fg py-2">We don’t see this student’s work in SPARK yet.</p>;
  }
  if (state.phase === 'unreachable') {
    return <p className="text-sm text-fg py-2">We couldn’t reach SPARK right now — the work is safe there; try again in a moment.</p>;
  }

  const { review, responseIndexes, segmentsByStep } = state.data;
  const steps = review.steps ?? [];
  const answered = new Set(responseIndexes);

  const stepLabel = (idx: number): StepInfo | null =>
    idx === EXTENSION_INDEX ? { order: 0, title: 'Extension problem', type: 'claim_evidence', description: '' }
      : steps[idx] ?? null;

  return (
    <div className="mt-2 border-t border-sidebar-edge pt-3 space-y-4" data-testid="student-work-panel">
      {steps.length > 0 && (
        <details>
          <summary className="text-sm font-semibold text-fg cursor-pointer">The challenge this student saw</summary>
          <div className="mt-2 space-y-2">
            {steps.map((s) => (
              <div key={s.order}>
                <p className="text-xs font-semibold text-fg">{s.order}. {s.title}</p>
                <p className="text-sm text-fg whitespace-pre-wrap">{s.description}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="space-y-3">
        <p className="text-sm font-semibold text-fg">Student’s answers</p>
        {responseIndexes.filter((i) => (segmentsByStep[String(i)] ?? []).length > 0).length === 0 ? (
          <p className="text-sm text-fg">No written answers yet.</p>
        ) : (
          [...responseIndexes].sort((a, b) => a - b).map((idx) => {
            const segs = segmentsByStep[String(idx)] ?? [];
            if (segs.length === 0) return null;
            const info = stepLabel(idx);
            return (
              <div key={idx} className="rounded border border-sidebar-edge p-2">
                <p className="text-xs font-semibold text-fg">
                  {info ? (idx === EXTENSION_INDEX ? info.title : `${info.order}. ${info.title}`) : `Step ${idx + 1}`}
                </p>
                {segs.map((seg, i) =>
                  seg.kind === 'image' && DATA_IMAGE.test(seg.dataUrl) ? (
                    <img key={i} src={seg.dataUrl} alt={`Student’s ${seg.label.toLowerCase()}`}
                         className="mt-1 max-h-64 rounded border border-sidebar-edge" />
                  ) : seg.kind === 'text' ? (
                    <p key={i} className="text-sm text-fg mt-1">
                      <span className="font-medium">{seg.label}: </span>
                      <span className="whitespace-pre-wrap">{seg.text}</span>
                    </p>
                  ) : null,
                )}
              </div>
            );
          })
        )}
      </div>

      {review.analysis && (
        <div className="space-y-1">
          {/* key_observations were authored FOR the student (they saw the first
              one as "Teli says" — second-person redirects possible), so the
              heading is voice-transparent. Barb gates the wording. */}
          <p className="text-sm font-semibold text-fg">What the AI shared with the student</p>
          {review.analysis.key_observations.map((o, i) => (
            <p key={i} className="text-sm text-fg">{o}</p>
          ))}
          {review.analysis.dimension_observations &&
            Object.entries(review.analysis.dimension_observations).map(([dim, obs]) => (
              <p key={dim} className="text-sm text-fg">
                <span className="font-medium">{rubricLabel(dim)}: </span>{obs}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire into `ChallengeCard.tsx`**

Add a local `open` state and a toggle button rendered for `row.status !== 'assigned'`, below the existing detail line (match existing button idioms/tokens in the file):

```tsx
const [showWork, setShowWork] = useState(false);
// …inside the card, after the existing content:
{row.status !== 'assigned' && (
  <>
    <button
      type="button"
      onClick={() => setShowWork((v) => !v)}
      aria-expanded={showWork}
      className="mt-1 text-xs font-semibold text-brand hover:underline"
    >
      {showWork ? 'Hide student’s work' : 'View student’s work'}
    </button>
    {showWork && <StudentWorkPanel assignmentId={row.assignmentId} />}
  </>
)}
```

(`useState` is already imported or add it; import `StudentWorkPanel` from `./StudentWorkPanel`.)

- [ ] **Step 4b: Pin the wiring with a ChallengeCard test** (extend the existing `ChallengeCard` test file, same idioms): render a completed row → the "View student’s work" button exists; render an `assigned` row → it does not; stub `fetch`, click the toggle → assert `fetch` was called with a URL containing `assignmentId=<row.assignmentId>` (this pins both the status gate AND the prop wiring — `assignmentId={row.studentId}` is the one-keystroke bug that would ship every student as "not started").

- [ ] **Step 5: Run tests** — `npx vitest run "src/app/(teacher)/challenges"` (quoted — the route-group parentheses are shell syntax) → all green (new panel tests + the wiring test + the existing `ChallengeCard`/`ChallengesList` suites, which must stay green). `npx tsc --noEmit` → 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/(teacher)/challenges/_components/StudentWorkPanel.tsx src/app/(teacher)/challenges/_components/__tests__/StudentWorkPanel.test.tsx src/app/(teacher)/challenges/_components/ChallengeCard.tsx
git commit -m "feat(spark-review): Student's-work panel in the challenges drill-in"
```

---

### Task 5 (CORE): Barb strings + gates

**Files:**
- Modify: `STRINGS-FOR-BARB.md` (append section)
- Verify: full gates

- [ ] **Step 1: Append to `STRINGS-FOR-BARB.md`** (and reconcile the stale note: the existing §Spark Challenges line `(NOTE: "Open in SPARK" deferred — needs a net-new SPARK-side teacher-review build.)` becomes `(superseded — student work is now reviewed inside CORE; see §Student's work panel below.)`)

```markdown
## Student's work panel (challenges drill-in — the "Open in SPARK" item, now rendered in CORE) — 2026-07-01

Teacher-only panel. Coach posture: observational; no raw-stat dumps beyond what the row already shows.

| Where | Draft string |
|---|---|
| Toggle (closed) | View student’s work |
| Toggle (open) | Hide student’s work |
| Loading | Loading student’s work… |
| No work in SPARK (quiet state) | We don’t see this student’s work in SPARK yet. |
| SPARK unreachable / generic failure | We couldn’t reach SPARK right now — the work is safe there; try again in a moment. |
| Challenge context summary | The challenge this student saw |
| Answers heading | Student’s answers |
| No answers | No written answers yet. |
| AI section heading | What the AI shared with the student |
| Extension answer label | Extension problem |
| Unlabeled-step fallback | Step {n} |
| Drawing alt text | Student’s drawing |
| Drawing failed guard | (drawing could not be displayed) |
| Unrecognized answer | (unrecognized answer format) |

**Per-answer labels emitted by the formatter** (each renders as `Label: <student's words>`):
Prediction · Confidence (format: `{n} / 100`) · Observation · Chose · Why · Claim · Evidence · Reasoning · Side A · Side B · Synthesis · Sensor data · Code ({language}) · Answer. `data_entry` answers render the student's own field keys verbatim as labels. Rubric-dimension observations are prefixed with the SAME friendly dimension labels already gated in §Spark Challenges (Problem / Reasoning / Evidence / Creativity / Communication / Reflection / Collaboration).

**Voice context for Barb:** `key_observations` under "What the AI shared with the student" are SPARK-authored prose written TO the student (students saw the first one as "Teli says"; second-person redirects like "Ready for another try — …" occur on minimal-effort work). Dimension observations are one-liners never previously surfaced anywhere. Barb picks the framing with that context.

**Reteach-verbatim flag (Barb/Marvin call):** on attempts projected without a mastery band (older rows), SPARK-authored step text and the student's tier answer can contain the word "Reteach" verbatim (e.g. `Chose: Reteach`). [[v2-reteach-is-reinforce]] binds CORE-authored teacher copy, but this is quoted student-seen content — shipped verbatim for fidelity pending Barb/Marvin's decision on display-mapping.

NOTE (binding): no string may imply Teli conversation content is viewable — transcripts are never stored (student privacy promise); only the hint count exists.
```

- [ ] **Step 2: Full gates**

Run: `npm test` → all green; `npx tsc --noEmit` → 0; `npm run build` → content gates pass (a11y + tokens; the Google-Fonts network fetch failure is pre-existing env-only).

- [ ] **Step 3: Commit**

```bash
git add STRINGS-FOR-BARB.md
git commit -m "docs(spark-review): Barb strings for the Student's-work panel"
```

---

## Pre-code adversarial review — FOLDED (2026-07-01)

5-lens Workflow review (security / correctness / conventions / four-audience+copy / test-quality): 7 unique IMPORTANT + 10 MINOR, 0 refuted — ALL folded above. Highlights: session-school belt-and-braces re-verification restored in the SPARK handler (roster-churn rebind, mirrors `get_attempt_result`); Task 1 fixture corrected to the real `SparkChallengeContent` types (string[] tiers, `collaborative` key, SPARK's `on_level` band vocab); SPARK drift-lock tests added (school predicate + session check + zero-writes, house `readFileSync` pattern); `border-border` → house `border-sidebar-edge`; 404 disambiguation (`not_started` body only → quiet state); value-level `mapAnalysis` filtering; extension-9999 + quiet-state + ChallengeCard-wiring tests; full formatter label vocabulary + voice context + Reteach-verbatim flag routed to Barb; stale "deferred" note reconciled.

## Self-review notes

- Spec coverage: D1 (Task 1 SPARK action + Tasks 2–3 server-to-server), D2 (steps + answers + rubric observations + counts — Tasks 1/3/4), D3 (challenges drill-in only — Task 4). Constraints: snapshot excluded (Task 1 test), Teli count-only (no transcript strings — Task 5 note), media guards double-enforced (Task 3 formatter + Task 4 render re-check), guard-before-SPARK (Task 3 test), fail-soft (Tasks 2/4), no migration.
- Types consistent: `DisplaySegment` defined once (Task 3), imported by Task 4; wire shape locked in Task 1 and consumed by Task 2's mapper; route response shape locked in Task 3 and consumed by Task 4.
- Deploy order: Task 1 merges/deploys to SPARK `master` FIRST (additive); CORE branch merges after.
