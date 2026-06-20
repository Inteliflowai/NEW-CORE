# SPARK Phase 2 — Student Launch + Super-Admin Provisioning — Design Spec

**Date:** 2026-06-20
**Status:** Design — for user review before writing-plans
**Branch target:** `main` (feature branch off it)
**Operating principle:** **V1 (`C:/users/inteliflow/core`) is the spec and the completeness floor — V2 must do every feature V1 does. V2 is the *upgrade, not the update*: where V2's approach genuinely strengthens the platform, take it — and that approach is then canonical for V2 (do NOT reconcile back down to V1).** V2 is the **future base**: when it's fully online, V1 is decommissioned and V2 becomes the foundation for V3 — so build it durably; its improvements are the real thing, not provisional. The deliberate, sanctioned divergences are the four-audience / Barb stats-and-info presentation (actionable for every role) and the specific V2 improvements in §7. Everything else mirrors V1's proven behavior.
**Grounding (verbatim, both repos):** `docs/superpowers/plans/grounding/2026-06-20-spark-phase2/` — V2: `P1`–`P6`; V1 reference: `V1-launch-jwt.md`, `V1-provisioning.md`, `V1-student-experience.md`, `V1-config-contract-parity.md`.

---

## 1. Goal

Complete the SPARK loop's **student half** and make SPARK schools **provisionable from Super-Admin** — porting V1's proven flows into V2, with V2's upgrades. After this, a Super-Admin one-clicks a school SPARK-enabled (both sides), and a student opens their assignment in V2 and launches the Spark Challenge into SPARK and back. This closes the Phase-1 (teacher half) loop into the full end-to-end loop V1 already runs.

## 2. Where this sits (V1 → V2 parity)

