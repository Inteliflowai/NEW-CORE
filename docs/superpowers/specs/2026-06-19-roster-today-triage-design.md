# Roster — "Today's Triage" — Design Spec

**Date:** 2026-06-19
**Screen:** Teacher → STUDENTS → Roster (`/roster`)
**Design direction:** A "Today's Triage" — locked 2026-06-18 (judge-panel `wf_a90246d2-458`, 2-of-3 + user pick). See [[core-v2-p4b-teacher-ia]].
**Grounding:** `docs/superpowers/specs/roster-grounding/2026-06-19-roster-current-code.md` (exact current-code types/props/signatures — relied on verbatim here).

---

## 1. Goal

Replace the placeholder `/roster` stub with the **signals-first class view**: a prioritized **worklist** ("who needs you today"), not a grid. The grid lives in Gradebook (separate screen). Roster answers, at a calm glance: *how is the class doing, who needs me right now, and why.*

This is a **teacher-only** surface (layout already gates `requireRole(['teacher'])`). The four-audience discipline still applies at the string boundary: no raw risk number, no opaque skill_id, pct as words, mastery as band **label**.

## 2. Architecture & data flow

**Data source:** the existing `GET /api/teacher/class/[classId]/roster-signals` logic. To render server-side without an HTTP hop, **extract the route's post-guard body into a reusable async function** and call it directly from the page:

- **New:** `src/lib/signals/loadRosterSignals.ts` — `export async function loadRosterSignals(admin: SupabaseClient, classId: string): Promise<RosterSignals>`. Move the route's lines 58–222 (enrollments → per-student loop → focus_group → concept_gaps → return object) into it. Export the result type `RosterSignals` and its item types (`RosterItem`, `FocusGroupItem`, `ConceptGapItem`).
- **Refactor:** `roster-signals/route.ts` becomes thin: auth → STAFF_ROLES gate → `guardClassAccess` → `loadRosterSignals(admin, classId)` → `NextResponse.json(result)`. **Behaviour unchanged** (the existing route test must still pass — update only if it asserted internals).
- **Page:** `src/app/(teacher)/roster/page.tsx` (Server Component) — after the layout's `requireRole(['teacher'])`, the page itself calls `guardClassAccess(classId)` (IDOR — a teacher must own the class) then `loadRosterSignals(admin, classId)`. No internal `fetch`.

**API change (this build) — concept skill names.** Add an additive `skill_name: string | null` to each `concept_gaps[]` item inside `loadRosterSignals`: after `detectConceptGaps`, look up `skills.name` for each gap's `question_text` (which is a raw `skill_id`) via one `admin.from('skills').select('id, name').in('id', skillIds)` query; map `skill_name = nameById[gap.question_text] ?? null`. **`question_text` (the raw skill_id) stays in the payload but is NEVER rendered; the UI renders `skill_name` only.** This JOIN is reused by Insights later.

```typescript
// loadRosterSignals.ts — exported types
export interface RosterItem { student_id: string; full_name: string; band: MasteryBand | null; volatile: boolean; risk: RiskResult; }
export interface FocusGroupItem { student_id: string; full_name: string; diagnosis: DiagnoseResult; }
export interface ConceptGapItem { question_index: number; question_text: string; /* opaque skill_id — never render */ skill_name: string | null; pct_incorrect: number; }
export interface RosterSignals { class_id: string; roster: RosterItem[]; focus_group: FocusGroupItem[]; concept_gaps: ConceptGapItem[]; }
```

**No `classId` selected** (`?class=` absent): render a select-a-class state (`<EmptyState variant="just-getting-started" titleOverride="Pick a class to begin" bodyOverride="Use the class selector above to see your roster." />`). The `ClassSwitcherPill` in the layout nav sets `?class=`.

## 3. Screen layout (6 parts, top→bottom; right rail beside parts 2–4)

> All counts derived **client-side** from the payload. Order of the "Needs you" stack is computed in the page (the API does **not** sort `focus_group`).

### Part 1 — Header
- Screen title "Roster" (`font-display text-2xl text-fg`). The class-switcher **pill** is already in the layout nav (do not duplicate).
- **"What do these mean?"** legend — a `'use client'` disclosure (closed by default) explaining the band labels (Building / On Track / Strong / Not yet assessed) and the action chips. Plain language, no enums/numbers.

### Part 2 — One honest calm-glance summary sentence
- Deep-ink (`text-fg`). Counts: `needs = focus_group.length`; `notAssessed = roster.filter(r => r.band === null).length`; `onTrack = roster.length − needs − notAssessed` (floored at 0).
- Template (singular/plural aware), e.g.: *"3 students need a closer look today, 4 are on track, and 1 hasn't been assessed yet."* When `needs === 0`: *"Nothing urgent today — everyone's tracking along."* When `roster.length === 0`: the not-assessed/empty roster EmptyState instead.

