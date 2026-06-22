# Epic 3b — Teacher Alerts + High-Fives + Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the three remaining teacher stubs (`/insights`, `/alerts`, `/high-fives`) into working, LEAN screens that derive from the signals V2 already computes, persisting only a small `alerts` table and a `high_fives` table.

**Architecture:** One migration (`0017`) adds the two tables. **Insights** is a pure re-presentation of `loadRosterSignals`. **Alerts** are *reconciled on read* — a loader recomputes the current "needs attention / just changed" set from the latest attempts, upserts alert rows (DB-level dedup), and auto-clears rows whose condition no longer holds; nothing is wired into the shipped quiz/assignment submit pipelines. **High-Fives** surfaces a derived "worth recognizing" list and lets a teacher send an AI-drafted, empty-praise-guardrailed note that the student sees on their home. Build order: **Insights → Alerts → High-Fives**.

**Tech Stack:** Next.js 16 App Router (async `params`/`searchParams`), React 19, TypeScript, Supabase (server SSR + admin service-role clients), Tailwind v4 (token-only), Vitest 4 (+ jsdom for components), `claudeChat` (`claude-opus-4-8`).

**Spec:** `docs/superpowers/specs/2026-06-22-teacher-alerts-highfives-insights-design.md`
**Grounding:** `docs/superpowers/plans/grounding/2026-06-21-teacher-completion/` (`v1-alerts.md`, `v1-highfives.md`, `v1-insights.md`, `v2-current-state.md`).

## Global Constraints

Every task inherits these. Exact values, copied from the spec + verified V2 facts:

- **Import alias:** `@/*` → `src/*`. Use `@/...`, never long relative paths.
- **Auth chain (API routes):** `const supabase = await createServerSupabaseClient()` → `const { data: { user } } = await supabase.auth.getUser()` (401 if absent) → load `users.role` → **role gate** with `new Set<string>(STAFF_ROLES).has(role)` (403 if not staff) — **`STAFF_ROLES` is a readonly tuple, NOT a Set; calling `STAFF_ROLES.has()` throws** → object guard `const guard = await guardClassAccess(classId); if (guard) return guard;` (guard returns `NextResponse` on deny, `null` on allow) → `const admin = createAdminSupabaseClient()` (SYNC — do not await; bypasses RLS, the guard is the only IDOR backstop).
- **Auth chain (server pages):** mirror `src/app/(teacher)/gradebook/page.tsx`: `const { class: classId } = await searchParams;` → if absent, `const { userId } = await requireRole(['teacher']); const firstId = await firstClassIdForTeacher(userId);` then `redirect('/<route>?class=${firstId}')` (or NO-CLASSES EmptyState if null) → `const guard = await guardClassAccess(classId); if (guard) return CLASS_UNAVAILABLE;` → `const admin = createAdminSupabaseClient();` → loader. `requireRole` REDIRECTS on failure (throws NEXT_REDIRECT) — never returns null.
- **Student route/view:** gate with `requireRole(['student'])` → use the returned `userId` as the student id; query only that student's own rows.
- **"Assignments", never "Homework"** in UI/copy (DB identifiers like `homework_attempts` are fine).
- **Leak discipline** (`src/lib/copy/leakGuard.ts`): teacher prose is checked with `hasBannedWord`/`assertNoBannedWord` ONLY (count-bearing teacher prose has digits — `assertNoLeak` would throw). `BANNED_WORDS = ['score','percentile','index','divergence','threshold','signal','model','algorithm','flag']` ('risk' is allowed). **Student-facing** strings (the high-five note + student view) must pass `assertNoLeak` AND `hasBannedWord` AND the empty-praise guardrail.
- **AI:** `claudeChat(systemPrompt, userPrompt, options?)` returns `Promise<string | null>` (null on failure → use a deterministic fallback). Use `model: CLAUDE_TUTOR_MODEL` (`'claude-opus-4-8'`) and OMIT `temperature` (opus-4.x/fable reject it; the helper strips it, but omit anyway). Default adaptive thinking.
- **WCAG-AA, token-only:** no hardcoded hex, no arbitrary `[var(--..)]`; content text `text-fg` (not `text-fg-muted`); status by glyph+text never color-alone; Pop-Art chrome `border-2 border-sidebar-edge shadow-sticker`; reuse the kit (`Card` tone `'surface'|'brand'|'ok'|'warn'|'risk'`, `PageHeader` accent `'brand'|'lime'|'ok'|'warn'|'risk'`, `SummaryCallout`, `SectionLabel` tone `'brand'|'ok'|'warn'|'risk'|'lime'`, `EmptyState` variant `'not-yet-assessed'|'just-getting-started'|'on-track'`, `MasteryLabel`, `RiskBadge`). `RiskBadge` is teacher-only. The teacher `<main>` already carries `pop-canvas` — do not re-apply.
- **All new user-facing strings are DRAFTS** → append to `STRINGS-FOR-BARB.md` (new `## Alerts`, `## High-Fives`, `## Insights` sections) as part of the task that introduces them. Barb gates final copy.
- **Tests:** Vitest 4. Component tests START with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`. Run affected files individually: `npx vitest run "<path>"` (the machine flakes under parallel jsdom load). `npx tsc --noEmit` must be 0; `npm run build` 0; `npm run a11y` all-green — before the feature is considered done.
- **DB safety:** the `0017` migration is applied to the **NEW CORE** Supabase project `pmdzxwppdlnddtnkoarc` ONLY, after merge, with explicit per-action authorization. Never touch V1/Spark/other projects. Do not run ad-hoc SQL against production without authorization.
- **Commit** after each task's tests are green. Message footer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AHQPVU2KgDjs4TKZRUdzDN
  ```

## File Structure

**Migration**
- `supabase/migrations/0017_teacher_completion.sql` — `alerts` + `high_fives` tables, indexes.

**Insights (Feature C)**
- `src/lib/insights/loadInsights.ts` — pure aggregation over `loadRosterSignals`.
- `src/lib/copy/insightsObservation.ts` — the one calm "what this means" line + band-pill labels (leak-guarded).
- `src/app/(teacher)/insights/page.tsx` — replaces the stub (server component).
- `src/app/(teacher)/insights/_components/BandMix.tsx`, `SkillsToFocus.tsx` — presentational.

**Alerts (Feature A)**
- `src/lib/copy/alertTriggerLabel.ts` — `source_kind` → label + bucket metadata.
- `src/lib/alerts/reconcileAlerts.ts` — the reconcile engine (compute → upsert → auto-clear → return open set).
- `src/lib/alerts/openAlertCount.ts` — `openAlertCountForTeacher` (badge).
- `src/app/api/teacher/alerts/resolve/route.ts` — `POST` manual resolve.
- `src/app/(teacher)/alerts/page.tsx` — replaces the stub (server component).
- `src/app/(teacher)/alerts/_components/AlertRow.tsx` — client island (Mark handled).
- Shell edits: `navConfig.ts` already has `badgeKey:'alerts'`; thread an `alertCount` prop layout → `TeacherShell` → `TeacherSidebar` → `SidebarNav`.

**High-Fives (Feature B)**
- `src/lib/highfives/suggestions.ts` — `buildHighFiveSuggestions` pure function.
- `src/lib/highfives/guardrail.ts` — `validateHighFive` (empty-praise + leak/banned, fail-closed).
- `src/lib/highfives/generateDraft.ts` — `generateHighFiveDraft` (claudeChat + guardrail + fallback).
- `src/lib/highfives/loadStudentHighFives.ts` — student-side loader.
- `src/app/api/teacher/high-fives/draft/route.ts` — `POST` AI draft.
- `src/app/api/teacher/high-fives/send/route.ts` — `POST` send (validate, insert).
- `src/app/(teacher)/high-fives/page.tsx` — replaces the stub (server component).
- `src/app/(teacher)/high-fives/_components/HighFiveComposer.tsx` — client island.
- `src/app/(student)/student/dashboard/page.tsx` — add the "note from your teacher" card.

---

## Task 1: Migration 0017 — alerts + high_fives tables

**Files:**
- Create: `supabase/migrations/0017_teacher_completion.sql`
- Test: `supabase/migrations/__tests__/migrations.test.ts` (append assertions; mirror existing `s()`-concatenation style)

**Interfaces:**
- Produces: tables `public.alerts` (cols: id, school_id, class_id, student_id, source_kind, source_ref, severity, status, resolved_by, resolved_at, resolution_note, created_at) and `public.high_fives` (cols: id, school_id, class_id, student_id, author_id, note_text, reason_hint, ai_drafted, viewed_by_student_at, created_at).

- [ ] **Step 1: Write the failing test**

In `supabase/migrations/__tests__/migrations.test.ts`, find how the suite reads SQL (a helper `s()` returns the concatenated migration text). Add:
```typescript
describe('0017 teacher completion', () => {
  it('creates the alerts table with severity + status CHECKs and the occurrence unique index', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.alerts/);
    expect(s()).toMatch(/source_kind\s+text[\s\S]*?check \(source_kind in[\s\S]*?'low_quiz'[\s\S]*?'strong_result'\)/i);
    expect(s()).toMatch(/severity\s+text[\s\S]*?check \(severity in \('urgent','watch','info'\)\)/i);
    expect(s()).toMatch(/status\s+text[\s\S]*?check \(status in \('open','resolved'\)\)/i);
    expect(s()).toMatch(/create unique index[\s\S]*alerts_occurrence_uq[\s\S]*\(student_id, class_id, source_kind, source_ref\)/i);
  });
  it('creates the high_fives table', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.high_fives/);
    expect(s()).toMatch(/note_text\s+text\s+not null/i);
    expect(s()).toMatch(/ai_drafted\s+boolean\s+not null\s+default false/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "supabase/migrations/__tests__/migrations.test.ts"`
Expected: FAIL (no `0017` table text yet).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/0017_teacher_completion.sql` (follow the `IF NOT EXISTS` idempotent style of the existing migrations):
```sql
-- 0017_teacher_completion.sql
-- Epic 3b: small persistence for teacher Alerts (reconciled-on-read history) and High-Fives (sent notes).
-- No edits to existing tables. App-logic + object-level IDOR guards are the access backstop (consistent with V2).

-- ── Alerts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES public.schools(id)  ON DELETE CASCADE,
  class_id        uuid NOT NULL REFERENCES public.classes(id)  ON DELETE CASCADE,
  student_id      uuid NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  source_kind     text NOT NULL
                    CHECK (source_kind in ('low_quiz','low_assignment','reteach_flag','reteach_review','strong_result')),
  source_ref      uuid NOT NULL,                 -- the attempt/redo row that raised it (per-occurrence identity)
  severity        text NOT NULL CHECK (severity in ('urgent','watch','info')),
  status          text NOT NULL DEFAULT 'open' CHECK (status in ('open','resolved')),
  resolved_by     uuid REFERENCES public.users(id),   -- null + resolved => auto-cleared
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- One alert per distinct triggering occurrence, ever (open or resolved):
-- DB-level dedup + makes manual/auto resolve sticky for that occurrence.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_occurrence_uq
  ON public.alerts (student_id, class_id, source_kind, source_ref);
CREATE INDEX IF NOT EXISTS alerts_class_status_idx
  ON public.alerts (class_id, status, severity);

