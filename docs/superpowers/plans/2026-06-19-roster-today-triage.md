# Roster "Today's Triage" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/roster` placeholder with the signals-first "Today's Triage" worklist that renders the seeded class.

**Architecture:** Extract the existing `roster-signals` route body into a reusable `loadRosterSignals()` (adding a `skill_name` JOIN), so the Server-Component page renders server-side with no HTTP hop. Build small presentational components + 2 pure helpers; the page assembles the 6-part layout, sorts the focus group, and derives counts client-side.

**Tech Stack:** Next.js 16 App Router (async `searchParams`), React 19 Server + `'use client'` components, Tailwind v4 token classes, Vitest (node + jsdom).

**Spec:** `docs/superpowers/specs/2026-06-19-roster-today-triage-design.md` (read first — full design).
**Grounding:** `docs/superpowers/specs/roster-grounding/2026-06-19-roster-current-code.md` (exact current-code types/props — rely on verbatim).

## Global Constraints

- **Leak discipline (teacher-only surface, enforced by a test):** never render `risk.risk_score` (pass `band={risk.risk_level}` to `<RiskBadge>` only); never render the raw `concept_gaps[].question_text` (a `skill_id`) — render `skill_name` only; `pct_incorrect` → `pctIncorrectToWords()`; `diagnosis.diagnosis` may contain `%`/digits and is allowed on this teacher-only screen but must never be forwarded elsewhere.
- **Tokens-only styling:** Tier-2/Tier-3 token classes only — NO hardcoded hex, NO arbitrary `[var(--..)]`. Content text `text-fg` (deep-ink); `text-fg-muted` only for eyebrows/meta. Must pass `npm run a11y` (WCAG-AA gate).
- **"Assignments" never "Homework"** in copy (DB identifier `homework_attempts` is legacy, keep).
- **Auth chain:** the `(teacher)` layout already calls `await requireRole(['teacher'])`; the page additionally calls `guardClassAccess(classId)` before reading data with the admin client.
- **Vitest envs:** lib/route tests = node (no header). Component/page tests = **first two lines** `// @vitest-environment jsdom` then `import '@/test/setup-dom';`. Single file: `npx vitest run <path>`.
- **Join/deep-link by `student_id`, never `full_name`.** Focus group is NOT sorted by the API — sort in-page.
- **Commit after each task** with the exact message in its Step 5.

---

## Task 1 — Data layer: `loadRosterSignals()` + `skill_name` JOIN

**Files:**
- Create: `src/lib/signals/loadRosterSignals.ts`
- Modify: `src/app/api/teacher/class/[classId]/roster-signals/route.ts` (become a thin wrapper)
- Test: `src/lib/signals/__tests__/loadRosterSignals.test.ts`
- Modify (if needed): `src/app/api/teacher/class/[classId]/roster-signals/__tests__/route.test.ts` (only if it asserted internals now moved)

**Interfaces — Produces:**
```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MasteryBand } from '@/lib/utils/scoring';
import type { RiskResult } from '@/lib/signals/computeRosterRiskIndex';
import type { DiagnoseResult } from '@/lib/signals/diagnosis';

export interface RosterItem { student_id: string; full_name: string; band: MasteryBand | null; volatile: boolean; risk: RiskResult; }
export interface FocusGroupItem { student_id: string; full_name: string; diagnosis: DiagnoseResult; }
export interface ConceptGapItem { question_index: number; question_text: string; skill_name: string | null; pct_incorrect: number; }
export interface RosterSignals { class_id: string; roster: RosterItem[]; focus_group: FocusGroupItem[]; concept_gaps: ConceptGapItem[]; }

export async function loadRosterSignals(admin: SupabaseClient, classId: string): Promise<RosterSignals>;
```

**Implementation:** Move the body of the current route GET (everything AFTER `const admin = createAdminSupabaseClient();` — the enrollments query through building `roster`, `focus_group`, `concept_gaps`, and the final object) into `loadRosterSignals(admin, classId)`, returning the object (do NOT `NextResponse.json`). Behaviour identical EXCEPT add `skill_name` to each concept gap:

