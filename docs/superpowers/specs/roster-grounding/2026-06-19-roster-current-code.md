# Roster (Today's Triage) — Current-Code Grounding Document

**Generated:** 2026-06-19
**Purpose:** Precise TypeScript types, field names, props, and signatures for every building block the Roster screen will touch. The spec author should rely on this verbatim and not re-read the source.

---

## 1. roster-signals API Response Shape

**Route:** `src/app/api/teacher/class/[classId]/roster-signals/route.ts`

### Top-level response (lines 211–222)

```typescript
NextResponse.json({
  class_id: string,          // classId from URL param
  roster: RosterItem[],
  focus_group: FocusGroupItem[],
  concept_gaps: ConceptGapResult[],
})
```

---

### 1a. `roster[]` item shape

Built at lines 211–218:

```typescript
{
  student_id: string,
  full_name:  string,
  band:       MasteryBand | null,   // return of currentMasteryBand()
  volatile:   boolean,               // return of bandIsVolatile()
  risk:       RiskResult,            // full object from computeRosterRiskIndex()
}
```

#### `MasteryBand` union (from `src/lib/utils/scoring.ts` + `src/types/core.ts`)

The value of `band` is the **direct return of `currentMasteryBand()`**, which returns `MasteryBand | null`.

```typescript
type MasteryBand = 'reteach' | 'grade_level' | 'advanced'
// null is possible: returned when there are no completed quiz attempts
```

Band thresholds (scoring.ts lines 11–14):
- `scorePct ≤ 50` → `'reteach'`
- `scorePct ≤ 79` → `'grade_level'`
- `scorePct > 79` → `'advanced'`

`currentMasteryBand()` filters `is_complete === false`; returns `null` when no valid attempts exist.

#### `RiskResult` — full object (`src/lib/signals/computeRosterRiskIndex.ts`, lines 1–30)

```typescript
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskResult {
  risk_score:   number;     // 0–100 (composite weighted score)
  risk_level:   RiskLevel;  // band derived from risk_score
  risk_factors: string[];   // human-readable factor labels (array may be empty)
}
```

Risk-level thresholds (lines 219–223):
- `risk_score < 25`  → `'low'`
- `risk_score < 50`  → `'medium'`
- `risk_score < 75`  → `'high'`
- `risk_score >= 75` → `'critical'`

`risk_factors` are plain English strings such as `"Low homework average"`, `"High redo rate"`, etc. — they are teacher-readable labels, not codes.

Weight breakdown (must sum to 100):
```typescript
const W = {
  avgHwScore:     25,
  avgQuizScore:   25,
  completionRate: 20,
  scoreTrend:     15,
  redoRate:       10,
  recency:         5,
}
```

---

### 1b. `focus_group[]` item shape

Built at lines 155–175 of the route:

```typescript
{
  student_id: string,
  full_name:  string,
  diagnosis:  DiagnoseResult,   // full object returned by diagnose()
}
```

Students only enter `focus_group` when `diagnose()` returns non-null. The focus group is sorted by `narrativeRank()` (severity × 1_000_000 − recencyDays × 1000 + actionPriority).

#### `DiagnoseResult` — full type (`src/lib/signals/diagnosis.ts`, lines 28–35)

```typescript
export interface DiagnoseResult {
  suggestedAction: 'reteach' | 'practice' | 'verbal_check' | 'profile' | 'monitor';
  severity:        1 | 2 | 3;    // 3 = most urgent, 1 = lowest
  diagnosis:       string;        // human-readable one-liner for teacher
}
```

**`severity` meaning:**
- `3` — critical / reteach needed
- `2` — actionable concern
- `1` — watch / monitor

**`suggestedAction` values and their meanings:**
- `'reteach'` — concept needs re-teaching (severity 3)
- `'practice'` — targeted practice indicated (severity 2)
- `'verbal_check'` — HW/quiz divergence; verbal check with student (severity 2)
- `'profile'` — generic divergence; investigate further (severity 1)
- `'monitor'` — small gap, watch only (severity 1)

**Pattern table (first match wins, lines 67–129):**

