# Epic 3b — LEAN Alerts + High-Fives + Insights (Teacher completion)

**Status:** DESIGN — awaiting Marvin sign-off → `writing-plans` → SDD.
**Date:** 2026-06-22
**Author:** Claude (with Marvin's decisions, this session).
**Grounding:** `docs/superpowers/plans/grounding/2026-06-21-teacher-completion/` — `v1-alerts.md`, `v1-highfives.md`, `v1-insights.md`, `v2-current-state.md` (+ `v1-gradebook.md`, shipped in 3a).
**Predecessor:** Epic 3a (full gradebook) — DONE + deployed (`main` `f1f5494`).

---

## 1. Goal & framing

Turn the three remaining teacher **`EmptyState` stubs** (`/alerts`, `/high-fives`, `/insights`) into working screens, **LEAN**: derive from the signals V2 already computes, persist only the minimum, and explicitly defer V1's heavy automation. V1 is the completeness floor for *student facts*; lean loses **no facts**, it defers automation + heavy analytics (all additive later). The moat ([[v2-moat-coach-over-the-shoulder]]) governs: a coach over the shoulder, not a dashboard.

This is **one increment, three independent features** sharing migration `0017` and the teacher shell. Build order (cheapest/safest → most complex): **C Insights → A Alerts → B High-Fives**.

### Locked decisions (Marvin, this session)
- **Alerts are reconciled on read, not fired into shipped routes.** A loader recomputes the current "needs attention / just changed" set from signals when the `/alerts` page loads, persists alert rows for history, and auto-clears rows whose condition no longer holds. **Does not touch the shipped quiz/assignment submit pipelines** (safer for a live beta).
- **Alert triggers (divergence DROPPED):** low quiz, low assignment grade, teacher reteach flag, reteach-ready-for-review, and a quiet strong-result "heads-up." Rationale: a weak comprehension quiz already alerts on its own merits; a standalone "homework↔quiz gap" alert is the easiest signal to misread and adds noise. What matters is the student's actual progression, surfaced via the real low result — not an abstract gap. ("divergence" is a banned copy word anyway.)
- **Alert lifecycle:** teacher "Mark handled" (stamps who+when) **or** auto-clear when the condition passes on the next read. Manual resolve is sticky for that occurrence.
- **High-Fives:** show a derived **"worth recognizing today"** suggestion list + **teacher send-a-note** with an **AI first draft** (guardrailed, teacher edits). Note is **persisted** and seen by the student on a **tiny student-facing view**.
- **Insights:** quiet hub re-presenting existing class signals.

### Deferred (NOT data loss — additive later)
- Alerts: school/admin alerts table + `/admin/alerts`; firing alerts at the moment of submit (event-sourced); per-teacher alert config; the legacy `urgent` boolean.
- High-Fives: the auto-issue engine (cooldown/ceiling/eligibility state), `hug_audit_log`, parent-digest cron + email, drift/tone audit dashboard, the full 6-category taxonomy, pin / share-with-teacher, **parent sharing** (lands with Epic 4 parent dashboard).
- Insights: strategy heat-map (needs grading-prose strategy tagging V2 lacks), custom report builder, CSV export, charts (donut/scatter/heat-map), cohort comparison.

---

## 2. Binding constraints (every task inherits these)

- **Coach posture** ([`COACH-POSTURE.md`](../../../COACH-POSTURE.md)): observation not metric; one thing at a time; plain human language; notices→suggests→confirms (never decides); quiet on good days; not a chatbot.
- **Four-audience leak discipline** (`src/lib/copy/leakGuard.ts`): teacher surfaces (`/alerts`, `/insights`, the High-Fives composer) MAY show raw numbers at their render site, but ALL prose stays **banned-word-free** (`hasBannedWord`: score/percentile/index/divergence/threshold/signal/model/algorithm/flag; "risk" is allowed). Count-bearing teacher prose is checked with `hasBannedWord` ONLY (not `assertNoLeak`, which throws on the digit). **Student-facing** surfaces (the High-Fives note + its student view) are held to the strict bar: `assertNoLeak` (no digits/%/ordinals) **and** `hasBannedWord`, plus the empty-praise guardrail (§5.4). Never expose band enum / raw risk number / pct to the student.
- **Auth chain** (every protected route + server page): `await createServerSupabaseClient()` → `auth.getUser()` → `STAFF_ROLES` gate (use `new Set<string>(STAFF_ROLES).has(role)` — `STAFF_ROLES` is a tuple, not a Set) → `guardClassAccess` IDOR guard → `createAdminSupabaseClient()` (sync; bypasses RLS — the guard is the only IDOR backstop). Student route/view gates to the authed student's own rows.
- **"Assignments", never "Homework"** in UI/copy (legacy `homework_attempts` identifiers are fine).
- **WCAG-AA, token-only:** no hardcoded hex / no arbitrary `[var(--..)]`; content text deep-ink `text-fg` (not `text-fg-muted`); status conveyed by glyph+text, never color alone; Pop-Art chrome (`border-sidebar-edge` + `shadow-sticker`); reuse `src/components/core/` + the teacher `_components` kit (PageHeader, SummaryCallout, Card, SectionLabel, EmptyState, MasteryLabel, RiskBadge).
- **Server-component page pattern** (mirror `today/page.tsx`): async; `?class=` param → `firstClassIdForTeacher` redirect when absent → `guardClassAccess` → admin client → loader → render. NO-classes and class-unavailable `EmptyState` branches.
- **All new user-facing strings are DRAFTS** → append to `STRINGS-FOR-BARB.md` (new §Alerts, §High-Fives, §Insights). Barb gates final copy.
- **AI calls** use `claudeChat` with `claude-opus-4-8` and OMIT the `temperature` param (opus-4.x/fable reject it, 400 — banked GOTCHA). Default adaptive thinking.
- **Migration:** next slot is `0017`. No edits to shipped migrations.
- **Tests:** Vitest 4; React component tests start with `// @vitest-environment jsdom` then `import '@/test/setup-dom';`. Run affected files individually (`npx vitest run "<file>"`) — the machine flakes under parallel jsdom load. Gates before merge: vitest all-green, `npx tsc --noEmit` 0, `npm run build` 0, `npm run a11y` (WCAG-AA gate) all-green.

---

## 3. Data model — migration `0017_teacher_completion.sql`

Two small tables; no edits to existing tables; no RLS dependency (app-logic + IDOR guard is the backstop, consistent with the rest of V2).

### 3.1 `public.alerts`
```sql
create table public.alerts (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  class_id        uuid not null references public.classes(id) on delete cascade,
  student_id      uuid not null references public.users(id)   on delete cascade,
  source_kind     text not null
                    check (source_kind in
                      ('low_quiz','low_assignment','reteach_flag','reteach_review','strong_result')),
  source_ref      uuid,                       -- the attempt/redo/flag row that raised it (per-occurrence identity)
  severity        text not null check (severity in ('urgent','watch','info')),
  status          text not null default 'open' check (status in ('open','resolved')),
  resolved_by     uuid references public.users(id),   -- null + resolved => auto-cleared
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now()
);

-- One alert per distinct triggering occurrence, EVER (open or resolved):
-- gives DB-level dedup (fixes V1's race) AND makes manual/auto resolve sticky for that occurrence.
create unique index alerts_occurrence_uq
  on public.alerts (student_id, class_id, source_kind, source_ref);
create index alerts_class_status_idx on public.alerts (class_id, status, severity);
```
Notes: `source_ref` is the per-occurrence key (the specific quiz attempt id, assignment attempt id, or redo attempt id). For `reteach_flag` it is the assignment-attempt id that carries `allow_redo=true`. A new occurrence (new attempt id) ⇒ a new alert; the prior one auto-clears. The unique index treats `(…, source_ref=NULL)` rows as distinct per Postgres semantics — so always populate `source_ref` (every trigger has a natural row id).

### 3.2 `public.high_fives`
```sql
create table public.high_fives (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete cascade,
  class_id            uuid not null references public.classes(id) on delete cascade,
  student_id          uuid not null references public.users(id)   on delete cascade,
  author_id           uuid not null references public.users(id),          -- the teacher
  note_text           text not null,
  reason_hint         text,            -- which suggestion seeded it: persistence|recovery|effortful_success|consistency_rising|reteach_completed|stretch  (nullable: blank composer)
  ai_drafted          boolean not null default false,
  viewed_by_student_at timestamptz,
  created_at          timestamptz not null default now()
);
create index high_fives_student_idx on public.high_fives (student_id, created_at desc);
create index high_fives_class_idx   on public.high_fives (class_id, created_at desc);
```
No cooldown/ceiling/eligibility/audit columns (deferred — a manual teacher send is deliberate, low spam risk). No `shared_with_parent` (parent sharing lands with Epic 4).

> **DB safety:** migration is authored as `0017_teacher_completion.sql` and applied to the **NEW CORE** project `pmdzxwppdlnddtnkoarc` ONLY, after sign-off, with explicit per-action authorization. Never touch V1/Spark/other projects.

---

## 4. Feature A — Alerts (`/alerts`)

### 4.1 The reconcile engine — `src/lib/alerts/reconcileAlerts.ts`
`reconcileAlerts(admin, { classId, now? }): Promise<AlertView[]>` — pure-ish; performs idempotent writes then returns the open set.

**Step 1 — compute current conditions** for the class from existing data (one batched read each):
- Latest **quiz attempt** per active student (`quiz_attempts`, most-recent by `submitted_at`, `is_complete` preferred). Condition `low_quiz` when `score_pct < 60` → `severity = score_pct < 40 ? 'urgent' : 'watch'`. `source_ref = attempt.id`.
- Latest **assignment attempt** per student (`homework_attempts`, most recent; use `displayed grade` = `teacher_score ?? score_pct` — override-wins, consistent with the gradebook). Condition `low_assignment` when displayed `< 60` → urgent `<40` else watch. `source_ref = attempt.id`.
- **Reteach flagged**: assignment attempts with `allow_redo = true` AND no completed redo yet → `reteach_flag`, severity `watch`. `source_ref = attempt.id`.
- **Reteach ready for review**: a redo attempt (`is_redo = true`) that is submitted but not yet teacher-reviewed (no `teacher_score`, status not graded) → `reteach_review`, severity `urgent`. `source_ref = redo attempt.id`.
- **Strong result** (info): latest quiz OR assignment `>= 85` (and not already low) → `strong_result`, severity `info`. `source_ref = attempt.id`. (Quiet good-news; flags a possible High-Fives candidate.)

**Step 2 — upsert open alerts:** for each current condition, `insert ... on conflict (student_id,class_id,source_kind,source_ref) do nothing`. (Conflict = this occurrence already has an alert, open or resolved — don't recreate, honoring manual-resolve stickiness.) Populate `school_id` from the class.

**Step 3 — auto-clear:** load the class's currently-**open** alerts. For each open alert whose `(source_kind, source_ref)` is **not** in Step-1's current condition set, mark it resolved (`status='resolved', resolved_at=now, resolved_by=null, resolution_note='cleared'`). Auto-clear fires because the latest data superseded the occurrence (e.g., a newer quiz attempt exists, the redo got reviewed, the reteach was consumed). Concurrency-safe: inserts dedup via the unique index (swallow 23505); resolves are idempotent.

**Step 4 — return** the open set joined to student names, shaped for the page (below). `AlertView = { id, student_id, student_name, source_kind, severity, created_at }`.

> Reconcile runs when `/alerts` loads. The **sidebar badge** does NOT reconcile (too heavy for every page) — it reads a cheap `count(*)` of open `urgent` alerts for the teacher's active class, deduped per student; eventually-consistent staleness is acceptable for a badge.

### 4.2 Copy — `src/lib/copy/alertTriggerLabel.ts`
Pure map `source_kind → label` + bucket metadata. Teacher-only prose; passes `hasBannedWord`. Drafts (→ Barb), seeded from V1:
- `low_quiz`: "Comprehension check came back low on the latest try"
- `low_assignment`: "An assignment just came back with a low grade"
- `reteach_flag`: "You flagged this student for another try"
- `reteach_review`: "Another try is in — ready for your review"
- `strong_result`: "Strong recent result — worth a high-five?"
Buckets (Barb 2026-05-13, reused): 🔴 **"Needs attention this week"** (urgent) / 🟡 **"Check In"** (watch) / ℹ️ **"Heads-up"** (info), with the V1 sub-lines.

### 4.3 Route — `POST /api/teacher/alerts/resolve`
`{ alert_id }` → auth chain → load the alert → `guardClassAccess(alert.class_id)` → `update alerts set status='resolved', resolved_by=<teacher>, resolved_at=now where id=… and status='open'` → capture `.error` → 500. Idempotent (no-op if already resolved). No body beyond `alert_id` (lean — `resolution_note` deferred).

### 4.4 Page — `src/app/(teacher)/alerts/page.tsx`
Server component, standard pattern. Calls `reconcileAlerts`, groups by severity bucket, renders:
- `PageHeader` (title "Alerts", kicker "Things that just changed"; accent brand).
- `SummaryCallout`: count-bearing calm line, e.g. "2 students need attention, 1 to check in." (`hasBannedWord`-checked). When zero open: "Nothing new — the class is steady today." (quiet on good days).
- Three bucket sections (`SectionLabel` tones: risk / warn / brand). Each alert = a `Card` row: student name (links to roster drill-in `/students/[id]?class=`), trigger label, `RiskBadge`/glyph, **"Mark handled"** button (client island → `POST resolve` → `router.refresh()`).
- Empty buckets render nothing (no empty bucket headers). Whole-page empty → `EmptyState` "No new change events."
- Resolved items are NOT shown in 3b (lean — no resolved tab). History lives in the table for later.

### 4.5 Badge — `src/lib/alerts/openAlertCount.ts` + wire into the shell
`openAlertCount(admin, { classId }): Promise<number>` = count open urgent, deduped per student. The shell (`SidebarNav`, `navConfig` already has `badgeKey:'alerts'`) reads it server-side for the active class and passes the count. (Confirm how the shell currently sources badge values during grounding-for-plan; wire minimally.)

---

## 5. Feature B — High-Fives (`/high-fives`)

### 5.1 Suggestions — `src/lib/highfives/suggestions.ts`
`buildHighFiveSuggestions(signals): Suggestion[]` (limit ~5, priority-sorted), a pure function adapted from V1's `findSuggestedToday` to **V2's available signals** (`loadRosterSignals` / `loadStudentSignals`: band, effort label, trajectory, reteach outcomes). Categories (each carries a `reason_hint` + a `context_hint` to pre-fill the draft):
- **persistence** — dominant effort pattern = struggling-but-trying with low recent results.
- **recovery** — a recent rebound after a dip (trajectory up).
- **effortful_success** — dominant effort = effortful success.
- **consistency_rising** — trajectory/consistency improving.
- **reteach_completed** — finished a redo with improvement.
- **stretch** — advanced band / ready-to-enrich.
Skip students who already received a high-five in the last 7 days (suggestion-list cooldown only — not a send block). No auto-issue. `Suggestion = { student_id, student_name, reason_hint, context_hint }`.

### 5.2 AI draft — `POST /api/teacher/high-fives/draft`
`{ student_id, reason_hint?, context_hint? }` → auth chain → `guardClassAccess` (student in class) → `claudeChat` (`claude-opus-4-8`, no `temperature`) with a hug-mode system prompt that: names the **specific** thing the student did (from `context_hint`), student-facing voice, **no digits/%/band/jargon**, no empty praise. Post-check the output through the guardrail (§5.4); ONE retry on violation; else deterministic fallback ("`<Name>`, your teacher noticed how you worked this week and wanted to name it."). Returns `{ draft_text, source: 'ai'|'ai_retry'|'fallback' }`. The teacher edits before sending.

### 5.3 Send — `POST /api/teacher/high-fives/send`
`{ student_id, text, reason_hint?, ai_drafted }` → auth chain → `guardClassAccess` → **server-side guardrail re-validation** (§5.4): on violation return **422** `{ violations: [{phrase, suggestion}] }` (client shows inline, lets the teacher fix). Also run `assertNoLeak` + `hasBannedWord` (fail-closed → 422). On pass: insert `high_fives` row (school_id from class). `text` length 1–600. No cooldown (lean).

### 5.4 Guardrail — `src/lib/highfives/guardrail.ts`
Port/mirror V1's `FORBIDDEN_PHRASES` (empty-praise: "great job", "awesome", "amazing", "excellent", "perfect", "you got this", "i'm proud", bare exclamation/emoji-praise). **First check `src/lib/teli/` for an existing forbidden-phrase/voice list and reuse it** (Teli voice work shipped in Epic 2 Seg 3); only create new if absent. `validateHighFive(text): Violation[]` (pure). This is the coach-posture "name the specific thing, never empty praise" guard — **fail-closed**, enforced on BOTH draft output and send (no path may persist a violating note), mirroring Teli's defense-in-depth ([[v2-teli-tutor-never-reveals-answer]]).

### 5.5 Page — `src/app/(teacher)/high-fives/page.tsx`
Server component, standard pattern. Renders:
- `PageHeader` ("High Fives", kicker "Catch them doing something right").
- **"Worth recognizing today"** list (suggestions) — each row: student name, the plain `context_hint`, and a **"Write a note"** button that opens the composer pre-filled (client island).
- **Composer** (client island): student (preselected or picker), **"Draft with help"** button → `POST draft` → fills an editable textarea; **Send** → `POST send` (handles 422 inline). Success → toast + clear.
- **Recent** (last ~10 sent for the class, from `high_fives`): student, when, the note text (already guardrailed). Read-only.
- Empty suggestions → quiet `EmptyState` ("No standouts to flag today — you can still write a note to anyone.").

### 5.6 Student view — tiny "notes from your teacher"
`src/lib/highfives/loadStudentHighFives.ts` (`loadForStudent(admin, studentId)`) + a small surface on the **student home** (the existing `(student)` area — confirm the exact landing route during grounding-for-plan; likely `(student)/student/assignments` or a student home). Shows the latest 1–2 notes ("A note from your teacher"), newest first; marks `viewed_by_student_at` on view. Student-strict copy bar. No pin/share in 3b. This is the only student-surface touch in 3b and keeps the feature real end-to-end.

---

## 6. Feature C — Insights (`/insights`)

### 6.1 Loader — `src/lib/insights/loadInsights.ts`
`loadInsights(admin, { classId }): Promise<ClassInsights>` — **no new data**; reuse `loadRosterSignals` (band, focus group, concept gaps) + light aggregation:
- `band_mix`: counts { needs_reinforcement (reteach), on_track (grade_level), ready_to_enrich (advanced), not_assessed (null) }.
- `concept_gaps`: existing `ConceptGapItem[]` (skill_name + how many students need it).
- `effort_read` (optional, if cheap from signals): dominant class effort pattern as a plain phrase.
- `observation`: ONE calm class-level line (the "What this means" logic, leak-guarded): reteach-heavy (≥40%) → "the latest concept may need a class-wide re-teach"; mostly advanced (≥50%) → "most are ready for deeper work on the same topic"; split → "differentiated grouping will help"; else silent.

### 6.2 Page — `src/app/(teacher)/insights/page.tsx`
Server component, standard pattern. Quiet hub:
- `PageHeader` ("Insights", kicker "Trends on your class right now").
- **Band mix** — three count pills (`MasteryLabel`-styled) + `not_assessed`. Tone-tinted Cards.
- **What this means** — the single observation line in a `SummaryCallout`; rendered only when present (quiet on good days).
- **Skills to focus on** — concept gaps as a list (skill + "N of M students need attention"); reuse/extend `ConceptGapsRail`. Silent when none.
- **Effort read** (optional) — one plain line.
- Whole-page cold-start → `EmptyState` ("Once your class has a little more activity, patterns will show up here.").
NO charts / report builder / CSV (deferred). All count-bearing prose → `hasBannedWord` only.

---

## 7. Copy → Barb

Append three new sections to `STRINGS-FOR-BARB.md`: **§Alerts** (trigger labels, bucket labels+sublines, summary/empty lines), **§High-Fives** (page kicker, suggestion context-hint templates, composer labels, AI-draft fallback, 422 violation copy, student-view heading), **§Insights** (kicker, band-pill labels, observation lines, empty states). All marked DRAFT. Note the High-Fives note text is AI-generated student-facing prose under the empty-praise guardrail — Barb should review the guardrail phrase list + the system-prompt voice.

---

## 8. Testing strategy (TDD per task)

- **`reconcileAlerts`** (node): each trigger creates the right severity; dedup (no second open alert for same occurrence); auto-clear when a newer attempt supersedes; manual-resolved occurrence does NOT recreate; strong_result info tier; idempotent on re-run.
- **`alertTriggerLabel`** / **`buildHighFiveSuggestions`** / **`loadInsights`** (node): pure-function behavior; leak/banned-word assertions hold on all output.
- **`/api/teacher/alerts/resolve`**, **`/high-fives/draft`**, **`/high-fives/send`** (node): auth chain (getUser → STAFF_ROLES via `new Set` → guardClassAccess), 422 on guardrail violation (send), guardrail re-validation can't be bypassed, write `.error` → 500, IDOR (other-class student rejected).
- **`guardrail`** (node): forbidden phrases caught; fail-closed; clean specific praise passes.
- **Pages + composer + student view** (jsdom): render the buckets/suggestions/band-mix; "Mark handled" calls resolve + refresh; composer draft→edit→send happy path + 422 inline; student view marks viewed. a11y (labels, focus-visible, color-not-sole-signal).
- Gates: vitest green, tsc 0, build 0, a11y green.

---

## 9. Out of scope (explicit)
Admin/school alerts surface; event-sourced alert firing; per-teacher alert config; auto-issued high-fives + eligibility/cooldown/ceiling/audit-log; parent digest + parent sharing; drift/tone audit; insights charts/report-builder/CSV/cohort; the 6-category hug taxonomy; pin/share-with-teacher. All deferred, additive later. Player Segment 4 (canvas) + 5 (voice) and Epic 4 (parent dashboard) follow 3b.

---

## 10. Open items for Barb / future
- Final copy for all three §sections + the High-Fives AI voice/guardrail.
- Whether resolved-alerts history gets a teacher-visible tab later (table already keeps it).
- Pre-existing band/CL vocabulary in shared score-message pools (tracked from Epic 2) still pending Barb.