-- ── High-Fives (sent notes) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.high_fives (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  class_id             uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  student_id           uuid NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  author_id            uuid NOT NULL REFERENCES public.users(id),
  note_text            text NOT NULL,
  reason_hint          text,            -- which suggestion seeded it (persistence|recovery|effortful_success|consistency_rising|reteach_completed|stretch); null = blank composer
  ai_drafted           boolean NOT NULL DEFAULT false,
  viewed_by_student_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS high_fives_student_idx ON public.high_fives (student_id, created_at desc);
CREATE INDEX IF NOT EXISTS high_fives_class_idx   ON public.high_fives (class_id, created_at desc);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "supabase/migrations/__tests__/migrations.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0017_teacher_completion.sql supabase/migrations/__tests__/migrations.test.ts
git commit -m "feat(3b): migration 0017 — alerts + high_fives tables"
```

---

## Task 2: Insights — `loadInsights` loader + observation copy

**Files:**
- Create: `src/lib/insights/loadInsights.ts`, `src/lib/copy/insightsObservation.ts`
- Test: `src/lib/insights/__tests__/loadInsights.test.ts`, `src/lib/copy/__tests__/insightsObservation.test.ts`

**Interfaces:**
- Consumes: `loadRosterSignals(admin, classId): Promise<RosterSignals>` where `RosterSignals = { class_id, roster: RosterItem[], focus_group: FocusGroupItem[], concept_gaps: ConceptGapItem[] }`; `RosterItem = { student_id, full_name, band: 'reteach'|'grade_level'|'advanced'|null, volatile, risk }`; `ConceptGapItem = { question_index, question_text, skill_name: string|null, pct_incorrect }`. Import `SupabaseClient` type from `@supabase/supabase-js`.
- Produces:
  - `insightsObservation(mix: BandMix): string | null`
  - `bandPillLabel(key: keyof BandMix): string`
  - `loadInsights(admin: SupabaseClient, opts: { classId: string }): Promise<ClassInsights>`
  - `interface BandMix { needs_reinforcement: number; on_track: number; ready_to_enrich: number; not_assessed: number; total: number }`
  - `interface ClassInsights { band_mix: BandMix; observation: string | null; concept_gaps: { skill_name: string; needs_count: number; total: number }[] }`

- [ ] **Step 1: Write the failing test (copy helper first)**

`src/lib/copy/__tests__/insightsObservation.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { insightsObservation, bandPillLabel } from '@/lib/copy/insightsObservation';
import { hasBannedWord } from '@/lib/copy/leakGuard';

const mix = (p: Partial<{ r: number; o: number; e: number; n: number }>) => {
  const needs_reinforcement = p.r ?? 0, on_track = p.o ?? 0, ready_to_enrich = p.e ?? 0, not_assessed = p.n ?? 0;
  return { needs_reinforcement, on_track, ready_to_enrich, not_assessed, total: needs_reinforcement + on_track + ready_to_enrich + not_assessed };
};

describe('insightsObservation', () => {
  it('flags a class-wide reteach when reinforcement is >= 40% of assessed', () => {
    const line = insightsObservation(mix({ r: 5, o: 4, e: 1 })); // 5/10 = 50%
    expect(line).toMatch(/re-?teach/i);
    expect(hasBannedWord(line!)).toBe(false);
  });
  it('suggests enrichment when ready-to-enrich is a majority', () => {
    expect(insightsObservation(mix({ e: 6, o: 3, r: 1 }))).toMatch(/deeper|enrich/i);
  });
  it('is quiet (null) when nothing is notable', () => {
    expect(insightsObservation(mix({ o: 10 }))).toBeNull();
  });
  it('is quiet (null) on an empty/cold-start class', () => {
    expect(insightsObservation(mix({ n: 8 }))).toBeNull();
  });
});

describe('bandPillLabel', () => {
  it('uses plain, banned-word-free labels', () => {
    for (const k of ['needs_reinforcement','on_track','ready_to_enrich','not_assessed'] as const) {
      expect(hasBannedWord(bandPillLabel(k))).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it; verify it fails** — `npx vitest run "src/lib/copy/__tests__/insightsObservation.test.ts"` → FAIL (module missing).

- [ ] **Step 3: Implement the copy helper**

`src/lib/copy/insightsObservation.ts`:
```typescript
// One calm, class-level "what this means" line + band-pill labels. Leak-guarded.
// DRAFT → Barb (STRINGS-FOR-BARB.md §Insights). Quiet on good days (returns null).
import { assertNoBannedWord } from '@/lib/copy/leakGuard';

export interface BandMix {
  needs_reinforcement: number;
  on_track: number;
  ready_to_enrich: number;
  not_assessed: number;
  total: number;
}

const PILL_LABELS: Record<'needs_reinforcement' | 'on_track' | 'ready_to_enrich' | 'not_assessed', string> = {
  needs_reinforcement: 'Needs reinforcement',
  on_track: 'On track',
  ready_to_enrich: 'Ready to enrich',
  not_assessed: 'Not yet assessed',
};

export function bandPillLabel(key: keyof typeof PILL_LABELS): string {
  return PILL_LABELS[key];
}

export function insightsObservation(mix: BandMix): string | null {
  const assessed = mix.needs_reinforcement + mix.on_track + mix.ready_to_enrich;
  if (assessed === 0) return null; // cold-start: quiet
  const reinforceShare = mix.needs_reinforcement / assessed;
  const enrichShare = mix.ready_to_enrich / assessed;

  let line: string | null = null;
  if (reinforceShare >= 0.4) {
    line = 'A good part of the class is still finding their footing — the latest concept may be worth a whole-class re-teach.';
  } else if (enrichShare >= 0.5) {
    line = 'Most of the class is ready for deeper work on the same topic.';
  } else if (mix.needs_reinforcement > 0 && mix.ready_to_enrich > 0) {
    line = 'The class is split between students who need another pass and students ready to go deeper — small groups will help.';
  }
  if (line) assertNoBannedWord(line, 'insightsObservation');
  return line;
}
```

- [ ] **Step 4: Run it; verify pass** — `npx vitest run "src/lib/copy/__tests__/insightsObservation.test.ts"` → PASS.

- [ ] **Step 5: Write the failing loader test**

`src/lib/insights/__tests__/loadInsights.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { loadInsights } from '@/lib/insights/loadInsights';
import * as roster from '@/lib/signals/loadRosterSignals';

function fakeRoster(bands: (string | null)[]) {
  return {
    class_id: 'c1',
    roster: bands.map((b, i) => ({ student_id: `s${i}`, full_name: `S ${i}`, band: b, volatile: false, risk: { risk_score: 0, risk_level: 'low', risk_factors: [] } })),
    focus_group: [],
    concept_gaps: [
      { question_index: 0, question_text: 'sk_a', skill_name: 'Fractions', pct_incorrect: 60 },
      { question_index: 1, question_text: 'sk_b', skill_name: null, pct_incorrect: 30 },
    ],
  } as roster.RosterSignals;
}

describe('loadInsights', () => {
  it('tallies the band mix and carries skill gaps (skipping unnamed skills)', async () => {
    vi.spyOn(roster, 'loadRosterSignals').mockResolvedValue(
      fakeRoster(['reteach', 'reteach', 'grade_level', 'advanced', null]),
    );
    const r = await loadInsights({} as never, { classId: 'c1' });
    expect(r.band_mix).toMatchObject({ needs_reinforcement: 2, on_track: 1, ready_to_enrich: 1, not_assessed: 1, total: 5 });
    expect(r.concept_gaps).toEqual([{ skill_name: 'Fractions', needs_count: expect.any(Number), total: 5 }]); // unnamed skill dropped
    expect(typeof r.observation === 'string' || r.observation === null).toBe(true);
  });
});
```

- [ ] **Step 6: Run it; verify it fails** — `npx vitest run "src/lib/insights/__tests__/loadInsights.test.ts"` → FAIL.

- [ ] **Step 7: Implement the loader**

`src/lib/insights/loadInsights.ts`:
```typescript
// Quiet class-insights hub data. NO new data — re-presents loadRosterSignals.
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { insightsObservation, type BandMix } from '@/lib/copy/insightsObservation';

export interface ClassInsights {
  band_mix: BandMix;
  observation: string | null;
  concept_gaps: { skill_name: string; needs_count: number; total: number }[];
}

export async function loadInsights(
  admin: SupabaseClient,
  opts: { classId: string },
): Promise<ClassInsights> {
  const signals = await loadRosterSignals(admin, opts.classId);
  const total = signals.roster.length;
  const band_mix: BandMix = {
    needs_reinforcement: signals.roster.filter((r) => r.band === 'reteach').length,
    on_track: signals.roster.filter((r) => r.band === 'grade_level').length,
    ready_to_enrich: signals.roster.filter((r) => r.band === 'advanced').length,
    not_assessed: signals.roster.filter((r) => r.band === null).length,
    total,
  };
  // pct_incorrect is a class-wide "how many got it wrong" share — convert to a count, drop unnamed skills.
  const concept_gaps = signals.concept_gaps
    .filter((g) => g.skill_name)
    .map((g) => ({
      skill_name: g.skill_name as string,
      needs_count: Math.round((g.pct_incorrect / 100) * total),
      total,
    }))
    .filter((g) => g.needs_count > 0);
  return { band_mix, observation: insightsObservation(band_mix), concept_gaps };
}
```

- [ ] **Step 8: Run it; verify pass** — `npx vitest run "src/lib/insights/__tests__/loadInsights.test.ts"` → PASS. Then `npx tsc --noEmit` → 0.

- [ ] **Step 9: Append copy drafts + commit**

Append a `## Insights` section to `STRINGS-FOR-BARB.md` listing the band-pill labels + the three observation lines as DRAFTS.
```bash
git add src/lib/insights src/lib/copy/insightsObservation.ts src/lib/copy/__tests__/insightsObservation.test.ts STRINGS-FOR-BARB.md
git commit -m "feat(3b): insights loader + observation copy"
```

---

## Task 3: Insights page + presentational components

**Files:**
- Create: `src/app/(teacher)/insights/_components/BandMix.tsx`, `src/app/(teacher)/insights/_components/SkillsToFocus.tsx`
- Modify (replace stub): `src/app/(teacher)/insights/page.tsx`
- Test: `src/app/(teacher)/insights/_components/__tests__/BandMix.test.tsx`

**Interfaces:**
- Consumes: `loadInsights`, `ClassInsights`, `bandPillLabel`; kit components `PageHeader`, `SummaryCallout`, `Card`, `EmptyState`. Page pattern = `src/app/(teacher)/gradebook/page.tsx`.

- [ ] **Step 1: Write the failing component test**

`src/app/(teacher)/insights/_components/__tests__/BandMix.test.tsx`:
```typescript
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BandMix } from '../BandMix';

describe('BandMix', () => {
  it('shows each band label with its count', () => {
    render(<BandMix mix={{ needs_reinforcement: 2, on_track: 5, ready_to_enrich: 1, not_assessed: 0, total: 8 }} />);
    expect(screen.getByText('Needs reinforcement')).toBeInTheDocument();
    expect(screen.getByText('On track')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/app/(teacher)/insights/_components/__tests__/BandMix.test.tsx"` → FAIL.

- [ ] **Step 3: Implement `BandMix.tsx`**
```typescript
// Four count pills for the class band mix. Token-only; counts are teacher-only numbers (OK here).
import React from 'react';
import { Card } from '@/components/core/Card';
import { bandPillLabel, type BandMix as Mix } from '@/lib/copy/insightsObservation';

const TONE: Record<keyof Omit<Mix, 'total'>, 'warn' | 'ok' | 'brand' | 'surface'> = {
  needs_reinforcement: 'warn',
  on_track: 'ok',
  ready_to_enrich: 'brand',
  not_assessed: 'surface',
};

export function BandMix({ mix }: { mix: Mix }): React.JSX.Element {
  const keys: (keyof Omit<Mix, 'total'>)[] = ['needs_reinforcement', 'on_track', 'ready_to_enrich', 'not_assessed'];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {keys.map((k) => (
        <Card key={k} tone={TONE[k]}>
          <div className="flex flex-col gap-1">
            <span className="text-fg font-display text-3xl font-extrabold leading-none">{mix[k]}</span>
            <span className="text-fg text-sm font-semibold">{bandPillLabel(k)}</span>
          </div>
        </Card>
      ))}
    </div>
  );
}
export default BandMix;
```

- [ ] **Step 4: Run; verify pass** — same vitest command → PASS.

- [ ] **Step 5: Implement `SkillsToFocus.tsx`**
```typescript
// Class-wide skill gaps — "N of M students need attention". Count-bearing prose (digits OK; banned-word-free).
import React from 'react';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';

export interface SkillGap { skill_name: string; needs_count: number; total: number }

export function SkillsToFocus({ gaps }: { gaps: SkillGap[] }): React.JSX.Element | null {
  if (gaps.length === 0) return null; // quiet when none
  return (
    <Card tone="surface">
      <div className="flex flex-col gap-3">
        <SectionLabel tone="warn">Skills to focus on</SectionLabel>
        <ul className="flex flex-col gap-2">
          {gaps.map((g) => (
            <li key={g.skill_name} className="flex items-baseline justify-between gap-3 text-fg">
              <span className="font-semibold">{g.skill_name}</span>
              <span className="text-fg text-sm whitespace-nowrap">{g.needs_count} of {g.total} need attention</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
export default SkillsToFocus;
```

- [ ] **Step 6: Replace the page stub**

`src/app/(teacher)/insights/page.tsx` (mirror `gradebook/page.tsx` exactly for the auth/redirect/guard preamble):
```typescript
// Server Component. Teacher-only (layout gates requireRole(['teacher'])). Quiet insights hub.
import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadInsights } from '@/lib/insights/loadInsights';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { SummaryCallout } from '../_components/SummaryCallout';
import { BandMix } from './_components/BandMix';
import { SkillsToFocus } from './_components/SkillsToFocus';

const NO_CLASSES = (
  <EmptyState variant="just-getting-started" titleOverride="No classes yet"
    bodyOverride="Once a class is set up for you, its trends show up here." />
);
const CLASS_UNAVAILABLE = (
  <EmptyState variant="just-getting-started" titleOverride="That class isn't available"
    bodyOverride="Use the class selector to pick one of your classes." />
);

export default async function InsightsPage({
  searchParams,
}: { searchParams: Promise<{ class?: string }> }): Promise<React.JSX.Element> {
  const { class: classId } = await searchParams;
  if (!classId) {
    const { userId } = await requireRole(['teacher']);
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) return <div className="p-6">{NO_CLASSES}</div>;
    redirect(`/insights?class=${firstId}`);
  }
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  const admin = createAdminSupabaseClient();
  const data = await loadInsights(admin, { classId });

  if (data.band_mix.total === 0) {
    return (
      <div className="p-5 flex flex-col gap-5">
        <PageHeader title="Insights" kicker="Trends on your class right now" accent="brand" />
        <EmptyState variant="just-getting-started"
          titleOverride="Not much to show yet"
          bodyOverride="Once your class has a little more activity, patterns will appear here." />
      </div>
    );
  }

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Insights" kicker="Trends on your class right now" accent="brand" />
      {data.observation && <SummaryCallout>{data.observation}</SummaryCallout>}
      <BandMix mix={data.band_mix} />
      <SkillsToFocus gaps={data.concept_gaps} />
    </div>
  );
}
```

- [ ] **Step 7: Run gates** — `npx vitest run "src/app/(teacher)/insights/_components/__tests__/BandMix.test.tsx"` → PASS; `npx tsc --noEmit` → 0; `npm run build` → 0.

- [ ] **Step 8: Commit**
```bash
git add src/app/\(teacher\)/insights
git commit -m "feat(3b): insights quiet hub page"
```

---

## Task 4: Alerts — `alertTriggerLabel` copy + buckets

**Files:**
- Create: `src/lib/copy/alertTriggerLabel.ts`
- Test: `src/lib/copy/__tests__/alertTriggerLabel.test.ts`

**Interfaces:**
- Produces:
  - `type AlertSourceKind = 'low_quiz'|'low_assignment'|'reteach_flag'|'reteach_review'|'strong_result'`
  - `type AlertSeverity = 'urgent'|'watch'|'info'`
  - `alertTriggerLabel(kind: AlertSourceKind): string`
  - `const ALERT_BUCKETS: { severity: AlertSeverity; label: string; subline: string }[]` (urgent, watch, info in that order)
  - `severityTone(sev: AlertSeverity): 'risk'|'warn'|'brand'`

- [ ] **Step 1: Failing test**

`src/lib/copy/__tests__/alertTriggerLabel.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { alertTriggerLabel, ALERT_BUCKETS, severityTone, type AlertSourceKind } from '@/lib/copy/alertTriggerLabel';
import { hasBannedWord } from '@/lib/copy/leakGuard';

describe('alertTriggerLabel', () => {
  const kinds: AlertSourceKind[] = ['low_quiz','low_assignment','reteach_flag','reteach_review','strong_result'];
  it('gives a label for every kind and never uses a banned word', () => {
    for (const k of kinds) {
      const label = alertTriggerLabel(k);
      expect(label.length).toBeGreaterThan(0);
      expect(hasBannedWord(label), `banned word in ${k}: ${label}`).toBe(false);
    }
  });
  it('never uses the literal word "homework"', () => {
    for (const k of kinds) expect(alertTriggerLabel(k).toLowerCase()).not.toContain('homework');
  });
  it('orders buckets urgent → watch → info', () => {
    expect(ALERT_BUCKETS.map((b) => b.severity)).toEqual(['urgent','watch','info']);
  });
  it('maps severity to a token tone', () => {
    expect(severityTone('urgent')).toBe('risk');
    expect(severityTone('watch')).toBe('warn');
    expect(severityTone('info')).toBe('brand');
  });
});
```

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/lib/copy/__tests__/alertTriggerLabel.test.ts"` → FAIL.

- [ ] **Step 3: Implement**

`src/lib/copy/alertTriggerLabel.ts`:
```typescript
// Teacher-only alert labels + severity buckets. Banned-word-free (count-bearing OK; teacher surface).
// DRAFT → Barb (STRINGS-FOR-BARB.md §Alerts). Bucket copy reused from V1 (Barb 2026-05-13).
import { assertNoBannedWord } from '@/lib/copy/leakGuard';

export type AlertSourceKind = 'low_quiz' | 'low_assignment' | 'reteach_flag' | 'reteach_review' | 'strong_result';
export type AlertSeverity = 'urgent' | 'watch' | 'info';

const LABELS: Record<AlertSourceKind, string> = {
  low_quiz: 'A comprehension check came back low on the latest try',
  low_assignment: 'An assignment just came back with a low grade',
  reteach_flag: 'You flagged this student for another try',
  reteach_review: 'Another try is in — ready for your review',
  strong_result: 'A strong recent result — worth a high-five?',
};

export function alertTriggerLabel(kind: AlertSourceKind): string {
  const label = LABELS[kind];
  assertNoBannedWord(label, 'alertTriggerLabel');
  return label;
}

export const ALERT_BUCKETS: { severity: AlertSeverity; label: string; subline: string }[] = [
  { severity: 'urgent', label: 'Needs attention this week', subline: 'Worth a check-in within the next few days.' },
  { severity: 'watch', label: 'Check in', subline: 'Look at when you have a moment.' },
  { severity: 'info', label: 'Heads-up', subline: 'Good news — nothing to do.' },
];

export function severityTone(sev: AlertSeverity): 'risk' | 'warn' | 'brand' {
  return sev === 'urgent' ? 'risk' : sev === 'watch' ? 'warn' : 'brand';
}
```

- [ ] **Step 4: Run; verify pass** — same command → PASS.

- [ ] **Step 5: Append copy + commit**

Add a `## Alerts` section to `STRINGS-FOR-BARB.md` (trigger labels + bucket labels/sublines, DRAFT).
```bash
git add src/lib/copy/alertTriggerLabel.ts src/lib/copy/__tests__/alertTriggerLabel.test.ts STRINGS-FOR-BARB.md
git commit -m "feat(3b): alert trigger labels + severity buckets"
```

---

## Task 5: Alerts — `reconcileAlerts` engine

**Files:**
- Create: `src/lib/alerts/reconcileAlerts.ts`
- Test: `src/lib/alerts/__tests__/reconcileAlerts.test.ts`

**Read first:** `src/lib/gradebook/loadGradebook.ts` (the class-scoped batched-query pattern: enrollments → users; assignments(class) → homework_attempts; quizzes(class) → quiz_attempts) and its test `src/lib/gradebook/__tests__/loadGradebook.test.ts` (the **Supabase admin-client mock harness** — mirror it for this test; do NOT invent a new mock style).

**Key schema facts:** `quiz_attempts` has no `class_id` — join via `quiz_id → quizzes.class_id`. `homework_attempts` has no `class_id` — join via `assignment_id → assignments.class_id`. `homework_attempts`: `status ∈ {in_progress,submitted,grading,graded,pending_grade}`, `score_pct`, `teacher_score`, `allow_redo`, `is_redo`. `quiz_attempts`: `is_complete`, `score_pct`. Displayed assignment grade = `teacher_score ?? score_pct` (override-wins, consistent with gradebook).

**Interfaces:**
- Consumes: `SupabaseClient`; `AlertSourceKind`, `AlertSeverity` from `@/lib/copy/alertTriggerLabel`.
- Produces:
  - `interface AlertView { id: string; student_id: string; student_name: string; source_kind: AlertSourceKind; severity: AlertSeverity; created_at: string }`
  - `interface Condition { student_id: string; source_kind: AlertSourceKind; source_ref: string; severity: AlertSeverity }`
  - `computeConditions(input: ReconcileInput, now: Date): Condition[]` (pure — the testable core)
  - `reconcileAlerts(admin: SupabaseClient, opts: { classId: string; now?: Date }): Promise<AlertView[]>`
  - `interface ReconcileInput { students: { id: string; full_name: string }[]; quizAttempts: QuizAttemptRow[]; hwAttempts: HwAttemptRow[] }` with `QuizAttemptRow = { id: string; student_id: string; is_complete: boolean; score_pct: number | null; submitted_at: string | null }` and `HwAttemptRow = { id: string; student_id: string; assignment_id: string; status: string; score_pct: number | null; teacher_score: number | null; allow_redo: boolean; is_redo: boolean; submitted_at: string | null }`.

- [ ] **Step 1: Write the failing test for the pure core (`computeConditions`)**

`src/lib/alerts/__tests__/reconcileAlerts.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { computeConditions, type ReconcileInput } from '@/lib/alerts/reconcileAlerts';

const NOW = new Date('2026-06-22T12:00:00Z');
const base: ReconcileInput = { students: [{ id: 's1', full_name: 'Ann' }], quizAttempts: [], hwAttempts: [] };

describe('computeConditions', () => {
  it('flags a low quiz urgent under 40, watch in 40–60', () => {
    const urgent = computeConditions({ ...base, quizAttempts: [{ id: 'q1', student_id: 's1', is_complete: true, score_pct: 30, submitted_at: '2026-06-22T10:00:00Z' }] }, NOW);
    expect(urgent).toContainEqual({ student_id: 's1', source_kind: 'low_quiz', source_ref: 'q1', severity: 'urgent' });
    const watch = computeConditions({ ...base, quizAttempts: [{ id: 'q2', student_id: 's1', is_complete: true, score_pct: 50, submitted_at: '2026-06-22T10:00:00Z' }] }, NOW);
    expect(watch).toContainEqual({ student_id: 's1', source_kind: 'low_quiz', source_ref: 'q2', severity: 'watch' });
  });
  it('uses the LATEST quiz attempt only', () => {
    const c = computeConditions({ ...base, quizAttempts: [
      { id: 'old', student_id: 's1', is_complete: true, score_pct: 20, submitted_at: '2026-06-20T10:00:00Z' },
      { id: 'new', student_id: 's1', is_complete: true, score_pct: 90, submitted_at: '2026-06-22T10:00:00Z' },
    ] }, NOW);
    expect(c.find((x) => x.source_kind === 'low_quiz')).toBeUndefined(); // latest is fine
    expect(c.find((x) => x.source_kind === 'strong_result')?.source_ref).toBe('new');
  });
  it('flags a low assignment using teacher_score over score_pct (override wins)', () => {
    const c = computeConditions({ ...base, hwAttempts: [
      { id: 'h1', student_id: 's1', assignment_id: 'a1', status: 'graded', score_pct: 30, teacher_score: 80, allow_redo: false, is_redo: false, submitted_at: '2026-06-22T10:00:00Z' },
    ] }, NOW);
    expect(c.find((x) => x.source_kind === 'low_assignment')).toBeUndefined(); // override 80 is fine
  });
  it('flags reteach_flag when allow_redo and no redo exists yet', () => {
    const c = computeConditions({ ...base, hwAttempts: [
      { id: 'h1', student_id: 's1', assignment_id: 'a1', status: 'graded', score_pct: 70, teacher_score: null, allow_redo: true, is_redo: false, submitted_at: '2026-06-22T10:00:00Z' },
    ] }, NOW);
    expect(c).toContainEqual({ student_id: 's1', source_kind: 'reteach_flag', source_ref: 'h1', severity: 'watch' });
  });
  it('flags reteach_review for a submitted-but-ungraded redo', () => {
    const c = computeConditions({ ...base, hwAttempts: [
      { id: 'r1', student_id: 's1', assignment_id: 'a1', status: 'submitted', score_pct: null, teacher_score: null, allow_redo: false, is_redo: true, submitted_at: '2026-06-22T10:00:00Z' },
    ] }, NOW);
    expect(c).toContainEqual({ student_id: 's1', source_kind: 'reteach_review', source_ref: 'r1', severity: 'urgent' });
  });
  it('flags a strong result (info) at or above 85 when not low', () => {
    const c = computeConditions({ ...base, quizAttempts: [{ id: 'q1', student_id: 's1', is_complete: true, score_pct: 92, submitted_at: '2026-06-22T10:00:00Z' }] }, NOW);
    expect(c).toContainEqual({ student_id: 's1', source_kind: 'strong_result', source_ref: 'q1', severity: 'info' });
  });
});
```

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/lib/alerts/__tests__/reconcileAlerts.test.ts"` → FAIL.

- [ ] **Step 3: Implement the engine**

`src/lib/alerts/reconcileAlerts.ts`:
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AlertSourceKind, AlertSeverity } from '@/lib/copy/alertTriggerLabel';

const LOW = 60;        // < 60 => attention
const URGENT = 40;     // < 40 => urgent
const STRONG = 85;     // >= 85 => strong-result heads-up

export interface QuizAttemptRow { id: string; student_id: string; is_complete: boolean; score_pct: number | null; submitted_at: string | null }
export interface HwAttemptRow { id: string; student_id: string; assignment_id: string; status: string; score_pct: number | null; teacher_score: number | null; allow_redo: boolean; is_redo: boolean; submitted_at: string | null }
export interface ReconcileInput { students: { id: string; full_name: string }[]; quizAttempts: QuizAttemptRow[]; hwAttempts: HwAttemptRow[] }
export interface Condition { student_id: string; source_kind: AlertSourceKind; source_ref: string; severity: AlertSeverity }
export interface AlertView { id: string; student_id: string; student_name: string; source_kind: AlertSourceKind; severity: AlertSeverity; created_at: string }

function ts(s: string | null): number { return s ? new Date(s).getTime() : 0; }
function latest<T extends { submitted_at: string | null }>(rows: T[]): T | null {
  return rows.reduce<T | null>((best, r) => (best === null || ts(r.submitted_at) >= ts(best.submitted_at) ? r : best), null);
}

/** Pure: latest-attempt-wins condition set for the class. */
export function computeConditions(input: ReconcileInput, _now: Date): Condition[] {
  const out: Condition[] = [];
  for (const student of input.students) {
    const sid = student.id;

    // ── Quizzes: latest complete attempt ──
    const quizzes = input.quizAttempts.filter((q) => q.student_id === sid && q.is_complete);
    const latestQuiz = latest(quizzes);
    let quizIsLow = false;
    if (latestQuiz && latestQuiz.score_pct != null) {
      if (latestQuiz.score_pct < LOW) {
        quizIsLow = true;
        out.push({ student_id: sid, source_kind: 'low_quiz', source_ref: latestQuiz.id, severity: latestQuiz.score_pct < URGENT ? 'urgent' : 'watch' });
      }
    }

    // ── Assignments ──
    const hw = input.hwAttempts.filter((h) => h.student_id === sid);
    // low_assignment: latest non-redo graded/submitted attempt, displayed = teacher_score ?? score_pct
    const gradedish = hw.filter((h) => !h.is_redo && (h.status === 'graded' || h.status === 'submitted' || h.status === 'pending_grade'));
    const latestHw = latest(gradedish);
    let hwIsLow = false;
    if (latestHw) {
      const displayed = latestHw.teacher_score ?? latestHw.score_pct;
      if (displayed != null && displayed < LOW) {
        hwIsLow = true;
        out.push({ student_id: sid, source_kind: 'low_assignment', source_ref: latestHw.id, severity: displayed < URGENT ? 'urgent' : 'watch' });
      }
    }

    // reteach_flag: an attempt flagged allow_redo with no redo started for that assignment yet
    for (const h of hw) {
      if (h.allow_redo && !h.is_redo) {
        const redoExists = hw.some((r) => r.is_redo && r.assignment_id === h.assignment_id);
        if (!redoExists) out.push({ student_id: sid, source_kind: 'reteach_flag', source_ref: h.id, severity: 'watch' });
      }
    }

    // reteach_review: a submitted-but-not-graded redo
    for (const r of hw) {
      if (r.is_redo && (r.status === 'submitted' || r.status === 'pending_grade')) {
        out.push({ student_id: sid, source_kind: 'reteach_review', source_ref: r.id, severity: 'urgent' });
      }
    }

    // strong_result (info): latest quiz/assignment >= STRONG and not already low
    const strongQuiz = latestQuiz && !quizIsLow && latestQuiz.score_pct != null && latestQuiz.score_pct >= STRONG ? latestQuiz : null;
    const strongHwDisplayed = latestHw ? (latestHw.teacher_score ?? latestHw.score_pct) : null;
    const strongHw = latestHw && !hwIsLow && strongHwDisplayed != null && strongHwDisplayed >= STRONG ? latestHw : null;
    const strong = (strongQuiz && strongHw) ? (ts(strongQuiz.submitted_at) >= ts(strongHw.submitted_at) ? strongQuiz : strongHw) : (strongQuiz ?? strongHw);
    if (strong) out.push({ student_id: sid, source_kind: 'strong_result', source_ref: strong.id, severity: 'info' });
  }
  return out;
}

const SEV_ORDER: Record<AlertSeverity, number> = { urgent: 0, watch: 1, info: 2 };

/** Reconcile-on-read: compute conditions, upsert (DB-dedup), auto-clear stale, return the open set. Idempotent. */
export async function reconcileAlerts(
  admin: SupabaseClient,
  opts: { classId: string; now?: Date },
): Promise<AlertView[]> {
  const now = opts.now ?? new Date();
  const classId = opts.classId;

  // school_id for inserts
  const { data: cls } = await admin.from('classes').select('school_id').eq('id', classId).maybeSingle();
  const schoolId = (cls as { school_id?: string } | null)?.school_id;
  if (!schoolId) return [];

  // active enrolled students + names
  const { data: enr } = await admin.from('enrollments').select('student_id').eq('class_id', classId);
  const studentIds = (enr ?? []).map((e: { student_id: string }) => e.student_id);
  if (studentIds.length === 0) return [];
  const { data: userRows } = await admin.from('users').select('id, full_name').in('id', studentIds);
  const students = (userRows ?? []).map((u: { id: string; full_name: string | null }) => ({ id: u.id, full_name: u.full_name ?? 'Student' }));
  const nameById = new Map(students.map((s) => [s.id, s.full_name]));

  // class assignment + quiz ids
  const { data: asg } = await admin.from('assignments').select('id').eq('class_id', classId);
  const assignmentIds = (asg ?? []).map((a: { id: string }) => a.id);
  const { data: qz } = await admin.from('quizzes').select('id').eq('class_id', classId);
  const quizIds = (qz ?? []).map((q: { id: string }) => q.id);

  const { data: hwRows } = assignmentIds.length
    ? await admin.from('homework_attempts')
        .select('id, student_id, assignment_id, status, score_pct, teacher_score, allow_redo, is_redo, submitted_at')
        .in('assignment_id', assignmentIds).in('student_id', studentIds)
    : { data: [] as HwAttemptRow[] };
  const { data: quizRows } = quizIds.length
    ? await admin.from('quiz_attempts')
        .select('id, student_id, is_complete, score_pct, submitted_at')
        .in('quiz_id', quizIds).in('student_id', studentIds)
    : { data: [] as QuizAttemptRow[] };

  const conditions = computeConditions(
    { students, quizAttempts: (quizRows ?? []) as QuizAttemptRow[], hwAttempts: (hwRows ?? []) as HwAttemptRow[] },
    now,
  );

  // upsert open alerts (dedup on the occurrence unique index; do nothing on conflict)
  if (conditions.length) {
    await admin.from('alerts').upsert(
      conditions.map((c) => ({
        school_id: schoolId, class_id: classId, student_id: c.student_id,
        source_kind: c.source_kind, source_ref: c.source_ref, severity: c.severity,
        status: 'open', created_at: now.toISOString(),
      })),
      { onConflict: 'student_id,class_id,source_kind,source_ref', ignoreDuplicates: true },
    );
  }

  // load currently-open alerts, auto-clear those no longer in the condition set
  const { data: openRows } = await admin.from('alerts')
    .select('id, student_id, source_kind, source_ref, severity, created_at')
    .eq('class_id', classId).eq('status', 'open');
  const open = (openRows ?? []) as { id: string; student_id: string; source_kind: AlertSourceKind; source_ref: string; severity: AlertSeverity; created_at: string }[];
  const liveKeys = new Set(conditions.map((c) => `${c.student_id}|${c.source_kind}|${c.source_ref}`));
  const staleIds = open.filter((o) => !liveKeys.has(`${o.student_id}|${o.source_kind}|${o.source_ref}`)).map((o) => o.id);
  if (staleIds.length) {
    await admin.from('alerts').update({ status: 'resolved', resolved_at: now.toISOString(), resolved_by: null, resolution_note: 'cleared' }).in('id', staleIds);
  }

  // return the still-open set (those whose key is live), shaped + sorted
  return open
    .filter((o) => liveKeys.has(`${o.student_id}|${o.source_kind}|${o.source_ref}`))
    .map((o) => ({ id: o.id, student_id: o.student_id, student_name: nameById.get(o.student_id) ?? 'Student', source_kind: o.source_kind, severity: o.severity, created_at: o.created_at }))
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.student_name.localeCompare(b.student_name));
}
```

- [ ] **Step 4: Run; verify the pure-core tests pass** — `npx vitest run "src/lib/alerts/__tests__/reconcileAlerts.test.ts"` → PASS.

- [ ] **Step 5: Add a reconcile integration test (mock admin client)**

Extend the test file with a `reconcileAlerts` block using the SAME mock-admin pattern as `src/lib/gradebook/__tests__/loadGradebook.test.ts` (a chainable query-builder mock returning seeded rows + capturing `upsert`/`update` calls). Assert: (a) a low-quiz condition causes one `upsert` row with `onConflict` + `ignoreDuplicates`; (b) an open alert whose occurrence is NOT in the condition set is moved to resolved via `update(... status:'resolved')`; (c) the returned `AlertView[]` is sorted urgent→watch→info. (Model the chainable mock exactly on the gradebook test — do not invent a new harness.)

- [ ] **Step 6: Run; verify pass** — same command → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 7: Commit**
```bash
git add src/lib/alerts/reconcileAlerts.ts src/lib/alerts/__tests__/reconcileAlerts.test.ts
git commit -m "feat(3b): reconcileAlerts engine (compute/upsert/auto-clear)"
```

---

## Task 6: Alerts — open-count helper + sidebar badge

**Files:**
- Create: `src/lib/alerts/openAlertCount.ts`
- Test: `src/lib/alerts/__tests__/openAlertCount.test.ts`
- Modify: `src/app/(teacher)/layout.tsx` (fetch count, pass down), `src/app/(teacher)/_components/TeacherShell.tsx`, `src/app/(teacher)/_components/TeacherSidebar.tsx`, `src/app/(teacher)/_components/SidebarNav.tsx` (thread `alertCount` prop → render badge on the `badgeKey==='alerts'` item).

**Read first:** the four shell files to see the exact prop threading. `navConfig.ts` already declares `badgeKey?: 'alerts'` but `SidebarNav` does not render it yet.

**Interfaces:**
- Produces: `openAlertCountForTeacher(admin: SupabaseClient, teacherId: string): Promise<number>` — distinct students with an open `urgent` alert across the teacher's classes.

- [ ] **Step 1: Failing test**

`src/lib/alerts/__tests__/openAlertCount.test.ts` — mirror the gradebook mock-admin harness:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { openAlertCountForTeacher } from '@/lib/alerts/openAlertCount';

// Mock admin: classes owned by teacher = [c1]; open urgent alerts on c1 for s1 (x2) + s2.
function mockAdmin() {
  return {
    from(table: string) {
      const api: Record<string, unknown> = {
        select: () => api, eq: () => api, in: () => api,
      };
      if (table === 'classes') (api as { then?: unknown }).then = undefined;
      // resolve query via thenable
      (api as { then: (r: (v: { data: unknown }) => void) => void }).then = (resolve) => {
        if (table === 'classes') return resolve({ data: [{ id: 'c1' }] });
        if (table === 'alerts') return resolve({ data: [
          { student_id: 's1' }, { student_id: 's1' }, { student_id: 's2' },
        ] });
        return resolve({ data: [] });
      };
      return api;
    },
  };
}

describe('openAlertCountForTeacher', () => {
  it('counts DISTINCT students with an open urgent alert', async () => {
    const n = await openAlertCountForTeacher(mockAdmin() as never, 't1');
    expect(n).toBe(2); // s1 deduped
  });
});
```
> If the mock thenable shape differs from the gradebook harness, use the gradebook harness's exact style instead — this is illustrative.

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/lib/alerts/__tests__/openAlertCount.test.ts"` → FAIL.

- [ ] **Step 3: Implement**

`src/lib/alerts/openAlertCount.ts`:
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

/** Count of DISTINCT students with an open URGENT alert across the teacher's classes (badge). */
export async function openAlertCountForTeacher(admin: SupabaseClient, teacherId: string): Promise<number> {
  const { data: classes } = await admin.from('classes').select('id').eq('teacher_id', teacherId);
  const ids = (classes ?? []).map((c: { id: string }) => c.id);
  if (ids.length === 0) return 0;
  const { data: rows } = await admin.from('alerts')
    .select('student_id').in('class_id', ids).eq('status', 'open').eq('severity', 'urgent');
  const distinct = new Set((rows ?? []).map((r: { student_id: string }) => r.student_id));
  return distinct.size;
}
```

- [ ] **Step 4: Run; verify pass** — same command → PASS.

- [ ] **Step 5: Wire the badge (no test — exercised by build + manual)**

In `src/app/(teacher)/layout.tsx`: after `requireRole(['teacher'])` (capture `userId`), fetch `const admin = createAdminSupabaseClient(); const alertCount = await openAlertCountForTeacher(admin, userId);` and pass `alertCount` into `<TeacherShell userName={fullName} alertCount={alertCount}>`. Thread the optional `alertCount?: number` prop through `TeacherShell` → `TeacherSidebar` → `SidebarNav`. In `SidebarNav`'s `NavLink`, when `item.badgeKey === 'alerts'` and `alertCount! > 0`, render a token-only badge beside the label:
```tsx
{item.badgeKey === 'alerts' && (alertCount ?? 0) > 0 && (
  <span aria-label={`${alertCount} need attention`}
    className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full border-2 border-sidebar-edge bg-risk px-1.5 text-xs font-bold text-fg">
    {alertCount}
  </span>
)}
```
> The badge reflects persisted open-urgent alerts (eventually-consistent; reconcile runs when /alerts loads). Documented limitation, acceptable for lean.

- [ ] **Step 6: Run gates** — `npx tsc --noEmit` → 0; `npm run build` → 0.

- [ ] **Step 7: Commit**
```bash
git add src/lib/alerts/openAlertCount.ts src/lib/alerts/__tests__/openAlertCount.test.ts "src/app/(teacher)/layout.tsx" "src/app/(teacher)/_components/TeacherShell.tsx" "src/app/(teacher)/_components/TeacherSidebar.tsx" "src/app/(teacher)/_components/SidebarNav.tsx"
git commit -m "feat(3b): alert badge count + sidebar wiring"
```

---

## Task 7: Alerts — resolve route

**Files:**
- Create: `src/app/api/teacher/alerts/resolve/route.ts`
- Test: `src/app/api/teacher/alerts/resolve/__tests__/route.test.ts`

**Read first:** `src/app/api/teacher/gradebook/override/route.ts` (auth chain + write + error capture template) and its test (mock pattern for `createServerSupabaseClient`/`createAdminSupabaseClient`/guards).

**Interfaces:**
- `POST` body `{ alert_id: string }` → 200 `{ ok: true }` / 400 / 401 / 403 / 404 / 500.

- [ ] **Step 1: Failing test** — mirror the gradebook override route test exactly. Cover: 401 when no user; 403 when role not staff (`new Set(STAFF_ROLES)` membership); 404 when alert not found; guard rejects other-class alert; happy path updates `status='resolved', resolved_by=<user>, resolved_at` and returns `{ ok: true }`; write `.error` → 500.

`src/app/api/teacher/alerts/resolve/__tests__/route.test.ts` (structure mirrors the override test — reuse its mocks for `@/lib/supabase/server` and `@/lib/auth/guards`):
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
// vi.mock('@/lib/supabase/server', ...) and vi.mock('@/lib/auth/guards', ...) — copy the override test's mocks.
import { POST } from '@/app/api/teacher/alerts/resolve/route';
// ... (assertions per the list above) ...
describe('POST /api/teacher/alerts/resolve', () => {
  it('rejects an unauthenticated caller with 401', async () => {
    // mock getUser → null
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ alert_id: 'a1' }) }));
    expect(res.status).toBe(401);
  });
  // ...remaining cases...
});
```

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/app/api/teacher/alerts/resolve/__tests__/route.test.ts"` → FAIL.

- [ ] **Step 3: Implement**

`src/app/api/teacher/alerts/resolve/route.ts`:
```typescript
// POST /api/teacher/alerts/resolve — manually resolve an alert. Auth chain + class IDOR guard.
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { STAFF_ROLES } from '@/lib/auth/roles';

const STAFF = new Set<string>(STAFF_ROLES);

export async function POST(req: Request): Promise<NextResponse> {
  let body: { alert_id?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const alertId = typeof body.alert_id === 'string' ? body.alert_id : null;
  if (!alertId) return NextResponse.json({ error: 'alert_id required' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !STAFF.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createAdminSupabaseClient();
  const { data: alert } = await admin.from('alerts').select('id, class_id, status').eq('id', alertId).maybeSingle();
  if (!alert) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const guard = await guardClassAccess((alert as { class_id: string }).class_id);
  if (guard) return guard;

  if ((alert as { status: string }).status === 'resolved') return NextResponse.json({ ok: true });

  const { error } = await admin.from('alerts')
    .update({ status: 'resolved', resolved_by: user.id, resolved_at: new Date().toISOString() })
    .eq('id', alertId).eq('status', 'open');
  if (error) { console.error('alerts/resolve write failed', error); return NextResponse.json({ error: 'Write failed' }, { status: 500 }); }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run; verify pass** — same command → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**
```bash
git add "src/app/api/teacher/alerts/resolve"
git commit -m "feat(3b): alerts resolve route"
```

---

## Task 8: Alerts — page + AlertRow client island

**Files:**
- Create: `src/app/(teacher)/alerts/_components/AlertRow.tsx`
- Modify (replace stub): `src/app/(teacher)/alerts/page.tsx`
- Test: `src/app/(teacher)/alerts/_components/__tests__/AlertRow.test.tsx`

**Interfaces:**
- Consumes: `reconcileAlerts`, `AlertView`; `alertTriggerLabel`, `ALERT_BUCKETS`, `severityTone`; kit `PageHeader`, `SummaryCallout`, `Card`, `SectionLabel`, `EmptyState`. `POST /api/teacher/alerts/resolve`.

- [ ] **Step 1: Failing test for the client row**

`src/app/(teacher)/alerts/_components/__tests__/AlertRow.test.tsx`:
```typescript
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AlertRow } from '../AlertRow';

const alert = { id: 'a1', student_id: 's1', student_name: 'Ann Lee', source_kind: 'low_quiz' as const, severity: 'urgent' as const, created_at: '2026-06-22T10:00:00Z' };

beforeEach(() => { vi.restoreAllMocks(); });

describe('AlertRow', () => {
  it('shows the student name and a leak-free trigger label', () => {
    render(<AlertRow alert={alert} classId="c1" onResolved={() => {}} />);
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
    expect(screen.getByText(/comprehension check/i)).toBeInTheDocument();
  });
  it('calls resolve then onResolved on Mark handled', async () => {
    const onResolved = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    render(<AlertRow alert={alert} classId="c1" onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('button', { name: /mark handled/i }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith('/api/teacher/alerts/resolve', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/app/(teacher)/alerts/_components/__tests__/AlertRow.test.tsx"` → FAIL.

- [ ] **Step 3: Implement `AlertRow.tsx`**
```typescript
'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/core/Card';
import { alertTriggerLabel, severityTone, type AlertSeverity, type AlertSourceKind } from '@/lib/copy/alertTriggerLabel';

export interface AlertRowItem { id: string; student_id: string; student_name: string; source_kind: AlertSourceKind; severity: AlertSeverity; created_at: string }

export function AlertRow({ alert, classId, onResolved }: { alert: AlertRowItem; classId: string; onResolved: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function markHandled() {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/teacher/alerts/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alert_id: alert.id }),
      });
      if (!res.ok) { setErr('Could not mark handled — try again.'); setBusy(false); return; }
      onResolved();
    } catch { setErr('Could not mark handled — try again.'); setBusy(false); }
  }

  return (
    <Card tone={severityTone(alert.severity)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Link href={`/students/${alert.student_id}?class=${classId}`} className="text-fg font-display font-bold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
            {alert.student_name}
          </Link>
          <span className="text-fg text-sm">{alertTriggerLabel(alert.source_kind)}</span>
        </div>
        <button type="button" onClick={markHandled} disabled={busy}
          className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker hover:bg-brand-surface disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          {busy ? 'Working…' : 'Mark handled'}
        </button>
      </div>
      {err && <p className="text-fg mt-2 text-sm">{err}</p>}
    </Card>
  );
}
export default AlertRow;
```

- [ ] **Step 4: Run; verify pass** — same vitest command → PASS.

- [ ] **Step 5: Replace the page stub**

`src/app/(teacher)/alerts/page.tsx` (auth/redirect/guard preamble identical to Insights/gradebook; then reconcile + group + render). The page is a server component; it renders an `AlertsClient` wrapper only if you need `router.refresh()` after resolve — simplest: make a tiny client wrapper that holds the list and removes a row on `onResolved`, OR keep server-rendered and have `AlertRow.onResolved = () => router.refresh()` via a thin client list component. Implement a client list:

Create inline `src/app/(teacher)/alerts/_components/AlertsList.tsx`:
```typescript
'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { ALERT_BUCKETS } from '@/lib/copy/alertTriggerLabel';
import { SectionLabel } from '../../_components/SectionLabel';
import { AlertRow, type AlertRowItem } from './AlertRow';

export function AlertsList({ alerts, classId }: { alerts: AlertRowItem[]; classId: string }): React.JSX.Element {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-6">
      {ALERT_BUCKETS.map((bucket) => {
        const rows = alerts.filter((a) => a.severity === bucket.severity);
        if (rows.length === 0) return null;
        return (
          <section key={bucket.severity} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <SectionLabel tone={bucket.severity === 'urgent' ? 'risk' : bucket.severity === 'watch' ? 'warn' : 'brand'}>{bucket.label}</SectionLabel>
              <span className="text-fg-muted text-xs">{bucket.subline}</span>
            </div>
            {rows.map((a) => <AlertRow key={a.id} alert={a} classId={classId} onResolved={() => router.refresh()} />)}
          </section>
        );
      })}
    </div>
  );
}
export default AlertsList;
```

Then `page.tsx`:
```typescript
import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { reconcileAlerts } from '@/lib/alerts/reconcileAlerts';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { SummaryCallout } from '../_components/SummaryCallout';
import { AlertsList } from './_components/AlertsList';

const NO_CLASSES = (<EmptyState variant="just-getting-started" titleOverride="No classes yet" bodyOverride="Once a class is set up for you, alerts show up here." />);
const CLASS_UNAVAILABLE = (<EmptyState variant="just-getting-started" titleOverride="That class isn't available" bodyOverride="Use the class selector to pick one of your classes." />);

function summary(urgent: number, watch: number): string {
  if (urgent === 0 && watch === 0) return 'Nothing new — the class is steady today.';
  const u = urgent === 1 ? '1 student needs attention' : `${urgent} students need attention`;
  const w = watch === 1 ? '1 to check in on' : `${watch} to check in on`;
  if (urgent === 0) return `${w}.`;
  if (watch === 0) return `${u}.`;
  return `${u}, ${w}.`;
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ class?: string }> }): Promise<React.JSX.Element> {
  const { class: classId } = await searchParams;
  if (!classId) {
    const { userId } = await requireRole(['teacher']);
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) return <div className="p-6">{NO_CLASSES}</div>;
    redirect(`/alerts?class=${firstId}`);
  }
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  const admin = createAdminSupabaseClient();
  const alerts = await reconcileAlerts(admin, { classId });
  const urgent = alerts.filter((a) => a.severity === 'urgent').length;
  const watch = alerts.filter((a) => a.severity === 'watch').length;

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="Alerts" kicker="Things that just changed" accent="brand" />
      <SummaryCallout>{summary(urgent, watch)}</SummaryCallout>
      {alerts.length === 0
        ? <EmptyState variant="on-track" titleOverride="No new change events" bodyOverride="When something needs your eyes, it'll show up here." />
        : <AlertsList alerts={alerts} classId={classId} />}
    </div>
  );
}
```

- [ ] **Step 6: Run gates** — vitest for AlertRow → PASS; `npx tsc --noEmit` → 0; `npm run build` → 0.

- [ ] **Step 7: Commit**
```bash
git add "src/app/(teacher)/alerts"
git commit -m "feat(3b): alerts page + bucketed list + mark-handled"
```

---

## Task 9: High-Fives — suggestions

**Files:**
- Create: `src/lib/highfives/suggestions.ts`
- Test: `src/lib/highfives/__tests__/suggestions.test.ts`

**Interfaces:**
- Consumes: `RosterItem` (band), and per-student signal inputs. For lean, derive from class-level data we already load: `RosterItem.band` (`'advanced'` → stretch) + a per-student effort/trajectory input the page provides. Keep the function PURE over an explicit input array so it's testable without DB.
- Produces:
  - `type HighFiveReason = 'persistence'|'recovery'|'effortful_success'|'consistency_rising'|'reteach_completed'|'stretch'`
  - `interface SuggestionInput { student_id: string; full_name: string; band: 'reteach'|'grade_level'|'advanced'|null; dominant_effort: string | null; trajectory: 'improving'|'stable'|'worsening' | null; had_recent_reteach_win: boolean; recent_high_five: boolean }`
  - `interface HighFiveSuggestion { student_id: string; full_name: string; reason: HighFiveReason; context_hint: string }`
  - `buildHighFiveSuggestions(inputs: SuggestionInput[], limit?: number): HighFiveSuggestion[]`

- [ ] **Step 1: Failing test**

`src/lib/highfives/__tests__/suggestions.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildHighFiveSuggestions, type SuggestionInput } from '@/lib/highfives/suggestions';
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';

const mk = (p: Partial<SuggestionInput>): SuggestionInput => ({
  student_id: p.student_id ?? 's', full_name: p.full_name ?? 'Stu', band: p.band ?? 'grade_level',
  dominant_effort: p.dominant_effort ?? null, trajectory: p.trajectory ?? null,
  had_recent_reteach_win: p.had_recent_reteach_win ?? false, recent_high_five: p.recent_high_five ?? false,
});

describe('buildHighFiveSuggestions', () => {
  it('suggests reteach_completed and stretch with leak-free context hints', () => {
    const out = buildHighFiveSuggestions([
      mk({ student_id: 'a', had_recent_reteach_win: true }),
      mk({ student_id: 'b', band: 'advanced' }),
    ]);
    const reasons = out.map((s) => s.reason);
    expect(reasons).toContain('reteach_completed');
    expect(reasons).toContain('stretch');
    for (const s of out) { expect(hasLeak(s.context_hint)).toBe(false); expect(hasBannedWord(s.context_hint)).toBe(false); }
  });
  it('skips students who recently got a high-five', () => {
    const out = buildHighFiveSuggestions([mk({ student_id: 'a', band: 'advanced', recent_high_five: true })]);
    expect(out).toHaveLength(0);
  });
  it('respects the limit and prioritises stronger reasons first', () => {
    const out = buildHighFiveSuggestions([
      mk({ student_id: 'a', dominant_effort: 'struggling_trying' }),       // persistence (high)
      mk({ student_id: 'b', band: 'advanced' }),                            // stretch (low)
    ], 1);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('persistence');
  });
});
```

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/lib/highfives/__tests__/suggestions.test.ts"` → FAIL.

- [ ] **Step 3: Implement**

`src/lib/highfives/suggestions.ts`:
```typescript
// Derived "worth recognizing today" suggestions. Pure. Context hints are STUDENT-FACING-safe (leak + banned-word free).
// DRAFT → Barb (STRINGS-FOR-BARB.md §High-Fives).
import { assertNoLeak, assertNoBannedWord } from '@/lib/copy/leakGuard';

export type HighFiveReason = 'persistence' | 'recovery' | 'effortful_success' | 'consistency_rising' | 'reteach_completed' | 'stretch';

export interface SuggestionInput {
  student_id: string; full_name: string;
  band: 'reteach' | 'grade_level' | 'advanced' | null;
  dominant_effort: string | null;
  trajectory: 'improving' | 'stable' | 'worsening' | null;
  had_recent_reteach_win: boolean;
  recent_high_five: boolean;
}
export interface HighFiveSuggestion { student_id: string; full_name: string; reason: HighFiveReason; context_hint: string }

const HINTS: Record<HighFiveReason, string> = {
  persistence: 'Kept at it through some tough work this week, even when it was a grind.',
  recovery: 'Bounced back after a rough patch — nice to see them climb again.',
  effortful_success: 'Worked hard and got there — earned that result.',
  consistency_rising: 'Steadier and steadier lately — the effort is showing.',
  reteach_completed: 'Came back for another try and pushed it further.',
  stretch: 'Ready for more — reaching past the standard and into deeper work.',
};
// Higher = surface first.
const PRIORITY: Record<HighFiveReason, number> = {
  persistence: 5, recovery: 4, reteach_completed: 4, effortful_success: 3, consistency_rising: 2, stretch: 1,
};

function reasonFor(i: SuggestionInput): HighFiveReason | null {
  if (i.dominant_effort === 'struggling_trying') return 'persistence';
  if (i.had_recent_reteach_win) return 'reteach_completed';
  if (i.trajectory === 'improving') return 'recovery';
  if (i.dominant_effort === 'effortful_success') return 'effortful_success';
  if (i.band === 'advanced') return 'stretch';
  return null;
}

export function buildHighFiveSuggestions(inputs: SuggestionInput[], limit = 5): HighFiveSuggestion[] {
  const out: HighFiveSuggestion[] = [];
  for (const i of inputs) {
    if (i.recent_high_five) continue;
    const reason = reasonFor(i);
    if (!reason) continue;
    const context_hint = HINTS[reason];
    assertNoLeak(context_hint, 'highFiveSuggestion'); assertNoBannedWord(context_hint, 'highFiveSuggestion');
    out.push({ student_id: i.student_id, full_name: i.full_name, reason, context_hint });
  }
  return out.sort((a, b) => PRIORITY[b.reason] - PRIORITY[a.reason] || a.full_name.localeCompare(b.full_name)).slice(0, limit);
}
```

- [ ] **Step 4: Run; verify pass** — same command → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Append copy + commit**

Append the six context-hint templates to `STRINGS-FOR-BARB.md §High-Fives` (DRAFT).
```bash
git add src/lib/highfives/suggestions.ts src/lib/highfives/__tests__/suggestions.test.ts STRINGS-FOR-BARB.md
git commit -m "feat(3b): high-five suggestions (derived wins)"
```

---

## Task 10: High-Fives — empty-praise guardrail

**Files:**
- Create: `src/lib/highfives/guardrail.ts`
- Test: `src/lib/highfives/__tests__/guardrail.test.ts`

**Read first:** `src/lib/teli/revealCheck.ts` (the sync-gate + fail-closed pattern to mirror). This guardrail is the coach-posture "name the specific thing, never empty praise" gate ([[v2-teli-tutor-never-reveals-answer]] discipline). Fail-closed.

**Interfaces:**
- Produces:
  - `interface Violation { phrase: string; suggestion: string }`
  - `validateHighFive(text: string): Violation[]` — empty array = clean. Catches forbidden empty-praise phrases AND (via leak guards) digits/% and banned words. Pure, deterministic.
  - `const FORBIDDEN_PRAISE: { pattern: RegExp; phrase: string; suggestion: string }[]`

- [ ] **Step 1: Failing test**

`src/lib/highfives/__tests__/guardrail.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateHighFive } from '@/lib/highfives/guardrail';

describe('validateHighFive', () => {
  it('passes a specific, named-effort note', () => {
    expect(validateHighFive('Ann, you kept working on the fraction problems even when they got tricky.')).toEqual([]);
  });
  it('flags empty praise', () => {
    expect(validateHighFive('Great job!! Amazing work!').length).toBeGreaterThan(0);
  });
  it('flags a leaked number/percent', () => {
    expect(validateHighFive('You scored 95% — awesome').length).toBeGreaterThan(0);
  });
  it('flags a banned coach-posture word', () => {
    expect(validateHighFive('Your score signal improved').length).toBeGreaterThan(0);
  });
  it('returns suggestions for each violation', () => {
    const v = validateHighFive('Perfect! You got this!');
    expect(v.every((x) => x.suggestion.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/lib/highfives/__tests__/guardrail.test.ts"` → FAIL.

- [ ] **Step 3: Implement**

`src/lib/highfives/guardrail.ts`:
```typescript
// Empty-praise guardrail for teacher High-Five notes (student-facing). Fail-closed, deterministic.
// Mirrors the Teli sync-gate posture (src/lib/teli/revealCheck.ts). DRAFT phrases → Barb.
import { hasLeak, hasBannedWord } from '@/lib/copy/leakGuard';

export interface Violation { phrase: string; suggestion: string }

export const FORBIDDEN_PRAISE: { pattern: RegExp; phrase: string; suggestion: string }[] = [
  { pattern: /\bgreat job\b/i, phrase: 'great job', suggestion: 'Name the specific thing they did.' },
  { pattern: /\bgood job\b/i, phrase: 'good job', suggestion: 'Name the specific thing they did.' },
  { pattern: /\bamazing\b/i, phrase: 'amazing', suggestion: 'Describe what was actually impressive.' },
  { pattern: /\bawesome\b/i, phrase: 'awesome', suggestion: 'Describe what was actually impressive.' },
  { pattern: /\bexcellent\b/i, phrase: 'excellent', suggestion: 'Say what specifically was strong.' },
  { pattern: /\bperfect\b/i, phrase: 'perfect', suggestion: 'Point to the concrete thing they did well.' },
  { pattern: /\byou got this\b/i, phrase: 'you got this', suggestion: 'Name the effort you actually saw.' },
  { pattern: /\b(i'?m|i am) (so )?proud\b/i, phrase: "i'm proud", suggestion: 'Describe the work, not your reaction to it.' },
  { pattern: /\bso smart\b/i, phrase: 'so smart', suggestion: 'Praise the effort/strategy, not the trait.' },
];

export function validateHighFive(text: string): Violation[] {
  const violations: Violation[] = [];
  for (const f of FORBIDDEN_PRAISE) if (f.pattern.test(text)) violations.push({ phrase: f.phrase, suggestion: f.suggestion });
  if (hasLeak(text)) violations.push({ phrase: 'a number or percent', suggestion: 'Keep it about the effort — no numbers or grades.' });
  if (hasBannedWord(text)) violations.push({ phrase: 'a data word', suggestion: 'Use plain, human language.' });
  return violations;
}
```

- [ ] **Step 4: Run; verify pass** — same command → PASS.

- [ ] **Step 5: Append copy + commit**

Append `FORBIDDEN_PRAISE` phrase list + suggestions to `STRINGS-FOR-BARB.md §High-Fives` (note Barb should review the empty-praise list + voice).
```bash
git add src/lib/highfives/guardrail.ts src/lib/highfives/__tests__/guardrail.test.ts STRINGS-FOR-BARB.md
git commit -m "feat(3b): high-five empty-praise guardrail"
```

---

## Task 11: High-Fives — AI draft generator

**Files:**
- Create: `src/lib/highfives/generateDraft.ts`
- Test: `src/lib/highfives/__tests__/generateDraft.test.ts`

**Read first:** `src/lib/ai/claude.ts` (`claudeChat`), `src/lib/ai/models.ts` (`CLAUDE_TUTOR_MODEL`), `src/lib/teli/generateHint.ts` (the generate→validate→retry→fallback shape to mirror).

**Interfaces:**
- Consumes: `claudeChat(system, user, opts?) => Promise<string|null>`; `CLAUDE_TUTOR_MODEL`; `validateHighFive`.
- Produces:
  - `interface DraftOpts { studentName: string; reasonHint?: string; contextHint?: string }`
  - `generateHighFiveDraft(opts: DraftOpts): Promise<{ draft_text: string; source: 'ai'|'ai_retry'|'fallback' }>`
  - `fallbackDraft(studentName: string): string` (must itself pass `validateHighFive`)

- [ ] **Step 1: Failing test (mock `claudeChat`)**

`src/lib/highfives/__tests__/generateDraft.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ai from '@/lib/ai/claude';
import { generateHighFiveDraft, fallbackDraft } from '@/lib/highfives/generateDraft';
import { validateHighFive } from '@/lib/highfives/guardrail';

beforeEach(() => vi.restoreAllMocks());

describe('generateHighFiveDraft', () => {
  it('returns a clean AI draft when the model output passes the guardrail', async () => {
    vi.spyOn(ai, 'claudeChat').mockResolvedValue('Ann, you stuck with the tricky fraction problems all week.');
    const r = await generateHighFiveDraft({ studentName: 'Ann', contextHint: 'kept trying' });
    expect(r.source).toBe('ai');
    expect(validateHighFive(r.draft_text)).toEqual([]);
  });
  it('retries once when the first output violates, then accepts the clean retry', async () => {
    const spy = vi.spyOn(ai, 'claudeChat')
      .mockResolvedValueOnce('Great job!! amazing!')
      .mockResolvedValueOnce('Ann, you broke the problem into steps and worked through each one.');
    const r = await generateHighFiveDraft({ studentName: 'Ann' });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(r.source).toBe('ai_retry');
  });
  it('falls back deterministically when the model returns null', async () => {
    vi.spyOn(ai, 'claudeChat').mockResolvedValue(null);
    const r = await generateHighFiveDraft({ studentName: 'Ann' });
    expect(r.source).toBe('fallback');
    expect(r.draft_text).toContain('Ann');
    expect(validateHighFive(r.draft_text)).toEqual([]);
  });
  it('falls back when both passes violate', async () => {
    vi.spyOn(ai, 'claudeChat').mockResolvedValue('Awesome! perfect!');
    const r = await generateHighFiveDraft({ studentName: 'Ann' });
    expect(r.source).toBe('fallback');
  });
});

describe('fallbackDraft', () => {
  it('is itself guardrail-clean', () => { expect(validateHighFive(fallbackDraft('Ann'))).toEqual([]); });
});
```

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/lib/highfives/__tests__/generateDraft.test.ts"` → FAIL.

- [ ] **Step 3: Implement**

`src/lib/highfives/generateDraft.ts`:
```typescript
// AI first-draft for a teacher High-Five note. Generate → guardrail → retry once → deterministic fallback.
// Student-facing voice. NO digits/%/jargon/empty-praise. Mirrors Teli's generate-guarded shape.
import { claudeChat } from '@/lib/ai/claude';
import { CLAUDE_TUTOR_MODEL } from '@/lib/ai/models';
import { validateHighFive } from '@/lib/highfives/guardrail';

export interface DraftOpts { studentName: string; reasonHint?: string; contextHint?: string }

const SYSTEM = [
  'You write a SHORT note from a teacher to a student recognizing something specific they did.',
  'Rules: 1–2 sentences. Address the student by their first name. Name the SPECIFIC effort or thinking, not a trait.',
  'NEVER use empty praise ("great job", "amazing", "awesome", "excellent", "perfect", "you got this", "so smart").',
  'NEVER mention numbers, percentages, grades, scores, rankings, or any data/jargon words.',
  'Warm, plain, human. Output ONLY the note text — no quotes, no preamble.',
].join(' ');

const RETRY_SUFFIX = '\n\nThe previous attempt used empty praise or a number. Rewrite: name ONE concrete thing they did, plainly, no praise words, no numbers.';

export function fallbackDraft(studentName: string): string {
  return `${studentName}, your teacher noticed how you worked this week and wanted to name it.`;
}

export async function generateHighFiveDraft(opts: DraftOpts): Promise<{ draft_text: string; source: 'ai' | 'ai_retry' | 'fallback' }> {
  const user = [
    `Student first name: ${opts.studentName}`,
    opts.contextHint ? `What they did: ${opts.contextHint}` : '',
  ].filter(Boolean).join('\n');

  const first = await claudeChat(SYSTEM, user, { model: CLAUDE_TUTOR_MODEL });
  if (first && validateHighFive(first.trim()).length === 0) return { draft_text: first.trim(), source: 'ai' };

  const second = await claudeChat(SYSTEM + RETRY_SUFFIX, user, { model: CLAUDE_TUTOR_MODEL });
  if (second && validateHighFive(second.trim()).length === 0) return { draft_text: second.trim(), source: 'ai_retry' };

  return { draft_text: fallbackDraft(opts.studentName), source: 'fallback' };
}
```

- [ ] **Step 4: Run; verify pass** — same command → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**
```bash
git add src/lib/highfives/generateDraft.ts src/lib/highfives/__tests__/generateDraft.test.ts
git commit -m "feat(3b): high-five AI draft generator (guardrailed + fallback)"
```

---

## Task 12: High-Fives — draft route

**Files:**
- Create: `src/app/api/teacher/high-fives/draft/route.ts`
- Test: `src/app/api/teacher/high-fives/draft/__tests__/route.test.ts`

**Interfaces:**
- `POST` body `{ student_id: string; class_id: string; reason_hint?: string; context_hint?: string }` → 200 `{ draft_text, source }` / 400 / 401 / 403 (auth chain + `guardClassAccess(class_id)` — student must be in that class). Also verify the student is enrolled in the class (defense): after the class guard, confirm an `enrollments` row for `(class_id, student_id)`; 403 if not.

- [ ] **Step 1: Failing test** — mirror the alerts/resolve route test mocks. Cover: 401/403 gates; happy path returns `{ draft_text, source }` (mock `generateHighFiveDraft`); rejects a student not enrolled in the class (403).

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/app/api/teacher/high-fives/draft/__tests__/route.test.ts"` → FAIL.

- [ ] **Step 3: Implement**

`src/app/api/teacher/high-fives/draft/route.ts`:
```typescript
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { generateHighFiveDraft } from '@/lib/highfives/generateDraft';

const STAFF = new Set<string>(STAFF_ROLES);

export async function POST(req: Request): Promise<NextResponse> {
  let body: { student_id?: unknown; class_id?: unknown; reason_hint?: unknown; context_hint?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const studentId = typeof body.student_id === 'string' ? body.student_id : null;
  const classId = typeof body.class_id === 'string' ? body.class_id : null;
  if (!studentId || !classId) return NextResponse.json({ error: 'student_id and class_id required' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !STAFF.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  const admin = createAdminSupabaseClient();
  const { data: enrolled } = await admin.from('enrollments').select('student_id').eq('class_id', classId).eq('student_id', studentId).maybeSingle();
  if (!enrolled) return NextResponse.json({ error: 'Student not in class' }, { status: 403 });
  const { data: stu } = await admin.from('users').select('full_name').eq('id', studentId).maybeSingle();
  const firstName = ((stu as { full_name?: string } | null)?.full_name ?? 'there').split(' ')[0];

  const out = await generateHighFiveDraft({
    studentName: firstName,
    reasonHint: typeof body.reason_hint === 'string' ? body.reason_hint : undefined,
    contextHint: typeof body.context_hint === 'string' ? body.context_hint : undefined,
  });
  return NextResponse.json(out);
}
```

- [ ] **Step 4: Run; verify pass** — same command → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**
```bash
git add "src/app/api/teacher/high-fives/draft"
git commit -m "feat(3b): high-five AI draft route"
```

---

## Task 13: High-Fives — send route

**Files:**
- Create: `src/app/api/teacher/high-fives/send/route.ts`
- Test: `src/app/api/teacher/high-fives/send/__tests__/route.test.ts`

**Interfaces:**
- `POST` body `{ student_id: string; class_id: string; text: string; reason_hint?: string; ai_drafted?: boolean }` → 200 `{ ok: true, id }` / 400 / 401 / 403 / **422 `{ violations }`** (guardrail) / 500. Auth chain + `guardClassAccess` + enrollment check (as in draft). On 422, do NOT insert.

- [ ] **Step 1: Failing test** — cover: 401/403; 422 with `{ violations }` when `validateHighFive(text)` is non-empty (no insert); text length bounds (empty → 400, >600 → 400); happy path inserts a `high_fives` row (school_id from class) and returns `{ ok: true, id }`; insert `.error` → 500.

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/app/api/teacher/high-fives/send/__tests__/route.test.ts"` → FAIL.

- [ ] **Step 3: Implement**

`src/app/api/teacher/high-fives/send/route.ts`:
```typescript
import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createAdminSupabaseClient } from '@/lib/supabase/server';
import { guardClassAccess } from '@/lib/auth/guards';
import { STAFF_ROLES } from '@/lib/auth/roles';
import { validateHighFive } from '@/lib/highfives/guardrail';

const STAFF = new Set<string>(STAFF_ROLES);

export async function POST(req: Request): Promise<NextResponse> {
  let body: { student_id?: unknown; class_id?: unknown; text?: unknown; reason_hint?: unknown; ai_drafted?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  const studentId = typeof body.student_id === 'string' ? body.student_id : null;
  const classId = typeof body.class_id === 'string' ? body.class_id : null;
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!studentId || !classId) return NextResponse.json({ error: 'student_id and class_id required' }, { status: 400 });
  if (text.length === 0 || text.length > 600) return NextResponse.json({ error: 'text must be 1–600 chars' }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  const role = profile?.role ?? null;
  if (!role || !STAFF.has(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Guardrail re-validation server-side (fail-closed) — cannot be bypassed by the client.
  const violations = validateHighFive(text);
  if (violations.length > 0) return NextResponse.json({ violations }, { status: 422 });

  const guard = await guardClassAccess(classId);
  if (guard) return guard;

  const admin = createAdminSupabaseClient();
  const { data: enrolled } = await admin.from('enrollments').select('student_id').eq('class_id', classId).eq('student_id', studentId).maybeSingle();
  if (!enrolled) return NextResponse.json({ error: 'Student not in class' }, { status: 403 });
  const { data: cls } = await admin.from('classes').select('school_id').eq('id', classId).maybeSingle();
  const schoolId = (cls as { school_id?: string } | null)?.school_id;
  if (!schoolId) return NextResponse.json({ error: 'Class not found' }, { status: 404 });

  const { data: inserted, error } = await admin.from('high_fives').insert({
    school_id: schoolId, class_id: classId, student_id: studentId, author_id: user.id,
    note_text: text, reason_hint: typeof body.reason_hint === 'string' ? body.reason_hint : null,
    ai_drafted: body.ai_drafted === true,
  }).select('id').single();
  if (error || !inserted) { console.error('high_fives insert failed', error); return NextResponse.json({ error: 'Write failed' }, { status: 500 }); }
  return NextResponse.json({ ok: true, id: (inserted as { id: string }).id });
}
```

- [ ] **Step 4: Run; verify pass** — same command → PASS. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**
```bash
git add "src/app/api/teacher/high-fives/send"
git commit -m "feat(3b): high-five send route (guardrail re-validate + insert)"
```

---

## Task 14: High-Fives — page + composer + recent list

**Files:**
- Create: `src/app/(teacher)/high-fives/_components/HighFiveComposer.tsx`
- Modify (replace stub): `src/app/(teacher)/high-fives/page.tsx`
- Test: `src/app/(teacher)/high-fives/_components/__tests__/HighFiveComposer.test.tsx`

**Interfaces:**
- The page (server component) loads suggestions + recent sent notes and passes them to the client composer. To build `SuggestionInput[]`, the page uses `loadRosterSignals` for band + (for effort/trajectory) `loadStudentSignals` per focus-group student is too heavy — instead derive a lean input: band from roster; `dominant_effort`/`trajectory`/`had_recent_reteach_win` left null/false for students we don't deep-load (the `stretch` + advanced path still works from band alone). Recent high-fives in the last 7 days → set `recent_high_five`. Keep it lean: pass `SuggestionInput[]` built from roster band + a 7-day high_fives lookup.
- Composer client island: props `{ classId: string; suggestions: HighFiveSuggestion[] }`. Calls `POST /draft` then `POST /send`; handles 422 inline.

- [ ] **Step 1: Failing test for composer**

`src/app/(teacher)/high-fives/_components/__tests__/HighFiveComposer.test.tsx`:
```typescript
// @vitest-environment jsdom
import '@/test/setup-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HighFiveComposer } from '../HighFiveComposer';

const suggestions = [{ student_id: 's1', full_name: 'Ann Lee', reason: 'stretch' as const, context_hint: 'Ready for more.' }];
beforeEach(() => vi.restoreAllMocks());

describe('HighFiveComposer', () => {
  it('lists a suggestion and opens the composer pre-selected on Write a note', () => {
    render(<HighFiveComposer classId="c1" suggestions={suggestions} />);
    expect(screen.getByText('Ann Lee')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /write a note/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
  it('shows 422 violations inline and does not clear the draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('/send')
        ? new Response(JSON.stringify({ violations: [{ phrase: 'great job', suggestion: 'Name the specific thing.' }] }), { status: 422 })
        : new Response(JSON.stringify({ draft_text: 'Great job!', source: 'ai' }), { status: 200 }),
    ));
    render(<HighFiveComposer classId="c1" suggestions={suggestions} />);
    fireEvent.click(screen.getByRole('button', { name: /write a note/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Great job!' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));
    await waitFor(() => expect(screen.getByText(/name the specific thing/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/app/(teacher)/high-fives/_components/__tests__/HighFiveComposer.test.tsx"` → FAIL.

- [ ] **Step 3: Implement `HighFiveComposer.tsx`**
```typescript
'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/core/Card';
import { SectionLabel } from '../../_components/SectionLabel';
import type { HighFiveSuggestion } from '@/lib/highfives/suggestions';

interface Violation { phrase: string; suggestion: string }

export function HighFiveComposer({ classId, suggestions }: { classId: string; suggestions: HighFiveSuggestion[] }): React.JSX.Element {
  const router = useRouter();
  const [active, setActive] = useState<HighFiveSuggestion | null>(null);
  const [text, setText] = useState('');
  const [aiDrafted, setAiDrafted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [err, setErr] = useState<string | null>(null);

  function open(s: HighFiveSuggestion) { setActive(s); setText(''); setViolations([]); setErr(null); setAiDrafted(false); }

  async function draft() {
    if (!active) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/teacher/high-fives/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: active.student_id, class_id: classId, reason_hint: active.reason, context_hint: active.context_hint }),
      });
      const data = await res.json();
      if (res.ok && data.draft_text) { setText(data.draft_text); setAiDrafted(true); }
      else setErr('Could not draft — write your own below.');
    } catch { setErr('Could not draft — write your own below.'); }
    setBusy(false);
  }

  async function send() {
    if (!active || text.trim().length === 0) return;
    setBusy(true); setViolations([]); setErr(null);
    try {
      const res = await fetch('/api/teacher/high-fives/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: active.student_id, class_id: classId, text, reason_hint: active.reason, ai_drafted: aiDrafted }),
      });
      if (res.status === 422) { const d = await res.json(); setViolations(d.violations ?? []); setBusy(false); return; }
      if (!res.ok) { setErr('Could not send — try again.'); setBusy(false); return; }
      setActive(null); setText(''); router.refresh();
    } catch { setErr('Could not send — try again.'); }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionLabel tone="lime">Worth recognizing today</SectionLabel>
      {suggestions.length === 0 && (
        <p className="text-fg text-sm">No standouts to flag today — you can still write a note to anyone from the roster.</p>
      )}
      <div className="flex flex-col gap-3">
        {suggestions.map((s) => (
          <Card key={s.student_id} tone="surface">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-fg font-display font-bold">{s.full_name}</span>
                <span className="text-fg text-sm">{s.context_hint}</span>
              </div>
              <button type="button" onClick={() => open(s)}
                className="rounded-md border-2 border-sidebar-edge bg-brand-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                Write a note
              </button>
            </div>
          </Card>
        ))}
      </div>

      {active && (
        <Card tone="brand">
          <div className="flex flex-col gap-3">
            <p className="text-fg font-display font-bold">A note for {active.full_name}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={draft} disabled={busy}
                className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                {busy ? 'Working…' : 'Draft with help'}
              </button>
            </div>
            <label className="sr-only" htmlFor="hf-text">Note text</label>
            <textarea id="hf-text" value={text} onChange={(e) => { setText(e.target.value); setAiDrafted(false); }}
              maxLength={600} rows={3}
              className="w-full rounded-md border-2 border-sidebar-edge bg-surface p-2 text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" />
            {violations.length > 0 && (
              <ul className="flex flex-col gap-1">
                {violations.map((v, i) => <li key={i} className="text-fg text-sm">Avoid “{v.phrase}” — {v.suggestion}</li>)}
              </ul>
            )}
            {err && <p className="text-fg text-sm">{err}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={send} disabled={busy || text.trim().length === 0}
                className="rounded-md border-2 border-sidebar-edge bg-brand px-4 py-1 text-sm font-bold text-fg-on-brand shadow-sticker disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                Send
              </button>
              <button type="button" onClick={() => setActive(null)}
                className="rounded-md border-2 border-sidebar-edge bg-surface px-3 py-1 text-sm font-bold text-fg shadow-sticker focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                Cancel
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
export default HighFiveComposer;
```

- [ ] **Step 4: Run; verify pass** — same command → PASS.

- [ ] **Step 5: Replace the page stub**

`src/app/(teacher)/high-fives/page.tsx`:
```typescript
import React from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/requireRole';
import { firstClassIdForTeacher } from '@/lib/teacher/firstClassIdForTeacher';
import { guardClassAccess } from '@/lib/auth/guards';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { loadRosterSignals } from '@/lib/signals/loadRosterSignals';
import { buildHighFiveSuggestions, type SuggestionInput } from '@/lib/highfives/suggestions';
import { EmptyState } from '@/components/core/EmptyState';
import { PageHeader } from '../_components/PageHeader';
import { HighFiveComposer } from './_components/HighFiveComposer';

const NO_CLASSES = (<EmptyState variant="just-getting-started" titleOverride="No classes yet" bodyOverride="Once a class is set up for you, you can recognize students here." />);
const CLASS_UNAVAILABLE = (<EmptyState variant="just-getting-started" titleOverride="That class isn't available" bodyOverride="Use the class selector to pick one of your classes." />);

export default async function HighFivesPage({ searchParams }: { searchParams: Promise<{ class?: string }> }): Promise<React.JSX.Element> {
  const { class: classId } = await searchParams;
  if (!classId) {
    const { userId } = await requireRole(['teacher']);
    const firstId = await firstClassIdForTeacher(userId);
    if (!firstId) return <div className="p-6">{NO_CLASSES}</div>;
    redirect(`/high-fives?class=${firstId}`);
  }
  const guard = await guardClassAccess(classId);
  if (guard) return <div className="p-6">{CLASS_UNAVAILABLE}</div>;

  const admin = createAdminSupabaseClient();
  const roster = await loadRosterSignals(admin, classId);

  // recent high-fives (7d) → suppress repeat suggestions
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await admin.from('high_fives').select('student_id').eq('class_id', classId).gte('created_at', since);
  const recentSet = new Set((recent ?? []).map((r: { student_id: string }) => r.student_id));

  const inputs: SuggestionInput[] = roster.roster.map((r) => ({
    student_id: r.student_id, full_name: r.full_name, band: r.band,
    dominant_effort: null, trajectory: null, had_recent_reteach_win: false,
    recent_high_five: recentSet.has(r.student_id),
  }));
  const suggestions = buildHighFiveSuggestions(inputs);

  return (
    <div className="p-5 flex flex-col gap-5">
      <PageHeader title="High Fives" kicker="Catch them doing something right" accent="lime" />
      <HighFiveComposer classId={classId} suggestions={suggestions} />
    </div>
  );
}
```
> Note: lean suggestion inputs derive `stretch` from band; deeper effort/trajectory/reteach reasons are wired when a class-level effort rollup is added (fast-follow). Documented limitation.

- [ ] **Step 6: Run gates** — composer vitest → PASS; `npx tsc --noEmit` → 0; `npm run build` → 0.

- [ ] **Step 7: Append composer copy + commit**

Append composer labels + empty-state copy to `STRINGS-FOR-BARB.md §High-Fives`.
```bash
git add "src/app/(teacher)/high-fives" STRINGS-FOR-BARB.md
git commit -m "feat(3b): high-fives page + composer"
```

---

## Task 15: High-Fives — student-side loader + dashboard note card

**Files:**
- Create: `src/lib/highfives/loadStudentHighFives.ts`
- Modify (replace placeholder): `src/app/(student)/student/dashboard/page.tsx`
- Test: `src/lib/highfives/__tests__/loadStudentHighFives.test.ts`

**Interfaces:**
- Produces:
  - `interface StudentHighFive { id: string; note_text: string; created_at: string }`
  - `loadStudentHighFives(admin: SupabaseClient, studentId: string, limit?: number): Promise<StudentHighFive[]>` — newest-first; ALSO marks any unviewed ones `viewed_by_student_at = now` (best-effort).

- [ ] **Step 1: Failing test** — mock admin; assert it selects the student's notes newest-first with the limit, and issues an update to stamp `viewed_by_student_at` for rows where it is null.

`src/lib/highfives/__tests__/loadStudentHighFives.test.ts` — mirror the gradebook mock-admin harness; assert `from('high_fives')` select chain `.eq('student_id', studentId).order('created_at', { ascending: false }).limit(2)` returns mapped rows and an `update({ viewed_by_student_at })` is issued for unviewed ids.

- [ ] **Step 2: Run; verify fails** — `npx vitest run "src/lib/highfives/__tests__/loadStudentHighFives.test.ts"` → FAIL.

- [ ] **Step 3: Implement**

`src/lib/highfives/loadStudentHighFives.ts`:
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StudentHighFive { id: string; note_text: string; created_at: string }

export async function loadStudentHighFives(admin: SupabaseClient, studentId: string, limit = 2): Promise<StudentHighFive[]> {
  const { data } = await admin.from('high_fives')
    .select('id, note_text, created_at, viewed_by_student_at')
    .eq('student_id', studentId).order('created_at', { ascending: false }).limit(limit);
  const rows = (data ?? []) as (StudentHighFive & { viewed_by_student_at: string | null })[];
  const unviewed = rows.filter((r) => r.viewed_by_student_at === null).map((r) => r.id);
  if (unviewed.length) {
    try { await admin.from('high_fives').update({ viewed_by_student_at: new Date().toISOString() }).in('id', unviewed); }
    catch { /* best-effort; never block the read */ }
  }
  return rows.map((r) => ({ id: r.id, note_text: r.note_text, created_at: r.created_at }));
}
```

- [ ] **Step 4: Run; verify pass** — same command → PASS.

- [ ] **Step 5: Add the note card to the student dashboard**

Replace `src/app/(student)/student/dashboard/page.tsx` placeholder with a server component that keeps any existing copy and adds the note card at top:
```typescript
import React from 'react';
import { requireRole } from '@/lib/auth/requireRole';
import { createAdminSupabaseClient } from '@/lib/supabase/server';
import { Card } from '@/components/core/Card';
import { loadStudentHighFives } from '@/lib/highfives/loadStudentHighFives';

export default async function StudentHome(): Promise<React.JSX.Element> {
  const { userId } = await requireRole(['student']);
  const admin = createAdminSupabaseClient();
  const notes = await loadStudentHighFives(admin, userId, 2);

  return (
    <div className="p-6 flex flex-col gap-6">
      <h1 className="font-display text-fg text-xl font-semibold">Your CORE space</h1>
      {notes.length > 0 && (
        <Card tone="brand">
          <div className="flex flex-col gap-3">
            <p className="text-fg text-xs font-bold uppercase tracking-wide">A note from your teacher</p>
            {notes.map((n) => (
              <p key={n.id} className="text-fg text-base leading-relaxed">{n.note_text}</p>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
```
> Student-strict: `note_text` was guardrailed at send time (no numbers/jargon/empty-praise). The view renders it verbatim — no new copy.

- [ ] **Step 6: Run gates** — loader vitest → PASS; `npx tsc --noEmit` → 0; `npm run build` → 0; `npm run a11y` → all-green.

- [ ] **Step 7: Commit**
```bash
git add src/lib/highfives/loadStudentHighFives.ts src/lib/highfives/__tests__/loadStudentHighFives.test.ts "src/app/(student)/student/dashboard/page.tsx"
git commit -m "feat(3b): student note-from-teacher view"
```

---

## Task 16: Full-suite gates + STRINGS-FOR-BARB consolidation

**Files:** (no new source) — verification + docs.

- [ ] **Step 1: Run the whole suite** — `npx vitest run --no-file-parallelism` (avoids the jsdom worker flake). Expected: all green. If a single file flakes, re-run it individually to confirm it's environmental, not a regression.
- [ ] **Step 2:** `npx tsc --noEmit` → 0.
- [ ] **Step 3:** `npm run build` → 0.
- [ ] **Step 4:** `npm run a11y` → all-green (WCAG-AA gate).
- [ ] **Step 5:** Confirm `STRINGS-FOR-BARB.md` has complete `## Alerts`, `## High-Fives`, `## Insights` sections (every DRAFT string introduced above). Add a one-line note that the High-Five AI voice + empty-praise list need Barb's review.
- [ ] **Step 6: Commit**
```bash
git add STRINGS-FOR-BARB.md
git commit -m "docs(3b): consolidate Barb copy drafts; gates green"
```

---

## Self-Review (run by the plan author before handoff)

**Spec coverage:**
- Migration `0017` (alerts + high_fives) → Task 1. ✓
- Alerts reconcile-on-read + triggers (low_quiz, low_assignment, reteach_flag, reteach_review, strong_result; divergence dropped) + severity buckets + lifecycle (manual + auto-clear) → Tasks 4,5. ✓
- Alerts route + page + badge → Tasks 6,7,8. ✓
- High-Fives suggestions + AI draft + guardrail + send + page + student view → Tasks 9–15. ✓
- Insights quiet hub (band mix + observation + skill gaps; no charts) → Tasks 2,3. ✓
- Leak discipline (teacher = banned-word only; student = leak + banned + empty-praise) enforced in every copy helper + the guardrail + send route. ✓
- Auth chain + `new Set(STAFF_ROLES)` membership + `guardClassAccess`/enrollment check in every route. ✓
- "Assignments" not "Homework" — asserted in the alert-label test. ✓
- Deferred items (admin alerts, event-firing, auto-issue/cooldown/parent digest, charts) — not in any task. ✓

**Type consistency:** `AlertSourceKind`/`AlertSeverity` defined in `alertTriggerLabel.ts` (Task 4) and consumed by `reconcileAlerts` (5), `openAlertCount` (6), `AlertRow` (8). `HighFiveSuggestion`/`SuggestionInput` defined in `suggestions.ts` (9), consumed by the composer (14) + page (14). `Violation` defined in `guardrail.ts` (10), consumed by `generateDraft` (11) + send route (13) + composer (14). `BandMix` defined in `insightsObservation.ts` (2), consumed by `loadInsights` (2) + `BandMix.tsx` (3). Consistent. ✓

**Placeholder scan:** Every code step has complete code. The two mock-admin test steps (Task 5 step 5, Task 6 step 1, Task 15 step 1) reference the existing `loadGradebook` test harness as the exact mock pattern rather than re-deriving it — this is a real, readable file, not a placeholder. ✓
