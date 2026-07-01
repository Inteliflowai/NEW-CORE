# One-Student Screen — Current-Code Grounding
**Mined:** 2026-06-19  
**Source branch:** main  
**Purpose:** Precise TypeScript types, field names, function signatures, and file:line references for the One-Student implementation plan.

---

## 1. Per-Student Signals API

**File:** `src/app/api/teacher/student/[studentId]/signals/route.ts`

### Full JSON Response Shape

The final `return NextResponse.json(...)` at **line 243** returns:

```ts
{
  student_id: string,                     // line 244 — from params

  // ── Mastery ──────────────────────────────────────────────────────────────────
  current_band: string | null,            // line 245 — result of currentMasteryBand(quizAttempts)

  // ── Per-skill CL ────────────────────────────────────────────────────────────
  per_skill_cl: Array<{
    skill_id:         string | null,      // line 101
    skill_name:       string,             // line 102  ("Unknown" if missing)
    state:            SkillLearningState, // line 103  (DB enum: needs_different_instruction | needs_more_time | on_track | ready_to_extend | insufficient_data | not_attempted)
    cl_verb:          'Reinforce' | 'On Track' | 'Enrich' | null,  // line 104
    cl_display:       string,             // line 105  (cl_verb ?? 'Not yet assessed')
    confidence_label: 'consistent' | 'tentative' | 'emerging' | 'unknown',  // line 107 — SOFT WORD ONLY; raw confidence number is NOT in the response
  }>,

  // ── Misconceptions ──────────────────────────────────────────────────────────
  recurring_misconceptions: Array<{
    skill_id:        string,              // line 124
    recurring_error: { type: string; count: number } | null,  // line 125 — from findRecurringError()
  }>,

  // ── Divergence (spread — all DivergenceResult fields plus divergence_flagged) ─
  divergence: {
    divergence_score:     number,         // line 249 — via ...divergence (DivergenceResult)
    divergence_direction: 'hw_higher' | 'quiz_higher' | 'aligned',  // same spread
    divergence_trend:     'widening' | 'narrowing' | 'stable' | null,  // same spread
    hw_avg:               number | null,  // same spread — raw rounded integer (e.g. 73); LEAKS raw number
    quiz_avg:             number | null,  // same spread — raw rounded integer (e.g. 58); LEAKS raw number
    divergence_flagged:   boolean,        // line 251 — added explicitly; true when divergence_score >= 20
  },

  // ── Effort ──────────────────────────────────────────────────────────────────
  effort: {
    dominant_effort_pattern: 'low' | 'medium' | 'high' | 'inconsistent' | null,  // line 253
  },

  // ── Risk ────────────────────────────────────────────────────────────────────
  risk: {
    roster: {
      risk_score:   number,              // line 255 — RiskResult; raw 0–100 integer; LEAKS raw number
      risk_level:   'low' | 'medium' | 'high' | 'critical',  // same
      risk_factors: string[],            // same — strings MAY embed raw numbers (e.g. "Low average quiz score (48%)")
    },
    session: {
      score:   number,                   // line 256 — SessionRiskResult; 0–1 float; LEAKS raw number
      factors: string[],                 // same
    },
  },

  // ── Reteach outcomes ────────────────────────────────────────────────────────
  reteach_outcomes: Array<{             // line 257 — ReteachCycleRecord[]
    student_id:            string,
    assignment_id:         string,
    original_attempt_id:   string,
    redo_attempt_id:       string,
    pre_score:             number,       // LEAKS raw score
    post_score:            number,       // LEAKS raw score
    improvement:           number,       // post - pre; can be negative; LEAKS raw number
    flagged_by:            'auto' | 'teacher',
    completed_at:          string,       // ISO timestamp
  }>,

  // ── Trajectory + consistency ─────────────────────────────────────────────────
  trajectory: {                         // line 258 — ...consistency spread THEN ...trajectoryResult spread
    consistency_score: number | null,   // from ConsistencyResult; raw 0–100; LEAKS raw number
    consistency_label: 'consistent' | 'variable' | 'erratic' | null,
    trajectory:        'improving' | 'stable' | 'worsening',  // from TrajectoryResult
  },

  // ── Growth history ───────────────────────────────────────────────────────────
  growth_history: number[],            // line 263 — snapshotScores array INCLUDED in response
                                        // oldest→newest avg_score values from student_model_snapshots
                                        // (up to 8 snapshots; filter removes nulls)
}
```

