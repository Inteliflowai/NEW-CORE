# Plan Review Log: CORE v2 — P1 (Pilot Baseline) architecture & approach

Started 2026-06-17 (session). MAX_ROUNDS=5. Reviewer: OpenAI Codex (read-only). Builder/arbiter: Claude.
Codex thread: `019ed74b-fb60-7aa2-9660-88ce7b6592d3`.

## Round 1 — Codex (VERDICT: REVISE)

1. **Schedule internally dishonest** — PLAN targets full Pro baseline before Sept solo+CC, but spec §10 assumes 3–4 parallel streams; single-threaded ~doubles. Fix: staff parallel, or cut P1 to loop-first with Risk Index / full Super TELI / Spark GA hardening / taxonomy as fast-follows.
2. **WDK on critical path without proof** — no WDK dep in repo; Next16/Fluid/35s handoff unverified. Fix: week-1 blocking spike + fallback to SPARK's awaited-webhook + idempotency.
3. **Role model unresolved** — `school_sysadmin` 6th role referenced in V1 code, not in DB enum. Fix: lock enum/route group/privileges/UI before first migration.
4. **Per-skill CL underspecified migration problem** — must reconcile per-class `student_model`, SCOPE `skill_state` naming, 6-state vocab, 3 verbs. Fix: define one canonical grain/name/mapping + rollup/shim before porting signal consumers.
5. **Eval "from day one" = passes empty** — corpus empty, gates only ≥50 tuples, Barb on-demand → AI changes merge with no drift protection. Fix: temporary golden fixtures for grading/Spark before any AI path lands; replace with Barb corpus later.
6. **SPARK rubric conflict** — spec still puts `knowledge_transfer` in strict dimensions though SPARK's locked 7 exclude it. Fix: shared contract exports exactly the 7 unless a protocol-versioned 8th is approved.
7. **SPARK idempotency race** — cached-response handles post-completion retries but concurrent *first* deliveries double-generate. Fix: `INSERT ... ON CONFLICT (endpoint, idempotency_key)` + `in_progress/completed/failed` state machine + transactional persistence.
8. **FERPA deletion doesn't propagate to SPARK** — 6-action contract has no delete/forget; P1 Spark holds student work. Fix: add a delete action now, or explicitly exclude Spark from the pilot FERPA-deletion SLA/DPA.
9. **Trial licensing can overrun seats/costs** — seat trigger fires only for `status='active'`; trials unenforced. Fix: extend seat + media enforcement to trialing, or cap trial roster/import.
10. **GC grade pull lacks conflict semantics** — no cadence/source-of-truth/overwrite policy. Fix: define before implementing the adapter.
11. **Security relies on discipline, not inventory** — lifting guards.ts needs a route-by-route admin-client audit + a failing meta-test for unguarded `[studentId]`/`[classId]` service-role reads.
12. **"Lift V1 as-is" hides hardening** — maintenance mode banner-only, trial grace unsigned, key expiry/rate-limit are new code, Spark keys bare UUIDs. Fix: split "lift" vs "new hardening" tasks, each with acceptance tests.

### Claude's response (Round 1)
**All 12 accepted as valid — incorporated into PLAN.md.** No rejections. Highest-value additive catches: #5 (interim golden eval fixtures), #7 (idempotency state machine for concurrent first delivery), #11 (security meta-test, not discipline), #12 (split lift/hardening). Changes made:
- **#1/#7-timeline:** reframed P1 as **core-loop-first with explicit fast-follows** (Risk Index, full Super TELI, misconception taxonomy, Spark hardening) — the "full Pro baseline before Sept" is the *target ceiling*, not a single-track commitment; loop-first ships first.
- **#2:** WDK demoted to **week-1 blocking spike with a V1 awaited-webhook + idempotency fallback** — not assumed.
- **#3:** `school_sysadmin` enum/route/privileges/UI locked as a **pre-migration foundation task**.
- **#4:** added "define the canonical per-skill grain/name (`skill_learning_state`), the 6-state→3-verb mapping, and the `student_model` rollup/shim **before** any signal consumer ports."
- **#5:** **interim golden fixtures** (grading + Spark) gate AI paths until the Barb corpus reaches ≥50/scope.
- **#6:** shared contract = **exactly SPARK's 7 canonical dimensions**; `knowledge_transfer` only via a protocol-versioned, explicitly-approved 8th.
- **#7:** SPARK webhook idempotency = unique `(endpoint, idempotency_key)` + `in_progress/completed/failed` state machine + transactional response persist.
- **#8:** add a **delete/forget action to the CORE↔SPARK contract** in P1 (FERPA propagation), or document the exclusion in the DPA — decision forced, not deferred.
- **#9:** extend **seat + media enforcement to `trialing`** licenses (or cap trial roster) — close the trial overrun.
- **#10:** define **GC grade-pull cadence + conflict/source-of-truth policy** before the adapter.
- **#11:** add a **route inventory + failing meta-test** for unguarded service-role cross-user reads (`[studentId]`/`[classId]`).
- **#12:** every licensing/anti-piracy item **split into LIFT vs NEW-HARDENING tasks**, each with its own acceptance test.