| Condition | `suggestedAction` | `severity` |
|---|---|---|
| `divergence ≥ 25 AND hw_avg < 50 AND quiz_avg ≥ 60` | `verbal_check` | 2 |
| `divergence ≥ 25 AND quiz_avg < 50` | `reteach` | 3 |
| `divergence ≥ 25` (generic) | `profile` | 1 |
| recurring error (count ≥ 3) | `practice` | 2 |
| `divergence ≥ 20 AND < 25` | `monitor` | 1 |
| otherwise | `null` (not in focus group) | — |

**LEAK RISK — `diagnosis` string:** The `diagnosis` field is a raw one-liner string generated inside `diagnose()`. It MAY contain bare numbers or `%` signs (e.g. `"Quiz average is 42% — this concept needs another pass."`). This field is **teacher-only** and must never be forwarded to student/parent surfaces. It is NOT passed through `assertNoLeak`. See Section 7 (Leak Discipline).

---

### 1c. `concept_gaps[]` item shape

#### `ConceptGapResult` (`src/lib/signals/conceptGapDetector.ts`, lines 20–26)

```typescript
export interface ConceptGapResult {
  question_index: number;   // 0-based index into the question array
  question_text:  string;   // ⚠️  raw opaque skill_id string from misconception_observations
  pct_incorrect:  number;   // 0–100 (Math.round((incorrect/total)*100))
}
```

Thresholds (lines 5–6):
```typescript
export const THRESHOLD_PCT = 40;  // minimum % incorrect to flag (inclusive ≥)
export const MIN_STUDENTS  = 5;   // minimum number of attempts before a question is flagged
```

**LEAK RISK — `question_text`:** In the roster-signals route (lines 195–209), `question_text` is populated from `misconception_observations` rows using the `skill_id` column directly. It is **not a human-readable question string** — it is an opaque skill identifier (e.g. `"skill:fractions:add_unlike"`). It must never be rendered verbatim as a pretty label in any UI. See Section 7.

**LEAK RISK — `pct_incorrect`:** This is a raw number (0–100). It must be converted via `pctIncorrectToWords()` for any audience-facing display. Teachers see the band label; no surface shows the raw number.

---

## 2. `bandIsVolatile` (scoring.ts)

**File:** `src/lib/utils/scoring.ts`

```typescript
export function bandIsVolatile(
  attempts: ReadonlyArray<QuizAttemptForBand>,
  windowSize = 3,
): boolean
```

**Meaning:** Returns `true` when the last `windowSize` (default 3) completed quiz attempts span more than one mastery band. Returns `false` if fewer than 2 attempts exist. A `volatile: true` student has been flipping bands recently — the teacher should probe before acting on the current band alone.

Supporting input type:
```typescript
export interface QuizAttemptForBand {
  mastery_band:  MasteryBand | string | null;
  submitted_at:  string | null;
  created_at?:   string | null;
  is_complete?:  boolean | null;
}
```

---

## 3. Component Props

### 3a. `MasteryLabel` (`src/components/core/MasteryLabel.tsx`)

```typescript
interface MasteryLabelProps {
  band: string | null;
}

export function MasteryLabel({ band }: MasteryLabelProps): JSX.Element
```

**Tokens used:** `bg-surface text-fg border border-fg-muted rounded px-2.5 py-0.5 text-sm font-medium`

**Internal transform:** Calls `masteryDisplayLabel(band)` from `src/lib/utils/masteryLabel.ts`:
```typescript
// 'reteach'     → 'Building'
// 'grade_level' → 'On Track'
// 'advanced'    → 'Strong'
// null/unknown  → 'Not yet assessed'
```

Safe for all audiences — never exposes the raw enum. No `data-band` attribute.

---

### 3b. `RiskBadge` (`src/components/core/RiskBadge.tsx`)

```typescript
export type RiskBand = 'low' | 'medium' | 'high' | 'critical';  // from @/lib/copy/riskBandLabel

export interface RiskBadgeProps {
  score?: number;          // raw numeric score (optional)
  band?:  RiskBand;        // preferred: pass risk.risk_level directly
  scale?: '0to1' | '0to100';  // default '0to100'
}

export function RiskBadge(props: RiskBadgeProps): JSX.Element
```

**Additive `band?` prop:** When `band` is provided, `score` is ignored entirely. For the Roster, always pass `band={risk.risk_level}` and never pass `score={risk.risk_score}`.