After computing `concept_gaps` (the `detectConceptGaps(...)` result), add the JOIN:
```ts
// Resolve opaque skill_ids -> human names for the concept-gap rail (teacher-safe label).
const gapSkillIds = Array.from(new Set(concept_gaps.map((g) => g.question_text)));
const nameById: Record<string, string> = {};
if (gapSkillIds.length) {
  const { data: skillRows } = await admin.from('skills').select('id, name').in('id', gapSkillIds);
  for (const r of (skillRows ?? []) as { id: string; name: string }[]) nameById[r.id] = r.name;
}
const conceptGapsNamed: ConceptGapItem[] = concept_gaps.map((g) => ({
  question_index: g.question_index,
  question_text: g.question_text,           // opaque skill_id — kept but never rendered
  skill_name: nameById[g.question_text] ?? null,
  pct_incorrect: g.pct_incorrect,
}));
return { class_id: classId, roster: /* mapped {student_id,full_name,band,volatile,risk} */, focus_group, concept_gaps: conceptGapsNamed };
```
The route GET becomes: auth → STAFF_ROLES gate → `guardClassAccess` → `const admin = createAdminSupabaseClient(); return NextResponse.json(await loadRosterSignals(admin, classId));`.

- [ ] **Step 1: Write the failing test** (`loadRosterSignals.test.ts`, node env). Build a mock admin whose `enrollments` select returns 1 student, the quiz/hw selects return scored attempts, `misconception_observations` select returns 1 row with `skill_id:'sk1'`, and `skills` select returns `[{id:'sk1', name:'Adding fractions'}]`. Assert: result has `class_id`, `roster[0].student_id`/`band`/`risk`, and `concept_gaps` items carry `skill_name` (`'Adding fractions'` when the skill row exists, `null` when absent). Mirror the mock shape already used in the existing route test.

- [ ] **Step 2: Run → FAIL** (`npx vitest run src/lib/signals/__tests__/loadRosterSignals.test.ts`) — function not implemented.

- [ ] **Step 3: Implement** the extraction + JOIN per above; rewire the route to the thin wrapper.

- [ ] **Step 4: Run → PASS** the new test AND the existing route test (`npx vitest run src/app/api/teacher/class/[classId]/roster-signals/__tests__/route.test.ts`). Fix the route test only if it asserted now-moved internals (keep its behavioral assertions).

- [ ] **Step 5: Commit**
```bash
git add src/lib/signals/loadRosterSignals.ts src/lib/signals/__tests__/loadRosterSignals.test.ts "src/app/api/teacher/class/[classId]/roster-signals/route.ts" "src/app/api/teacher/class/[classId]/roster-signals/__tests__/route.test.ts"
git commit -m "feat(roster): extract loadRosterSignals + add skill_name JOIN for concept gaps"
```

---

## Task 2 — Pure helpers: `actionChipLabel` + `sortFocusGroup`

**Files:**
- Create: `src/lib/copy/actionChipLabel.ts`, `src/lib/signals/sortFocusGroup.ts`
- Test: `src/lib/copy/__tests__/actionChipLabel.test.ts`, `src/lib/signals/__tests__/sortFocusGroup.test.ts`

**Interfaces — Produces:**
```ts
// actionChipLabel.ts
import type { SuggestedAction } from '@/lib/copy/diagnosisToFeedSentence';
export type ChipTone = 'risk' | 'warn' | 'brand';
export interface ActionChip { label: string; tone: ChipTone; }
export function actionChipLabel(action: SuggestedAction): ActionChip;

// sortFocusGroup.ts
import type { FocusGroupItem } from '@/lib/signals/loadRosterSignals';
export function sortFocusGroup(items: readonly FocusGroupItem[]): FocusGroupItem[]; // pure, returns a new array
```
`actionChipLabel`: reteach→{`'reteach now'`,`'risk'`}, verbal_check→{`'check in'`,`'warn'`}, practice→{`'practice'`,`'warn'`}, profile→{`'look closer'`,`'brand'`}, monitor→{`'watch'`,`'brand'`}.
`sortFocusGroup`: severity DESC; tie → action priority ASC (`reteach`=0, `verbal_check`=1, `practice`=1, `profile`=2, `monitor`=2); tie → `full_name` ASC. Pure (copy then sort).