## Round 2 — Codex (VERDICT: REVISE)
1. **WDK correction contradicted by Approach** — decision #4 says "spike only" but Approach #2/#6 still say "runs as a WDK durable pipeline"/"modeled as WDK round-trip." Fix: rewrite Approach to "default proven awaited-webhook/idempotency; WDK only if spike passes."
2. **P1 cut-line ambiguous** — "all 5 roles + Risk Index in-pilot" vs "Risk Index/Super TELI/taxonomy fast-follows." Fix: define "first shippable slice," "P1 pilot," "fast-follow" as separate milestones with exact features.
3. **Silent divergence from SCOPE authority** — SCOPE still locks full Super TELI/Risk Index/all-5-roles-full-depth/Pro baseline; PLAN defers parts without saying SCOPE must change. Fix: update SCOPE or mark PLAN as a scope-change proposal needing approval.
4. **Decision #7 repeats old commitment** — still says "full Pro baseline before September," conflicting with schedule-honesty. Fix: reword to core-loop-first before Sept, full baseline only if capacity allows.
5. **FERPA-to-SPARK still optional** — "add delete OR document exclusion" leaves a deletion gap on the approved path. Fix: make delete/forget propagation mandatory for any pilot using Spark student data.
6. **Eval fixtures under-specified** — only grading+Spark named, but claims to gate "every AI path"; quiz/homework/spark-gen/learner-profile unprotected. Fix: interim fixtures for all 6 scopes, or prohibit merging ungated AI paths.
7. **Spark GA hardening conflicts with P1 security** — rotatable keys, rate-limit, idempotency TTL/state, allow-listed URLs, delete propagation are security/abuse controls, not polish. Fix: split "pilot-blocking security minimum" vs "post-pilot operational hardening."
8. **Role delivery vague** — "all 5 roles" + core-loop-first implies Teacher/Student first, Parent/Admin/Super-Admin later. Fix: specify which role surfaces are in the first slice vs later.