### Critical: growth_history fate

Lines 233–235 compute `snapshotScores`:
```ts
const snapshotScores = (snapshots ?? [])
  .map((s: { avg_score: number | null }) => s.avg_score)
  .filter((s): s is number => s != null);
```

Line 263 places it in the response:
```ts
growth_history: snapshotScores,
```

**growth_history DOES reach the response.** It is an array of raw `avg_score` numbers (0–100 floats). This is used by GrowthMotif which normalises to its own max for display — the raw numbers are passed through the API payload.

### Confidence soft-label logic (lines 36–41)

```ts
function confidenceSoftLabel(confidence: number | null): string {
  if (confidence == null) return 'unknown';
  if (confidence >= 70) return 'consistent';
  if (confidence >= 40) return 'tentative';
  return 'emerging';
}
```

The raw numeric `confidence` (0–100) from `skill_learning_state.confidence` is consumed internally and converted to a soft word. **The raw number never reaches the JSON response.**

---

## 2. Auth Chain

### Signals route auth (lines 47–70, `src/app/api/teacher/student/[studentId]/signals/route.ts`)

```
1. await createServerSupabaseClient()           → line 48
2. supabase.auth.getUser()                      → line 49; 401 if null
3. users.select('role').eq('id', user.id)       → lines 56–60; 403 unless STAFF_ROLES
   STAFF_ROLES = { teacher, school_admin, school_sysadmin, platform_admin }
4. await guardStudentAccess(studentId)          → line 69; 403 on IDOR
5. createAdminSupabaseClient()                  → line 72 (synchronous; bypasses RLS)
```

### `guardStudentAccess` — exists and is fully implemented

**File:** `src/lib/auth/guards.ts`, **lines 86–106**

Full signature:
```ts
export async function guardStudentAccess(studentId: string): Promise<NextResponse | null>
```

Logic:
- `caller.id === studentId` → null (student self-access)
- `caller.role === 'platform_admin'` → null
- School admin with matching school_id → null
- `caller.role === 'parent'` with `stu.parent_id === caller.id` → null
- `caller.role === 'teacher'` → checks enrollments: teacher's class_ids ∩ student's enrollments; null if found
- Otherwise → FORBID (403)

Uses `createAdminSupabaseClient()` internally for the users/classes/enrollments lookups.

### Roster page auth pattern (for comparison)

**File:** `src/app/(teacher)/roster/page.tsx`, lines 66–69:
```ts
const guard = await guardClassAccess(classId);
if (guard) {
  return <div className="p-6">{PICK_A_CLASS}</div>;
}
```

Note: roster page returns JSX on auth failure (cannot return NextResponse from page component). The `/students/[studentId]` API route correctly returns NextResponse short-circuits.

### How the new `/students/[studentId]` page should auth

The page is a **Server Component**. It cannot return a NextResponse. Pattern:
```
1. await createServerSupabaseClient() → auth.getUser() → redirect('/login') if null
2. users.select('role') → check STAFF_ROLES → redirect('/login') if not staff
3. await guardStudentAccess(studentId) → guardStudentAccess returns NextResponse | null
   BUT in a page component, if guard !== null → redirect (not return guard)
4. createAdminSupabaseClient() for data fetching
```

The `/api/teacher/student/[studentId]/signals/route.ts` is the data source — the page should call it client-side, or replicate the server-side fetch directly with the admin client after running the same guard pattern.

---

## 3. Student Identity

### Signals payload — does NOT include student name/grade/period

The response from `GET /api/teacher/student/[studentId]/signals` contains only:
- `student_id` (string)

There is **no `full_name`, `grade_level`, `period`, or `class` in the signals payload.**

### Where to fetch student identity

**Table:** `public.users` — **migration:** `supabase/migrations/0001_identity_roles.sql` lines 40–60

Relevant columns:
```sql
id           uuid        PRIMARY KEY REFERENCES auth.users(id),
school_id    uuid        REFERENCES public.schools(id),
role         text        NOT NULL,
full_name    text        NOT NULL,    -- ← student display name
email        text        NOT NULL,
display_name text,                   -- ← optional nickname
grade_level  text,                   -- ← e.g. "6", "7", "8" (student's grade)
is_active    boolean,
```

Note: `grade_levels` (plural, line 48) is on the **teacher** row (subjects they teach). `grade_level` (singular, line 51) is the student's own grade.

**Period** is not a column on `users`. Period is stored in the `enrollments` table (migration `0002_classes_enrollments.sql`).