- [ ] **Step 1: Write failing tests.**
```ts
// actionChipLabel.test.ts (node)
import { describe, it, expect } from 'vitest';
import { actionChipLabel } from '../actionChipLabel';
describe('actionChipLabel', () => {
  it('maps each action to label+tone', () => {
    expect(actionChipLabel('reteach')).toEqual({ label: 'reteach now', tone: 'risk' });
    expect(actionChipLabel('verbal_check')).toEqual({ label: 'check in', tone: 'warn' });
    expect(actionChipLabel('practice')).toEqual({ label: 'practice', tone: 'warn' });
    expect(actionChipLabel('profile')).toEqual({ label: 'look closer', tone: 'brand' });
    expect(actionChipLabel('monitor')).toEqual({ label: 'watch', tone: 'brand' });
  });
});
```
```ts
// sortFocusGroup.test.ts (node)
import { describe, it, expect } from 'vitest';
import { sortFocusGroup } from '../sortFocusGroup';
const mk = (name: string, severity: 1|2|3, action: string) =>
  ({ student_id: name, full_name: name, diagnosis: { severity, suggestedAction: action, diagnosis: 'x' } } as never);
describe('sortFocusGroup', () => {
  it('orders by severity DESC, then action priority, then name; pure', () => {
    const input = [mk('Bob',1,'monitor'), mk('Ann',3,'reteach'), mk('Cy',3,'profile'), mk('Dan',3,'reteach')];
    const out = sortFocusGroup(input);
    expect(out.map((x) => x.full_name)).toEqual(['Ann','Dan','Cy','Bob']); // sev3 reteach(Ann,Dan by name) > sev3 profile(Cy) > sev1(Bob)
    expect(input.map((x) => x.full_name)).toEqual(['Bob','Ann','Cy','Dan']); // input unmutated
  });
});
```
- [ ] **Step 2: Run → FAIL** both files.
- [ ] **Step 3: Implement** both per the interface (use the exact label/tone map + the comparator above; `actionChipLabel` labels are static so no `assertNoLeak` needed).
- [ ] **Step 4: Run → PASS** both files.
- [ ] **Step 5: Commit**
```bash
git add src/lib/copy/actionChipLabel.ts src/lib/copy/__tests__/actionChipLabel.test.ts src/lib/signals/sortFocusGroup.ts src/lib/signals/__tests__/sortFocusGroup.test.ts
git commit -m "feat(roster): actionChipLabel + sortFocusGroup pure helpers"
```

---

## Task 3 — `ActionChip` + `RosterTriageCard`

**Files:**
- Create: `src/app/(teacher)/roster/_components/ActionChip.tsx`, `src/app/(teacher)/roster/_components/RosterTriageCard.tsx`
- Test: `src/app/(teacher)/roster/_components/__tests__/RosterTriageCard.test.tsx`

**Interfaces — Consumes** `actionChipLabel` (Task 2), `FocusGroupItem`/`RosterItem` (Task 1), `MasteryLabel`/`RiskBadge` (grounding §3). **Produces:**
```ts
// ActionChip.tsx (server)
import type { SuggestedAction } from '@/lib/copy/diagnosisToFeedSentence';
export function ActionChip({ action }: { action: SuggestedAction }): React.JSX.Element;
// tone -> classes: risk='bg-risk-surface text-risk-fg', warn='bg-warn-surface text-warn-fg', brand='bg-brand-surface text-brand-fg'; rounded px-2 py-0.5 text-xs font-medium

// RosterTriageCard.tsx (server)
import type { FocusGroupItem, RosterItem } from '@/lib/signals/loadRosterSignals';
export function RosterTriageCard({ item, rosterById, classId }:
  { item: FocusGroupItem; rosterById: Record<string, RosterItem>; classId: string }): React.JSX.Element;
```
**RosterTriageCard** renders (spec §3 Part 4): a left accent bar by `item.diagnosis.severity` (3→`bg-risk`, 2→`bg-warn`, 1→`bg-brand`); a dot-count tile (●●●/●●/● by severity, with `aria-label` like `"severity 3 of 3"`); `item.full_name` (`text-fg font-medium`); `<ActionChip action={item.diagnosis.suggestedAction} />`; `item.diagnosis.diagnosis` verbatim as `text-fg` body; a meta row from `rosterById[item.student_id]`: `<MasteryLabel band={r.band} />`, `"∿ moving around lately"` (warn tone) iff `r.volatile`, `"△ {r.risk.risk_factors[0]}"` iff `r.risk.risk_factors.length`, and a `<Link href={\`/students/${item.student_id}?from=roster&class=${classId}\`}>look closer ›</Link>`. **Never render `r.risk.risk_score`.**