### Claude's response (Round 2)
**All 8 accepted.** Core reconciliation (resolves #2/#3): **core-loop-first is build *sequencing within* P1, not a scope cut** — SCOPE §17 already says "front-load lifts, layer net-new after," so this plan makes that concrete; everything SCOPE locks for the Pro pilot still ships. "Fast-follow" = build order, **not** descope. No SCOPE edit needed; *if* single-track velocity later forces dropping a locked feature from a specific pilot date, that is a flagged scope change requiring user sign-off (the human gate). Changes:
- **#1:** Approach #2/#6 rewritten — proven awaited-webhook/idempotency is the **default**; WDK only after the week-1 spike passes.
- **#2/#8:** added a **Milestones** section: **M-Slice (first shippable core loop)** = Teacher (Today/One Student/Create) + Student (Home/Do-the-Work) + engine + per-skill CL + gap/effort signals + GC + licensing/trial + thin Super Admin; **P1 Pilot (full Pro baseline)** adds Risk Index + full Super TELI + Spark + Confirm + Parent + School Admin + taxonomy; each with explicit feature lists.
- **#3:** added a **"Relationship to SCOPE"** note — sequencing, not cut; SCOPE unchanged; real cuts need sign-off.
- **#4:** decision #7 reworded to "core-loop-first before September; full Pro baseline only as capacity allows."
- **#5:** FERPA delete/forget propagation to SPARK is **mandatory in P1** (not "or document exclusion") wherever Spark holds identifiable student work.
- **#6:** interim golden fixtures cover **all 6 eval scopes**; rule: **no AI-output path merges ungated.**
- **#7:** split Spark hardening — **pilot-blocking security minimum** (auth, idempotency state machine, allow-listed URLs, FERPA delete, seat/media enforcement incl. trial, object-level guards) vs **post-pilot operational** (key-rotation overlap windows, idempotency-TTL cleanup cron, rate-limit tuning, maintenance-mode polish). Security is never a fast-follow.

## Round 3 — Codex (VERDICT: REVISE)
1. **M-Slice claims Notice→Act→Confirm but excludes Confirm** (Confirm is only in P1 Pilot). Fix: include minimal outcome-confirmation in M-Slice, or rename to Notice→Act.
2. **Full Super Admin missing from P1 Pilot** — M-Slice has "thin Super Admin"; P1 Pilot adds only Parent + School Admin; SCOPE locks Super Admin as a full-depth role. Fix: add full Super Admin to P1 Pilot.
3. **Maintenance mode downgraded too far** — "true read-only polish" listed post-pilot, but SCOPE hardening requires *true read-only* (V1 is banner-only). Fix: if the maintenance surface ships in P1, true read-only enforcement is pilot-blocking; only UX polish defers.
4. **Rate limiting not in Spark security minimum** — moved "rate-limit tuning" post-pilot without stating a basic per-key limiter is pilot-blocking. Fix: require a conservative per-key/per-school limiter for the pilot; defer only threshold tuning.

### Claude's response (Round 3)
**All 4 accepted.** Changes:
- **#1:** M-Slice renamed **"Notice → Act → minimal Confirm"** — includes the mastery-moved check on the next quiz of the same skill (cheap; per-skill state already supports it). The full reteach-effectiveness rollups stay in P1 Pilot.
- **#2:** **full Super Admin** (schools/licensing/maintenance/changelog) added to the P1 Pilot milestone.
- **#3:** **true read-only maintenance-mode enforcement moved to the pilot-blocking security minimum**; only the maintenance-mode UX polish stays post-pilot.
- **#4:** a **conservative per-key/per-school rate limiter** added to the pilot-blocking security minimum; only threshold *tuning* defers to operational hardening.

## Round 4 — Codex (VERDICT: APPROVED) ✅
> "No remaining material implementation blockers in PLAN.md. The current plan now has a coherent cut-line: M-Slice is explicitly Notice→Act→minimal Confirm, P1 Pilot restores the full SCOPE-locked Pro baseline, WDK is no longer assumed, Spark/security/eval gates are pilot-blocking where they need to be, and operational hardening is separated without moving core controls out of pilot. Residual risks remain, but they are now named rather than hidden: solo timeline, Barb dependency, WDK spike, per-skill CL mapping, and eval corpus rebuild. Those are execution risks, not plan contradictions."

**Converged after 4 rounds.** No Claude rejections were needed — all 24 findings across rounds 1–3 were valid and incorporated. The cross-model review materially hardened the plan; see the gate summary.

## Round 5 — Codex (scope change: LIFT handoff pulled into P1) — VERDICT: REVISE
1. **Foundation `platform_links.product CHECK ('spark','custom')` rejects `'lift'`** — LIFT can't be provisioned. Fix: allow `'lift'`.
2. **LIFT absent from milestone/security cut-line** — P1 Pilot + Security Minimum name Spark only. Fix: add LIFT inbound to P1 Pilot; "Spark/LIFT contract security."
3. **Endpoint mismatch** — LIFT's sender posts `/api/import/lift-inbound`; plan said `/api/integrations/lift-inbound`. Fix: match LIFT's path (or scope the LIFT-side change).
4. **Per-skill CL seeding overclaims** — LIFT sends coarse `predicted_mastery_band`, not skill-level evidence; blind write fabricates mastery. Fix: source-tagged **provisional prior**, mapped to skill groups, **superseded by first CORE quiz**.
5. **Idempotency key collision across schools** — `lift_candidate_id` alone unsafe. Fix: key = `provider+school_id+lift_candidate_id`.
6. **Student-linking rules missing** — create/match/reject undefined. Fix: school-scoped `external_identities(school_id, provider, external_id)` UNIQUE + explicit ambiguous-match behavior.
7. **Tier gating not explicit** — raw `lift_integration` flag can bypass packaging. Fix: add to tier gate map as Pro+; require tier feature + active link.

### Claude's response (Round 5)
**All 7 accepted.** Applied to PLAN.md (Approach #6 LIFT clause rewritten; LIFT added to P1 Pilot milestone + Security Minimum), SCOPE §11, spec §7.9, and the Foundation plan corrections (platform_links enum). Notable: #4 (provisional-prior, observation-supersedes) protects per-skill CL integrity; #6 adds an `external_identities` table. Re-submitting for re-pass.

## Round 6 — Codex (LIFT re-pass) — VERDICT: APPROVED ✅
> "No remaining material blockers on the LIFT addition. The revised LIFT scope now has a consistent inbound-only cut-line, matches the existing LIFT sender path, uses the same pilot-blocking auth/idempotency/rate-limit/FERPA posture as Spark, avoids fabricating per-skill mastery by treating LIFT data as a provisional prior, and adds the missing identity/linking and Pro+ gate requirements."

Hygiene note (Codex): the Foundation plan's inline Task 15 still shows the stale `('spark','custom')` enum; the "LIFT handoff provisioning" correction overrides it — **update the Task 15 body + test inline when implementing** so no one follows the stale snippet.

**Plan + LIFT scope change both Codex-APPROVED.** Ready to build (subagent-driven).
