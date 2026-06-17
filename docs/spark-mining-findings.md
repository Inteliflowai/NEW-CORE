# SPARK Mining Findings — `spark-platform`

> Source: C:/users/inteliflow/spark-platform (github.com/Inteliflowai/spark-platform), analyzed 2026-06-17 via parallel workflow.
> Companion to [v1-mining-findings.md](./v1-mining-findings.md) and [SCOPE.md](./SCOPE.md). Mine for logic/contract/patterns — never visual design.

## TL;DR

SPARK is the Pro+ enrichment product that plugs into the CORE engine through an **explicit, typed HTTP contract — never shared DB seeds.** It is a separate Next.js + Supabase app with its own school/student/attempt tables, linked 1:1 to a CORE school via a `core_spark_links` row. CORE signs JWTs (HS256) and posts assignment payloads to SPARK; SPARK generates a personalized challenge live and returns scored results to CORE via Bearer-token webhooks. **This coupling pattern is the proven model for how CORE v2 should couple to any out-of-process product** (SCOPE §13: "Couple products by explicit typed contract … never shared DB seeds"). The pattern is battle-tested in production (EduFlux end-to-end, May 2026), idempotent, and clean enough to LIFT wholesale.

The pedagogical machinery inside SPARK — the 9-section challenge schema, the tiered generation pipeline, and the 7-dimension rubric — is Barb-authored, versioned, eval-locked, and should be treated as core IP. Most of it LIFTS verbatim. The locale/BNCC/Portuguese layer is real and clean but is **explicitly out of v2-pilot scope** (SCOPE §19) — keep the seam, leave the feature dark.

---

## 1. What SPARK Is (and how it relates to the engine)

A SPARK is a personalized, challenge-based learning experience delivered as a 6–8 step student workflow: scenario/challenge briefing → (optional tier-select) → prediction → workspace (tiered materials + strategy layer + TELI tutor) → output-format choice → evidence → metacognitive reflection → (optional) Knowledge Transfer.

It is **not part of the cold-start engine** — it fires *after* a student submits a CORE assignment, as an enrichment layer gated to Pro+/Enterprise. CORE owns the student model and the assignment; SPARK owns generation, the runner UI, scoring, and gamification. They share nothing but a typed wire contract. This matches SCOPE §10 ("Spark is built into the engine but gated to Pro+") and §11 ("via typed contract, never shared seeds") exactly — SPARK as-built already implements the locked decision.

Relevant SPARK files (repo `C:/users/inteliflow/spark-platform`):
- `app/(dashboard)/student/experiment/[sessionId]/page.tsx` — the runner that renders the projected workflow and TELI tutor.
- `lib/generation/projection.ts` — turns the 9-section content into the 6–8 step runtime workflow; **skips the tier-select step when CORE supplies a mastery_band** (CORE-driven path shows only the matched tier).

---

## 2. The CORE↔SPARK Typed Platform API Contract (the model for v2 coupling)

This is the most important finding for v2. It is the reference implementation for SCOPE §13's "explicit typed contract" mandate and directly answers punch-list **item 11 (Integrations — Spark via typed contract)**.

**Topology**
- Two separate Supabase databases. No shared rows, no shared seeds. A single `core_spark_links` row bridges one CORE school to one SPARK school (1:1), carrying `enabled`, `api_key` (Bearer), and `core_base_url` (per-school CORE deployment override).
- SPARK: `supabase/migrations/001_initial_schema.sql:238–246` (`core_spark_links`), `:248–258` (`core_experiment_assignments`, composite-unique on `core_homework_id + student_id`), `035_core_spark_links_core_base_url.sql` (per-school CORE URL).

**Asymmetric auth (the key design)**
- **CORE → SPARK (student launch):** CORE issues an HS256 JWT signed by `CORE_SPARK_API_SECRET` (issuer `inteliflow-core`); SPARK validates and **auto-creates `spark_users` keyed on `core_user_id`** on first auth (lazy-create, never delete). `lib/integration/core-client.ts:164–266` (`verifyCoreJWT`), `app/api/integration/auth/route.ts`.
- **CORE → SPARK (assignment handoff):** payload-direct webhook — CORE posts `lesson_plan` + `student_profile` **inline** (not a catalog lookup), authenticated by Bearer `SPARK_SCHOOL_API_KEY` + `X-Idempotency-Key`. `app/api/integration/webhooks/core/route.ts`.
- **SPARK → CORE (results):** SPARK posts `AttemptCompletePayload` (score, effort, `rubric_dimensions|null`, `content_quality|null`, `bncc_codes|null`) to CORE's `/api/attempts/spark-attempt-complete` with 3-attempt retry (1s/5s/15s). `lib/integration/core-client.ts:80–142`.