- [ ] **Step 1: Write failing test** (jsdom). Render with a mock `item` (severity 3, `suggestedAction:'reteach'`, `diagnosis:'Quiz average is 42% — needs another pass.'`) and a `rosterById` whose entry has `band:'reteach'`, `volatile:true`, `risk:{risk_level:'high', risk_score:73, risk_factors:['Low homework average']}`. Assert: the diagnosis sentence text is present; an element with the `actionChipLabel('reteach').label` ("reteach now") renders; the MasteryLabel "Building" renders; "moving around lately" appears (volatile); "Low homework average" appears; the "look closer" link `href` contains `/students/<id>?from=roster&class=`; and **`container.innerHTML` does NOT contain `"73"`** (no risk_score leak).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `ActionChip` then `RosterTriageCard` per the interface + spec §3 Part 4, tokens-only.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**
```bash
git add "src/app/(teacher)/roster/_components/ActionChip.tsx" "src/app/(teacher)/roster/_components/RosterTriageCard.tsx" "src/app/(teacher)/roster/_components/__tests__/RosterTriageCard.test.tsx"
git commit -m "feat(roster): ActionChip + RosterTriageCard (severity accent, action chip, diagnosis, meta, look-closer; no risk_score)"
```

---

## Task 4 — `ClassPulseStrip`

**Files:**
- Create: `src/app/(teacher)/roster/_components/ClassPulseStrip.tsx`
- Test: `src/app/(teacher)/roster/_components/__tests__/ClassPulseStrip.test.tsx`

**Interfaces — Produces:**
```ts
export interface PulseCounts { reteach: number; grade_level: number; advanced: number; not_assessed: number; }
export function ClassPulseStrip({ counts }: { counts: PulseCounts }): React.JSX.Element; // server
```
A slim segmented bar over the four counts + a legend. Each legend entry pairs a **color swatch + dot glyph + word + count** (color never sole carrier): Building (`bg-warn` family) ● · On Track (`bg-brand` family) ● · Strong (`bg-ok` family) ● · Not yet assessed (`bg-fg-muted`) ○. Use band→word via the same labels as `masteryDisplayLabel` ("Building"/"On Track"/"Strong"/"Not yet assessed"). Segment widths ∝ count (skip zero-width). Tokens-only; AA-safe pairs.

