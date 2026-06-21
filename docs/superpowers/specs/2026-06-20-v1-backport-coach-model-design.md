# V1 Backport — Coach Model + Four-Audience Presentation — Design Spec

**Date:** 2026-06-20
**Status:** Design — **BUILD LATER** (parallel "on the side" track; does NOT block the V2 build). Lives in the V2 repo's specs for record; implementation targets the V1 repo `C:/users/inteliflow/core`.
**Relationship:** the inverse of the parity program — instead of V2 catching up to V1, this backports the V2 *improvements* onto the live V1.

---

## 0. Why (the rationale, from Marvin)

V1 (`app.inteliflowai.com`) is the product **actively piloting** with real schools while V2 is months from fully online. Backporting V2's improvements to the live V1:
1. **Generates real-pilot feedback that de-risks V2** — running V2's coach model + four-audience presentation against live students validates the model and the restrained-presentation thesis with real users *before* V2 ships, and the feedback loops back into the V2 build.
2. **Keeps V1 a strong fallback** — if the V2 timeline slips, the live product still carries the moat.

V1 is still slated for eventual decommission once V2 is fully online, so scope is **targeted backporting**, not a V1 rebuild.

## 1. What V1 already has (so this is backporting, not adding)

V1 has its own quiz runner, the full streamed behavioral pipeline (`student_events → computeSignals → cognitive_signals + student_model(EMA) + signal_aggregates + signal_history`), and the Teli AI tutor coach. The gap vs V2 is **how it presents** and **how cleanly the model is wired** — not the raw capability.

## 2. The V2 deltas to backport (priority order)

**Delta 1 — Four-audience / Barb presentation (HIGHEST value, lowest risk).** V1's documented #1 failing is stat overload — too much raw data shown to every audience. Backport V2's restrained, role-appropriate, leak-guarded presentation: band labels + qualitative coaching copy for students/parents (no mastery enums, no raw risk numbers), actionable teacher framing, Option-D (students never see the quiz %). This is a **presentation layer over data V1 already has** — restyle the surfaces, route every string through a leak-guard equivalent, hide the numbers. No engine change. Delivers immediate value to current pilots and is the cleanest experiment in the four-audience thesis on real users.

**Delta 2 — Coach-model alignment (for comparable feedback).** Align V1's behavioral-signal *outputs* with V2's `computeSignals` shape (the seven cognitive signals: velocity / frustration / attention / error-pattern / confidence / engagement / predictive-risk) so the pilot data is directly comparable to what V2 produces — that comparability is what makes the pilot feedback useful for de-risking V2. Implementation can be: (a) verify V1's existing `signalComputer` already produces these (it's the source V2 ported from — likely yes), and (b) ensure the **dedicated single-model** read pattern (V2's `behavioral_signals` model) is mirrored so the surfaces read one coherent model. Lower urgency than Delta 1.

**Delta 3 — Coaching register + leak-guard discipline.** Make the Option-D / no-leak behavior enforced (a `leakGuard`/`assertNoLeak` equivalent at V1's string boundary) rather than ad-hoc inline, and adopt the coaching voice across student surfaces. Folds into Delta 1's presentation pass.

## 3. Approach

- **Presentation-first.** Delta 1 is a UI/copy refactor over V1's existing data — highest value, lowest risk, no migration. Ship it to pilots, gather feedback.
- **Then model-comparability** (Delta 2) only as far as needed to make V1↔V2 feedback directly comparable.
- **Do NOT** rebuild V1's engine, change its data pipeline beyond output-shape alignment, or touch pt-BR/EduFlux.

## 4. Out of scope

V1 engine rebuild; new V1 features beyond parity; the V2 Pop-Art shell (V1 keeps its own chrome); architecture refactors that don't serve the feedback/fallback goal; anything that risks destabilizing the live pilot.

## 5. Prerequisite before building

A **V1 grounding pass** (mirror of the V2 grounding): map V1's current presentation surfaces (student/teacher/parent dashboards) + its `lib/signals` pipeline + where raw stats currently leak, so the backport is a precise diff, not a guess. The V2 work is already producing much of this map.

## 6. Sequencing

Build **after** the V2 Quiz Runner (and ideally after V2's behavioral model is proven in V2), so: (a) the V2 design is settled and can be mirrored cleanly, (b) the pilot feedback from V1's backported presentation feeds the *next* V2 epics, (c) we don't split focus during the V2 Quiz Runner build. This spec is the durable record; promote it to `writing-plans` when the V2 Quiz Runner lands.