**The CORE side of the contract already exists** as templates to lift: `core-integration/spark-client.ts` (6 actions), `core-integration/attempt-complete-route.ts` (return endpoint), `core-integration/README.md` (env vars).

**Wire contract — treat as LOCKED.** Inbound event `spark_assignment_created`, `data = { spark_assignment_id, core_homework_id, student_id, school_id, lesson_plan{content, concept_tags, subject_domain, grade_band}, student_profile{grade, student_band, rubric_rolling_averages, learning_pattern_flags, locale} }`. Any addition should bump a `PROTOCOL_VERSION`.

**Patterns to LIFT verbatim into v2's Platform API:**
1. Typed HTTP POST with payloads sent inline — no shared DB, no catalog dependency.
2. Asymmetric auth: CORE signs JWTs (student flows), products validate; products return data via per-school Bearer secret.
3. School-scoped API keys, one per integration link (`core_spark_links`).
4. Per-tenant feature flag gating **both** entry points (auth + webhook) — `lib/tenancy/featureFlags.ts`, flag `core_integration`.
5. Webhook idempotency: `webhook_idempotency_keys(endpoint, idempotency_key UNIQUE, status_code, response_body)`; on hit, return the cached response and **never** retry on the duplicate — prevents retry storms.
6. Per-school `core_base_url` override so one SPARK can serve N CORE deployments (proven on EduFlux at `eduflux.datanex.ai`).
7. Synthetic experiment rows so a CORE homework collapses to one deterministic experiment id (multi-student assignments dedupe).
8. Inline generation await on the inbound webhook (NOT fire-and-forget) — a May-2026 production bug killed unawaited promises on Vercel teardown; the fix was to `await` before returning.

**REWORK for v2:**
- **Tier is not enforced on SPARK's side** — SPARK trusts CORE's gate and only checks the `core_integration` feature flag. CORE v2 must enforce the Pro+ tier gate *before* it ever calls SPARK (it already has `spark_experiences` in `lib/licensing/tiers.ts` per V1 mining). Decide whether SPARK should *also* defensively check tier (belt-and-suspenders) — see open questions.
- `core_spark_links.api_key` is a bare `gen_random_uuid()::text` — no version, rotation, or expiry. v2 should add `key_version + rotated_at + expires_at`.
- No rate limiting on the 6-action `/api/integration/core` endpoint. Add per-api_key quota (Upstash Redis — already in the v2 service list, SCOPE §14).
- `core_base_url` is unvalidated on write; a bad value silently misroutes result webhooks. Validate against an allow-list (same trust-boundary logic as the return-URL allow-list).
- Idempotency rows store the **full** response body — define and enforce a TTL (e.g. 30 days) from day one (migration 029 itself notes "future cron can DELETE").

**LEAVE behind:** the retired catalog-match path (`get_experiment_suggestions` → match-score filter); the Barb-original static seed fallback (`challenge-seeds.ts`, archived in migration 028); template-anchored generation (replaced by payload-direct, May 2026). v2 should *not* resurrect static-content fallbacks — keep generation lesson-grounded.

---

## 3. The Generation Pipeline

A tiered, cost-capped, cached pipeline producing a locked 9-section JSON schema. This informs SCOPE **item 4 (engine)** and **item 5 (media)** for the Spark path specifically.

**Tiers (all produce the same schema):**
- T1: cache check on `(profile_fingerprint, lesson_plan_fingerprint)` SHA-256 keys.
- T2: Claude Sonnet 4.6 @ temp 0.7.
- T3: Claude retry @ temp 0.3 with stricter constraints.
- T4: GPT-4o fallback @ temp 0.5 (only when both Claude tiers fail).
- Files: `lib/generation/pipeline.ts`, `lib/generation/fingerprint.ts`, `lib/ai/models.ts` (`ANTHROPIC_PRIMARY_MODEL`, `OPENAI_FALLBACK_MODEL`).

**Inputs (the CORE→SPARK signal bridge):**
- `StudentProfileSnapshot`: grade, `dominant_learning_style`, `mastery_band` (reteach/on_level/advanced), `rubric_rolling_averages` (7 dims, 1–4), `learning_pattern_flags`, `iep_accommodations`, `locale`.
- `LessonPlanInput`: `subject_domain`, `concept_tags`, free-text lesson content.
- Mapped from the CORE webhook by `buildStudentProfile()` in `app/api/integration/webhooks/core/route.ts` (student_band → mastery_band; CORE band `reteach/grade_level/advanced` → SPARK `struggling/developing/mastery`).

