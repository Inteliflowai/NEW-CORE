# G6 — Existing teacher-screen pattern + component kit + copy helpers (SP-4 screen)

Grounding for the new `/challenges` teacher screen. All facts are verbatim from `feat/teacher-app-shell`.
READ-ONLY capture. No proposals, no edits.

---

## 0. FLAGGED — the exact IDOR guard the new `/challenges` page must use

**Import:** `import { guardClassAccess } from '@/lib/auth/guards';`

**Signature** (`src/lib/auth/guards.ts:68`):
```ts
export async function guardClassAccess(classId: string): Promise<NextResponse | null>
```
- Returns `null` to proceed; returns a `NextResponse` (401/403) on denial.
- A **page cannot return a NextResponse** — the roster page treats any non-null return as "render the pick-a-class state" (see §1).
- Allows: `platform_admin` (always), the owning `teacher` (`cls.teacher_id === caller.id`), or a same-school admin (`isSchoolAdmin(caller.role) && cls.school_id === caller.school_id`). Otherwise `FORBID()` (403, deliberately not 404 — "don't leak existence").
- Internally uses `createAdminSupabaseClient()` to read `classes.teacher_id, school_id`.

There are **no barrel/index files** for `src/lib/auth`, `src/components/core`, or `src/lib/copy`. Every import is by exact path.

---

## 1. Existing complete teacher route page — `src/app/(teacher)/roster/page.tsx`

Most complete server-component page using `?class=` + the IDOR chain. Quoted verbatim in full where load-bearing:

```ts
// src/app/(teacher)/roster/page.tsx  (lines 1–20)
import React from 'react';

import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { sortFocusGroup } from '@/lib/signals/sortFocusGroup';
import { EmptyState } from '@/components/core/EmptyState';
```

### 1a. async searchParams + classId resolution (lines 53–63)
```ts
export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ class?: string }>;
}): Promise<React.JSX.Element> {
  // 1. Resolve classId from searchParams
  const { class: classId } = await searchParams;

  if (!classId) {
    return <div className="p-6">{PICK_A_CLASS}</div>;
  }
```
- `searchParams` is a **Promise** (Next.js 16) and is `await`ed.
- The key is `class` (URL `?class=<uuid>`), aliased to `classId`.

### 1b. IDOR guard call (lines 65–70)
```ts
  // 2. IDOR guard — teacher must own the class
  const guard = await guardClassAccess(classId);
  if (guard) {
    // Can't return a NextResponse from a page — render the select-a-class state instead
    return <div className="p-6">{PICK_A_CLASS}</div>;
  }
```

### 1c. Data load via admin client (lines 72–74)
```ts
  // 3. Load signals via admin client (RLS-bypassed; guard above is the backstop)
  const admin = createAdminSupabaseClient();
  const data = await loadRosterSignals(admin, classId);
```
- `createAdminSupabaseClient()` is **synchronous** (note: no `await`), imported from `@/lib/supabase/server`.

### 1d. The pick-a-class fallback element (lines 22–29)
```tsx
const PICK_A_CLASS = (
  <EmptyState
    variant="just-getting-started"
    titleOverride="Pick a class to begin"
    bodyOverride="Use the class selector above to see your roster."
  />
);
```

### 1e. Render shell (lines 104–115) — layout idiom the new screen should match
```tsx
  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Part 1 — Header */}
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-display text-2xl text-fg font-semibold">Roster</h1>
      </div>
      ...
          <p className="text-fg text-sm">{summary}</p>
```
Note: page itself is **NOT** marked `requireRole` — the route-group **layout** does the role gate.

### 1f. The role gate lives in the layout — `src/app/(teacher)/layout.tsx` (full file)
```tsx
import { TeacherShell } from './_components/TeacherShell';
import { requireRole } from '@/lib/auth/requireRole';

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { fullName } = await requireRole(['teacher']);
  return <TeacherShell userName={fullName}>{children}</TeacherShell>;
}
```
So any new `src/app/(teacher)/challenges/page.tsx` inherits `requireRole(['teacher'])` from the layout and only needs `guardClassAccess(classId)` for the object-level IDOR check.

### 1g. `requireRole` signature — `src/lib/auth/requireRole.ts`
```ts
export interface AuthedContext {
  userId: string;
  role: Role;
  schoolId: string | null;
  fullName: string | null;
}
export async function requireRole(allowed: readonly Role[]): Promise<AuthedContext>
```
- Redirects (`/login?expired=true`, `/login`, `/trial-expired`, or `homeForRole(role)`) on failure; returns context when allowed.

---

## 2. Component kit — `src/components/core/` (NO index barrel; import each by path)

