# V1 Teacher HIGH-FIVES ("Virtual Hugs") Subsystem — Grounding

**Date:** 2026-06-22 (filled in during Epic 3b kickoff).
**Source repo:** `C:/users/inteliflow/core` (V1).

## Overview
V1 ships a **heavy "Virtual Hugs" engine**: auto-trigger + manual teacher-send + student wall + parent digest + platform audit. Every evaluation (issued OR silenced) is logged. Text is AI-generated against a forbidden-phrase voice guardrail with deterministic fallback. **The LEAN V2 target (locked in memory): derived wins surfaced + teacher send-a-note; DEFER auto-issue engine, parent digest, cooldowns/ceiling, and audit dashboard.**

## Routes & pages (V1)
- **Teacher** `app/(dashboard)/teacher/hugs/page.tsx` (667 lines): (1) **Suggested Today** — signal-driven suggestions from `findSuggestedToday()`, pre-fills a context hint; (2) **inline composer** — two-step Draft→Send; (3) **Recent** — last 20 in 30d (category, timeAgo, author); (4) **roster heatmap** — 30d hug count per student.
- **Student** `app/(dashboard)/student/hugs/page.tsx`: wall of teacher notes, latest 2 + "See more", inline new-note notification, **share-with-parent toggle** per note.
- **Platform audit** `app/(dashboard)/platform/hugs-audit/page.tsx`: drift alerts, silenced inventory, tone CSV export.

## API (V1)
- `GET /api/teacher/hugs/list` → `{students, recent, suggested_today}` (roster-scoped).
- `POST /api/teacher/hugs/compose` → `action='draft'` `{student_id, context_hint}` → `{draft_text, source:'gpt'|'gpt_retry'|'deterministic_fallback', fallback_used}`; `action='send'` `{student_id, text}` → 200 / **422** (forbidden phrase: category+suggestion) / **409** (cooldown/ceiling).
- `GET /api/teacher/cron/weekly-hug-check` (Mon 05:00 UTC) → `tryWeeklyHugsForStudent()` per student (PATTERN/COMEBACK/PERMISSION).
- `GET /api/teacher/cron/weekly-hug-digest` (Fri 16:00 UTC) → parent email per opted-in child.
- `GET /api/teacher/platform/hugs-audit` (admin).

## DB schema (V1 `044_virtual_hugs.sql`)
- **virtual_hugs**: id, student_id, `category` CHECK(effort|pattern|comeback|permission|teacher|self_discovery), `trigger_event`, trigger_event_id, `signal_evidence` jsonb NOT NULL (matching_rule, inputs, candidate_event, evaluated_at), `hug_text` NOT NULL, voice_profile, `authored_by` (teacher), visible_to_student (def true), `shared_with_parent` (def false), shared_with_teacher, pinned_by_student, viewed_by_student_at, created_at. Idx: (student_id, created_at desc), (category, created_at desc).
- **hug_audit_log**: every evaluation — candidate_event, student_id, school_id, `evaluation_result` CHECK(issued|silenced_no_criteria|silenced_cooldown|silenced_ceiling|silenced_guard), category_attempted, silence_reason, signal_snapshot jsonb, virtual_hug_id, created_at.
- **hug_eligibility_state**: per-student rolling — last_{effort,pattern,comeback,permission,self_discovery,teacher}_hug_at, hugs_issued_in_window (rolling 7d), ceiling_window_start, updated_at.
- **users.parent_hug_digest_optin** (bool, def false).