**Band → token class mapping:**
```typescript
const BAND_STYLES: Record<RiskBand, string> = {
  low:      'bg-ok-surface   text-ok-fg',
  medium:   'bg-warn-surface text-warn-fg',
  high:     'bg-risk-surface text-risk-fg',
  critical: 'bg-risk-surface text-risk-fg ring-2 ring-risk',
}
```

Renders `role="status"` with `aria-label="Risk level: {band}"`. Displays the band label string (e.g. `"low"`, `"critical"`). Never places numeric score in the DOM or data attributes.

**TEACHER/ADMIN-ONLY** — do not render on student or parent surfaces.

---

### 3c. `GrowthMotif` (`src/components/core/GrowthMotif.tsx`)

```typescript
interface GrowthMotifProps {
  history?:       number[];   // legacy alias
  growth_history?: number[];  // preferred; from signals API response
  deltaLabel?:    string;
  accent?:        'brand' | 'ok';
}

export function GrowthMotif(props: GrowthMotifProps): JSX.Element
```

**Cold-start threshold:** `COLD_STARTS_THRESHOLD = 4`. Fewer than 4 data points → renders `data-testid="growth-motif-cold-start"` placeholder (no bars, no fabricated trend).

**Intensity:** Inherited from nearest `[data-intensity]` ancestor (set by `RoleLayout`, not a prop). Teacher layout sets `data-intensity="calm"`.

**`accent='ok'`** adds class `growth-motif--wins` which overrides `--brand` to `var(--ok)` — used for positive trend context.

**Normalization:** Bars are scaled to the series' own max (not a fixed ceiling). Never peer-relative.

**Note for Roster:** `growth_history` is NOT currently in the `roster-signals` response. The Roster screen's per-student growth chip will need either a separate signal or will show a cold-start state. Do not fabricate growth data.

---

### 3d. `EmptyState` (`src/components/core/EmptyState.tsx`)

```typescript
export type EmptyStateVariant =
  | 'not-yet-assessed'
  | 'just-getting-started'
  | 'on-track';

interface EmptyStateProps {
  variant:        EmptyStateVariant;
  className?:     string;
  titleOverride?: string;    // overrides default heading
  bodyOverride?:  string;    // overrides default body
}

export function EmptyState(props: EmptyStateProps): JSX.Element
```

**Built-in copy per variant:**

| `variant` | `heading` | `body` |
|---|---|---|
| `'not-yet-assessed'` | "Not yet assessed" | "Data will appear once practice is complete." |
| `'just-getting-started'` | "Just getting started" | "Keep going — more practice builds a clearer picture." |
| `'on-track'` | "You're on track" | "Things look good here. Keep going." |

**Tokens used:** outer `bg-surface rounded p-8 text-center`; icon `text-fg-muted text-3xl mb-3`; heading `text-fg font-display text-lg font-semibold mb-2`; body `text-fg text-base leading-relaxed max-w-[28ch] mx-auto`.

**Deep-ink rule satisfied:** heading uses `text-fg` (deep-ink), NOT `text-fg-muted`.

---

### 3e. `Card` and `StatCard` (`src/components/core/Card.tsx`)

```typescript
interface CardProps {
  children:   ReactNode;
  className?: string;
}
export function Card({ children, className }: CardProps): JSX.Element
// outer: bg-surface rounded shadow p-5

interface StatCardProps {
  label:      string;
  value:      ReactNode;
  className?: string;
}
export function StatCard({ label, value, className }: StatCardProps): JSX.Element
// label: text-fg-muted text-xs font-medium uppercase tracking-wide
// value: text-fg text-2xl font-display font-bold leading-tight
// outer: bg-surface rounded shadow p-5
```

---

## 4. Copy Helpers (`src/lib/copy/`)

No barrel `index.ts` exists — each helper is its own file. Import individually.

### 4a. `riskBandLabel` (`src/lib/copy/riskBandLabel.ts`)

```typescript
export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

export function riskBandLabel(
  score: number,
  scale: '0to1' | '0to100' = '0to100',
): RiskBand
// normalised = scale==='0to1' ? score*100 : score
// < 25  → 'low'
// < 50  → 'medium'
// < 75  → 'high'
// ≥ 75  → 'critical'
```

