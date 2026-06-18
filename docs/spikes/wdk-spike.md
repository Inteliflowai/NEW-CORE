# WDK Spike — Week 1 (spec §3.6)

**Question:** model the background generation pipeline as a Vercel Workflow DevKit
("use workflow" orchestrator, each engine fn a retryable "use step") — or keep the
proven direct-awaited path?

## Spike steps
- [ ] `npm install workflow` (it is NOT in the scaffold); read `node_modules/workflow/docs/`.
- [ ] Wrap `runGenerationPipeline` as a "use workflow" with parseLesson/generateQuiz as steps.
- [ ] Verify: builds on Next 16.2.9 + React 19.2.4 + Turbopack; steps replay; FatalError
      (refusal/4xx/Zod) vs RetryableError (429/5xx/timeout) map to the §3.5 contract.
- [ ] Confirm the interactive create path is unaffected (stays synchronous/streaming).

## Decision
- [ ] PASS → adopt WDK for background generation + the §7.4 Spark round-trip ONLY.
- [ ] FAIL/uncertain → **DEFAULT stands: src/lib/workflow/generationPipeline.ts (awaited
      + retry/idempotency).** The engine fns are already import-safe step bodies, so adopting
      WDK later is a wrapping change, not a rewrite.

**Committed default:** direct awaited pipeline (the proven path).

## C10 Governing Correction

The awaited default path **delegates retry and terminal classification to the engine
fns' wrappers** — `resilientChatCompletion` already retries on 429/5xx/timeout and
throws `LlmExhaustedError` on exhaustion. The orchestrator (`runGenerationPipeline`)
does NOT swallow `LlmExhaustedError`; it must propagate to the caller/route which
handles the throw.

The §3.6 `FatalError`/`RetryableError` taxonomy is **WDK-only** and materializes
ONLY if the WDK spike passes. These error types are NOT live in the shipped awaited
default. Do not mistake the §3.6 mapping as being active on the current committed
path — it is a future adoption gate, pending the spike described above.

**STATUS: PENDING a dedicated spike in a keyed/experimental branch.** The `workflow`
package has NOT been added to the app. The committed default is
`src/lib/workflow/generationPipeline.ts` (direct awaited pipeline). This decision
record will be updated once the spike is executed in a keyed environment with the
actual build result on Next 16.2.9 + Turbopack. Do NOT fabricate a build result here.
