# ADR — session_risk stays internal (2026-06-21)

**Decision:** On the teacher drill-in, the EMA cross-session **coach-read**
(`coach_read`, from `behavioral_signals`) is the canonical behavioral read.
The single-session `computeSessionRisk` value (`StudentSignals.risk.session`,
from the latest attempt's `quiz_responses`) is **computed but intentionally not
rendered**.

**Why:** Surfacing both would double-state the same concern (violates
one-thing-at-a-time). A single session is noisier than the smoothed EMA; the
coach-read waits for a pattern across ≥ 2 sessions before it speaks.

**Status of `sessionRiskPhrase`:** `src/lib/copy/sessionRiskPhrase.ts` is a
built + tested render helper with **no production caller**. It is retained as
latent infrastructure (e.g. a future "this session specifically" detail), not a
missing wire. Do not treat its absence from the UI as a bug.

**Revisit when:** the Assignment Player (Epic 2) adds richer single-session
behavioral data (hints, canvas, TTS) where a per-session read may earn its own slot.