Files: `Card.tsx`, `CLBadge.tsx`, `EmptyState.tsx`, `GrowthMotif.tsx`, `icons.tsx`, `MasteryLabel.tsx`, `MathText.tsx`, `RiskBadge.tsx`, `RoleLayout.tsx`.

### Exported components & signatures

**EmptyState** — `src/components/core/EmptyState.tsx`
```ts
export type EmptyStateVariant = 'not-yet-assessed' | 'just-getting-started' | 'on-track';
interface EmptyStateProps {
  variant: EmptyStateVariant;
  className?: string;
  titleOverride?: string;
  bodyOverride?: string;
}
export function EmptyState({ variant, className, titleOverride, bodyOverride }: EmptyStateProps)
export default EmptyState;
```
Markup: `bg-surface rounded p-8 text-center`; heading `text-fg font-display text-lg font-semibold mb-2`; body `text-fg text-base leading-relaxed max-w-[28ch] mx-auto`.

**Card / StatCard** — `src/components/core/Card.tsx` (only Card-type primitive in the kit)
```ts
interface CardProps { children: ReactNode; className?: string; }
export function Card({ children, className }: CardProps)        // <div className="bg-surface rounded shadow p-5 ...">
interface StatCardProps { label: string; value: ReactNode; className?: string; }
export function StatCard({ label, value, className }: StatCardProps)
export default Card;
```
StatCard label: `text-fg-muted text-xs font-medium uppercase tracking-wide`; value: `text-fg text-2xl font-display font-bold leading-tight`.

**RiskBadge** — `src/components/core/RiskBadge.tsx` — `'use client'`. TEACHER/ADMIN-ONLY.
```ts
export interface RiskBadgeProps { score?: number; scale?: '0to1' | '0to100'; band?: RiskBand; }
export function RiskBadge(props: RiskBadgeProps)
export default RiskBadge;
```
Renders ONLY the band string; raw score never in DOM. `RiskBand` imported from `@/lib/copy/riskBandLabel`.

**CLBadge** — `src/components/core/CLBadge.tsx` — `'use client'`. TEACHER-SURFACE-ONLY.
```ts
export type ConfidenceWord = 'consistent' | 'tentative' | 'emerging';
export interface CLBadgeProps {
  state: SkillLearningState;          // from @/lib/skills/clVerbs
  confidence?: number | null;
  confidenceWord?: ConfidenceWord | null;
}
export function CLBadge({ state, confidence, confidenceWord }: CLBadgeProps)
export default CLBadge;
```

**MasteryLabel** — `src/components/core/MasteryLabel.tsx` — safe for student/parent/teacher.
```ts
interface MasteryLabelProps { band: string | null; }   // raw DB mastery_band enum or null
export function MasteryLabel({ band }: MasteryLabelProps)
export default MasteryLabel;
```
Delegates mapping to `masteryDisplayLabel` from `@/lib/utils/masteryLabel`.

**GrowthMotif** — `src/components/core/GrowthMotif.tsx`
```ts
interface GrowthMotifProps {
  history?: number[];
  growth_history?: number[];
  deltaLabel?: string;
  accent?: 'brand' | 'ok';
}
export function GrowthMotif({ history, growth_history, deltaLabel, accent }: GrowthMotifProps)
export default GrowthMotif;
```
`COLD_START_THRESHOLD = 4` — renders cold-start state below 4 points.

**MathText** — `src/components/core/MathText.tsx` — `'use client'`. KaTeX renderer.
```ts
export interface MathTextProps { children: string; }
export function MathText({ children }: MathTextProps)
export default MathText;
```

**RoleLayout** — `src/components/core/RoleLayout.tsx`
```ts
export type Role = 'student' | 'teacher' | 'parent' | 'admin' | 'super-admin';
interface RoleLayoutProps { role: Role; nav?: React.ReactNode; children: React.ReactNode; }
export function RoleLayout({ role, nav, children }: RoleLayoutProps)
export default RoleLayout;
```

**icons.tsx** — `src/components/core/icons.tsx` — inline-SVG kit. All `(p: IconProps) => JSX`, `IconProps = { className?: string }`:
`IconToday, IconRoster, IconGradebook, IconAlerts, IconHighFive, IconLessons, IconQuizzes, IconInsights, IconUpload, IconChevron, IconSignOut, IconMenu`. **No challenges/SPARK icon exists** — a new one would have to be added here following the `Svg` wrapper pattern (`viewBox="0 0 24 24"`, `stroke="currentColor"`, `strokeWidth={1.8}`, `aria-hidden`).

