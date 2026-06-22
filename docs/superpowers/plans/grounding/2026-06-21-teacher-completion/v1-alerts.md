# V1 Teacher ALERTS Subsystem — Grounding

**Date:** 2026-06-22 (filled in during Epic 3b kickoff; the teacher-completion grounding pass had recorded it in memory but never written the file).
**Source repo:** `C:/users/inteliflow/core` (V1).

## Overview
V1 alerts are an **event-driven, severity-tiered "things that just changed" feed** — explicitly distinct from steady-state class status (which lives on Overview/Insights). Fires on **three engine paths**, persists rows to a `public.alerts` table, surfaces them to teachers on `/teacher/alerts` (bucketed by severity) and to admins on `/admin/alerts` (table). Open urgent alerts also feed a de-duplicated dashboard watchlist. Teachers resolve manually.

## DB schema — `public.alerts` (V1 `000_full_schema.sql:239–253`)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| school_id | uuid NOT NULL → schools | tenancy |
| class_id | uuid → classes, nullable | (NULL = school-wide; unused in V1) |
| student_id | uuid NOT NULL → users | target |
| quiz_attempt_id | uuid nullable | quiz-sourced alerts |
| insight_id | uuid nullable | reserved, **unused** |
| severity | text CHECK ('urgent'\|'watch'\|'info') | priority tier |
| trigger_reason | text NOT NULL | event type (enum below) |
| status | text CHECK ('open'\|'resolved') DEFAULT 'open' | |
| resolved_by | uuid → users, nullable | |
| resolved_at | timestamptz nullable | |
| resolution_note | text nullable | |
| created_at | timestamptz DEFAULT now() | event time |

No indexes; no RLS — **scoping is app-logic only** (teacher sees own classes). Admin view also has a legacy `urgent` boolean distinct from `severity` (map `urgent=true ↔ severity='urgent'`).

## Trigger reasons (enum)
**Quiz submit** (`app/api/attempts/[attemptId]/submit/route.ts`): `score_below_40` (urgent), `score_40_to_60` (watch), `incomplete_attempt` (urgent), `strong_performance` (>80%, info — motivational).
**Signal computation** (`lib/signals/runSignalComputation.ts:167–206`, `maybeFireDivergenceAlert`): `divergence_hw_higher`, `divergence_quiz_higher` — watch if divergence ∈ [20,40), urgent if ≥40.
**Teacher / reteach** (`reteach/route.ts`): `teacher_reteach_flag` (watch), `reteach_completed_pending_review` (urgent).
**Homework submit** (`homework-submit/route.ts`): `homework_low_score` — <40 urgent, <60 watch.
**Model regression**: `mastery_regression` (band dropped) if detected.

## Severity logic (`lib/utils/scoring.ts`)
```ts
defaultAlertSeverity(scorePct, isComplete):
  if (!isComplete) 'urgent'
  if (scorePct < 40) 'urgent'
  if (scorePct < 60) 'watch'
  else 'info'
```
**De-dup:** each engine skips insert if an open alert already exists for (student_id, class_id, trigger_reason); quiz path gates on severity≠default. **No timed cooldown** — manual resolve only.

## API
- `GET /api/teacher/alerts/open` → open **urgent** across teacher's classes, **deduped per (student,class)** (newest trigger), for dashboard watchlist.
- `GET /api/teacher/student/[studentId]/alerts` → all open alerts for one student (all severities), teacher-class-scoped (admins bypass).
- `GET /api/teacher/admin/alerts?classId&status` → school-wide table, enriched with student/class/teacher names + `classes` list.
- `PATCH /api/teacher/admin/alerts` → `{alertId, action: resolve|flag_urgent|unflag_urgent}`.
- Teacher resolve (client): `alerts.update({status:'resolved'}).eq('id',…)` — leaves resolved_by/at NULL (no auth context client-side).

## UI — `/teacher/alerts` (V1)
- Filter tabs: **open | resolved**.
- **Severity buckets (Barb 2026-05-13 copy):**
  - 🔴 **"Needs attention this week"** (urgent) — sub: "Worth a check-in within the next few days."
  - 🟡 **"Check In"** (watch) — sub: "Look at when you have a moment."
  - ℹ️ **"Heads-up"** (info) — sub: "Information only."
- Per-alert card: student name (→ student profile), trigger label, **View Student** + **Resolve**.
- Empty: open → "No new change events" / "Nothing has changed recently. For ongoing class state, see Overview."; resolved → "No resolved alerts yet."
- Title/subtitle: "Alerts" / "Things that just changed — for the bigger picture, see Overview".

### Trigger → label copy (`lib/i18n/en.ts teacherAlerts`)
- score_below_40: "Quiz score below 40% on the latest attempt"
- score_40_to_60: "Quiz score between 40–60% — borderline"
- incomplete_attempt: "Submitted incomplete work"
- strong_performance: "Strong recent performance"
- divergence_hw_higher: "Assignment grades outpacing quiz scores — possible support gap on quizzes"
- divergence_quiz_higher: "Quiz scores outpacing assignment grades — possible assignment slippage"
- teacher_reteach_flag: "Teacher flagged this student for reteach"
- reteach_completed_pending_review: "Reteach work submitted — ready for your review"
- homework_low_score: "An assignment just received a low grade"
- mastery_regression: "Mastery dropped from prior assessment"

## V2 reuse / gaps
**V2 has NOT built alerts.** No table, routes, or components.
Reusable in V2: `src/lib/signals/computeHwQuizDivergence.ts` (divergence math/thresholds ported), `computeSignals.ts` (orchestrator — would host divergence firing), `loadRosterSignals.ts` already computes focus-group + risk (the "who needs attention" set), `src/lib/copy/` (extend with a trigger→label helper). Next migration slot = `0017`.
Missing for a build: the table, a `triggerReasonLabel` copy helper, alert-firing hooks on quiz/homework/divergence/reteach paths, the GET (+ resolve) route(s), the `/alerts` page, and the nav badge count source (`navConfig` already has `badgeKey:'alerts'`).

## LEAN-V2 open decisions (carried into spec brainstorm)
- **Fire-and-persist (V1-parity lean, keeps "what changed when" history)** vs. derive-on-read from current signals (no history). Memory leans fire-and-persist.
- Severity buckets: keep Barb's three (urgent/watch/info → Needs attention / Check In / Heads-up).
- Resolve: keep manual; capture resolved_by/at server-side (V1 left them NULL — tighten).
- Scope: teacher-only `/alerts` for 3b; admin alerts table is DEFERRED (admin epic).
- All trigger labels are teacher-only prose → still leak-guarded (`hasBannedWord`); count-bearing labels (the "below 40%" string) are teacher-only so a digit is allowed but banned words are not — **Barb gates final copy**.
