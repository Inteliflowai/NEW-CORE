# Plan: CORE v2 — P1 (Pilot Baseline) architecture & approach
_Round 3 — revised by Claude (Codex rounds 1–3 incorporated). **Codex VERDICT: APPROVED at round 4.**_

> **Reviewer:** read the full design spec at `docs/superpowers/specs/2026-06-17-core-v2-p1-design.md`, the locked decisions in `docs/SCOPE.md`, and the proven-source analyses in `docs/v1-mining-findings.md` + `docs/spark-mining-findings.md`. This PLAN.md is the contestable summary; those files are the depth. You are read-only.

## Goal
Rebuild "CORE" (an AI learning-intelligence product for K-12 teachers) as v2 in a fresh Next.js 16 + Supabase + Vercel repo (`NEW-CORE`), by **mining the existing V1 (`core-platform`) and SPARK (`spark-platform`) repos for proven logic/prompts/schema and re-skinning fresh**. P1 = the **Pro-tier pilot baseline**: the full Notice→Act→Confirm teacher loop, all 5 roles. Built **solo + Claude Code** (single track); **V1 carries the near-term pilots** (EduFlux ~next week, US ~2–3 wks) as the safety net while v2 builds **core-loop-first**.

**Schedule honesty (Round 1 fix #1):** because the team is single-track, P1 ships **core-loop-first** and treats **Risk Index, full Super TELI, the misconception taxonomy, and Spark GA-hardening as explicit fast-follows** layered after the loop works. "Full Pro baseline before September" is the *target ceiling*, **not** a single-track commitment — the spec §10 calendar is a parallel-team capacity model, not the plan.

## Approach
1. **Foundation & Spine** (plan 1 of 8): Supabase + auth + users/role model, RLS + object-level (IDOR) guards lifted from V1 `guards.ts`, the full core data-model migrations (real V1 schema: `skill_learning_state` 072, licensing 020/035/049, etc.), AI model registry + resilient wrappers, eval-rig harness.
2. **Generation engine**: lift V1 prompt text verbatim; lesson→quiz(3 MCQ+2 OEQ)→within-attempt adapt→OEQ grading (Claude→GPT fallback)→differentiated assignment. Engine logic in import-safe `lib/engine/*` so routes + eval rig share it. **Default execution = direct awaited calls with retry/idempotency (the proven V1 pattern); the Vercel Workflow DevKit durable pipeline is adopted ONLY if the week-1 spike passes (decision #4).**
3. **Signals→actions**: 8 signals with V1 formulas/thresholds (gap=20, effort labels, reteach-effectiveness, Risk Index ensemble). **Comprehension Level computed per-skill** (`skill_learning_state`); Learning Strategies/Profile stay per-student/behavioral.
4. **Core screens** (Teacher Today/One Student/Create, Student Home/Do-the-Work) + **Super TELI** (~90% net-new: persistent memory + 3-level hint ladder + Strategy naming + voice).
5. **Licensing/anti-piracy/trial + media metering**: lift V1 as-is + 4 hardening fixes; trial=Pro, cloud self-serve, defer Stripe (admin-provisioned keys).
6. **Integrations** (independent tracks): Google Classroom live (lift ~95% + add grade pull); LMS (GC+Canvas) & SIS adapter interfaces architected now, shipped Enterprise. **CORE↔SPARK contract** = SPARK's proven wire format + GA reworks. **Default round-trip = SPARK's proven awaited-webhook + idempotency state machine; WDK `createWebhook` pause-resume only if the week-1 spike passes.** Security-critical GA reworks (auth, idempotency state machine, allow-listed URLs, FERPA delete action) are **pilot-blocking**; operational hardening (key-rotation overlap, idempotency-TTL cleanup cron, rate-limit tuning) is post-pilot (see Milestones). **LIFT pre-populate handoff is IN P1 (inbound only):** `POST /api/import/lift-inbound` — **matches LIFT's existing sender path** (no LIFT-side change), a sibling to the SPARK contract. Auth: per-school `api_key` on `platform_links` (**the `product` CHECK must allow `'lift'`** — Foundation corrections). Gated on `lift_integration` **AND Pro+ tier** (add `lift_integration` to the tier gate map; require tier feature + active link before accepting). **Idempotency key = `provider + school_id + lift_candidate_id`** (not bare `lift_candidate_id` — cross-school collision) via the shared state machine; shared rate-limit + FERPA-delete. **Student linking:** a school-scoped `external_identities(school_id, provider, external_id) UNIQUE` table resolves create-vs-match; ambiguous email/name/grade collisions are **rejected for manual review, never silently merged**, before returning `core_student_id`. **CL seeding (integrity-critical):** LIFT's coarse `predicted_mastery_band` + readiness dimensions are written as a **source-tagged provisional cold-start prior** mapped only to defined skill groups — **the first CORE quiz supersedes it** (never fabricate per-skill mastery from admissions data; observation supersedes). ~3–5 days on the SPARK workstream. **Deferred to P2:** CORE→LIFT outcomes return + `learner_profile.v1`.
7. **Design system** (fresh electric palette; student-loud / adult-credible split; swappable tokens) + Parent/Admin/Super-Admin screens + onboarding.
8. **Testing & eval**: lift V1 eval rig (drift gates score×3/notes×1/voice×1; CI at ≥50 tuples); rebuild corpus with Barb; FIX the SPARK eval-tuple↔rubric dimension-key mismatch; Vitest + Playwright (none configured yet).

## Milestones (the P1 cut-line — Round 2)
Three named, ordered milestones. All are **within P1** (the Pro pilot); the split is **build order**, not scope.

- **M-Slice — First Shippable Slice (the core loop).** The minimum that runs **Notice → Act → minimal Confirm** in a real classroom: **Teacher** (Today / One Student / Create) + **Student** (Home / Do-the-Work) + the **generation engine** + **per-skill CL** + **gap + effort signals** + **minimal Confirm** (mastery-moved check on the next quiz of the same skill — cheap; per-skill state already supports it) + **Google Classroom** (roster + launch) + **licensing/trial** + a **thin Super Admin** (provision schools/keys). Roles in this slice: **Teacher, Student, thin Super Admin.**
- **P1 Pilot — full Pro baseline (adds onto M-Slice).** + **Risk Index** + **full Super TELI** + **Spark (Pro+)** + **full "did it work" Confirm** (reteach-effectiveness rollups) + **Parent** dashboard + **School Admin** (adoption + Risk Index) + **full Super Admin** (schools / licensing / maintenance / changelog) + **misconception taxonomy** + **LIFT inbound pre-populate handoff** + full media. This is everything SCOPE locks for the Pro pilot (all 5 roles full depth).
- **Security minimum (PILOT-BLOCKING — never a fast-follow):** object-level guards + the meta-test; licensing/anti-piracy core (HMAC keys, domain lock, **seat enforcement incl. `trialing`**, tenant isolation, **true read-only maintenance-mode enforcement** — not banner-only); **Spark/LIFT contract security** (auth, **idempotency state machine** keyed `provider+school_id+external_id`, allow-listed URLs, **FERPA delete/forget action**, **a conservative per-key/per-school rate limiter**, Pro+ tier gate + active-link check). These gate any slice that exposes the relevant surface — **including the LIFT inbound route.** 
- **Operational hardening (post-pilot OK):** key-rotation overlap windows, idempotency-row TTL cleanup cron, **rate-limit threshold tuning** (the limiter itself is pilot-blocking), maintenance-mode **UX polish** (the enforcement is pilot-blocking).

## Relationship to SCOPE (authority — Round 2)
This plan **does not change SCOPE.** SCOPE §17 already mandates "front-load proven V1 lifts, layer net-new after" and "core-loop-first as the forward platform" — the Milestones above make that sequencing concrete. **Everything SCOPE locks for the Pro pilot still ships in P1**; "fast-follow" = build order, not descope. **If** single-track velocity later forces dropping a SCOPE-locked feature from a specific pilot date, that is a **flagged scope change requiring user sign-off** at that point (human gate) — never a silent divergence.

## Key decisions & tradeoffs (contest these)
1. **Mine V1 into clean v2 files** rather than fork/patch V1 or build greenfield. Bet: V1's engine/signals/licensing/media are production-grade; the failure was presentation. Risk: "lift" hides real rework (e.g. the OEQ grader is a 1,449-line/5-LLM-call route; per-skill CL is a new grain over per-class `student_model`).
2. **Pro-tier as the pilot baseline**, not lean Essentials — so the "Confirm" half of the loop (did-it-work, Risk Index) ships in-pilot. Trades a bigger pilot scope for a closed loop.
3. **Per-skill Comprehension Level + per-student Learning Strategies/Profile** (two grains) reconciled with V1's existing per-`(student,class)` `student_model`. Risk: a third grain piled onto two existing ones.
4. **Vercel Workflow DevKit** for the generation pipeline + the SPARK round-trip only (not Super TELI/crons). **Round 1 fix #2: this is NOT assumed — it is a week-1 blocking spike** (verify Next 16 / Fluid Compute / 35s inline SPARK handoff). **Fallback if the spike fails: SPARK's proven awaited-webhook + idempotency pattern** (no WDK). WDK does not land on the critical path until the spike passes.
5. **Reuse V1 licensing/anti-piracy verbatim** (HMAC single-use keys, domain lock, DB seat trigger, tenant isolation) + 4 hardening fixes. Defer Stripe (admin-provisioned). Trades self-serve billing for proven anti-piracy + edu PO reality.
6. **Grading model**: keep V1's calibration-locked Sonnet/GPT for the pilot; Opus 4.8 as a week-1 spike, not a day-1 dependency.
7. **Solo + Claude Code, core-loop-first before September; the full Pro baseline only as capacity allows**, single track, V1 as safety net. The M-Slice (core loop) is the commitment; Risk Index / full Super TELI / taxonomy / Spark land after it in build order (still within the P1 pilot — see Milestones). A forced drop from a specific pilot date is a flagged scope change, not a silent cut.
8. **CORE Learning Loop deferred to P2+** (aggregate/de-identified learning; no fine-tuning on raw PII) but P1 captures the substrate so it isn't a retrofit.

## Risks / open questions
- Timeline realism: full Pro baseline (5 roles, full Super TELI, Spark, misconception taxonomy, fresh design) **solo + Claude Code** before September.
- The OEQ grader request-shape rebuild if Opus is chosen (structured output, sampling stripped) — could shift the grade distribution vs the calibration-locked corpus.
- Barb is the single human dependency (per-skill CL ratification, misconception taxonomy, ~300-tuple eval-corpus rebuild) — "on demand," not scheduled.
- The SPARK eval-tuple dimension keys (`analysis_evidence`/`metacognition`/`growth_mindset`) don't match SPARK's 7 runtime rubric keys — a cross-cutting blocker before eval Stage B.
- Next 16 + Fluid Compute behavior for the WDK inline-await SPARK handoff is unverified.
- Per-skill CL cold-start ("not yet assessed") UI + the 6-state→3-verb mapping are net-new and Barb-gated.
- 24 residual open questions enumerated in the spec.

## Round 1 resolutions (Codex findings → concrete plan changes)
1. **Schedule** → P1 is **core-loop-first**; Risk Index / full Super TELI / misconception taxonomy / Spark GA-hardening are **fast-follows**, not part of the first shippable slice. (See Goal.)
2. **WDK** → **week-1 blocking spike + V1 awaited-webhook fallback**; not on the critical path until proven. (Decision #4.)
3. **`school_sysadmin` 6th role** → lock the enum, route group, privileges, and UI surface as a **pre-migration foundation task** (before any migration runs).
4. **Per-skill CL** → first foundation task defines the **canonical grain + name (`skill_learning_state`), the 6-state→3-verb mapping, and the per-class `student_model` rollup/shim** — *before* any signal consumer is ported. One grain, one name, one mapping.
5. **Eval drift protection** → ship **interim golden fixtures for all 6 eval scopes** (grading, quiz-gen, homework-gen, spark-gen, spark-rubric, learner-profile); **no AI-output path merges ungated.** Swap to the Barb-reviewed corpus as each scope reaches ≥50 tuples. (Round 2 #6: extended from grading+Spark to all six.)
6. **SPARK rubric** → the shared contract exports **exactly SPARK's 7 canonical dimensions**; `knowledge_transfer` enters strict scoring only via a protocol-versioned, explicitly-approved 8th.
7. **SPARK idempotency** → unique `(endpoint, idempotency_key)` + an **`in_progress / completed / failed` state machine** via `INSERT ... ON CONFLICT`, with transactional response persistence — closes the concurrent-first-delivery double-generate race (not just post-completion retries).
8. **FERPA → SPARK** → **mandatory delete/forget action on the CORE↔SPARK contract in P1** wherever Spark holds identifiable student work (Round 2 #5: strengthened from "or document exclusion" to required — it is part of the pilot-blocking security minimum).
9. **Trial enforcement** → extend **seat + media-cap enforcement to `trialing`** licenses (trigger currently fires only on `active`), or cap trial roster/import — closes trial seat/cost overrun.
10. **GC grade pull** → define **cadence + source-of-truth + overwrite/conflict policy** before building the adapter (default: pull on Confirm-view load; CORE-vs-LMS conflict policy explicit).
11. **Security** → add a **route inventory + a failing meta-test** that fails on any service-role cross-user read (`[studentId]`/`[classId]`) lacking an object-level guard — enforce `guards.ts`, don't rely on discipline.
12. **Lift vs hardening** → every licensing/anti-piracy item is **split into a LIFT task and a NEW-HARDENING task** (true read-only maintenance mode, signed trial-grace semantics, key-expiry-at-activation, activation rate-limit, rotatable Spark keys), each with its own acceptance test.

## Out of scope (P1 pilot)
- pt-BR / EduFlux / BNCC (deferred §19; near-term EduFlux pilot runs on V1).
- Enterprise: full longitudinal analytics, SIS *implementations* (interfaces only), white-label.
- The CORE Learning Loop build (P2+; substrate captured only).
- Stripe / self-serve billing.
- Canvas LMS *implementation* (interface only).
- LIFT **outcomes return** (CORE→LIFT) + the richer `learner_profile.v1` delivery + Pulse ecosystem API (P2; only the inbound pre-populate handoff is in P1).