**On Roster:** use `risk.risk_level` (already a `RiskLevel` / `RiskBand`) rather than calling `riskBandLabel` with `risk.risk_score`. This avoids any floating-point rounding discrepancy between the server-computed band and the client-recomputed band.

---

### 4b. `pctIncorrectToWords` (`src/lib/copy/pctIncorrectToWords.ts`)

```typescript
import { assertNoLeak } from './leakGuard';

export function pctIncorrectToWords(value: number): string
// values ≥ 1 → treated as 0–100 percentage (auto-divided by 100)
// values in [0,1) → treated as proportion
// Buckets (after normalisation):
//   prop < 0.10  → 'almost none'
//   prop < 0.20  → 'a few'
//   prop < 0.35  → 'about a quarter'
//   prop < 0.60  → 'about half'
//   prop < 0.80  → 'most'
//   prop ≥ 0.80  → 'nearly all'
// Calls assertNoLeak before returning (will throw if result contains digits or %)
```

**Use for:** converting `ConceptGapResult.pct_incorrect` (a raw 0–100 number) into a word-form label for any audience.

---

### 4c. `leakGuard` (`src/lib/copy/leakGuard.ts`)

```typescript
export const LEAK_PATTERNS: RegExp[] = [
  /\d/,                    // any bare digit
  /%/,                     // percent sign
  /\bavg\b/i,              // "avg"
  /\bscore\s+\d/i,         // "score <number>"
  /\d+(?:st|nd|rd|th)\b/i, // ordinals: 2nd, 73rd…
  /\bpercentile\b/i,
  /\brank(?:ed)?\b/i,
]

export function hasLeak(text: string): boolean
// Returns true if any LEAK_PATTERNS matches the text

export function assertNoLeak(text: string, ctx?: string): void
// Throws Error(`[${ctx}] Audience-copy leak detected in: "${text}"`) if hasLeak(text) is true
```

**Note:** `diagnosis.diagnosis` is NOT passed through `assertNoLeak` inside `diagnose()` itself. The Roster page must not forward `diagnosis.diagnosis` to any student/parent surface. It is teacher-only copy.

---

### 4d. `diagnosisToFeedSentence` (`src/lib/copy/diagnosisToFeedSentence.ts`)

```typescript
export type SuggestedAction =
  | 'reteach' | 'practice' | 'verbal_check' | 'profile' | 'monitor';

export interface DiagnosisInput {
  suggestedAction: SuggestedAction;
  severity:        1 | 2 | 3;
}

export function diagnosisToFeedSentence(d: DiagnosisInput): string
```

**Scope:** This helper is for the **Alerts** feed, not the Roster directly. Listed here because the Roster focus-group entries carry a `suggestedAction` — if Roster ever renders a one-liner explanation, use this helper (not `diagnosis.diagnosis`). It passes `assertNoLeak` before returning. `severity` is accepted but does NOT currently vary the output sentence.

**Sentences by action:**
```typescript
const ACTION_SENTENCES: Record<SuggestedAction, string> = {
  reteach:      'This concept looks like it needs another pass with the group.',
  practice:     'Targeted practice on this skill should help.',
  verbal_check: "Strong on practice but the quiz didn't match — worth a quick verbal check.",
  profile:      "Worth a quick look at what's going on for this student.",
  monitor:      'A small gap worth keeping an eye on.',
}
```

---

### 4e. Other copy helpers (exist, note for completeness)

- **`effortPhrase`** (`src/lib/copy/effortPhrase.ts`) — converts `EffortLabel | null | string` → effort sentence; passes `assertNoLeak`. Not in roster-signals payload currently.
- **`narrativeRank`** (`src/lib/copy/narrativeRank.ts`) — sort key: `severity * 1_000_000 − min(recencyDays,999) * 1000 + actionPriority`. Used server-side to sort `focus_group`; the array arrives pre-sorted.
- **`reteachWorkingPhrase`** (`src/lib/copy/reteachWorkingPhrase.ts`) — "reteach is paying off" copy; passes `assertNoLeak`.

---

## 5. Nav Shell + Class Selection

### 5a. Teacher layout (`src/app/(teacher)/layout.tsx`, lines 1–29)