**The system prompt is the contract with Claude** — `lib/generation/system-prompt.ts` (PROMPT_VERSION v6), with explicit per-signal differentiation rules (mastery band sets stakes/complexity; rubric dims < 2.5 surface heavily; each learning_pattern_flag drives one design choice; IEP accommodations are non-negotiable structural requirements; dominant learning style gets the most concrete strategy modality first). Plus 4 Barb-authored reference exemplars (`lib/generation/reference-examples.ts`).

**Validation gates** (`lib/generation/validator.ts`): ≥3 output options, ≥2 TELI prompts, ≥2 reflection questions, all 4 strategy modalities, all 9 sections; **voice compliance** (forbidden: weak/poor/fail/deficit/behind/low); question structure (challenge + TELI prompts must be questions; role assignment must start "You are a").

**LIFT verbatim:** the 9-section schema (`lib/generation/types.ts`), the v6 system prompt's per-signal differentiation block, the validator gates, the 4 exemplars, the fingerprint logic. **REWORK:** the cost circuit breaker (`pipeline.ts` ~564–597; per-school $50/mo cap — revisit per-school vs per-district for v2) and hardcoded cost rates (version them as constants). **LEAVE:** template-anchored path, retired seed fallback, deleted `barb-original-adapter.ts`.

**Note for v2's media decision (§5):** SPARK runs its **own** media stack (Flux images → `lib/image/flux.ts`, Runway video → `lib/video/runway.ts`, Whisper transcription, persisted to Supabase `challenge-media`). This is the *same* tooling V1 CORE uses (Flux + Runway + Whisper, per the V1 findings and SCOPE §14). For v2, decide whether SPARK keeps its isolated media stack or shares CORE v2's pipeline — see open questions. Flux URLs expire in 10 min, so any caller **must** persist immediately (`lib/storage/media.ts::persistImage`).

---

## 4. The 7-Dimension Rubric & Scoring

A locked, asymmetrically-weighted 7-dimension rubric on a 1–4 scale. This is SPARK's scoring IP and informs SCOPE **item 7 (OEQ rubric / mastery scale)** and the eval rig.

**The seven locked dimensions** (`lib/analyzer/rubric.ts`): `problem_understanding` (0.15), `reasoning_strategy` (0.20), `use_of_evidence` (0.20), `creativity_application` (0.10), `communication` (0.10), `reflection_metacognition` (0.15), `collaboration` (0.10). "Asymmetric" = reasoning + evidence are load-bearing (strict tier); creativity/communication/collaboration are flexible (wider tolerance). Scored by Claude Sonnet 4.6 (primary) / GPT-4o (fallback) via `SCORING_SYSTEM_PROMPT` (PROMPT_VERSION `spark-rubric-v4`, Barb-locked 2026-04-30).

**Load-bearing details to preserve:**
- Score→dashboard mapping `1→25 / 2→50 / 3→75 / 4→100` (preserves the "70-as-strong / Proficient=75" threshold). Locked in `__tests__/lib/seven-dimension-rubric.test.ts`.
- `content_quality` flag (engaged/minimal/non_engaged) is **detected first** and gates rendering — gibberish scores all-1s. **This flag must gate any CORE-side rendering too**; if a dashboard silently renders the 1s as "passed the floor," students get misleading feedback.
- `collaboration = null` (solo, "not observed") is distinct from `0` (malformed) — wire format must never send `0`. Rolling-average math breaks otherwise.
- Voice principle: forbidden words are **dropped at output time, never rewritten**.
- Barb-locked verbatim string: Communication L3 = `"Clear, organized, and complete."` (the period is load-bearing for the drift test).

**Eval rig — there is a real blocker here.** The CORE eval rig already has `spark-rubric` and `spark-generation` scopes (this matches V1 mining: 6 scopes incl. spark-gen/spark-rubric, corpus empty in Stage A). **But `core/scripts/eval/types.ts` `SparkRubricEvalTuple` uses dimension keys that do not match SPARK's runtime keys** (`analysis_evidence` vs `use_of_evidence`; `metacognition` vs `reflection_metacognition`; a non-existent `growth_mindset`). Stage B's `invokeCandidate()` wiring will fail without a mapping layer. **Fix before Stage B: rename the eval-tuple keys to SPARK's canonical seven, or add an explicit mapper in `core/scripts/eval/runners/sparkRubric.ts`.** Threshold policy is already drafted (strict-tier drift > 0.125 = regression; flexible-tier drift > 0.25 warn / > 0.375 regress; any `content_quality` mismatch = hard regression).

