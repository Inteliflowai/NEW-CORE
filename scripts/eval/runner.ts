// ============================================================
// scripts/eval/runner.ts — Core eval runner
//
// Loads corpus files and runs drift scoring per scope. The gate
// short-circuits ("corpus too small") below MIN_TUPLES_FOR_GATE
// tuples/scope — Stage A behavior to avoid blocking PRs while the
// corpus is being populated.
//
// invokeCandidate is optional and unused in Stage A — it will be
// wired against import-safe src/lib/engine/* functions in a later
// plan (spec §1.11/§3.4).
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_SCOPES, type EvalScope, type EvalTuple, type RunReport } from './types';

/** V1 activates the gate at >=50 tuples/scope (v1-mining-findings.md item 7). */
export const MIN_TUPLES_FOR_GATE = 50;

const CORPUS_DIR = resolve(process.cwd(), 'scripts/eval/corpus');

export function loadCorpus(scope: EvalScope): EvalTuple[] {
  const file = resolve(CORPUS_DIR, `${scope}.json`);
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? (parsed as EvalTuple[]) : [];
}

/** Candidate invoker is wired against import-safe src/lib/engine/* in a later plan
 *  (spec §1.11/§3.4). Optional now so the harness runs green with an empty corpus. */
export type InvokeCandidate = (tuple: EvalTuple) => Promise<unknown>;

export function runScope(scope: EvalScope, _invokeCandidate?: InvokeCandidate): RunReport { // eslint-disable-line @typescript-eslint/no-unused-vars
  const corpus = loadCorpus(scope);
  const ran_at = new Date().toISOString();
  if (corpus.length < MIN_TUPLES_FOR_GATE) {
    return {
      scope,
      variant_label: 'candidate',
      baseline_label: null,
      ran_at,
      total_tuples: corpus.length,
      tier_counts: { pass: 0, warning: 0, regression: 0 },
      flagged: [],
      mean_drift: 0,
      gate: 'pass',
      gate_reason: `corpus too small (${corpus.length} < MIN_TUPLES=${MIN_TUPLES_FOR_GATE}); gate inactive`,
    };
  }
  // Full drift scoring is a later-plan deliverable; reaching here means a real corpus exists.
  throw new Error(`Drift scoring not implemented for scope "${scope}" (requires src/lib/engine/*)`);
}

export function runAll(invokeCandidate?: InvokeCandidate): RunReport[] {
  return ALL_SCOPES.map(scope => runScope(scope, invokeCandidate));
}
