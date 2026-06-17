# V1 Mining Findings — `core-platform`

> Source: `C:/users/inteliflow/core` (`github.com/Inteliflowai/core-platform`), analyzed 2026-06-17.
> Purpose: capture the **proven "how"** to lift into CORE v2 per [SCOPE.md](./SCOPE.md) §13. Paths are relative to the V1 repo root.
> Rule: mine V1 for **logic, data, prompts, schema, eval tuples — never its visual design.**

This doc is organized by the punch-list decision each finding informs.

---

## Headline: V1 is far more complete than "150 unreadable features" implies

The *engine, signals, licensing, media metering, eval rig, and Google Classroom* are production-grade and calibration-locked. The V1 problem was **presentation/clarity**, not the underlying machinery. That validates the v2 thesis exactly: **keep the bones, rebuild the skin.**

A master decisions doc already exists: **`CLAUDE.md` (171KB)** + **`docs/decisions-archive.md`** capture every locked pedagogical decision with Barb's original rationale. These should be ported to v2 as the authority.

---

## Item 4 — Generation Engine (the pipeline already exists, end to end)

**Pipeline today:** lesson upload → parse (GPT-4o) → quiz gen → student takes Q1–Q3 → **adapt route generates Q4–Q5** → submit → OEQ grading (Claude→GPT-4o) → mastery band + learning-style → differentiated assignment (Claude→GPT-4o).

- **Lesson parse:** `app/api/teacher/lessons/parse/route.ts` + prompts in `lib/openai/prompts.ts` (~268–289). Uploads via `unpdf`/`mammoth`. GPT-4o, temp 0.3.
- **Quiz gen (3 MCQ + 2 OEQ confirmed):** `lib/teacher/generateQuizForLesson.ts`, prompts `lib/openai/prompts.ts` 297–512. STEM variant = 3 numeric + 2 OEQ (deterministic numeric grading). GPT-4o, temp 0.5.
- **OEQ grading:** `app/api/attempts/[attemptId]/submit/route.ts` + `GRADING_SYSTEM`/`gradingPrompt` (`lib/openai/prompts.ts` 514–648). **Claude Sonnet 4.6 primary, GPT-4o fallback.** Outputs score (0/0.5/1.0) + reasoning_pattern + error_type + cognitive_notes + misinterpretation flag.
- **Grade-anchored difficulty — CONFIRMED, already a hard constraint.** Bloom level matched to grade band in the quiz prompt (`prompts.ts` 367–372). "Same diagnostic for the whole class, never personalized per student."
- **Adaptive Q4–Q5 — ALREADY EXISTS** (resolves item 4b): `app/api/attempts/[attemptId]/adapt/route.ts`. Maps Q1–Q3 MCQ %: **0–50 → scaffolded, 50–79 → grade_level, 80+ → advanced**, then regenerates Q4–Q5 (GPT-4o, temp 0.7). NOTE: V1 adapts *within the same quiz attempt* off Q1–Q3, not "after N quizzes of history." Decision 4b should reconcile: keep V1's same-attempt adaptation, or add the history-threshold reshape the scope describes (the scope's framing is not what V1 does today).
- **Differentiated assignment:** 15 profiles = **3 bands × 5 learning styles**. `ASSIGNMENT_SYSTEM` (`prompts.ts` 681+). Claude primary, GPT-4o fallback. "Band mismatch is the worst regression" is a locked safeguard.
- **Super TELI:** today's Teli (`app/api/attempts/teli-chat/route.ts`, `lib/teli/prompts.ts`) is a Socratic <3-sentence tutor, tier-capped (20/50/∞ per day). It is **NOT yet "Super"** — missing: persistent memory, 3-level hint ladder, embedded Strategy naming, tight voice integration. **That gap = the v2 "Super TELI" definition (resolves item 4c).**
- **Model registry:** `lib/ai/models.ts` — `CLAUDE_GRADING_MODEL=claude-sonnet-4-6`, `OPENAI_GEN_MODEL=gpt-4o`, `OPENAI_VOICE_MODEL` (env lever). Resilient wrappers: `lib/claude/client.ts`, `lib/openai/resilient.ts`. **LIFT as-is.** NOTE for v2: model IDs are dated — revisit against current Claude/GPT versions at build time.

**LIFT verbatim:** quiz-gen prompts, OEQ grading prompt, assignment prompts, adapt route, model registry. **Rework:** lesson-parse (add concept-graph traceability), Super TELI (the upgrade), learning-style cold-start.

## Item 6 — Signals → Actions (formulas + exact thresholds found)

