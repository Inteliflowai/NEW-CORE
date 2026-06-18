# Grader Spike — Week 1 (spec §3.1, §10.5)

**Date:** PENDING keyed run  **Model under test:** claude-sonnet-4-6 (CLAUDE_GRADING_MODEL default)
**Fixture:** scripts/eval/fixtures/grader-spike.json (5 hand-graded OEQs)

> **STATUS: PENDING keyed run.**
> This spike MUST be executed in a keyed environment (local dev or CI) with
> `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` set before M1 commits the grader.
> Run: `npm run spike:grader`
> The committed default (claude-sonnet-4-6 primary / gpt-4o fallback) stands
> until a keyed run produces a PASS result that justifies changing it. Do NOT
> fabricate or pre-fill the result table below.

## Result

| id | expected | got | drift | reasoning_pattern |
|----|----------|-----|-------|-------------------|
| PENDING keyed run — paste runner output here | | | | |

mean_drift = PENDING  max_drift = PENDING

## Decision

- [ ] PASS (mean <= 0.25, max <= 0.5) — keep the configured grader.
- [ ] If Opus was under test and PASSED: flip ANTHROPIC_GRADING_MODEL to the Opus id (one-line env change) AND confirm the Claude request-shape rebuild (drop temperature, output_config.format, refusal handling) is live in @/lib/ai/claude.
- [ ] If FAIL: DEFAULT stands — keep claude-sonnet-4-6 + GPT-4o fallback. Do NOT adopt Opus.

**Committed default:** claude-sonnet-4-6 (Sonnet) primary / gpt-4o fallback unless this spike flips it.

## Notes

- `tsx` is confirmed available as a devDependency (4.22.4) — no install needed.
- The `gradeOpenResponse` import is lazy-init safe: no SDK objects are constructed
  at module load time (Foundation wrappers are lazy-init per C18). The runner will
  not throw at import time without keys; it will throw only when the first API call
  is made.
- Barb confirmation of `expected_score` values is a carry-forward action for the
  keyed run. The fixture scores are hand-graded by the engineering team and serve
  as the initial calibration baseline. If Barb adjusts any score, re-run the spike
  before committing the grader.
- Expected_scores used: spike-1=1.0 (messy-but-correct), spike-2=0.0 (misconception),
  spike-3=0.0 (blank/idk), spike-4=1.0 (full reasoning with evidence),
  spike-5=0.5 (partial, no density link).