### Table/list/row primitives
There is **NO generic Table/List/Row primitive in `src/components/core/`.** The roster screen composes plain `<div>`/`<section>` with Tier-2 token classes. The reusable row pattern is `src/app/(teacher)/roster/_components/RosterTriageCard.tsx` (a route-local `_components` server component, not a shared kit export):
```tsx
// RosterTriageCard.tsx — row/card idiom (server component, no 'use client')
interface RosterTriageCardProps {
  item: FocusGroupItem;
  rosterById: Record<string, RosterItem>;
  classId: string;
}
export function RosterTriageCard({ item, rosterById, classId }: RosterTriageCardProps): React.JSX.Element
```
Card frame: `<div className="flex overflow-hidden rounded border border-surface">` with a `w-1 shrink-0 ${accentClass}` accent bar; `look closer` link uses `text-brand-fg underline`. The established convention: **route-local primitives live in `(teacher)/<route>/_components/`**, not the shared kit.

---

## 3. Copy helpers — `src/lib/copy/` (NO index barrel; import each by path)

### Every helper + signature
| File | Exports |
|---|---|
| `leakGuard.ts` | `LEAK_PATTERNS: RegExp[]`, `hasLeak(text: string): boolean`, `assertNoLeak(text: string, ctx?: string): void` |
| `riskBandLabel.ts` | `type RiskBand = 'low'\|'medium'\|'high'\|'critical'`; `riskBandLabel(score: number, scale: '0to1'\|'0to100' = '0to100'): RiskBand` |
| `topicFrame.ts` | `topicFrame(topic: string): string` → `"still building: <Title Case>"` |
| `actionChipLabel.ts` | `type ChipTone='risk'\|'warn'\|'brand'`; `interface ActionChip { label; tone }`; `actionChipLabel(action: SuggestedAction): ActionChip` |
| `triageWhySentence.ts` | `interface TriageWhyInput { suggestedAction; divergence_score; hw_avg; quiz_avg }`; `triageWhySentence(d: TriageWhyInput): string` |
| `diagnosisToFeedSentence.ts` | `type SuggestedAction` (line 9); `interface DiagnosisInput`; `diagnosisToFeedSentence(d: DiagnosisInput): string` |
| `effortPhrase.ts` | `type EffortLabel='low'\|'medium'\|'high'\|'inconsistent'`; `effortPhrase(label: EffortLabel\|null\|string): string` |
| `narrativeRank.ts` | `narrativeRank(s: {...}): ...` (line 45) |
| `pctIncorrectToWords.ts` | `pctIncorrectToWords(value: number): string` |
| `reteachWorkingPhrase.ts` | `reteachWorkingPhrase(outcome: string\|null): string` |
| `riskFactorPhrase.ts` | `riskFactorPhrase(factor: string): string` |
| `consistencyPhrase.ts` | `consistencyPhrase(label: ConsistencyLabel\|null): string` |
| `divergencePhrase.ts` | `type DivergenceInput = DivergenceResult & { divergence_flagged: boolean }`; `divergencePhrase(d: DivergenceInput): string` |
| `misconceptionPhrase.ts` | `interface RecurringErrorInput`; `misconceptionPhrase(err: RecurringErrorInput): string` |
| `sessionRiskPhrase.ts` | `interface SessionRiskInput`; `sessionRiskPhrase(input: SessionRiskInput): string` |
| `storyLine.ts` | `interface StoryLineInput`; `storyLine(input: StoryLineInput): string` |
| `trajectoryPhrase.ts` | `trajectoryPhrase(direction: TrajectoryDirection\|null): string` |

### leakGuard verbatim (`src/lib/copy/leakGuard.ts`)
```ts
export const LEAK_PATTERNS: RegExp[] = [
  /\d/,                          // any bare digit
  /%/,                           // percent sign
  /\bavg\b/i,                    // "avg"
  /\bscore\s+\d/i,               // "score <number>"
  /\d+(?:st|nd|rd|th)\b/i,       // ordinals: 2nd, 73rd, 1st …
  /\bpercentile\b/i,             // the word "percentile"
  /\brank(?:ed)?\b/i,            // "rank" or "ranked"
];
export function hasLeak(text: string): boolean { return LEAK_PATTERNS.some((re) => re.test(text)); }
export function assertNoLeak(text: string, ctx?: string): void { /* throws "Audience-copy leak detected in: ..." */ }
```

### band/label helpers verbatim
```ts
// riskBandLabel.ts
export type RiskBand = 'low' | 'medium' | 'high' | 'critical';
export function riskBandLabel(score: number, scale: '0to1' | '0to100' = '0to100'): RiskBand {
  const normalised = scale === '0to1' ? score * 100 : score;
  if (normalised < 25) return 'low';
  if (normalised < 50) return 'medium';
  if (normalised < 75) return 'high';
  return 'critical';
}
```
Mastery band → label mapping is single-sourced in `masteryDisplayLabel` (`@/lib/utils/masteryLabel`), surfaced via the `MasteryLabel` component.