```typescript
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

- **Auth:** `requireRole(['teacher'])` — teacher-only, not school_admin. Redirects if unauthenticated, trial-expired, or wrong role.
- **RoleLayout** sets `data-role="teacher"` and `data-intensity="calm"` on the root container. All Tailwind token classes resolve under these two attributes (Tier-3 bindings in `globals.css`).
- `ClassSwitcherPill` is rendered in the nav, providing global class switching.

---

### 5b. `TeacherNav` (`src/app/(teacher)/_components/TeacherNav.tsx`, lines 1–100)

`'use client'` component. Nav structure:

```typescript
const NAV_ENTRIES = [
  { label: 'Today',     href: '/today' },
  { groupLabel: 'STUDENTS', items: [
    { label: 'Roster',     href: '/roster',   alsoActiveWhen: ['/students'] },
    { label: 'Gradebook',  href: '/gradebook' },
    { label: 'Alerts',     href: '/alerts' },
    { label: 'High Fives', href: '/high-fives' },
  ]},
  { groupLabel: 'TEACHER', items: [
    { label: 'Lesson Library', href: '/library/lessons' },
    { label: 'Quiz Library',   href: '/library/quizzes' },
  ]},
  { label: 'Insights', href: '/insights' },
  { label: 'Upload',   href: '/upload' },
]
```

Active link: `text-brand px-3 py-1`; inactive: `text-fg hover:text-brand px-3 py-1`.
Group labels: `text-fg-muted text-xs font-semibold uppercase tracking-wider px-2`.

---

### 5c. `ClassSwitcherPill` (`src/app/(teacher)/_components/ClassSwitcherPill.tsx`, lines 1–67)

`'use client'` component. No props — self-contained.

```typescript
export function ClassSwitcherPill(): JSX.Element
// Fetches GET /api/teacher/classes → { classes: { class_id: string; label: string }[] }
// loading → animated pulse skeleton (w-40 h-8 rounded bg-surface animate-pulse)
// empty   → <EmptyState variant="just-getting-started" />
// renders <select> with one <option> per class
// onChange: router.replace(`${pathname}?${params}`) — sets `class` URL param to selected class_id
```

Select token classes: `text-fg bg-surface border border-surface rounded px-3 py-1 text-sm hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand`

**How a page reads the class:** via `searchParams` (async in Next.js 16). Pattern:

```typescript
// In a Server Component page:
export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}) {
  const { class: classId } = await searchParams;
  // classId may be undefined if no class selected yet
}
```

The `?class=` param value is the `class_id` UUID. No `classId` → show an EmptyState or prompt to select a class.

---

## 6. Auth Chain for a Teacher Server Component Page

### `requireRole` (`src/lib/auth/requireRole.ts`, lines 1–37)

```typescript
export interface AuthedContext {
  userId:   string;
  role:     Role;
  schoolId: string | null;
}