- [ ] **Step 1: Write failing test** (jsdom): render `counts={reteach:2, grade_level:4, advanced:1, not_assessed:1}`; assert each word label ("Building","On Track","Strong","Not yet assessed") and each count (2,4,1,1) appears in the legend.
- [ ] **Step 2: Run → FAIL.**  - [ ] **Step 3: Implement.**  - [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**
```bash
git add "src/app/(teacher)/roster/_components/ClassPulseStrip.tsx" "src/app/(teacher)/roster/_components/__tests__/ClassPulseStrip.test.tsx"
git commit -m "feat(roster): ClassPulseStrip mastery-mix segmented strip (color+dot+word+count)"
```

---

## Task 5 — `EveryoneElseDisclosure` (client)

**Files:**
- Create: `src/app/(teacher)/roster/_components/EveryoneElseDisclosure.tsx` (`'use client'`)
- Test: `src/app/(teacher)/roster/_components/__tests__/EveryoneElseDisclosure.test.tsx`

**Interfaces — Consumes** `RosterItem`, `MasteryLabel`, `RiskBadge`. **Produces:**
```ts
import type { RosterItem } from '@/lib/signals/loadRosterSignals';
export function EveryoneElseDisclosure({ others, classId }: { others: RosterItem[]; classId: string }): React.JSX.Element;
```
A collapsed `<details>`/button toggle (closed by default) labeled `"Everyone else (${others.length}) ▾"`. Expanded: a compact list, each row = name + `<MasteryLabel band />` + a `look closer ›` link (`/students/${id}?from=roster&class=${classId}`). Render `<RiskBadge band={r.risk.risk_level} />` **only when** `r.risk.risk_level !== 'low'`. Never pass `score`.

- [ ] **Step 1: Write failing test** (jsdom): `others` = [one with `risk_level:'low'`, one with `risk_level:'high', risk_score:80`]. Assert the summary shows "Everyone else (2)"; after clicking to expand, both names show; the `low` row has NO risk badge text, the `high` row shows a risk badge; `container.innerHTML` does NOT contain `"80"`.
- [ ] **Step 2: Run → FAIL.**  - [ ] **Step 3: Implement.**  - [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**
```bash
git add "src/app/(teacher)/roster/_components/EveryoneElseDisclosure.tsx" "src/app/(teacher)/roster/_components/__tests__/EveryoneElseDisclosure.test.tsx"
git commit -m "feat(roster): EveryoneElseDisclosure (collapsed roster, RiskBadge medium+ only, no score)"
```

---

## Task 6 — `ConceptGapsRail` + `SignalLegend`

**Files:**
- Create: `src/app/(teacher)/roster/_components/ConceptGapsRail.tsx` (server), `src/app/(teacher)/roster/_components/SignalLegend.tsx` (`'use client'`)
- Test: `src/app/(teacher)/roster/_components/__tests__/ConceptGapsRail.test.tsx`

**Interfaces — Consumes** `ConceptGapItem`, `pctIncorrectToWords`. **Produces:**
```ts
import type { ConceptGapItem } from '@/lib/signals/loadRosterSignals';
export function ConceptGapsRail({ gaps }: { gaps: ConceptGapItem[] }): React.JSX.Element;
export function SignalLegend(): React.JSX.Element; // closed-by-default "What do these mean?" disclosure
```
**ConceptGapsRail:** header "The whole class is stuck on". Empty (`gaps.length===0`) → `<EmptyState variant="on-track" titleOverride="No class-wide gaps" bodyOverride="No single skill is tripping up the group right now." />`. Else one row per gap: render `gap.skill_name ?? 'a skill we're still naming'` (NEVER `gap.question_text`) + `pctIncorrectToWords(gap.pct_incorrect)`. **SignalLegend:** a `'use client'` toggle explaining the band words (Building/On Track/Strong/Not yet assessed) and the action chips, plain-language, no numbers.

- [ ] **Step 1: Write failing test** (jsdom): (a) `gaps=[]` → assert "No class-wide gaps"; (b) `gaps=[{question_index:0, question_text:'skill:secret', skill_name:'Adding fractions', pct_incorrect:80}]` → assert "Adding fractions" AND the words from `pctIncorrectToWords(80)` ("nearly all") appear, AND `container.innerHTML` does NOT contain `"skill:secret"` nor `"80"`.
- [ ] **Step 2: Run → FAIL.**  - [ ] **Step 3: Implement** both.  - [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit**
```bash
git add "src/app/(teacher)/roster/_components/ConceptGapsRail.tsx" "src/app/(teacher)/roster/_components/SignalLegend.tsx" "src/app/(teacher)/roster/_components/__tests__/ConceptGapsRail.test.tsx"
git commit -m "feat(roster): ConceptGapsRail (skill_name + pct-words, EmptyState) + SignalLegend"
```

---

## Task 7 — Roster page assembly + leak test

**Files:**
- Modify: `src/app/(teacher)/roster/page.tsx` (replace the placeholder)
- Test: `src/app/(teacher)/roster/__tests__/page.test.tsx`, `src/app/(teacher)/roster/__tests__/roster.leak.test.tsx`

**Interfaces — Consumes** everything above. The page is an async Server Component:
```ts
export default async function RosterPage({ searchParams }: { searchParams: Promise<{ class?: string }> }): Promise<React.JSX.Element>;
```
**Behavior (spec §2–§3):**
1. `const { class: classId } = await searchParams;` — if falsy → render `<EmptyState variant="just-getting-started" titleOverride="Pick a class to begin" bodyOverride="Use the class selector above to see your roster." />` and return.
2. `const guard = await guardClassAccess(classId); if (guard) { /* not allowed */ render the same pick-a-class EmptyState and return; }` (the page can't return a NextResponse — on a non-null guard, render the empty/select state).
3. `const admin = createAdminSupabaseClient(); const data = await loadRosterSignals(admin, classId);`
4. Build `rosterById = Object.fromEntries(data.roster.map((r) => [r.student_id, r]))`.
5. Counts: `needs = data.focus_group.length`; `notAssessed = data.roster.filter((r) => r.band === null).length`; `onTrack = Math.max(0, data.roster.length - needs - notAssessed)`.
6. `const focusSorted = sortFocusGroup(data.focus_group);` — render the "Needs you today" stack of `<RosterTriageCard>` (rough-week: if `focusSorted.length > 6`, render the first 6 and a `"+N more need attention"` note).
7. `pulseCounts` for `<ClassPulseStrip>` from band counts; the summary sentence; `<EveryoneElseDisclosure others={roster minus focus_group ids} />`; `<ConceptGapsRail gaps={data.concept_gaps} />`; `<SignalLegend />`.

- [ ] **Step 1: Write failing tests.** Mock `@/lib/signals/loadRosterSignals` (return a fixture: 8 roster items incl. one `band:null`, a 3-item focus_group with mixed severities, one concept gap with `skill_name`), mock `@/lib/auth/guards` (`guardClassAccess`→null), mock `@/lib/supabase/server` (`createAdminSupabaseClient`→{}), and `next/navigation`. 
  - `page.test.tsx`: render `await RosterPage({ searchParams: Promise.resolve({ class: 'c1' }) })`; assert the summary counts are correct (needs/on-track/not-assessed), the focus cards appear in `sortFocusGroup` order, the concept `skill_name` shows; and with `searchParams: {}` the "Pick a class" EmptyState shows.
  - `roster.leak.test.tsx`: fixture where every `risk.risk_score` is a distinctive number (e.g. 73, 91) and a concept gap `question_text:'skill:secret'`; assert `container.innerHTML` contains none of `"73"`/`"91"`/`"skill:secret"`, but DOES contain a band word (e.g. "high") for a medium+ student and the `diagnosis.diagnosis` text of a focus card.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the page per the behavior above, composing Tasks 1–6.
- [ ] **Step 4: Run → PASS** both test files; then `npx tsc --noEmit` and `npm run a11y` clean.
- [ ] **Step 5: Commit**
```bash
git add "src/app/(teacher)/roster/page.tsx" "src/app/(teacher)/roster/__tests__/page.test.tsx" "src/app/(teacher)/roster/__tests__/roster.leak.test.tsx"
git commit -m "feat(roster): assemble Today's Triage page (summary, pulse, needs-you stack, everyone-else, concept rail) + leak test"
```

---

## Self-Review

- **Spec coverage:** §2 data flow → Task 1 (+page in 7); §3 Part1 legend → Task 6; Part2 summary → Task 7; Part3 pulse → Task 4; Part4 triage stack → Task 3 (+7 sort/rough-week); Part5 everyone-else → Task 5; Part6 concept rail → Task 6; §5 helpers → Task 2; §6 leak test → Tasks 3/5/6 (component-level) + Task 7 (full-page). ✓
- **Placeholder scan:** test code is complete; component internals reference the spec/grounding by exact prop+token (no "TBD"). The implementer has the spec + grounding files in-hand. ✓
- **Type consistency:** `RosterSignals`/`RosterItem`/`FocusGroupItem`/`ConceptGapItem` defined in Task 1 and consumed verbatim by Tasks 3/5/6/7; `ActionChip`/`ChipTone` Task 2 → Task 3; `PulseCounts` Task 4 → Task 7. ✓
- **YAGNI:** no writes, no growth-on-roster (not in payload), no One-Student screen (only linked). ✓
