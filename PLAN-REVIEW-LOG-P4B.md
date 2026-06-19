# Plan Review Log — CORE v2 Plan 4b Foundation

**Plan:** `docs/superpowers/plans/2026-06-19-p4b-foundation.md`
**Date:** 2026-06-19

## Process

- **In-house adversarial Workflow** (`wf_93a31e57-e8d`) — 5 verification lenses (seed-determinism, schema/DB, auth/security, type/framework, discipline/test-integrity) → dedup+rank synthesis. **Primary** review; ran the *real* signal functions over the cast.
- **Codex** (`codex-review`, round 1) — launched in parallel at `codex-cli 0.140.0`, read-only. **Ran too slow to be usable; stopped by operator decision** ("Codex is taking too long so ignore"). No Codex verdict obtained; not blocking (in-house was authoritative).

Verdict: **REVISE** (in-house, `blocking: true` — 4 confirmed criticals + several importants). All revisions below applied to the plan; re-verification is Task 1's test, to be run as the first build action.

## Findings & disposition

| # | Sev | Finding (verified) | Disposition |
|---|---|---|---|
| 1 | 🔴 | Seed risk math unsatisfiable: ran real `computeRosterRiskIndex` → Jordan=51, Darius=70, **no `critical`**; coverage assertion fails. Completion penalty saturates +20 for rate≥0.7; my `deriveSignals` masked recency with fresh quiz dates. | **ACCEPT.** Added `daysAgo` to `DemoQuiz`; re-engineered Darius (stale >21d + redoRate .67) → re-derived **79=critical**; relabeled Jordan `high`; medium covered by Sofia(45)/Nadia(27.5). `deriveSignals` now uses real `daysAgo` dates. (R1) |
| 2 | 🔴 | TeacherNav test unsatisfiable: `/students/abc` matches no nav href → 0 active, asserts 1. | **ACCEPT.** Added explicit alias (Roster active when `pathname.startsWith('/students')`, per IA intent); fixed test to assert exactly-1 = Roster. |
| 3 | 🔴 | Account-takeover: `users.email` not UNIQUE; email-keyed upsert overwrites role/school_id; cast embedded the real operator email. | **ACCEPT.** Reconcile by auth id (paginated `listUsers`); never overwrite role/school_id on a non-seed-owned row; hard-fail on mismatch. Removed `DEMO_PLATFORM_ADMIN` (operator already has global access). (R2, C13/C14) |
| 4 | 🔴 | `GET /api/teacher/classes` NULL-school_id cross-tenant leak. | **ACCEPT.** Read role+school_id in one gate query; explicit per-role branches; admins require non-null school_id (else 403). (R3) |
| 5 | 🟠 | `skills` `ON CONFLICT ON CONSTRAINT` fails (expression index, no `pg_constraint`); supabase-js can't express `COALESCE`. | **ACCEPT.** C7 rewritten: pre-query insert-if-absent on `(school_id, COALESCE(subject,''), slug)`. (R4) |
| 6 | 🟠 | `auth.admin.getUserByEmail` doesn't exist; `.maybeSingle()` on non-unique email duplicates on collision. | **ACCEPT.** Use paginated `listUsers`; resolve by auth id; check errors. Grounding §2/§12 correction is Task 2 Step 8. (C13) |
| 7 | 🟠 | Reteach-cycle test built rows with a `created_at` formula that inverts Darius's cycle (−2), masked by Jordan's +25 average. | **ACCEPT.** Test now builds rows from `daysAgo`; Darius has no `allow_redo` (forms no cycle); asserts Jordan's improvement **sign** + `success_rate===100`. |
| 8 | 🟠 | Task 14 fallback creates `(platform-admin)`, but `(super-admin)` already exists. | **ACCEPT.** Reuse `src/app/(super-admin)/provision/page.tsx`. |
| 9 | 🟡 | `assignments.content` is jsonb NOT NULL; seed omitted it. | **ACCEPT.** `buildSeedRows` emits non-null `content` per assignment + test asserts `content != null`. (C9) |
| 10 | 🟡 | nav test "8 destinations" but model has 9. | **ACCEPT.** Renamed to "9 destinations". |
| 11 | 🟡 | EmptyState test uses direct jest-dom import, not `@/test/setup-dom`; blanket "all four files use setup-dom" was false. | **ACCEPT.** Reworded to "follow each file's existing 4a header". |
| 12 | 🟡 | `currentMasteryBand`/`bandIsVolatile` relied on stable-sort of tied empty keys. | **ACCEPT.** Test passes real descending `submitted_at` from `daysAgo`. |
| 13 | 🟡 | narrativeRank test only had distinct severities — never exercised the tiebreak. | **ACCEPT.** Added an equal-severity, differing-recency/action tiebreak case. |
| 14 | 🟡 | Stale `0011_signals.sql` "Task 17" comment implies columns missing; they're live. | **ACCEPT (note).** Task 2 notes the columns are present live; per-column writes kept soft-failed. |
| 15 | 🟡 | Task 13 didn't pin `school_licenses.status='trialing'` as the invariant that bypasses the enrollment-limit trigger. | **ACCEPT.** Task 13 live check asserts `status='trialing'` before enrollments. |
| 16 | 🟡 | Risk-band clustering: completion +20 floor clusters students into `high`. | **NOTE (open-risk #3).** Not fixed (would mean changing the V1-ported classifier — out of foundation scope); documented. Coverage still satisfied. |

No findings rejected. The completion-penalty quirk (#16) is acknowledged as an out-of-scope classifier behavior and documented in Open Risks rather than worked around further.
