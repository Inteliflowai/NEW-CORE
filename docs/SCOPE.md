# CORE v2 — Master Scope

> **Inteliflow · CORE v2.** Lock every decision here **before Claude Code writes one line.**
> Pre-filled with what four months of V1 taught us and what the live site already commits to.
> Companion file: [`core-v2-workbook.html`](./core-v2-workbook.html) (the shareable, red-line version for Barb).

**Status legend:** ✅ Locked · 🟠 Needs you · 🟣 Barb's call (pedagogy)

**One sentence:** "CORE shows a teacher *how* each student learns and thinks, and turns it into one clear next step."
**Tagline:** Learning Intelligence. Built on pedagogy. Powered by AI.
**Packaging spine:** Essentials **generates** · Pro **reveals** · Enterprise **remembers** — build in that order.
**Core loop:** **Notice → Act → Confirm.**

---

## Decision Log

This table is the live scoreboard. As each open item is settled, move it to ✅ and record the answer.

> **STATUS — 2026-06-17: all punch-list items LOCKED.** Decided with the user and grounded in the V1 + SPARK mining (`v1-mining-findings.md`, `spark-mining-findings.md`). Only item 7 is ✅* — approach locked, pending Barb's sign-off on 3 pedagogy deltas (per-skill CL, misconception taxonomy, eval-corpus rebuild). Ready for the P1 design doc.

| # | Section | Decision | Status | Answer |
|---|---------|----------|--------|--------|
| 0 | Big Fork | Lean Essentials-MVP first vs full three-tier rebuild | ✅ | **MVP discipline, Pro-tier baseline.** Build sequentially/one-loop-at-a-time, but the pilot ships on **Pro** (not Essentials) so the "Confirm" half of the loop is in-pilot. Enterprise deferred. |
| 2 | Roles | All 5 roles in MVP vs student + teacher + thin admin | ✅ | **All five, full depth.** Guardrail: each role still obeys one-role-one-job — full depth = its single job polished, not added secondary features. |
| 4a | Engine | Confirm grade-anchored difficulty | ✅ | **Locked as-is.** Hard generation constraint; lift V1's Bloom-to-grade calibration in the quiz/assignment prompts. |
| 4b | Engine | Data threshold where Q4–Q5 start adapting | ✅ | **Both layered.** Within-attempt reshape (Q1–Q3 → Q4–Q5: 0–50 scaffolded / 50–79 grade / 80+ advanced, lift V1) always on; student history deepens personalization over time. |
| 4c | Engine | CL granularity (per-skill vs per-student) | ✅ | **Per-skill CL + per-student LS/LP.** CL per skill (`skill_state`); Learning Strategies/Profile stay cross-cutting & behavioral per student. Cold-start = skill "not yet assessed" (null), no fabricated fallback. Most comprehensive + most actionable. |
| 4d | Engine | What's "Super" about Super TELI | ✅ | **Full upgrade bundle.** Persistent cross-session memory + 3-level hint ladder (nudge→cue→walkthrough) + embedded Strategy naming + voice (TTS read-aloud + Whisper speak-back). |
| 5 | Media | Which media in Essentials vs Pro; voice-on-non-reading; monthly limits | ✅ | **Adopt V1.** TTS+voice+Flux images+diagrams all tiers, Runway video Pro+. Caps = V1 table (TTS 100k/500k/∞, Whisper 12k/60k/∞, Flux 50/200/∞, Runway 10/50/∞, Teli 20/50/day). NEW adds: passage/question read-aloud + code-enforce voice-on-non-reading. |
| 6 | Signals | Final signal set + exact gap threshold (V1 used 20+) | ✅ | **8-signal set locked; gap = 20** (V1's live value). Lift V1 formulas/thresholds. **Misconception: build a structured taxonomy + matcher for the pilot** (net-new vs V1's raw-store; needs Barb pedagogy input — see item 7). |
| 7 | Pedagogy | CL states, 12 Strategies, 5 Powers, 4 effort labels, mastery scale, OEQ rubric | ✅* | **Carry V1's locked pedagogy verbatim** as the v2 basis. *Pending Barb sign-off* on 3 deltas only: per-skill CL, misconception taxonomy (6b), eval-corpus rebuild. Reconcile the eval-tuple key mismatch vs SPARK's rubric keys. (✅* = approach locked, Barb confirmation queued.) |
| 8 | Screens | Right MVP screen set | ✅ | **Per-role set + onboarding.** Teacher: Today / One Student / Create / Classes. Student: Home / Do the Work / Spark (Pro+). Parent: child narrative. School Admin: adoption + **aggregate at-risk count** (named roster is a deliberate drill-down, never the landing state — FERPA/LGPD) + equity-across-sections ("where students need support," not teacher report cards) + board-ready aggregate summary. Super Admin: schools / licensing / maintenance / changelog. **PLUS** a first-run onboarding/setup flow (GC connect, demo class, 30-min implementation). |
| 10 | Packaging | Confirm tier gate map; any feature changing tiers | ✅ | **Adopt V1's `TIER_FEATURES` gate map as-is** (matches §10). Lift `checkFeature` (server) + `useLicenseGate` (client) + JSONB override/block. Spark = Pro+ (checked in CORE before the webhook fires; SPARK-side grade-band gate 3–12). No features move tiers. |
| 11 | Integrations | GC-only at MVP; SIS connector architected now / shipped P3 | ✅ | **GC live at pilot (all tiers, free; lift V1 ~95%).** Architect a provider-agnostic **LMS** interface (GC + **Canvas**, net-new) **and SIS** interface (Blackbaud, Veracross, ManageBac, Clever) now; ship non-GC implementations in the Enterprise phase. **Platform API = SPARK's contract pattern + GA reworks** (rotatable/expiring keys, per-key rate-limit, idempotency TTL, codegen'd payload spec). |
| 12a | Licensing | Reuse V1 licensing vs redesign | ✅ | **Reuse V1 as-is + minor hardening:** lift HMAC single-use keys + domain lock + DB-trigger seat enforcement + tenant isolation; add (1) trial grace-period enforcement, (2) *true* read-only maintenance mode, (3) key-expiry check at activation, (4) rate-limit activation. |
| 12b | Licensing | Trial = Pro or Essentials level | ✅ | **Pro** — 30-day, no card, demo students pre-loaded (matches V1 + the Pro-baseline decision). |
| 12c | Licensing | "Downloadable" = cloud signup or installable | ✅ | **Self-serve cloud signup** (no installable build — none exists in V1). |
| 14 | Services | Reuse service configs vs clean reset; add/drop services | ✅ | **Reuse all V1 configs as-is** (Resend, Sentry, PostHog 2-project, Upstash, Flux, Runway, Whisper/TTS, diagram renderer). **Defer Stripe** — keep V1's admin-provisioned license-key model for the pilot (reserved Stripe columns stay ready). **Keep HighLevel** trial webhook. |
| 16 | Look & Feel | Vibrant vs indigo/amber; student-loud/adult-credible split; leaderboard default; "first 5 min" flow | ✅ | **Fresh electric palette** (direction locked; exact colors explored visually in the design phase). **Student-loud / adult-credible split confirmed** (WCAG AA always). **Leaderboard off by default** ("You vs 4 weeks ago" is the frame). **Hero flow = teacher → first differentiated assignment, <5 min.** |
| 17 | Sequence | Phasing matches Sept pilot | ✅ | **V1 carries near-term pilots (EduFlux next wk, US 2–3 wks); v2 builds core-loop-first as the forward platform, V1 is the safety net.** Solo + Claude Code (single track). Front-load proven V1 lifts + the core loop so v2 can come online ASAP; full Pro Baseline ~September. |
| 18 | Success | The 2–3 success metrics | ✅ | **3-metric scoreboard:** (1) teacher takes a CORE-recommended action; (2) time-to-first-value < 5 min (first differentiated assignment) + weekly return; (3) flagged students improve (assignment grades up and/or Assignment-vs-Quiz gap narrows). |