**LIFT verbatim:** the 7 keys + definitions, the 1–4 scale, the weighted formula, the 1→25/…/4→100 mapping, the voice gate, `content_quality` gating, the null-collaboration distinction. **REWORK:** the eval-tuple key mismatch (above). **LEAVE:** the legacy `dimension_scores` alias (evidence_quality/reasoning_depth at 0–100) once dashboards migrate; SPARK-only celebration/magnitude UX.

> **Relationship to CORE's own rubric:** SPARK's 7-dimension rubric scores *enrichment challenges* and is distinct from CORE's OEQ grader (0/0.5/1.0, per V1 mining `lib/openai/prompts.ts` GRADING_SYSTEM). They are two different instruments. v2 must decide whether the Learner Profile competency dimensions adopt SPARK's seven or stay separate — see open questions.

---

## 5. Data Model (Supabase)

SPARK's schema is multi-tenant and proven. Most of it is SPARK-owned and stays in SPARK; the parts that matter to v2 are the **bridge tables** and the **per-attempt content cache**.

- **Bridge (the contract surface):** `core_spark_links`, `core_experiment_assignments` (`core_homework_id` unique), `webhook_idempotency_keys`. LIFT the *pattern* into v2's Platform API config.
- **Per-attempt generation cache:** `experiment_attempt_content` (migration 025; `profile_fingerprint` + `lesson_plan_fingerprint` index, `generation_status`, `generation_cost_usd`, `model_version`, `prompt_version`) with `student_profile_snapshot` (migration 031) captured at generation time. This is the scalability anchor for personalization — make it first-class, not a bolt-on.
- **RLS pattern:** `get_my_spark_school_id()` helper + school_id-scoped policies + service-role admin client; defense-in-depth locked tables (RLS on, no browser policy = fail-closed). LIFT verbatim (migration 020).
- **Feature flags:** `spark_schools.feature_flags` jsonb (ai_generation, hardware, core_integration, marketplace, teli). LIFT the per-school jsonb-gate pattern.
- **LEAVE / archive:** the entire **hardware subsystem** (connectors, sessions, commands, sensor events, alerts — fully defined, never populated, simulator-only) unless v2 takes on robotics; the stale legacy experiment catalog (`legacy_transform_pre_apr30`, `barb_original_pre_apr30`); `experiment_drafts` (superseded by on-demand generation).

**Watch-outs:** `student_profile_snapshot` can go stale if a CORE profile changes after generation but before the attempt renders; the `generation_path` switch field (`template_anchored`/`payload_direct`) is a code smell — v2 should have a single unified generation interface; `experiments.source` enum has crept to 8 values (a maintenance hazard — consider a structured provenance tuple).

---

## 6. Triggering & Pro+ Gating (how SPARK plugs into the engine)

This directly informs SCOPE **items 4 + 10**.

**The flow:** student submits CORE assignment → CORE computes mastery band → **two gates** → `notifyAssignmentCreated` webhook fires (payload-direct, **inline, 35s sync-handoff timeout**) → SPARK generates live (T1–T4) → response carries `generation_status` → CORE writes `spark_sync_failed` if status=`failed` → Launch button gates accordingly.

**Two gates, correct split:**
1. **Commercial (CORE side):** `checkFeature(schoolId, 'spark_experiences')` — Pro+/Enterprise only, Essentials excluded. `core/lib/licensing/tiers.ts`. This is the SCOPE §10 Pro+ gate, already implemented.
2. **Grade-band (SPARK side):** SPARK supports grades 3–12 only; rejects K-2.

SPARK is **not** mastery-band-specific — every student (mastery/developing/struggling) gets a challenge. The band maps to a comprehension level that pre-tunes difficulty and, at render time, **shows only the matched tier** (no self-selection on the CORE-driven path).

**LIFT verbatim:** the band→tier mapping (mastery→advanced, developing→on_level, struggling→reteach); the inline 35s sync-handoff (vs the retired async `after()` block); the idempotency-key pattern; the **gate split** (CORE decides "is this tenant allowed", product decides "is this enabled for this school").