Phase 1 shipped the **teacher half** (create-notify, completion ingestion, teacher Spark Challenges screen) — at parity with V1's teacher side, plus V2 upgrades (push completions, discrete `spark_status`). This phase ports V1's **student launch** + **provisioning**. The **full student assignment player** (V1's `student/homework` in-app player — Teli tutor, hints, canvas, TTS, autosave, graded submit, ~1,557 lines) is a **committed next epic** ("Student-App parity", §8) — not dropped, sequenced: it's a large standalone port and the SPARK launch is the live thread.

## 3. Scope

**In (this phase) — two sub-projects:**
- **SP-A — Super-Admin SPARK provisioning.** Port V1's CORE-side provisioning + the V2 upgrade that automates the SPARK side V1 leaves manual.
- **SP-B — Student SPARK launch surface.** A V2 `(student)/assignments` list + detail, where SPARK-bound assignments render a **"Launch Challenge"** card that hands off to SPARK (V1's exact launch flow), and status reflects back. Plus the one SPARK code change Phase 1 deferred.

**Committed next epic (separate spec):** the full non-SPARK assignment **player** (Student-App parity).

**Out (later/elsewhere):** parent SPARK surface; EduFlux/pt-BR; gamification/hugs/essay/learnerChallenge ports (tracked in the parity roadmap §8).

## 4. The V1 reference (verbatim contract — what we port)

**Launch (V1 `app/api/attempts/spark-launch/route.ts` + `student/homework` SPARK card):**
- Student card renders when `spark_attempt_id` is set and the sync didn't fail; button → `POST /api/attempts/spark-launch { assignment_id }` → opens `launch_url` in a new tab.
- Route: `auth.getUser()` → 401; IDOR `assignment.student_id !== userId` → 403; require `spark_attempt_id` (or `spark_experiment_id`) → 400 otherwise. Resolves `core_user_id`/`core_school_id`/`email`/`full_name`/`grade` **server-side from the session → `users` lookup** (never from the body).
- Sign: `jwt.sign({ core_user_id, core_school_id, spark_attempt_id, email, full_name, grade, return_url }, CORE_SPARK_API_SECRET, { expiresIn: '15m' })` — HS256, **no `iss`**.
- `return_url` rides **inside** the JWT = the V2 student assignment-detail URL (where the student lands back).
- Launch URL: `${SPARK_API_URL}/api/integration/auth?token=<jwt>&redirect=${encodeURIComponent('/student/experiment/' + spark_attempt_id)}` — **deep-link by `spark_attempt_id`** (V2 already captures it; there is NO `session_id` to add).

**Provisioning (V1 `POST /api/admin/platform-keys` + `school_licenses`):**
- V1 writes only the CORE-side per-school key row (`platform_api_keys`, product `spark`) and grants the `spark_experiences` license feature. **V1 does NOT create the SPARK-side `spark_schools`/`core_spark_links`/`feature_flags.core_integration`** — that is a manual ops step on SPARK (surfaced to CORE only as `school_not_linked` / `core_integration_disabled` errors). This is the gap V2 closes (§7).

## 5. Global constraints (binding — same as Phase 1)

- **Four-audience.** The student surface is student-scoped: soft band words + actionable next step; **never** raw risk scores, mastery enums, CL verbs, or rubric/transfer numbers (those are teacher-only). `leakGuard` on every student string. SPARK transfer/rubric detail stays teacher-side (the Phase-1 `/challenges` screen).
- **"Assignments"/"Challenge", never "Homework"** in UI (DB identifiers exempt; note V1's route is named `homework` — V2 uses `assignments`).
- **Auth/IDOR + tokens/WCAG-AA** as Phase 1. Student routes: `requireRole(['student'])` in the layout + object-level ownership in the launch route. Admin routes: `guardPlatformAdmin`.
- **SPARK auth = constant-time Bearer `CORE_SPARK_API_SECRET`** on the new provision endpoint (machine-to-machine), mirroring the existing SPARK webhooks.
- **Next.js 16; admin client bypasses RLS (guards are the backstop).**

## 6. Sub-projects (design)

### SP-A — Super-Admin SPARK provisioning (port V1 + automate the SPARK side)
- **SPARK (new):** `POST /api/integration/provision-school` — Bearer `CORE_SPARK_API_SECRET`, idempotent. Body `{ core_school_id, name, core_base_url }`. Upserts `spark_schools` (generate `school_id`, set `name`) + `core_spark_links` (conflict on `core_school_id`; set `core_base_url`, `enabled=true`) + sets `feature_flags.core_integration=true` on the spark school. Returns `{ spark_school_id }`. (Mirrors V1's `link-*` scripts; this is the V2 upgrade — V1 has no such endpoint.)
- **V2 super-admin:** a minimal **school list** under `(super-admin)` (the dead `/platform/*` nav finally gets a real home — read schools via admin client, `guardPlatformAdmin`/`requireRole(['platform_admin'])`). Per school: status (SPARK enabled? via `getSparkLink`) + an **"Enable SPARK"** action → `POST /api/admin/spark-enable { school_id }` (`guardPlatformAdmin`): calls the SPARK provision endpoint, then `provisionSparkLink()` (V2 `platform_links`, `core_base_url=newcore`), then grants the `spark_experiences` feature on `school_licenses.feature_overrides` (V1-parity license gate). Idempotent + reports per-step result.
- **Auth upgrade over V1:** session-gated super-admin (V1 used a bare env secret with no user identity).

### SP-B — Student SPARK launch surface (port V1's launch)
- **Student assignment surface:** `(student)/assignments` (list of the student's assignments via a new student-scoped GET) → `(student)/assignments/[id]` (detail). The list/detail is the home for the launch card. Non-SPARK assignments are listed; their in-V2 play is the next epic (§8) — the detail shows the assignment framing now.
- **SPARK card:** when `spark_status ∈ {created,in_progress,completed}` (V2's discrete column — cleaner than V1's `spark_attempt_id`+content flag), render a **"Launch Challenge"** card with status (from `spark_status`/`spark_completions` — **push, no polling**, a V2 upgrade over V1's 60s poll). Completed → show the student-appropriate outcome (soft, four-audience; never the transfer number).
- **Launch route:** `POST /api/attempts/spark-launch { assignment_id }` — port V1 exactly (auth, IDOR, require `spark_attempt_id`, server-side identity resolve, HS256 JWT with V1's claim set, `return_url` = `${origin}/student/assignments/${assignment_id}`, deep-link `redirect=/student/experiment/${spark_attempt_id}`). Returns `{ launch_url }`; the card opens it in a new tab.
- **SPARK change (the one Phase-1 deferral):** add `newcore.inteliflowai.com` to `isValidReturnUrl` (SPARK `app/api/integration/auth/route.ts`).
- **Edge:** `users.school_id` is nullable — guard launch when null (cannot mint a valid `core_school_id`); surface a clear "school not linked" state.

## 7. V2 upgrades over V1 (the "better", deliberate)

1. **One-click both-sided provisioning** — V1 leaves the SPARK-side link manual; V2's `provision-school` endpoint + super-admin action automate it.
2. **Session-gated super-admin** provisioning (V1: bare shared env secret).
3. **Push completions + discrete `spark_status`** drive the student card — no 60s polling, no `content.spark_completed_at` flag-scraping (V1's approach).
4. **Four-audience student presentation** — actionable, soft, leak-guarded (the Barb contract).
5. **"Assignments"/"Challenge"** naming throughout (V1 still says "homework").

## 8. V1 → V2 parity roadmap (so we always know where we are)

| Surface | V1 | V2 now | Next |
|---|---|---|---|
| Auth/login/routing | ✅ | ✅ ported | — |
| Teacher shell + screens | ✅ | ✅ (4b + shell); stats = Barb upgrade | depth audit vs V1 |
| Skills engine/signals | ✅ | ✅ ported | — |
| SPARK teacher half | ✅ | ✅ Phase 1 | — |
| **SPARK student launch + provisioning** | ✅ | ✗ | **THIS SPEC** |
| **Student assignment player** (non-SPARK) | ✅ rich | ✗ placeholder | **committed next epic** |
| Parent surface | ✅ | ◐ stub | epic |
| Gamification/hugs, essay, learnerChallenge, eduflux/pt-BR, analytics | ✅ | ✗ | audited + ported per parity |

## 9. Testing
- **SP-A:** SPARK provision endpoint (idempotent create of spark_schools/core_spark_links + feature flag; 401 bad Bearer); V2 spark-enable route (guardPlatformAdmin; calls SPARK + provisionSparkLink + license feature; idempotent); super-admin school list renders + gated.
- **SP-B:** launch route (401/403/400 gates; JWT claim shape + HS256 signature verifies with the secret; `return_url`/`redirect` correct; school_id-null guard); student assignment list/detail (student-scoped, leak-audit — no teacher numbers); SPARK card render gate + status from `spark_status`.
- **SPARK change:** `isValidReturnUrl` accepts `newcore.inteliflowai.com` (unit).
- Gates: full suite + `tsc` + `npm run a11y` + build; adversarial whole-branch review before merge.

## 10. Risks / notes
- **Two repos change** (V2 + a real SPARK code change for the provision endpoint + `isValidReturnUrl`) — SPARK changes go through SPARK's repo/deploy, not just a DB row this time.
- **Secret reuse:** the launch JWT, both webhooks, and the provision endpoint all key off `CORE_SPARK_API_SECRET` — rotation (still recommended from Phase 1) now also affects launch.
- **`users.school_id` nullable** — launch + provisioning must handle.
- **Don't fabricate** student outcomes — the card shows only real `spark_completions`/`spark_status`; cold-start otherwise.