export async function requireRole(allowed: readonly Role[]): Promise<AuthedContext>
// 1. createServerSupabaseClient() → auth.getUser()
//    → no user: redirect('/login?expired=true')
// 2. users.select('role, school_id')
//    → no role: redirect('/login')
// 3. schools.trial_status === 'expired'
//    → redirect('/trial-expired')
// 4. !allowed.includes(role)
//    → redirect(homeForRole(role))
// 5. Returns { userId, role, schoolId }
```

### `guardClassAccess` (`src/lib/auth/guards.ts`, lines 60–85)

```typescript
export async function guardClassAccess(classId: string): Promise<NextResponse | null>
// platform_admin → null (pass-through)
// teacher who owns the class → null
// school_admin in the same school as the class → null
// else → NextResponse with 403 status (NOT 404 — no existence leak)
```

### Canonical pattern for the Roster page (Server Component)

```typescript
// src/app/(teacher)/roster/page.tsx
export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}) {
  // Step 1: auth (layout already calls requireRole(['teacher']);
  //         but page can call it again to get AuthedContext if needed)
  // Step 2: read classId
  const { class: classId } = await searchParams;

  // Step 3: fetch roster-signals (server-side, using createServerSupabaseClient for auth context,
  //         or via internal fetch to the API route)
  // Step 4: render
}
```

**Note on supabase clients:**
- `createServerSupabaseClient()` — reads session cookie; respects RLS. Use for auth checks.
- `createAdminSupabaseClient()` — uses `SUPABASE_SECRET_KEY`; **bypasses RLS**. RLS is NOT the IDOR backstop — `guardClassAccess` is. Use admin client only after the guard passes.

**STAFF_ROLES constant** (defined in two places — route file and `src/lib/auth/roles.ts`):
```typescript
// src/lib/auth/roles.ts
export const STAFF_ROLES = ['teacher', 'school_admin', 'school_sysadmin', 'platform_admin'] as const;
```

---

## 7. Leak Discipline for Roster (CRITICAL)

Three specific leaks the Roster page must actively guard against:

### Leak 1: `risk.risk_score` — raw numeric score in the payload

- **Where:** `roster[].risk.risk_score` (type `number`, 0–100) is part of the `RiskResult` object returned by the API.
- **Rule:** The page must render the risk chip from `risk.risk_level` (a `RiskLevel` band string) ONLY. `risk_score` must **never** appear in the DOM, in `data-*` attributes, in `aria-label` text, or in any rendered output.
- **Enforcement:** Pass `band={risk.risk_level}` to `<RiskBadge>`; never pass `score={risk.risk_score}`.
- **File:line:** `computeRosterRiskIndex.ts` lines 1–30 (definition); `route.ts` lines 211–218 (serialised into response).

### Leak 2: `concept_gaps[].question_text` — opaque skill_id

- **Where:** `ConceptGapResult.question_text` is populated from `misconception_observations.skill_id` column directly (route.ts lines 195–209). It is NOT a human-readable question string.
- **Rule:** Never render `question_text` verbatim as a label. It is an opaque identifier (e.g. `"skill:fractions:add_unlike"`). The Roster concept-gap section must either map it through a display-name lookup (not yet built) or omit it entirely from the rendered UI.
- **File:line:** `conceptGapDetector.ts` lines 20–26 (`ConceptGapResult` interface); `route.ts` lines 195–209 (population from `skill_id`).

### Leak 3: `focus_group[].diagnosis.diagnosis` — may contain raw `%` or numbers

- **Where:** `DiagnoseResult.diagnosis` is a plain string constructed inside `diagnose()` (`src/lib/signals/diagnosis.ts`). It is NOT passed through `assertNoLeak` and may contain sentences like `"Quiz average is 42% — concept needs another pass."`.
- **Rule:** `diagnosis.diagnosis` is teacher-only. It must never be forwarded to student or parent surfaces. If the Roster renders a one-liner for each focus-group student, use `diagnosisToFeedSentence({ suggestedAction, severity })` instead — that helper IS `assertNoLeak`-clean.
- **File:line:** `diagnosis.ts` lines 28–35 (interface), lines 67–129 (patterns that build the string without leak-checking it).

### Summary table

| Payload field | Risk | Render rule |
|---|---|---|
| `roster[].risk.risk_score` | Raw 0–100 number | Use `risk.risk_level` only; never touch `risk_score` in UI |
| `concept_gaps[].question_text` | Opaque `skill_id` | Never pretty-print; requires display-name lookup or omit |
| `concept_gaps[].pct_incorrect` | Raw 0–100 number | Convert via `pctIncorrectToWords()` before any display |
| `focus_group[].diagnosis.diagnosis` | May contain digits/`%` | Teacher-only; use `diagnosisToFeedSentence()` for clean copy |

---

## 8. Tailwind Token Classes Available

All tokens resolve via the `@theme inline` block in `src/app/globals.css` (lines 259–291). Under `[data-role="teacher"][data-intensity="calm"]` (the Roster's context):

### Color tokens — class prefixes

| Family | Tailwind classes | Teacher/calm value |
|---|---|---|
| Background | `bg-bg` | `var(--ink-50)` (very light grey) |
| Surface | `bg-surface` | `#ffffff` (white card) |
| Foreground | `text-fg` | `var(--ink-900)` (near-black — **deep-ink rule**) |
| Muted fg | `text-fg-muted` | `var(--ink-600)` (mid-grey) |
| Brand | `text-brand`, `bg-brand`, `border-brand`, `ring-brand` | `var(--cobalt-600)` |
| Brand accent | `text-brand-accent`, `bg-brand-accent` | `var(--cobalt-400)` |
| On-brand | `text-fg-on-brand` | `var(--white)` |
| Brand surface | `bg-brand-surface` | `var(--cobalt-50)` |
| Brand fg | `text-brand-fg` | `var(--cobalt-800)` |
| OK (positive) | `bg-ok-surface`, `text-ok-fg`, `text-ok`, `ring-ok` | emerald-50 / emerald-800 / emerald-600 |
| Warn (caution) | `bg-warn-surface`, `text-warn-fg`, `text-warn`, `ring-warn` | amber-50 / amber-900 / amber-500 |
| Risk (danger) | `bg-risk-surface`, `text-risk-fg`, `text-risk`, `ring-risk` | coral-50 / coral-900 / coral-500 |