---

## 0. The Big Fork: How Much Do We Build First? 🟠

- **V1 lesson:** We built 150+ features at once, in parallel; the result was a screen nobody could read. Breadth killed clarity.
- **Original recommendation (refined by the decision below):** a lean Essentials-first MVP that nails one loop end-to-end, then layer Pro and Enterprise. The decision kept the MVP *discipline* but moved the **pilot baseline to Pro** so the loop actually closes in-pilot.
- **DECIDED:** MVP *discipline* (sequenced, one loop end-to-end — not 150 features at once), but the **pilot baseline is the Pro tier**, not Essentials. Rationale: the "Confirm" half of Notice→Act→Confirm (did the intervention work, cognitive signals, Risk Index) lives in Pro — an Essentials-only pilot would repeat the V1 mistake of never closing the loop. **Enterprise (longitudinal, SIS, white-label) stays deferred.** This merges the old P1+P2 into a single "pilot baseline" phase (see §17).

## 1. What CORE v2 Is ✅

- Locked one-sentence definition + tagline (above).
- Packaging spine: Essentials generates · Pro reveals · Enterprise remembers → maps onto the core loop; build in that order.

## 2. The Five Roles ✅ (MVP scope 🟠)

Each role gets *one* primary job. A screen that serves two masters serves neither.

| Role | The one thing they come for |
|------|------------------------------|
| **Student** | Am I getting better, and what's my next step? |
| **Teacher** | Who needs me today, and what do I do about it? |
| **Parent** | Is my child okay, in plain words? (no scores dump) |
| **School Admin** | Are teachers and students actually being helped? (adoption + risk) |
| **Platform Super Admin** | Run the platform — schools, licensing, maintenance mode, changelog. |

- **DECIDED:** All five roles in the pilot at **full depth** (School Admin confirmed in). Guardrail: each role still obeys one-role-one-job — "full depth" = its single job polished and complete, not added secondary features per role.