| Signal | File | Formula / threshold |
|--------|------|---------------------|
| Comprehension Level | `lib/utils/scoring.ts` `computeMasteryBand` | **≤50 Reinforce(reteach) · 51–79 On Track(grade_level) · ≥80 Enrich(advanced)**; rolling avg of last 5 quiz attempts; quiz-only |
| Assignment-vs-Quiz gap | `lib/signals/computeHwQuizDivergence.ts` | alignment threshold **±10**; tribes gating fires at **divergence_score ≥ 20** (matches scope's "~20") |
| Effort label (4) | `lib/signals/computeEffortLabel.ts` | success ≥75%, effortful = ≥2 hints → 4 labels |
| Direction/trajectory | `lib/studentModel.ts` 259–277 + `lib/signals/signalComputer.ts` 369–438 | consistency from quiz std-dev (bands 5/15/25, labels 70/40); velocity ±20% pace delta |
| Did-it-work | `lib/admin/reteachEffectiveness.ts` + `lib/studentModel.ts` 326–353 | reteach_cycles improvement delta; mastery-regression alert on band drop (≥3 quizzes) |
| Misconception | `submit/route.ts` 142+ | LLM error_type/reasoning_pattern stored, **no structured taxonomy yet** |
| Risk Index (Pro) | `lib/signals/signalComputer.ts` 310–367 | weighted ensemble (frustration .30/attention .20/velocity .20/error .15/confidence .10/engagement .05) |

**LIFT as-is:** mastery band, effort labels, HW/quiz divergence, consistency, the pure `classifyStudent()` in `lib/briefing/tribes.ts`. **Rework/recalibrate:** frustration & attention heuristics (noisy), misconception (needs a taxonomy), confidence-from-speed (loose). The exact threshold constants above answer **item 6**.

## Item 7 — Pedagogy content + eval rig (all present, Barb-locked)

- **12 Strategies — all present, full metadata:** `lib/openai/prompts.ts` `INTELIFLOW_STRATEGIES` (15–218). Prescription rule exists: `getStrategiesForStudent(band, style)` via `ATL_TO_STRATEGIES`/`STYLE_TO_STRATEGIES`/`BAND_TO_STRATEGY_FOCUS`.
- **5 Powers:** Monitor/Think/Research/Communicate/Collaborate. Display rule: only "Think" gets a parenthetical. `lib/strategies/powerDisplay.ts`.
- **4 effort labels:** `lib/copy/effortLabels.ts` — with student/parent/teacher voice registers + pt-BR.
- **Mastery scale — 3 levels:** teacher-facing **Reinforce / On Track / Enrich** (`BAND_LABEL` in `lib/admin/profileExport.ts`); DB enum stays `reteach|grade_level|advanced`; parent register uses score-driven labels (Strong/Building/Needs-practice). **"Band" is forbidden in user-facing copy.**
- **OEQ rubric:** 0/0.5/1.0 + reasoning_pattern + error_type + cognitive_notes; "score thinking not writing"; response-not-student voice; one Strategy/Power reference max, observational not evaluative.
- **Eval rig:** `scripts/eval/` — 6 scopes (grading, quiz-gen, homework-gen, spark-gen, spark-rubric, learner-profile). Drift-scored (grading: score×3/notes×1/voice×1; pass <0.05, warn 0.05–0.15, regress ≥0.15). CI gate `scripts/eval/ci.ts`, activates at ≥50 tuples/scope. **Corpus is currently empty** (Stage A) — scaffolding lifts, tuples must be rebuilt with Barb.

**LIFT verbatim:** `INTELIFLOW_STRATEGIES`, grading prompt, `powerDisplay.ts`, `effortLabels.ts`, `BAND_LABEL`, eval `types.ts`/runners/ci. Any change to this content must go through Barb + bump the drift suite. **This is Inteliflow's core IP.**

## Item 5 — Media (mature metering already built)

- **TTS:** OpenAI `tts-1`/`nova`, `app/api/attempts/tts/route.ts`. **Today only on Teli replies** — read-aloud on passages/questions is **NEW v2 scope.**
- **Voice in:** Whisper, `app/api/attempts/transcribe|teli-voice`. Voice-on-non-reading is implied via assignment modality, **not enforced in code** → enforcing it is a small v2 add.
- **Illustrations:** **Flux** (`flux-pro-1.1`, `lib/flux/client.ts`), not DALL·E. Degrades to Mermaid/Excalidraw if no key.
- **Diagrams:** Mermaid + GPT-4o-generated Excalidraw SVG + Flux+vision hybrid (`app/api/attempts/diagram/route.ts`).
- **Video:** Runway Gen-3 Turbo (`lib/runway/client.ts`), gated behind `?video=true`.
- **Metering — EXISTS** (`lib/licensing/usageCaps.ts`), per-school/month via `platform_events`:

| Feature | Essentials | Professional | Enterprise |
|---|---|---|---|
| TTS chars | 100k | 500k | ∞ |
| Whisper sec | 12k | 60k | ∞ |
| Flux images | 50 | 200 | ∞ |
| Runway videos | 10 | 50 | ∞ |
| Teli chat | 20/day | 50/day | ∞ |

These default numbers answer **item 5**'s "set the limits" (adopt or adjust). **LIFT the metering architecture as-is.**

## Items 10 & 12 — Packaging gates + Licensing (a genuine moat — lift it)

- **Tiers/features:** `lib/licensing/tiers.ts` (`TIER_FEATURES` map) + central gate `lib/licensing/checkFeature.ts` (server `requireFeature()` + client `useLicenseGate.ts`), 60s Redis cache. Override/block via JSONB for negotiated terms. **This is the tier gate map for item 10.**
- **Anti-piracy — 3 layers (item 12):** (1) **HMAC-SHA256 single-use activation keys** (`lib/licensing/keys.ts`, Crockford base32, constant-time compare, secret `LICENSE_KEY_SECRET`); (2) **domain locking** (`allowed_email_domains`); (3) **per-school API keys + tenant-mismatch checks** on platform endpoints. Server-validated, can't run off-license. **LIFT as-is.**
- **Seat enforcement:** DB trigger `trg_enforce_enrollment_limit` (migration 049) — can't be bypassed in app code.
- **30-day trial:** `lib/licensing/trial.ts` (migration 035). Provisions **Professional**-tier trial, 300 students, expiry cron `app/api/attempts/trial-expiry`. Day-25 nudge + day-30 expire. → **answers item 12b: trial = Pro level (matches the Pro-baseline decision).**
- **Maintenance mode:** `platform_config` singleton (migration 033) — **today it's a banner only, not real read-only.** Making it truly read-only = a v2 add.
- **NO Stripe.** Licensing is admin-provisioned keys, not self-serve SaaS billing. Scope §14 lists Stripe → **that's NEW for v2** if self-serve billing is wanted. Trial signup currently fires a **HighLevel CRM** webhook, not a payment.

## Item 11 — Integrations

- **Google Classroom — ~95% production** (`lib/integrations/lms/google-classroom.ts` + `app/api/teacher/google/*`): SSO, roster import, course link, publish CourseWork, **one-way grade push**, pinned launch link. Gaps: grade *pull* not implemented; student-number anchoring relies on admin CSV. **LIFT.**
- **SIS — ~20% stubs only:** adapter classes for Blackbaud/Veracross/ManageBac/Clever exist with OAuth scaffolding + types (`lib/integrations/sis/`), but no working sync/cron, no dashboard wiring. → confirms scope: **architect the connector interface now (the base adapter is a good starting point), ship Phase 3.**

## Item 14 — Services (inventory + env)

**Production-ready → lift:** Resend (8 email templates, `lib/email/`), Sentry (PII-scrubbed, free-tier tuned), PostHog (two projects: public marketing + server-side product analytics with Zod-typed allow-list, opaque IDs, no PII, FERPA delete path), Upstash (3 rate limiters + cache, graceful degrade), Flux, Runway, Supabase, Vercel Speed Insights.
**Evaluate:** HighLevel CRM (trial webhook only), Stripe (absent — add only if self-serve billing).
**Env inventory** captured (Supabase, OpenAI, Anthropic, licensing secret, Resend, PostHog ×5, Sentry ×2, Upstash ×2, Google, SIS ×N, Flux, Runway, HL, CRON_SECRET) — see the integrations agent notes; **never print secret values.**

---

## Net recommendations for the punch list

- **4b (adaptive threshold):** V1 adapts Q4–Q5 *within the attempt* off Q1–Q3 (0–50/50–79/80+). Decide whether to keep that or layer the scope's "after N quizzes of history" reshape on top.
- **5 (media limits):** adopt V1's caps table above as the default; add read-aloud-on-passages (new) and code-enforce voice-on-non-reading (small add).
- **6 (gap threshold):** 20 is already the live gating value — lock it.
- **7 (pedagogy):** nothing to invent — confirm V1's locked content with Barb and rebuild the eval corpus.
- **10 (gates):** `TIER_FEATURES` is the gate map — confirm, don't redesign.
- **12 (licensing/trial):** reuse the V1 mechanism as-is (it's solid); trial = Pro (already true); "downloadable" = self-serve cloud signup (V1 has no installable build).
- **14 (Stripe):** only add if v2 wants self-serve billing; otherwise keep admin-provisioned keys.