### Part 3 — Class **pulse** micro-strip (mastery mix)
- A slim segmented bar (`ClassPulseStrip`) over the mastery-band distribution of `roster[]`: counts of `reteach` / `grade_level` / `advanced` / `null`.
- **Color is never the sole carrier:** each segment + its legend entry pairs a color swatch with a **dot glyph + word + count** (Building ● / On Track ● / Strong ● / Not yet assessed ○). Use band→label via `masteryDisplayLabel`; segment colors from tokens (`bg-warn`/`bg-brand`/`bg-ok`/`bg-fg-muted` family — pick AA-passing surface/again-fg pairs; no hardcoded hex).

### Part 4 — **"Needs you today"** stack (the dominant region)
- Source: `focus_group[]`, **sorted in the page**: `severity` DESC, then action priority `reteach(0) < verbal_check(1) = practice(1) < profile(2) = monitor(2)` ASC, then `full_name` for stability.
- One `RosterTriageCard` per focus student:
  - **Left accent bar** by severity: 3 → `bg-risk` (coral), 2 → `bg-warn` (amber), 1 → `bg-brand` (cobalt).
  - **Dot-count tile** echoing severity: ●●● / ●● / ● (text + aria-label "severity 3 of 3" etc. — color never sole carrier).
  - **Student name** (deep-ink, `font-medium`).
  - **Action chip** from `actionChipLabel(diagnosis.suggestedAction)` (new helper, §5): reteach→"reteach now"/risk-tone, verbal_check→"check in"/warn, practice→"practice"/warn, profile→"look closer"/brand, monitor→"watch"/brand.
  - **The diagnosis sentence VERBATIM**: `diagnosis.diagnosis` rendered as deep-ink body text. **Teacher-only** — this string may contain `%`/digits and MUST NOT be forwarded to any other audience surface (it is fine here; Roster is teacher-only).
  - **Meta row:** `<MasteryLabel band={r.band} />` (join the roster item by `student_id`) · if `volatile` → "∿ moving around lately" (warn-tone text+glyph) · if `risk.risk_factors.length` → "△ {risk.risk_factors[0]}" (first factor only) · **"look closer ›"** link → `/students/{student_id}?from=roster&class={classId}` (the One-Student screen; deep-link by `student_id`, never `full_name`).
- **Rough-week fallback:** if `focus_group.length > 6`, render the top 6 cards at full treatment and collapse the remainder into a "+N more need attention ▾" disclosure (same card component, lighter). Prevents a wall of coral.

### Part 5 — "Everyone else (N) ▾" disclosure
- A `'use client'` collapsed section (closed by default). Contents: `roster[]` **minus** the `focus_group` student_ids — a compact list (name + `<MasteryLabel band />` + "look closer ›").
- **RiskBadge shown ONLY when `risk.risk_level` is `medium`/`high`/`critical`** (`<RiskBadge band={r.risk.risk_level} />`); `low` shows nothing. **Never** pass `score`; `risk.risk_score` must not reach the DOM.

### Part 6 — Right rail: "The whole class is stuck on"
- Source: `concept_gaps[]`. For each gap: render **`skill_name`** (the new JOIN; if `null`, fall back to "a skill we're still naming" — never the raw `skill_id`) + a **words** phrase from `pctIncorrectToWords(gap.pct_incorrect)` (e.g. "most of the class missed this").
- **Empty (the common demo case):** `<EmptyState variant="on-track" titleOverride="No class-wide gaps" bodyOverride="No single skill is tripping up the group right now." />`.
- On a narrow viewport the rail stacks below Part 4.

## 4. Components

**Reuse (unchanged):** `MasteryLabel` (`band` prop, handles null) · `RiskBadge` (`band` prop only) · `EmptyState` (variants + `titleOverride`/`bodyOverride`) · `Card` · `ClassSwitcherPill` (in layout).

**New — under `src/app/(teacher)/roster/_components/`:**
- `ClassPulseStrip.tsx` (server) — props `{ counts: { reteach: number; grade_level: number; advanced: number; not_assessed: number } }`. Segmented bar + dot+word+count legend.
- `RosterTriageCard.tsx` (server) — props `{ item: FocusGroupItem; rosterById: Record<string, RosterItem>; classId: string }`. Renders one triage card per §3 Part 4. (Pure presentational; receives the joined roster item via `rosterById[item.student_id]`.)
- `ActionChip.tsx` (server) — props `{ action: SuggestedAction }`. Renders label + tone via `actionChipLabel`.
- `EveryoneElseDisclosure.tsx` (`'use client'`) — props `{ others: RosterItem[]; classId: string }`. Collapsed list; RiskBadge at medium+.
- `ConceptGapsRail.tsx` (server) — props `{ gaps: ConceptGapItem[] }`.
- `SignalLegend.tsx` (`'use client'`) — the "what do these mean?" disclosure.
- `RosterCardOverflow.tsx` (`'use client'`) — the rough-week "+N more ▾" disclosure (optional; can fold into the page).