## 3. The Core Loop ✅

- **Notice → Act → Confirm.** Teacher notices who needs help (5-second test), acts (check-in / targeted practice / reteach), and later confirms whether it worked (did mastery move?).
- **V1 lesson:** We captured "notice" data but never closed the loop on "did it work." That close is the most valuable, most missing piece.

## 4. The Generation Engine 🟠 (the heart of CORE)

Pipeline: **Lesson Plan → Quiz (3 MCQ + 2 OEQ) → read cognitive + behavior signals → set CL + detect Learning Strategies → generate Differentiated Assignment + Spark Challenge + Super TELI support** (Strategies & Power Skills baked in).

- **Lesson plan.** One sentence or one upload in → CORE writes the full plan, passage, objectives, key concepts. Review, edit, publish.
- **Quiz: 3 MCQ + 2 OEQ.** MCQs read comprehension fast. The **2 open-ended questions are the engine** — reasoning, critical thinking, and the *specific misconception* live there. AI-graded with a rubric, eval-gated from day one.
- **Grade-anchored difficulty.** Questions generated to the student's **grade level** — a Grade 6 and Grade 12 item on the same skill are not the same difficulty. Hard generation constraint, not an afterthought.
- **Adaptive once there's data (resolved).** Not fixed-vs-adaptive — *sequenced*. Cold-start is a clean fixed 3 MCQ + 2 OEQ at grade level. Once CORE has enough history, **Q4–Q5 reshape in real time** off Q1–Q3 (scaffold down / challenge up).
- **CL = Reinforce / On Track / Enrich.** Three states, each a teacher verb. Set **per skill, not per student.**
- **LS detection** from the 12 Strategies. Quiz *seeds* LS weakly; **behavior signals confirm it** over time. Never a day-one verdict.
- **CL drives generation:** Reinforce → scaffolded work + more Super TELI. On Track → grade-level. Enrich → Spark / stretch + Socratic-only Super TELI.
- **Media-rich outputs.** Every passage, question, and hint can be read aloud; students can speak back; assignments include generated illustrations and diagrams (§5).
- **DECIDED (V1+SPARK-informed):**
  - **(4a) Grade-anchored difficulty — locked.** Already a hard constraint in V1 (Bloom matched to grade band in the quiz prompt); lift the calibration.
  - **(4b) Adaptive Q4–Q5 — both layered.** V1 already reshapes Q4–Q5 *within the attempt* off Q1–Q3 MCQ % (0–50 scaffolded / 50–79 grade / 80+ advanced) — keep that, always on. Layer student-history personalization on top over time. (Supersedes the earlier "after N quizzes" framing.)
  - **(4c) CL per-skill; LS/LP per-student.** Comprehension Level is computed per skill (`skill_state`) — strictly more comprehensive and more actionable than V1's per-student band. Learning Strategies / Learner Profile remain cross-cutting, behavioral, and accruing per student (observation supersedes; never claim a strategy from one skill). Cold-start: a skill with no evidence is "not yet assessed" (null), not a fabricated fallback.
  - **(4d) Super TELI = full upgrade bundle.** Persistent cross-session memory + 3-level hint ladder (nudge→cue→walkthrough) + embedded Inteliflow Strategy naming + tight voice (TTS read-aloud + Whisper speak-back). V1's Teli is the Socratic base to build on. NOTE (from SPARK mining): Spark's in-runner tutor stays SPARK-owned and separate behind the contract — do not unify the two tutors in the pilot. (Super TELI is a *normal* implementation — **not** on the Workflow DevKit; see the WDK addendum below.)
  - **(4e) ARCHITECTURE — Vercel Workflow DevKit on the generation pipeline.** Orchestrate lesson→quiz→adapt→grade→differentiate as a durable `"use workflow"` with each AI call a retryable `"use step"` (automatic retry, persisted replay, crash-safe). Keep the teacher's interactive "create assignment <5 min" path snappy/streaming — WDK is for the durable/background generation, not the synchronous request feel.

## 5. Media: Audio & Visuals 🟠

Audio and visuals are core to **accessibility** (struggling readers, ELL, younger grades) and **engagement** — not decoration.

- **Audio — read-aloud / TTS.** Passages, questions, Super TELI hints spoken aloud. Built in, every tier.
- **Audio — voice in.** Students speak to Super TELI; speech transcribed. **Voice only on non-reading tasks** (same rule as LIFT — never read a reading-comprehension answer aloud).
- **Visuals — illustrations.** AI-generated images bring lessons/assignments to life.
- **Visuals — diagrams.** Auto-generated diagrams (processes, structures, concept maps) where a picture beats a paragraph.
- **Video.** Richer generated media for select content — heavier cost, so Pro+.
- **Tier-gated limits.** Generous monthly AI-media allowances on Essentials; Pro raises every ceiling. Limits double as the cost guardrail (§14).
- **DECIDED (lift V1 metering):**
  - **(5a) Tier split = V1's:** TTS + voice + illustrations (Flux) + diagrams on all tiers incl. Essentials; **video (Runway) = Pro+**.
  - **(5b) Caps = V1's table** (TTS 100k/500k/∞ chars, Whisper 12k/60k/∞ sec, Flux 50/200/∞ images, Runway 10/50/∞ videos, Teli 20/50/∞ msgs/day) — lift `lib/licensing/usageCaps.ts` + `platform_events` metering; tune from pilot usage.
  - **(5c) Two NEW adds on top of V1:** read-aloud on passages/questions/hints (V1 only does Teli replies today) + **code-enforce "voice only on non-reading tasks."**