## Engine (`lib/hugs/engine.ts evaluateHugs`)
Pure `EvaluationContext → HugEvaluation`. Flow: reset 7d ceiling window → build candidates by event (`homework_submitted→[effort]`, `weekly_pattern_check→[comeback,permission,pattern]`, `reteach_completed→[comeback]`, `teacher_authored→[teacher]`) → for each by priority (comeback5 > permission4 > effort3 > pattern2 > self_discovery1 > teacher0): anti-hug guards → cooldown → ceiling → criteria → issue or continue.
- **Ceiling:** `HUGS_PER_WEEK_CEILING=4` (non-teacher).
- **Cooldown days:** effort 5, pattern 14, comeback 21, permission 14, self_discovery 30, teacher 7.
- **Effort criteria:** latestAttempt + four signals (effort_label ∈ {effortful_success, struggling_trying}, hours_to_submit > median, teli_hint_count ≥ 1, (articulation_used OR self_unblock_flag)). *NOTE: articulation/self_unblock are NULL pre-"Prompt 4 C-F" → currently silences as 'thinking_not_demonstrated'.*
- **Pattern/Comeback/Permission:** snapshot/model-driven transitions (consistency_label moves, dominant_effort shift, reteach-tribe exit, risk rise).
- `persistEvaluation()`: on issued → insert virtual_hugs + audit + upsert eligibility; on silenced → audit only; audit writes are non-blocking.

## Suggestions (`lib/hugs/suggestions.ts findSuggestedToday`, limit 5)
Pure, priority 1–4: **persistence**(4: struggling_trying + low avg), **recovery**(3: last≥60 after ≥15pt drop, 4+ points), **effortful_success**(3), **consistency_rising**(2: consistency_label=improving), **self_unblock_rising**(1: trend rising & rate≥0.3). Skips students with a hug in last 7d. Each carries a `context_hint` to pre-fill the composer.

## Text generation & guardrail
- `generateHugText()` (`lib/hugs/textGenerator.ts`): GPT call w/ `buildTeliSystemPrompt({mode:'hug'})`, post-check `passesGuardrail` (FORBIDDEN_PHRASES from `lib/teli/voice.ts`), single retry, else `deterministicFallback`. Returns `{text, source}`.
- `draftTeacherHug()` (`teacherCompose.ts`): same, fallback "NAME, your teacher noticed what you did this week and wanted to name it."
- `validateTeacherEdit()` (`guardrail.ts`): pure check on the teacher's final text → violation array for 422.
- **FORBIDDEN_PHRASES** (`lib/teli/voice.ts`, shared with LIFT): great-job, awesome, amazing, excellent, perfect, you-got-this, im-proud, exclamation, emoji-praise, etc. Both draft and send enforce; no fallback may violate. **This is the coach-posture "name the specific thing, never empty praise" guard.**

## Drift audit (`lib/hugs/driftAlerts.ts`, 14d window)
volume_exceeded (>4.5/student/wk), category_concentration (>60% one category), teacher_overissuance (>4/teacher/wk).

## V2 reuse / gaps
**Reusable in V2:** `src/lib/signals/computeEffortLabel.ts` (effort classifier, matches V1), `loadStudentSignals.ts`/`loadRosterSignals.ts` (the wins/trajectory data), behavioral model. **AI infra:** V2 uses `claudeChat` (`claude-opus-4-8`) + the Teli voice/reveal-guard work already shipped (Epic 2 Seg 3) — the high-five guardrail can mirror Teli's defense-in-depth.
**Missing in V2:** all hug tables, engine/triggers/suggestions/textGenerator/guardrail/driftAlerts, the pages, parent-digest cron, hug copy. No `FORBIDDEN_PHRASES` helper ported yet (Teli's voice rules are the nearest analog).

## LEAN-V2 scope (locked in memory) + open decisions for spec
- **SHIP:** (a) derived **wins** surfaced to the teacher (from existing signals — advanced band, upward trajectory, completed reteach, effortful success); (b) **teacher send-a-note** (manual), persisted, guardrailed against empty praise.
- **DEFER:** auto-issue engine (cooldown/ceiling/eligibility), parent digest cron, platform audit/drift, the 6-category taxonomy (lean uses "teacher" + derived-win framing), pin/share-with-teacher.
- **OPEN (→ brainstorm):** where the student SEES a sent note (minimal student view now vs. persist-only/defer to student-surface epic); whether to surface a derived **"worth recognizing today" suggestion list** (low-cost, reuses signals) or a blank composer; whether to include an **AI-draft** assist (V1-parity, reuses claudeChat + guardrail) or manual-only-with-guardrail for lean; parent-share toggle now vs. defer.
- Persistence table for lean = a single `high_fives` (sent notes) table; **no** audit_log / eligibility_state (deferred). Likely shares migration `0017` with alerts.