**Styling:** Tier-2/Tier-3 token classes only (no hardcoded hex, no arbitrary `[var(--..)]`); content text `text-fg` (deep-ink), `text-fg-muted` only for eyebrows/meta labels. Must pass the WCAG-AA contrast gate (`npm run a11y`).

## 5. Copy helpers

**New — `src/lib/copy/actionChipLabel.ts`:**
```typescript
import type { SuggestedAction } from '@/lib/copy/diagnosisToFeedSentence';
export type ChipTone = 'risk' | 'warn' | 'brand';
export interface ActionChip { label: string; tone: ChipTone; }
export function actionChipLabel(action: SuggestedAction): ActionChip {
  switch (action) {
    case 'reteach':      return { label: 'reteach now', tone: 'risk' };
    case 'verbal_check': return { label: 'check in',    tone: 'warn' };
    case 'practice':     return { label: 'practice',    tone: 'warn' };
    case 'profile':      return { label: 'look closer', tone: 'brand' };
    case 'monitor':      return { label: 'watch',       tone: 'brand' };
  }
}
// Labels are static, leak-free; no need for assertNoLeak (no interpolation).
```
Tone → token classes (mapped in `ActionChip`): `risk`→`bg-risk-surface text-risk-fg`, `warn`→`bg-warn-surface text-warn-fg`, `brand`→`bg-brand-surface text-brand-fg`.

**New — focus-group sort comparator** (inline in the page or `src/lib/signals/sortFocusGroup.ts`): severity DESC → action-priority ASC → name. Keep pure + unit-testable.

**Reuse:** `pctIncorrectToWords` (concept rail) · `masteryDisplayLabel` (via `MasteryLabel` + the pulse legend). **Do NOT** use `riskBandLabel(score)` — read `risk.risk_level` directly.

## 6. Leak discipline (enforced by a dedicated test)

A `roster.leak.test.tsx` (jsdom) renders the full page/section tree with a mock payload whose `risk.risk_score` values are distinctive numbers (e.g. 73, 91) and whose `concept_gaps[].question_text` is `skill:secret`, then asserts:
1. The rendered DOM (`container.innerHTML`) contains **no** `risk_score` digit substrings and no `data-*` carrying a score.
2. The raw `skill_id` string (`skill:secret`) appears **nowhere**; only `skill_name` does.
3. `risk.risk_level` band words DO appear (for medium+ in the disclosure).
4. `diagnosis.diagnosis` verbatim text DOES appear in a triage card (teacher-only is allowed here) — guards against over-sanitizing.

## 7. Testing

- **`loadRosterSignals`** (node): the skill_name JOIN — given misconception rows + a skills table, `concept_gaps[].skill_name` is populated, `null` when the skill row is missing; existing roster/focus_group/concept_gaps shape unchanged.
- **`roster-signals/route`**: existing test still green after the extraction (thin wrapper).
- **Page + components** (jsdom, `// @vitest-environment jsdom` + `import '@/test/setup-dom'`): summary counts correct; pulse segments+legend match band counts; focus_group rendered **in sorted order** (severity DESC); action chips map correctly; volatility marker shows only when `volatile`; first risk factor only; "look closer ›" hrefs carry `student_id` + `?from=roster&class=`; Everyone-else shows RiskBadge only at medium+; concept rail renders `skill_name` + pct-as-words, and the EmptyState when gaps is empty; no-class EmptyState when `?class=` absent.
- **`actionChipLabel`** + the sort comparator: pure unit tests.

## 8. Out of scope (explicit)

- The **One-Student** screen (the "look closer ›" target) — separate spec/build; Roster only links to it by `student_id`.
- Per-student **growth** on the Roster (the design uses mastery/volatility/risk, not growth; `growth_history` is not in this payload and is not added here).
- Writes (flag-for-reteach, notes, high-fives) — those belong to Gradebook/One-Student/Alerts; Roster is read-only triage.
- Gradebook grid, Alerts/High-Fives, Insights, Library/Studio — their own specs.
- The "Board" (kanban) and "Ledger" (sortable table) alternates to Direction A — held for later if we ever want a Board|List pair.

## 9. Self-review notes

- **Placeholders:** none — every data binding maps to a grounded field; the one new API field (`skill_name`) and one new helper (`actionChipLabel`) are fully specified.
- **Consistency:** band null handled everywhere (summary count, MasteryLabel, pulse "not assessed" segment); risk read via `risk_level` consistently; focus_group sorted in-page since the API doesn't sort.
- **Scope:** single screen + one small additive API change (the JOIN) + the loadRosterSignals extraction. Independently shippable/testable.
- **Ambiguity:** the concept rail's `skill_name===null` fallback is explicit ("a skill we're still naming", never the raw id); rough-week cap fixed at >6.