## 6. Signals → Actions 🟠

A signal only reaches the screen if it passes the 5-second test *and* resolves to a plain-language action. Everything else lives one tap down.

| Signal | Who | Action it triggers |
|--------|-----|--------------------|
| Comprehension Level (per skill) | Teacher | Reinforce / leave on track / enrich |
| Assignment vs Quiz gap (>~20 pts) | Teacher | Review submissions — integrity, format, or anxiety |
| Effort vs ability (can't yet / needs time) | Teacher | Reteach the concept, or just check in |
| Direction (sliding / climbing) | Teacher + Student | Watch & check in / celebrate the climb |
| Did the intervention work (mastery moved?) | Teacher | Confirm complete, or escalate |
| The specific misconception (from OEQs) | Teacher | Targeted practice on that exact thing |
| Personal growth over time | Student | "You're getting better at X" (vs own past, never peers) |
| One next step, plain words | Student | Do this one thing |

- **V1 credibility risk:** don't claim a learning *strategy* from 5 answers. Comprehension you can read from a quiz; strategy is behavioral and accrues. "Observation supersedes."
- **DECIDED:** 8-signal set locked as the pilot set (all proven in V1 — see `v1-mining-findings.md` for formulas). **Gap threshold = 20** (V1's live `divergence_score` gating value). The "did-it-work" confirmation (reteach effectiveness + mastery-regression alert) closes the loop and is in-pilot. **Misconception signal: build a structured taxonomy + matcher for the pilot** (V1 only stores raw `cognitive_notes`/`error_type` — the taxonomy is net-new and needs Barb's pedagogy input; tracked under item 7). Recalibrate the noisier V1 heuristics (frustration, attention) from pilot data.

## 7. Pedagogy Decisions to Lock 🟣 (Barb)

- **CL = Reinforce / On Track / Enrich** — locked on the site, replaces "Tribes." Confirm.
- **12 Learning Strategies:** Goal First, Knowledge Bridge, Quick Look, Text Detective, Question Quest, Explain It, Note Builder, Idea Mapping, Idea Exchange, Think-Talk-Share, Comprehension Crew, Pause & Reflect. Confirm + the rule for prescribing "the next one to try."
- **5 Power Skills ⚡:** Monitor, Think, Research, Communicate, Collaborate. Confirm.
- **4 effort labels:** effortful success / struggling but trying / independent success / independent struggle. Confirm.
- **Mastery scale:** how many levels + human labels ("Mastery," never "Band").
- **OEQ rubric:** what the 2 open-ended questions are scored on + the expected-output set for the eval rig.

- **DECIDED (approach):** carry V1's locked pedagogy **verbatim** as the v2 basis — all of the above already exists and is Barb-locked in V1 (`lib/openai/prompts.ts` `INTELIFLOW_STRATEGIES`, `lib/strategies/powerDisplay.ts`, `lib/copy/effortLabels.ts`, `BAND_LABEL`, the grading prompt). **Barb confirmation is queued for only 3 deltas:** (1) CL is now **per-skill** (V1 was per-student), (2) the **new misconception taxonomy** (item 6b), (3) **rebuilding the eval corpus** (V1's is empty / Stage A). Reconcile the eval-tuple dimension-key mismatch (`analysis_evidence`/`metacognition`/`growth_mindset` vs SPARK's runtime keys) during the rebuild. Any change to this content must go through Barb + bump the drift suite.

## 8. Screen Map (MVP) 🟠

- **Teacher: Today** — 5-second triage. Who needs me, ranked, reason in plain words, one-click action.
- **Teacher: One student** — the story (CL per skill, the gap, effort vs ability, trajectory) + three action buttons. Detail one tap down.
- **Teacher: Create** — one sentence or upload → lesson + quiz; one goal → CORE differentiates.
- **Student: Home** — "you're improving at X" + today's one next step.
- **Student: Do the work** — two-phase assignment (read, then tasks) + Super TELI (voice + read-aloud).
- **DECIDED:** per-role set above is locked (mirrors V1's proven screens; one job per role), **plus a named first-run onboarding/setup flow** (Google Classroom connect → roster import → demo class pre-loaded → first differentiated assignment) — designed explicitly, since "time-to-first-value <5 min / 30-min implementation" is a success metric (§16, §18). "Did it work" lives inside Teacher: One Student. Spark surfaces on Student for Enrich (Pro+).

## 9. Data Model ✅ (draft)

Start minimal. Every entity earns its place by feeding a signal in §6.

- **Student · Class · Teacher · School** — roster basics + multi-school from day one.
- **Lesson · Assignment** (goal + per-student entry point) · **Attempt** (work + result + effort signal).
- **Quiz / Quiz attempt** — kept separate so the gap signal works; stores per-question (3 MCQ + 2 OEQ) + misconception.
- **Skill state** — per skill, per student, over time, carrying CL.
- **Snapshots** — weekly, from day one, so trajectory is real not retrofitted.
- **Profile** — observational only; Strategies + Powers accrue. Never assigned upfront.
- **Media asset** — generated illustrations/diagrams/audio, with per-school usage counters for tier limits.
- **License** — school, tier, seat count, term, status (§12).
- **V1 lesson:** capture per-attempt history + weekly snapshots from the start — the trajectory view was a painful retrofit last time.

## 10. Packaging: Three Tiers ✅ (from site; gate map 🟠)

The build must **license-gate features by tier** from day one.

| Tier | Promise | What it adds |
|------|---------|--------------|
| **Essentials $99** | Runs your classroom | Full generation engine: lesson → quiz → differentiated assignments → Super TELI → reteach → parent narrative → gamification → Google Classroom (free) → 5 roles → PDF export → IEP/504-aware generation. Read-aloud + base media limits. |
| **Pro $165** | Shows what's happening now | + Spark Challenges, Risk Index, Assignment-vs-Quiz tracking, reteach effectiveness, cognitive signals, 4 effort labels, concept-gap alerts, "What CORE recommends," bulk grade approval, substitute mode, raised media ceilings + video. |
| **Enterprise** | Learns over time | + full Longitudinal Intelligence, trajectory tab, cohort benchmarking, learning velocity, SIS integration, Pulse/LIFT API, white-label, division-scoped admin, custom reports, CSM. |

- Spark is built into the engine but **gated to Pro+**. Learning Support Intelligence is an add-on for any tier.
- **DECIDED:** adopt V1's `lib/licensing/tiers.ts` `TIER_FEATURES` as the v2 gate map (it matches this table). Lift the central gate verbatim: `checkFeature()` server-side + `requireFeature()` in API routes + `useLicenseGate` client hook, 60s Redis cache, JSONB `feature_overrides`/`feature_blocks` for negotiated deals. **Spark stays Pro+**, gated by the `spark_experiences` feature checked in CORE *before* the webhook fires (+ SPARK-side grade-band gate 3–12). No features move tiers for v2.

## 11. Integrations 🟠

| Integration | Tier / phase |
|-------------|--------------|
| **Google Classroom** (SSO, roster, lesson import, one-click launch, grade sync) | **All tiers, free, MVP** |
| **SIS** (Blackbaud, Veracross, ManageBac, Clever/SSO) | **Enterprise** — design connector interface now, ship Phase 3 |
| Spark (internal) | Pro+ — via typed contract, never shared seeds |
| **LIFT pre-populate handoff** (LIFT → CORE inbound: readiness snapshot at admission) | **Pro+, P1** — inbound intake via the typed contract; seeds per-skill CL cold-start |
| LIFT outcomes return + learner-profile delivery + Pulse ecosystem API | Enterprise / P2 — deferred from pilot |

- **DECIDED:**
  - **Google Classroom is the only *live* integration at pilot** (all tiers, free) — lift V1's ~95%-complete connector (`lib/integrations/lms/google-classroom.ts` + `app/api/teacher/google/*`); add grade *pull* (V1 only pushes).
  - **Architect now, ship later:** a provider-agnostic **LMS adapter interface** (Google Classroom + **Canvas** — Canvas is net-new vs V1) and the **SIS adapter interface** (Blackbaud, Veracross, ManageBac, Clever — V1 has a base adapter + stubs). Non-GC implementations ship in the **Enterprise** phase.
  - **v2 Platform API = SPARK's proven contract pattern** (typed HTTP POST + inline payloads; asymmetric auth — CORE signs HS256 JWTs, products return via per-school Bearer secret; one school-scoped `api_key` per link; per-tenant feature-flag gating both entry points; webhook idempotency; per-school `core_base_url` override) **+ GA reworks:** rotatable/expiring keys (not bare UUIDs), per-key rate limiting (Upstash), idempotency-row TTL (~30d), and codegen the payload spec so both sides auto-validate. Wrap the call site in a `lib/spark/sendAssignmentToSpark` service layer.
  - **ARCHITECTURE — Vercel Workflow DevKit for the CORE↔SPARK round-trip.** Model the assignment→result handoff as a durable workflow using `createHook()` / webhook **pause-resume**: CORE fires the assignment, the workflow suspends, and SPARK's return webhook resumes it — replacing V1's hand-rolled idempotency-key + retry plumbing with the DevKit's built-in durability. (WDK adoption is scoped to **this contract** + the **generation pipeline (4e)** only — not Super TELI, crons, or media polling.)
  - **LIFT pre-populate handoff is IN P1 (inbound only)** — see `lift-mining-findings.md`. Receive LIFT's admission-time readiness snapshot at a CORE-side **`POST /api/import/lift-inbound`** (matches LIFT's existing sender path — no LIFT-side change), a one-off inbound *sibling* to the SPARK contract (no outbound launch/JWT). Auth = a per-school LIFT `api_key` on a `platform_links` row (`provider='lift'` — the enum must allow it), reusing the SPARK key/rate-limit machinery; **idempotency keyed `provider+school_id+lift_candidate_id`** (not bare candidate id); gated on a distinct **`lift_integration`** feature **AND Pro+ tier** (in the gate map; require tier + active link). **Student linking** via a school-scoped `external_identities(school_id, provider, external_id) UNIQUE` table — ambiguous matches rejected for manual review, never silently merged. **CL seeding is integrity-critical:** LIFT's coarse `predicted_mastery_band` + readiness dimensions are a **source-tagged provisional cold-start prior** (mapped to skill groups), **superseded by the first CORE quiz** — never fabricate per-skill mastery from admissions data (observation supersedes). LIFT's 7 *input-readiness* dimensions stay distinct from SPARK's 7 *output-quality* rubric dimensions. Same **pilot-blocking FERPA delete/forget** as SPARK. **Deferred to P2:** CORE → LIFT outcomes return + `learner_profile.v1` delivery. ~3–5 days, absorbed into the SPARK/Platform-API workstream.

## 12. Licensing, Anti-Piracy & Free Trial 🟠

Carry forward the licensing system already built — it's a moat. Bake in from line one.

- **Per-school, per-tier, per-seat licensing** — annual, September-aligned. Seat count enforced; tier gates features (§10).
- **Anti-copying / anti-piracy** — keep V1's mechanism so the platform can't be cloned or run off-license. Server-validated, not client-trustable.
- **30-day free trial, self-service** — no credit card, 8 demo students pre-loaded, every feature unlocked, onboarding wizard, no cap. Converts to a paid tier or expires cleanly.
- **Maintenance mode** — Super Admin can put CORE read-only with a user-facing banner.
- **DECIDED:** **(12a) Reuse V1's licensing as-is** — proven moat (HMAC single-use activation keys, domain locking, DB-trigger seat enforcement, per-school API keys + tenant-mismatch checks). Add only 4 small hardening fixes: enforce the trial grace period, make maintenance mode *actually* read-only (today banner-only), check key expiry at activation, rate-limit the activation endpoint. **(12b) Trial = Pro tier**, 30-day, no credit card, demo students pre-loaded. **(12c) "Downloadable" = self-serve cloud signup** — there is no installable build (none in V1).

## 13. Tech Architecture & V1 Gotchas ✅

**Stack:** Next.js (App Router, Turbopack) · Supabase · GPT-4o (+ Claude for rubric grading) · Tailwind + shadcn/ui · Vercel.

- Nest API routes under existing paths (Turbopack 404s on new top-level API folders).
- `SECURITY DEFINER` functions for circular RLS; `DROP POLICY IF EXISTS` before create.
- Session client for DB writes; `auth.getUser()` not `getSession()`; `await cookies()`.
- **Eval rig from day one** — real examples + Barb-confirmed expected outputs, auto-checked on every prompt change. Critical for the OEQ grader.
- Couple products by explicit typed contract (the Platform API), never shared DB seeds.

**Carrying V1 forward:** point Claude Code at the **V1 repo as a reference to mine, not a base to patch** — lift the proven pieces into clean v2 files: licensing / anti-piracy, Google Classroom integration, signal math, AI prompts, eval tuples, the 12 Strategies / 5 Powers content, the audio + visual media pipeline. Scope locks the *what/why*; the old repo supplies the *proven how*.

**Hard line:** mine V1 for **logic, data, and patterns — never its visual design.** Proven bones, brand-new skin (§16).

## 14. Services & Infrastructure ✅ (confirm)

Carry forward, configured from day one — not bolted on after launch.

| Service | What it does in CORE |
|---------|----------------------|
| **Resend** | Transactional email — parent narratives, notifications, weekly summary, report cards |
| **Runway** | AI video generation (Pro+ media) |
| **Whisper + TTS** | Voice input + read-aloud — powers §5 audio |
| **GPT-4o + Claude** | Generation + rubric grading of the open-ended questions |
| **Diagram renderer** | Auto-generated diagrams and concept maps |
| **Sentry** | Error monitoring (free-tier optimized, filtered) |
| **PostHog** | Product analytics — server-side, typed allow-list, opaque IDs, no PII |
| **Upstash Redis** | Rate limiting + caching (reliability) |
| **Stripe** | Billing / licensing payments |

- **Cost guardrail:** Runway, image generation, and TTS each cost per use. The per-tier media limits in §5 keep spend bounded — wire usage counters in from the start.
- **DECIDED:** **reuse all V1 service configs as-is** (incl. Sentry's PII scrubbing + free-tier tuning, PostHog's two-project split with Zod allow-list + FERPA delete path, Upstash rate-limiters). **Defer Stripe** — V1 has no payment system; licensing is admin-provisioned keys (sales-led / PO), which fits edu and the Sept pilot. The `school_licenses` table's reserved Stripe columns stay ready for a post-pilot self-serve billing add. **Keep** the HighLevel CRM trial-signup webhook (non-blocking lead capture).

## 15. Non-Negotiable Language & Brand ✅

- UI says **"Assignments"** and **"Mastery"** (never "Band").
- **"Personalized / differentiated,"** never **"adaptive."**
- Profiles are **observational, never diagnostic.** "The student is not a data set."
- CL states are **Reinforce / On Track / Enrich.** Strategies = what students *do*; Powers = what they *become*.
- Never lead with "AI-powered."

## 16. Look & Feel — and the Discipline 🟠

- **Visual direction (new for v2):** ditch V1's look entirely. v2 is **vibrant, energetic, pop-art-influenced** — bold color, confident type, playful motion. The opposite of the sterile ed-tech dashboard.
- **Intensity by surface:**
  - **Student screens:** full pop-art energy. Bold blocks, saturated color, big friendly type, playful micro-animations, Super TELI's character.
  - **Teacher / parent / admin screens:** same DNA, dialed for **credibility.** Confident and modern, never cartoonish — a clownish teacher dashboard kills the sale.
  - **Bold skin, disciplined bones.** Spend boldness on a signature element; keep information design calm so the 5-second test still works.
  - **Vibrant ≠ unreadable.** Bold color must still hit WCAG AA contrast.
  - **Avoid the generic AI look.** Specific, intentional palette — not stock Memphis squiggles.
- **Starter tokens (react to, not final):** electric palette — vivid violet + hot coral + acid lime accents over clean near-white, deep ink text — or a louder evolution of the current indigo/amber. Expressive geometric display face + highly legible body face. Motion with purpose.
- **The rest of "better" is discipline:** time-to-first-value < 5 min · 30-minute implementation · defaults over settings · one screen/one job/one action · healthy engagement (You-vs-4-weeks-ago default, leaderboard off by default) · plain language is the product · trust as a feature · mobile + accessible by default.
- **DECIDED:** **Fresh electric palette** — a new, intentional pop-art palette (not the V1 indigo/amber); direction locked now, exact colors + the signature element explored visually in the design phase (frontend-design + visual companion). **Student-loud / adult-credible split confirmed:** full pop-art energy on student screens; same DNA dialed for credibility on teacher/parent/admin; bold skin + disciplined bones; WCAG AA always. **Leaderboard off by default** (keep XP/streaks/badges, but "You vs 4 weeks ago" is the default frame; opt-in only). **The one "first 5 minutes" flow to obsess over:** teacher signs in → connects GC / picks demo class → one sentence → a real differentiated assignment in hand in under 5 minutes (the time-to-first-value metric, §18).

## 17. Build Sequence 🟠 (phasing reshaped by decisions 0, 2, 4)

Per decision 0, the old P1 (Essentials) and P2 (Pro) **merge into a single Pilot Baseline (Pro tier)** phase; Enterprise is deferred. Per decision 2, all 5 roles are full-depth in the pilot.

| Phase | What ships |
|-------|------------|
| **P0** | This sheet, fully locked. (We're here.) |
| **P1 — Pilot Baseline (Pro tier)** | Engine (§4) end-to-end with read-aloud + visuals + **full Super TELI**; **all 5 roles at full depth**; **per-skill CL** + gap + effort + cognitive signals + Risk Index; **"did it work" confirmation** (loop close); **Spark (Pro+, via the typed contract)**; student trajectory; parent dashboard; Google Classroom; licensing + 30-day Pro trial. |
| **P2 — Enterprise** | Longitudinal layer; SIS connectors; cohort benchmarking; white-label; ecosystem API. |

- **DECIDED:** target the **full Pilot Baseline (Pro) before September**; build begins as soon as the scope locks. **Build ordering** (to protect the date): front-load the proven V1 lifts — engine + prompts, signal math, licensing/anti-piracy, media metering, Google Classroom, the SPARK contract — onto a working spine *first*, then layer the net-new work: per-skill CL, full Super TELI, the misconception taxonomy, the Canvas LMS adapter, and the fresh design system.

- **BUILD PARAMETERS (resolved 2026-06-17, gating Q&A):**
  - **(1) Team = solo + Claude Code** → single ordered build track (no parallel workstreams); the §10 calendar assumes one decision-maker, with Claude Code lifting throughput.
  - **(2) Near-term pilots run on V1.** EduFlux pilot (~next week) + potential US pilot (~2–3 weeks) run on the existing `core-platform` (which already runs EduFlux/pt-BR). **v2 (NEW-CORE) is the forward platform**, built core-loop-first so the earliest usable slice can come online ASAP — but **V1 is the committed safety net**; no real pilot is bet on unbuilt v2. (Consistent with §19: pt-BR stays out of v2.)
  - **(3) OEQ grading = keep V1's Sonnet/GPT for the pilot;** run an **Opus 4.8 spike in week 1** as an upgrade candidate, not a day-1 dependency.
  - **(4) Adaptive = full power (both layers).** Layer 1 (within-attempt reshape) ships in the engine; Layer 2 (history-informed entry point off `skill_learning_state`, ≥3 observations) self-activates ~2–3 weeks into live use (can't history-gate with no history). Build both hooks now.
  - **(5) Barb on-demand** → pedagogy deltas + ~300-tuple eval-corpus rebuild are *not* a blocking critical-path dependency; schedule when needed.

## 18. How We'll Know It Has Value 🟠

- **V1 lesson:** "We don't even know if it has value" — because we never defined it upfront.
- **Leading signs:** teachers log in weekly without nagging · teachers take a CORE-recommended action · login→insight < ~30s, first differentiated assignment < 5 min.
- **Proof it worked:** flagged students' assignment grades trend up · the Assignment-vs-Quiz gap narrows for students we intervened on · teachers say, unprompted, "this changed what I did in class."
- **DECIDED — the pilot scoreboard (3 metrics):** (1) **Teacher takes a CORE-recommended action** (the click that proves the insight landed). (2) **Time-to-first-value < 5 min** — first session produces one real differentiated assignment; teachers return weekly without nagging. (3) **Flagged students improve** — for students CORE flagged and the teacher acted on, assignment grades trend up and/or the Assignment-vs-Quiz gap narrows.

## 18b. CORE Learning Loop — self-improvement (P2+, architected in P1) ✅ (direction)

**Decided 2026-06-17.** CORE should be a **self-improving system** that gets better at identifying and differentiating as it accumulates data — *not* by training LLM weights on raw student work, but via an **aggregate / de-identified learning layer**:

- **What it learns:** cross-cohort outcome patterns — e.g. "misconception X on skill Y at grade Z responded best to strategy S," "reteach approach A moved mastery more than B" — fed back into generation, the strategy-prescription rules, the recommendations, and signal thresholds.
- **Three grains (keep them distinct):** (1) **in-context per-student** personalization (in P1); (2) **aggregate/de-identified** pattern learning (the loop — P2+); (3) **fine-tuning on raw PII = the one red line** — avoided; any future fine-tuning uses de-identified/aggregated/derived features only.
- **Why it's compliant:** FERPA governs *disclosure/handling of PII*, not "using data to improve the service." Properly de-identified/aggregated data falls outside FERPA's PII constraints. Guardrails: operate as a school official under a data-handling agreement; de-identify before any cross-student learning; opaque IDs; raw student work stays in-context only.
- **Architected in P1, built in P2+:** P1 already captures the substrate (weekly snapshots, per-attempt history, reteach outcomes, signal aggregates, V1's PostHog typed-allow-list/opaque-ID/no-PII analytics). The loop drops in later **without a retrofit** — same discipline as longitudinal (§9). **Pilot does not build the loop; it must not foreclose it.**

## 18c. Multi-region architecture — BR/EduFlux (deferred, seam kept clean) ✅ (direction)

**Decided 2026-06-17.** When the Brazil/EduFlux (pt-BR) version comes into scope, the architecture is **one Git repo → a separate Vercel *project* per region, each with its own Supabase DB and its own domain.**

- **Separate DB per region** (not just separate domain on one project): clean **data residency** — Brazil **LGPD** + FERPA isolation, US and BR student data never share a database — and no runtime multi-DB routing complexity. Same code, two deploys, two DBs.
- **One codebase, not a fork:** region differences (locale, BNCC curriculum, palette) are **config / feature-flags** — lift V1's `NEXT_PUBLIC_BRAND=core|eduflux` seam.
- **Deferred per §19:** pt-BR is **not built** in the v2 pilot (near-term EduFlux pilot runs on V1). But the P1 foundation **keeps the seam clean** — locale is an input signal, brand resolves from env, nothing hardcoded en-US — so adding BR later is config, not surgery. **Pilot must not foreclose it.**

## 19. Explicitly Out of Scope (v2 pilot) ✅

- Portuguese / Brazil localization (Pulse track).
- LIFT integration **beyond the inbound pre-populate handoff** — the handoff itself (LIFT → CORE readiness snapshot at admission) is **in P1** (§11); the CORE → LIFT outcomes return, the richer `learner_profile.v1` delivery, and the Pulse ecosystem API are deferred (P2 / Enterprise).
- Custom white-label + advanced longitudinal dashboards (Enterprise, Phase 3).
- Anything that doesn't serve Notice → Act → Confirm.