**REWORK for v2:** wrap the `notifyAssignmentCreated` call site (currently a procedural mass of Supabase queries in `submit/route.ts:1119–1180`) in a service layer (`lib/spark/sendAssignmentToSpark`) that owns pre-flight checks, retry, and response handling. Codegen the payload shape from a shared schema so both sides auto-validate. Document the **cold-start rule explicitly**: `rubric_rolling_averages` is sent only when `spark_dim_attempt_count > 0` — *absent* (undefined), not `{}`, on first attempt; SPARK treats absence as "no personalization, default difficulty." If v2 ever emits `{}` instead, it poisons the cache fingerprint.

**Fragility to test in v2:** grade-band normalization accepts both `'7'` and `'6-8'` — enforce a canonical grade before notifying SPARK; idempotency key is `${core_homework_id}_${student_id}` (breaks if a homework ever fans out to per-group variants); fetch the live `core_integration` flag *at webhook time*, not at assignment-generation time, to catch in-flight disables.

---

## 7. LIFT vs LEAVE — Consolidated

**LIFT verbatim (proven, Barb-locked, or contract-critical):**
- The entire CORE↔SPARK typed contract: payload-direct webhook, asymmetric JWT/Bearer auth, school-scoped keys, per-tenant feature gate on both entry points, idempotency table + pattern, per-school `core_base_url`, inline-await generation, 35s sync handoff, retry/backoff on result return.
- The band→tier mapping and the gate split (CORE=commercial, product=per-school feature).
- Generation: 9-section schema, v6 per-signal system prompt, validator gates, 4 exemplars, fingerprinting.
- Rubric: 7 keys + weights + 1–4 scale + 1→25/…/4→100 mapping + voice gate + `content_quality` gate + null-collaboration distinction.
- Data: RLS helper-fn pattern, per-school feature-flag jsonb, per-attempt content cache, bridge-table concept.
- The centralized model registry pattern (`lib/ai/models.ts`) — never hardcode model IDs at call sites (the 2026-06-15 Sonnet retirement proved its value; matches V1's `lib/ai/models.ts` finding).

**REWORK / adapt:**
- Add rotatable, expiring per-school API keys (not bare UUIDs).
- Add rate limiting + idempotency-row TTL.
- Validate `core_base_url` and `return_url` against allow-lists.
- Fix the eval-tuple ↔ runtime dimension-key mismatch before Stage B.
- Wrap the notify call site in a service layer; codegen payloads from a shared spec.
- Decide tier-double-check on the product side; decide per-school vs per-district cost caps.

**LEAVE / archive:**
- Retired catalog-match path, static seed fallback, template-anchored generation, deleted adapters.
- Hardware subsystem (simulator-only, never populated).
- Stale legacy experiment catalog + `experiment_drafts`.
- SPARK-only UX (celebration triggers, gamification magnitude, TELI character).
- **Portuguese / BNCC / locale machinery — leave dark for the pilot (SCOPE §19 out-of-scope), but the seam is clean and ready when Pulse/EduFlux is in scope.**

---

## 8. The CORE↔SPARK Contract (one-page reference for v2)

| Direction | Channel | Auth | Idempotency | Payload (key fields) |
|---|---|---|---|---|
| CORE → SPARK | student launch (browser redirect) | HS256 JWT signed by `CORE_SPARK_API_SECRET`, issuer `inteliflow-core`; optional `return_url` (allow-list validated) | n/a | `core_user_id, core_school_id, spark_attempt_id, return_url` |
| CORE → SPARK | assignment webhook `spark_assignment_created` | Bearer `SPARK_SCHOOL_API_KEY` (per `core_spark_links`) | `X-Idempotency-Key` = `homework_id_student_id` | `lesson_plan{content, concept_tags, subject_domain, grade_band}`, `student_profile{grade, student_band, rubric_rolling_averages?, learning_pattern_flags, locale}` |
| SPARK → CORE | result webhook `/api/attempts/spark-attempt-complete` | Bearer `CORE_SPARK_API_SECRET`; URL from `core_spark_links.core_base_url` (per-school) | same dedup pattern, suffix `scored` | `score, effort, signals, rubric_dimensions\|null, content_quality\|null, bncc_codes\|null` |
| CORE ← SPARK | 6 read/write actions `/api/integration/core` | Bearer per-school `api_key` | n/a | `get_student_profile, get_experiment_suggestions, create_assignment, get_attempt_result, sync_student_roster, checkSparkHealth` |

Gates: **CORE** enforces `spark_experiences` tier (Pro+/Enterprise) before firing. **SPARK** enforces `core_integration` per-school feature flag + grades 3–12. Wire format is treated as a locked contract — additions bump `PROTOCOL_VERSION`.