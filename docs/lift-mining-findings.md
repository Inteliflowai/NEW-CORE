# LIFT Mining Findings — `lift-platform` (CORE↔LIFT connection)

> Source: C:/users/inteliflow/lift-platform (github.com/Inteliflowai/Lift-platform), analyzed 2026-06-17.
> Companion to [v1-mining-findings.md](./v1-mining-findings.md) + [spark-mining-findings.md](./spark-mining-findings.md). The CORE↔LIFT connection rides the same v2 Platform API pattern as SPARK.

> Source: synthesis of three parallel LIFT-mining passes against the LIFT repo (`lift-platform`), cross-referenced with `docs/SCOPE.md` (§11, §13, §19), `docs/spark-mining-findings.md`, and `PLAN.md`. Analyzed 2026-06-17. Mine for contract/logic/patterns — never visual design.

## TL;DR

LIFT (Inteliflow's admissions/intake assessment product) hands a **readiness snapshot** to CORE at admission time so CORE doesn't cold-start each student from zero. This is a **one-directional inbound handoff** (LIFT -> CORE), not a bidirectional "data trade": LIFT owns the intake assessment, CORE owns the student record. Today the whole integration lives **inside LIFT** (LIFT-scoped `.env`, LIFT-side routes) and posts to CORE's `/api/import/lift-inbound` using a bare shared secret. There is **no CORE-side Platform-API surface for it** and **no mention of LIFT anywhere in the approved P1 plan**.

The recommendation: **fold only the LIFT -> CORE pre-populate handoff into P1**, built as a *small sibling* to the already-locked SPARK contract (same auth model, same `platform_links` bridge table, same idempotency state machine, same per-school feature gate). It is cheap (~3-5 days, absorbed into the existing Platform-API/M-Slice work), it is pure additive cold-start seeding (zero risk to the Notice->Act->Confirm core loop), and it gives every LIFT-school student a warm `skill_learning_state` before their first CORE quiz. **Defer the CORE -> LIFT outcomes return to P2.** This requires editing SCOPE §11 + §19 (LIFT moves from "deferred" to "handoff in-P1") and flags a PLAN.md integrations-cut-line repass because the approved PLAN has *zero* LIFT surface in P1.

---

## 1. What LIFT is and how it relates to CORE

LIFT = "Learning Insight for Transitions." A non-diagnostic, AI-powered **admissions assessment**: a candidate does interactive tasks, LIFT scores 7 dimensions (reading / writing / reasoning / math / reflection / persistence / support-seeking), computes a weighted **TRI** ("Transition Readiness Index," 0-100) with a readiness label (emerging <40 / developing 40-60 / ready 60-80 / thriving 80+) and a confidence tier, and derives a coarse readiness band (reteach / on-level / advanced).

CORE is the **downstream** product: the in-classroom learning-intelligence platform the student uses *after* admission. The relationship is the same shape as CORE<->SPARK — two separate apps, no shared DB, coupled by a typed wire contract — except the direction and lifecycle differ:

| | CORE <-> SPARK | CORE <-> LIFT (handoff) |
|---|---|---|
| Trigger | Student submits a CORE assignment | Candidate admitted in LIFT |
| Direction of the call | CORE -> SPARK (CORE initiates) | LIFT -> CORE (**LIFT initiates**) |
| Shape | Bidirectional product contract (launch + handoff + result) | **One-off inbound intake** (single POST) |
| Lifecycle | Per-assignment, repeating | **One-shot per completed evaluation** |
| What CORE does with it | Fires an enrichment challenge | **Seeds the student's cold-start `skill_learning_state`** |

## 2. The two-and-a-half flows (only one is in scope for P1)

1. **Pre-populate handoff (LIFT -> CORE)** — IN SCOPE FOR P1. At admission, LIFT POSTs a ~26-field readiness payload to CORE `/api/import/lift-inbound`; CORE returns `core_student_id`, which LIFT persists and uses to track sync status. One-shot, request-response, fail-soft.
2. **Learner-profile delivery (LIFT -> CORE)** — the richer `inteliflow.learner_profile.v1` contract document (full provenance, pedagogy framing, placement recommendation, onboarding/baseline data). Newer (June 2026), supersedes-but-coexists-with #1. **Not required for P1** — see §6.
3. **Outcomes sync (CORE -> LIFT)** — the return path: CORE sends GPA / standing / support-plan status back to LIFT keyed on `core_student_id`. **Defer to P2.**

## 3. What crosses the boundary (handoff payload)

LIFT -> CORE inbound, inline (no catalog lookup, no shared DB link):

- Identity/roster: `lift_candidate_id, first_name, last_name, email, grade, preferred_language, lift_session_completed_at`
- Readiness: `tri_score, tri_label, predicted_mastery_band` (LIFT's TRI->band inference: reteach/grade_level/advanced), `predicted_learning_style`, `overall_confidence`
- Dimensions: `readiness_dimensions{ reading, writing, reasoning, math, reflection, persistence, support_seeking }` (each 0-100)
- Support: `support_indicator_level`, `learning_support_flags[]` (from 9 enriched behavioral signals)
- Prose: `internal_narrative_summary` (~500c), `placement_guidance`, `lift_report_url`

**CORE returns:** `core_student_id` (the UUID LIFT writes back and keys everything on thereafter).

The load-bearing field for CORE is **`predicted_mastery_band`** — it maps directly onto CORE v2's per-skill CL cold-start (the SCOPE §4c "not yet assessed" null is *replaced* by LIFT's readiness band when a LIFT school is linked). The 7 LIFT dimensions are **input-readiness** constructs and are deliberately distinct from SPARK's 7 **output-quality** rubric dimensions — they measure different things and must stay separate contract dimensions; do not unify them.

## 4. Auth and contract gap vs the locked SPARK pattern

The handoff's *spirit* already matches the SPARK pattern (typed HTTP POST, inline payload, no shared DB), but the **auth and durability mechanics are pre-GA**:

| Property | SPARK (locked v2 standard) | LIFT handoff today | Gap to close in P1 |
|---|---|---|---|
| Auth | Per-school Bearer `api_key` on a bridge row + asymmetric JWT | Bare shared `X-Integration-Secret` (env-wide) | Move to a **per-school LIFT `api_key` on a `platform_links` row** (provider='lift') |
| Idempotency | `(endpoint, idempotency_key)` UNIQUE + in_progress/completed/failed state machine | None | Reuse the SPARK idempotency state machine; key = `lift_candidate_id` (or its hash) |
| Feature gate | Per-tenant flag on both entry points | License-gated on `CORE_INTEGRATION`, silent-skip if no tenant | Add a distinct **`lift_integration`** per-school flag (independent opt-in) |
| Key hygiene | Rotatable / expiring keys, allow-listed URLs, rate limit | Bare secret, no rotation/limit | Inherit GA reworks from the SPARK contract work (rotatable keys, per-key rate limit, FERPA delete) |
| Delivery durability | Awaited webhook + retry + idempotency | (handoff is request-response; OK) outcomes path is fire-and-forget, no retry queue | Handoff: fine as sync request-response. Outcomes (P2): rework to webhook + retry. |

## 5. LIFT vs LEAVE (for v2)

**LIFT (bring into v2 as the inbound contract):**
- The ~26-field handoff payload shape, intact, as a versioned inbound intake schema (sibling to SPARK's wire contract; additions bump a PROTOCOL_VERSION).
- `predicted_mastery_band` -> per-skill CL cold-start seeding (verbatim mapping).
- The 7 LIFT readiness dimensions as *their own* contract dimension set, distinct from SPARK's rubric.
- The inline-payload / no-shared-DB discipline (already matches SPARK and SCOPE §13).

**LEAVE / defer:**
- The CORE -> LIFT **outcomes return** mechanics (today: shared secret, fire-and-forget, no idempotency) — needs a full webhook rework; defer to P2.
- The newer **learner-profile delivery (v1 contract)** — production-ready on LIFT's side but **post-P1 SPARK-cutoff (June 2026)** and pedagogy-gated (the prose fields are `pending` until Barb signs off). Keep the legacy 26-field handoff as the P1 surface; the richer contract document is a fast-follow once the pedagogy gate resolves.
- LIFT's assessment engine, TRI math, enriched-signal detectors, SIS adapters, consent/voice telemetry — all stay **LIFT-side**. CORE only *receives*.

## 6. Risks specific to including the handoff

- **`core_student_id` immutability.** It's mapped once at handoff and treated as immutable; there is no re-sync path if CORE ever re-issues an id or re-links a student to a different school. Low impact for P1 (handoff is one-shot), but the contract should *state* the immutability assumption so a future outcomes return doesn't silently orphan rows.
- **Pedagogy gate is one-way.** LIFT emits with the gate `pending`; if a gate approval ever arrives from CORE, LIFT has no consumer. Irrelevant for the *legacy 26-field handoff* (no gated prose) — it only bites the richer learner-profile delivery, which is deferred.
- **Cold-start seeding is additive, not load-bearing.** If the handoff fails or a school has no LIFT, CORE falls back to its existing "not yet assessed" null cold-start. Nothing in Notice->Act->Confirm depends on LIFT. This is why it's a SHOULD, not a MUST, and why it's zero-risk to the core loop.
- **FERPA.** A LIFT-deleted / opted-out candidate must propagate a delete/forget to CORE's linked rows — fold LIFT into the same pilot-blocking FERPA delete action already mandated for SPARK (PLAN.md round-1 resolution #8), not a separate mechanism.

## 7. Net recommendation

Include the **LIFT -> CORE pre-populate handoff** in P1 as a single inbound route, built on the SPARK Platform-API machinery (auth, bridge table, idempotency, feature gate), gated on a new `lift_integration` flag. Cost ~3-5 days, absorbed into the existing Platform-API/M-Slice work. Defer the outcomes return (P2) and the richer learner-profile contract (fast-follow, pedagogy-gated). Update SCOPE §11 + §19 to move LIFT from "deferred / Enterprise" to "handoff inbound = in-P1," and flag a PLAN integrations-cut-line repass.