### Fetch pattern for identity in a Server Component

```ts
const admin = createAdminSupabaseClient();
const { data: student } = await admin
  .from('users')
  .select('id, full_name, display_name, grade_level')
  .eq('id', studentId)
  .single();
```

The signals route itself does not query `users` for the student (it queries `users` only for the **caller's** role at lines 56–60). No existing Supabase query for student identity has been written in the teacher signals path.

---

## 4. Components

All components live in `src/components/core/`.

### CLBadge — `src/components/core/CLBadge.tsx`

```ts
export interface CLBadgeProps {
  /** The skill learning state from the DB enum. */
  state: SkillLearningState;
  /**
   * Confidence score (0–100). Rendered as a soft word only — the raw number
   * NEVER appears in the DOM. Pass null or omit to suppress confidence display.
   */
  confidence?: number | null;
  /**
   * Pre-computed confidence word. When provided, bypasses the numeric confidence
   * path entirely. Pass null to suppress confidence display.
   */
  confidenceWord?: ConfidenceWord | null;
}

export type ConfidenceWord = 'consistent' | 'tentative' | 'emerging';
```

**Key facts:**
- Accepts BOTH a numeric `confidence` (converts internally via `toConfidenceWord`) AND a pre-computed `confidenceWord` string
- The signals API returns `confidence_label` (already a soft word string); pass as `confidenceWord` prop to skip numeric path
- Verbs rendered: `'Reinforce'` | `'On Track'` | `'Enrich'` | `'Not yet assessed'` (null verb)
- Color tokens: Reinforce → `bg-warn-surface text-warn-fg`; On Track → `bg-ok-surface text-ok-fg`; Enrich → `bg-brand-surface text-brand-fg`; Not yet assessed → `bg-surface text-fg-muted ring-1 ring-inset ring-fg-muted`
- TEACHER-SURFACE ONLY — comment at line 4 is explicit

### GrowthMotif — `src/components/core/GrowthMotif.tsx`

```ts
interface GrowthMotifProps {
  /** Ordered history of scores (oldest first). Must have ≥4 points to render bars. */
  history?: number[];
  /** Alias for history — accepted from the signals API response shape. */
  growth_history?: number[];
  /** Optional copy shown below the bars (e.g. "+18 pts vs 4 weeks ago"). */
  deltaLabel?: string;
  /** When 'ok', rebinds --brand/--brand-accent to --ok (wins/positive accent). */
  accent?: 'brand' | 'ok';
}

const COLD_START_THRESHOLD = 4;  // line 19 — fewer than 4 points → cold start state
```

**Key facts:**
- Accepts `growth_history` directly (aliased from API response); resolves as `growth_history ?? history ?? []`
- Cold-start: `series.length < 4` → renders `<div class="growth-motif--cold-start">` with "just getting started" text — never a fake trend
- No `intensity` prop — inherited from nearest `[data-intensity]` ancestor via CSS token rebinding
- `accent='ok'` → applies `.growth-motif--wins` class which rebinds `--brand` to `--ok`

### RiskBadge — `src/components/core/RiskBadge.tsx`

```ts
export interface RiskBadgeProps {
  score?: number;
  scale?: '0to1' | '0to100';
  band?: RiskBand;
}
// RiskBand = 'low' | 'medium' | 'high' | 'critical'  (from src/lib/copy/riskBandLabel.ts)
```

**Key facts:**
- Accepts pre-computed `band?: RiskBand` directly (bypasses score→band conversion)
- `band` prop takes priority: `props.band ?? riskBandLabel(props.score ?? 0, props.scale)`
- Session risk `score` is 0–1; use `scale='0to1'`
- Roster risk `risk_level` is already a `RiskBand` string — pass as `band` prop directly
- TEACHER/ADMIN-ONLY — comment at line 4

### MathText — `src/components/core/MathText.tsx`

```ts
export interface MathTextProps {
  children: string;
}
```

Renders inline `$…$` and block `$$…$$` KaTeX math. Degrades gracefully on parse error (shows raw text). Used for quiz question rendering.

### MasteryLabel — `src/components/core/MasteryLabel.tsx`

```ts
interface MasteryLabelProps {
  /** Raw DB mastery_band enum value, or null for "not yet assessed". */
  band: string | null;
}
```

Maps via `masteryDisplayLabel()` from `@/lib/utils/masteryLabel`:
- `'reteach'` → `'Building'`
- `'grade_level'` → `'On Track'`
- `'advanced'` → `'Strong'`
- `null` → `'Not yet assessed'`

Uniform neutral pill for all bands (`bg-surface text-fg border border-fg-muted`). Safe for all surfaces including student/parent (no data-band in DOM).

### EmptyState — `src/components/core/EmptyState.tsx`

```ts
export type EmptyStateVariant =
  | 'not-yet-assessed'
  | 'just-getting-started'
  | 'on-track';

interface EmptyStateProps {
  variant: EmptyStateVariant;
  className?: string;
  titleOverride?: string;
  bodyOverride?: string;
}
```

Default copy per variant:
- `'not-yet-assessed'`: icon `○`, heading "Not yet assessed", body "Data will appear once practice is complete."
- `'just-getting-started'`: icon `◇`, heading "Just getting started", body "Keep going — more practice builds a clearer picture."
- `'on-track'`: icon `◆`, heading "You're on track", body "Things look good here. Keep going."

### Card / StatCard — `src/components/core/Card.tsx`

```ts
interface CardProps {
  children: ReactNode;
  className?: string;
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  className?: string;
}
```

- `Card`: `bg-surface rounded shadow p-5`
- `StatCard`: label is `text-fg-muted text-xs font-medium uppercase tracking-wide`; value is `text-fg text-2xl font-display font-bold leading-tight`
- No intensity prop — inherited from `[data-intensity]` ancestor

---

## 5. Copy Helpers

**Directory:** `src/lib/copy/`

### Helpers that exist and are relevant to One Student

| File | Signature | Use on One Student |
|---|---|---|
| `effortPhrase.ts` | `effortPhrase(label: EffortLabel \| null \| string): string` | Convert `effort.dominant_effort_pattern` to teacher sentence |
| `riskBandLabel.ts` | `riskBandLabel(score: number, scale?: '0to1' \| '0to100'): RiskBand` | Convert numeric risk score to band; also used by RiskBadge internally |
| `pctIncorrectToWords.ts` | `pctIncorrectToWords(value: number): string` | Suppress raw % from any stat surface |
| `reteachWorkingPhrase.ts` | `reteachWorkingPhrase(outcome: string \| null): string` | Convert reteach cycle outcome to "working / keep going" copy |
| `diagnosisToFeedSentence.ts` | `diagnosisToFeedSentence(d: DiagnosisInput): string` | `DiagnosisInput = { suggestedAction: SuggestedAction; severity: 1\|2\|3 }` — sentence for a diagnosis action |
| `actionChipLabel.ts` | `actionChipLabel(action: SuggestedAction): ActionChip` | `ActionChip = { label: string; tone: ChipTone }` — chip label for roster/focus actions |
| `riskFactorPhrase.ts` | `riskFactorPhrase(factor: string): string` | Strips raw numbers from risk_factors strings before rendering |
| `narrativeRank.ts` | `narrativeRank(s: { severity: number; recencyDays?: number; action?: string }): number` | Sort signals for narrative feed |
| `triageWhySentence.ts` | `triageWhySentence(d: TriageWhyInput): string` — TEACHER ONLY (contains raw numbers by design) | Explains divergence in plain language with scores |
| `topicFrame.ts` | `topicFrame(topic: string): string` | Student/parent surface only — frames topic as "still building: X" |
| `leakGuard.ts` | `hasLeak(text: string): boolean` / `assertNoLeak(text: string, ctx?: string): void` | Leak detection gate for all audience-safe copy |

`EffortLabel = 'low' | 'medium' | 'high' | 'inconsistent'`
`SuggestedAction = 'reteach' | 'practice' | 'verbal_check' | 'profile' | 'monitor'`
`ChipTone = 'risk' | 'warn' | 'brand'`

### Copy helpers that do NOT exist yet (One-Student scope)

These will need to be created for the One-Student screen:

- **`trajectoryPhrase(trajectory: TrajectoryDirection): string`** — teacher-safe sentence for 'improving' | 'stable' | 'worsening'
- **`consistencyPhrase(label: ConsistencyLabel | null): string`** — teacher-safe sentence for 'consistent' | 'variable' | 'erratic' | null
- **`divergencePhrase(divergence: DivergenceResult & { divergence_flagged: boolean }): string`** — teacher-safe summary for divergence block (without raw numbers; different from `triageWhySentence` which is number-bearing)
- **`misconceptionPhrase(recurringError: { type: string; count: number }): string`** — teacher-safe sentence for a recurring error pattern
- **`storyLine(signals: SignalBundle): string`** — top-of-page narrative sentence summarising the student's overall picture
- **`sessionRiskPhrase(sessionRisk: SessionRiskResult): string`** — if session risk needs text narration beyond band

---

## 6. Leak Discipline — Raw Numbers in the Signals Payload

The following raw numeric values reach the JSON response from `GET /api/teacher/student/[studentId]/signals`. The One-Student teacher screen must handle each according to the rendering rules below.

| Field path | Type | Value range | Rendering rule on One-Student teacher screen |
|---|---|---|---|
| `divergence.divergence_score` | `number` | 0–100 | May show as number in teacher context (spec allows); or render via `riskBandLabel` / descriptive copy |
| `divergence.hw_avg` | `number \| null` | 0–100 integer | Teacher surface — numbers allowed where design explicitly shows them (e.g. triageWhySentence) |
| `divergence.quiz_avg` | `number \| null` | 0–100 integer | Same as hw_avg |
| `risk.roster.risk_score` | `number` | 0–100 integer | NEVER render raw — use `RiskBadge` with `band` from `risk.roster.risk_level` |
| `risk.roster.risk_level` | `RiskBand` | low/medium/high/critical | Pass to `RiskBadge` as `band` prop |
| `risk.roster.risk_factors[]` | `string[]` | may embed raw % | Always pipe through `riskFactorPhrase()` before rendering |
| `risk.session.score` | `number` | 0–1 float | NEVER render raw — convert via `riskBandLabel(score, '0to1')` or `RiskBadge` |
| `reteach_outcomes[].pre_score` | `number` | 0–100 | Teacher surface — allowed as numbers OR pass through `pctIncorrectToWords()` |
| `reteach_outcomes[].post_score` | `number` | 0–100 | Same as pre_score |
| `reteach_outcomes[].improvement` | `number` | −100–100 | Teacher surface — may show as delta ("+12 pts") or suppress |
| `trajectory.consistency_score` | `number \| null` | 0–100 integer | NEVER render raw — use `consistency_label` string only |
| `growth_history[]` | `number[]` | 0–100 floats | Pass to `GrowthMotif` as `growth_history` prop — component normalises to its own max; never render numbers verbatim |

**What is already clean in the payload (no raw numbers):**
- `current_band` — string enum
- `per_skill_cl[].cl_display` — string verb
- `per_skill_cl[].confidence_label` — soft word
- `effort.dominant_effort_pattern` — label string
- `risk.roster.risk_level` — band string
- `trajectory.consistency_label` — label string
- `trajectory.trajectory` — direction string
- `divergence.divergence_direction` — direction string
- `divergence.divergence_trend` — trend string
- `divergence.divergence_flagged` — boolean

---

## 7. Tailwind Token Classes

**File:** `src/app/globals.css`

### Tier-2 semantic slots (light/teacher baseline, lines 104–126)

```css
--bg:           var(--ink-50);        /* page background */
--surface:      #ffffff;              /* card/panel backgrounds */
--fg:           var(--ink-900);       /* content text (deep-ink rule: use text-fg) */
--fg-muted:     var(--ink-600);       /* secondary/helper text */
--brand:        var(--cobalt-600);    /* teacher primary brand */
--brand-accent: var(--cobalt-400);
--fg-on-brand:  var(--white);
--ok:           var(--emerald-600);   /* positive signal */
--warn:         var(--amber-500);     /* caution signal */
--risk:         var(--coral-500);     /* risk/danger signal */
--ok-surface:   var(--emerald-50);    /* tinted bg for ok pill */
--ok-fg:        var(--emerald-800);   /* text on ok-surface */
--warn-surface: var(--amber-50);
--warn-fg:      var(--amber-900);
--risk-surface: var(--coral-50);
--risk-fg:      var(--coral-900);
--brand-surface:var(--cobalt-50);
--brand-fg:     var(--cobalt-800);
```

### Tailwind v4 utility classes (from `@theme inline`, lines 259–291)

| Class | CSS var |
|---|---|
| `bg-bg` | `--bg` |
| `bg-surface` | `--surface` |
| `text-fg` | `--fg` |
| `text-fg-muted` | `--fg-muted` |
| `bg-brand` / `text-brand` | `--brand` |
| `bg-ok-surface` / `text-ok-fg` | ok pair |
| `bg-warn-surface` / `text-warn-fg` | warn pair |
| `bg-risk-surface` / `text-risk-fg` | risk pair |
| `bg-brand-surface` / `text-brand-fg` | brand pair |
| `text-ok` | `--ok` |
| `text-warn` | `--warn` |
| `text-risk` | `--risk` |
| `rounded` | `--radius` (0.5rem teacher calm) |
| `rounded-lg` | `--radius-lg` (0.875rem teacher calm) |
| `shadow` | `--shadow` |
| `shadow-pop` | `--shadow-pop` |

### Teacher role binding (lines 155–174)

```css
[data-role="teacher"] {
  --brand: var(--cobalt-600);
  /* ... cobalt palette ... */
}
[data-role="teacher"][data-intensity="calm"] {
  --radius: 0.5rem;
  --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.08);
}
```

### WCAG-AA contrast gate

`scripts/a11y/contrast-check.ts` runs as `npm run a11y` (called by `npm run prebuild`). Every color pair used in components is gate-checked. The `VERB_STYLES` in CLBadge and `BAND_STYLES` in RiskBadge use only these verified token pairs. **Never add a hardcoded hex or arbitrary `[var(--...)]` in a component.**

---

## 8. Student Page Placeholder

**File:** `src/app/(teacher)/students/[studentId]/page.tsx`

Current content (18 lines — placeholder only):

```tsx
import { EmptyState } from '@/components/core/EmptyState';

export default async function StudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;

  return (
    <div className="p-6">
      <h1 className="text-fg font-display text-2xl font-semibold mb-6">
        Student {studentId}
      </h1>
      <EmptyState variant="just-getting-started" />
    </div>
  );
}
```

**Auth status:** There is **no auth chain** in the placeholder. The route group `(teacher)` layout is expected to handle auth (gating to teacher roles), but the page itself has no `guardStudentAccess` call. The full implementation must add the guard.

**The page renders `studentId` directly** as a heading (`Student {studentId}`) — this is a placeholder artefact. The real implementation must fetch `full_name` from `users`.

---

## Appendix: Key Type Definitions

### `SkillLearningState` (`src/lib/skills/clVerbs.ts`)
```ts
type SkillLearningState =
  | 'needs_different_instruction'
  | 'needs_more_time'
  | 'on_track'
  | 'ready_to_extend'
  | 'insufficient_data'
  | 'not_attempted';
```

### `CL_VERB_BY_STATE` (`src/lib/skills/clVerbs.ts`)
```ts
const CL_VERB_BY_STATE: Record<SkillLearningState, 'Reinforce' | 'On Track' | 'Enrich' | null> = {
  needs_different_instruction: 'Reinforce',
  needs_more_time:             'Reinforce',
  on_track:                    'On Track',
  ready_to_extend:             'Enrich',
  insufficient_data:           null,
  not_attempted:               null,
};
```

### `DivergenceResult` (`src/lib/signals/computeHwQuizDivergence.ts`)
```ts
interface DivergenceResult {
  divergence_score:     number;
  divergence_direction: 'hw_higher' | 'quiz_higher' | 'aligned';
  divergence_trend:     'widening' | 'narrowing' | 'stable' | null;
  hw_avg:               number | null;
  quiz_avg:             number | null;
}
```

### `RiskResult` (`src/lib/signals/computeRosterRiskIndex.ts`)
```ts
interface RiskResult {
  risk_score:   number;
  risk_level:   'low' | 'medium' | 'high' | 'critical';
  risk_factors: string[];
}
```

### `SessionRiskResult` (`src/lib/signals/computeSessionRisk.ts`)
```ts
interface SessionRiskResult {
  score:   number;   // [0,1]
  factors: string[];
}
```

### `ReteachCycleRecord` (`src/lib/signals/computeReteachEffectiveness.ts`)
```ts
interface ReteachCycleRecord {
  student_id:            string;
  assignment_id:         string;
  original_attempt_id:   string;
  redo_attempt_id:       string;
  pre_score:             number;
  post_score:            number;
  improvement:           number;
  flagged_by:            'auto' | 'teacher';
  completed_at:          string;
}
```

### `ConsistencyResult` + `TrajectoryResult` (`src/lib/signals/consistency.ts`)
```ts
interface ConsistencyResult {
  consistency_score: number | null;
  consistency_label: 'consistent' | 'variable' | 'erratic' | null;
}
interface TrajectoryResult {
  trajectory: 'improving' | 'stable' | 'worsening';
}
```