### Shape tokens

| Token | Tailwind class | Teacher/calm value |
|---|---|---|
| Default radius | `rounded` | `0.5rem` |
| Large radius | `rounded-lg` | `0.875rem` |
| Default shadow | `shadow` | `0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.08)` |
| Pop shadow | `shadow-pop` | `0 8px 24px -4px rgb(0 0 0 / 0.16), 0 4px 8px -2px rgb(0 0 0 / 0.10)` |

### Font tokens

| Token | Tailwind class | Value |
|---|---|---|
| Body / sans | `font-sans` | Inter (via `--font-inter`) |
| Display / headings | `font-display` | Bricolage Grotesque (via `--font-bricolage`) |

### Rules

1. **No hardcoded hex values** in component files — use token classes only.
2. **No arbitrary `[var(--...)]` syntax** — Tailwind v4 exposes all tokens via `@theme inline`; use the named utility class instead.
3. **Content text is `text-fg`** (deep-ink), NOT `text-fg-muted`. Muted is for metadata/labels.
4. **WCAG-AA contrast gate:** `npm run prebuild` runs `scripts/a11y/contrast-check.ts` which parses `globals.css`, resolves all `var()` chains, and checks 9 foreground/background pairs at 4.5:1 (text) or 3.0:1 (UI) across every `[data-role][data-intensity]` combination. Any failure blocks the build. The pairs checked include `fg/bg`, `fg/surface`, `fg-muted/bg`, `fg-on-brand/brand`, `brand/surface`, and the ok/warn/risk family surfaces. Never use a token combination not in this list without first verifying contrast.

---

## Appendix: Key File Paths (absolute)

| Item | Path |
|---|---|
| roster-signals route | `src/app/api/teacher/class/[classId]/roster-signals/route.ts` |
| scoring utils | `src/lib/utils/scoring.ts` |
| masteryLabel util | `src/lib/utils/masteryLabel.ts` |
| computeRosterRiskIndex | `src/lib/signals/computeRosterRiskIndex.ts` |
| diagnosis | `src/lib/signals/diagnosis.ts` |
| conceptGapDetector | `src/lib/signals/conceptGapDetector.ts` |
| computeHwQuizDivergence | `src/lib/signals/computeHwQuizDivergence.ts` |
| MasteryLabel component | `src/components/core/MasteryLabel.tsx` |
| RiskBadge component | `src/components/core/RiskBadge.tsx` |
| GrowthMotif component | `src/components/core/GrowthMotif.tsx` |
| EmptyState component | `src/components/core/EmptyState.tsx` |
| Card / StatCard component | `src/components/core/Card.tsx` |
| riskBandLabel copy | `src/lib/copy/riskBandLabel.ts` |
| pctIncorrectToWords copy | `src/lib/copy/pctIncorrectToWords.ts` |
| leakGuard copy | `src/lib/copy/leakGuard.ts` |
| diagnosisToFeedSentence copy | `src/lib/copy/diagnosisToFeedSentence.ts` |
| effortPhrase copy | `src/lib/copy/effortPhrase.ts` |
| narrativeRank copy | `src/lib/copy/narrativeRank.ts` |
| reteachWorkingPhrase copy | `src/lib/copy/reteachWorkingPhrase.ts` |
| Teacher layout | `src/app/(teacher)/layout.tsx` |
| TeacherNav | `src/app/(teacher)/_components/TeacherNav.tsx` |
| ClassSwitcherPill | `src/app/(teacher)/_components/ClassSwitcherPill.tsx` |
| requireRole | `src/lib/auth/requireRole.ts` |
| guards | `src/lib/auth/guards.ts` |
| roles | `src/lib/auth/roles.ts` |
| globals.css | `src/app/globals.css` |
| contrast-check | `scripts/a11y/contrast-check.ts` |