### "Assignments, never Homework" rule location
There is **NO central constant/lint rule** enforcing the term. It is enforced by convention + inline comments in the copy helpers themselves:
- `src/lib/copy/triageWhySentence.ts:7-8` header comment: *"…and uses 'Assignment', never 'HW'."* — body emits `"assignment scores"`, `"assignment average"`, etc.
- `src/lib/copy/divergencePhrase.ts` (matches `Assignment`/`Homework`).
- DB identifiers keep the legacy term: table `homework_attempts`, columns `hw_avg`, migration `0004_assignments_homework.sql`. The `FocusGroupItem.hw_avg` field is commented `// Assignment average`.
The rule is the CLAUDE.md binding discipline: **"Assignments", never "Homework"** in UI/copy; `homework_*` survives only in DB identifiers.

---

## 4. Auxiliary facts the planner will need

### STAFF_ROLES / role model — `src/lib/auth/roles.ts`
```ts
export const ROLES = ['teacher','student','parent','school_admin','school_sysadmin','platform_admin'] as const;
export type Role = (typeof ROLES)[number];
export const SCHOOL_ADMIN_ROLES = ['school_admin','school_sysadmin','platform_admin'] as const;
export const STAFF_ROLES = ['teacher','school_admin','school_sysadmin','platform_admin'] as const;
```

### loadRosterSignals — pattern for "load via admin client" (`src/lib/signals/loadRosterSignals.ts`)
```ts
export async function loadRosterSignals(admin: SupabaseClient, classId: string): Promise<RosterSignals>
// RosterSignals = { class_id; roster: RosterItem[]; focus_group: FocusGroupItem[]; concept_gaps: ConceptGapItem[] }
```
Header comment line 60: *"Caller is responsible for running the auth + IDOR guard BEFORE calling this."* — the contract a parallel `loadChallenges`-style loader should follow.

### Class selector / `?class=` propagation — `src/app/(teacher)/_components/ClassSwitcherPill.tsx`
- `'use client'`; fetches `/api/teacher/classes`; on mount defaults `?class=` to `classes[0].class_id` via `router.replace`. So teacher screens reliably receive a `?class=` param. Internal links should preserve it (roster does `?from=roster&class=${classId}`).

### Next migration number + naming convention
- Highest existing: `supabase/migrations/0011_signals.sql` → **next = `0012_<snake_case_name>.sql`**.
- Convention: zero-padded 4-digit prefix + `_` + lowercase snake_case description (`0004_assignments_homework.sql`, `0010_engine_columns.sql`).
- Migration headers are SQL comments; idempotent (`ADD COLUMN IF NOT EXISTS`, DO-block CHECK swaps); marked "NOT applied live here — see Task N (post-build MCP apply)".

### Demo-school identity — `src/lib/demo/demoCast.ts` + `scripts/seedDemo.ts`
- `export const DEMO_SCHOOL_NAME = 'CORE Demo School';` (school found/created by `name`, not slug — `seedDemo.ts:115` `.eq('name', DEMO_SCHOOL_NAME)`).
- Teacher: `DEMO_TEACHER = { key:'teacher', full_name:'Dana Whitfield', role:'teacher' }`; parent `Rosa Rivera`; admin `Priya Anand` (`school_admin`).
- User emails: `` `${key}@demo.coreedtech.com` `` (e.g. `teacher@demo.coreedtech.com`, `alex@demo.coreedtech.com`).
- Skills keyed by `slug` (e.g. `demo-skill-1`) scoped to `(school_id, slug, subject)`.

---

## 5. DISCREPANCY / RISK flags
- **No barrel/index files** in `src/components/core`, `src/lib/copy`, or `src/lib/auth` — any plan that writes `import { X } from '@/components/core'` will fail; must import the exact file path.
- **No shared Table/List/Row primitive** — the new screen must compose `<div>`/`<section>` + Tier-2 token classes, and place route-local row components under `src/app/(teacher)/challenges/_components/`.
- **No `challenges`/SPARK icon** in `icons.tsx` — must be added there if the nav needs one.
- **No `/challenges` route exists** under `src/app/(teacher)/` (confirmed by glob; existing routes: today, roster, gradebook, alerts, high-fives, insights, library/{lessons,quizzes}, upload, students/[studentId]).
- A **page cannot return the NextResponse** from `guardClassAccess` — must convert a non-null return into a rendered fallback (roster renders the pick-a-class EmptyState).
- "Assignments not Homework" has **no automated enforcement** — convention only; DB identifiers (`homework_attempts`, `hw_avg`) intentionally retain the legacy term.
- `createAdminSupabaseClient()` is **synchronous** (no `await`); `createServerSupabaseClient()` is async.
