// ============================================================
// scripts/eval/runner.ts — Core eval runner
//
// Loads corpus files and runs drift scoring per scope. The gate
// short-circuits ("corpus too small") below MIN_TUPLES_FOR_GATE
// tuples/scope — Stage A behavior to avoid blocking PRs while the
// corpus is being populated.
//
// invokeCandidate (Stage B) is exported and unit-tested. It routes
// a tuple into the real src/lib/engine/* fn (grading is wired;
// other scopes defer to a later-plan deliverable). runScope does NOT
// call invokeCandidate — the real drift gate is a later-plan
// deliverable; this task arms only the structural fixture gate
// (non-empty corpus).
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

/** Candidate invoker type used by runScope (optional; runScope ignores it — structural
 *  fixture gate only; real drift gate is a later-plan deliverable). */
export type InvokeCandidate = (tuple: EvalTuple) => Promise<unknown>;

/** Stage B: route a tuple into the real import-safe lib/engine fn (spec §11.3/§3.4).
 *  Uses dynamic import so loading runner.ts never eagerly loads grading→openai/claude,
 *  preserving the keyless-tsx import-safety guarantee (C18b).
 *  Grading is wired here; remaining scopes defer until their engine fns land.
 *  NOTE: runScope does NOT call this — it is exported and unit-tested only. */
export async function invokeCandidate(scope: EvalScope, tuple: EvalTuple): Promise<unknown> {
  switch (scope) {
    case 'grading': {
      const t = tuple as import('./types').GradingEvalTuple;
      const { gradeOpenResponse } = await import('../../src/lib/engine/grading');
      return gradeOpenResponse({
        questionText: t.input.question,
        rubric: t.input.rubric,
        response: t.input.student_response,
      });
    }
    default:
      throw new Error(`invokeCandidate: scope "${scope}" not yet wired (engine fn is a later-plan deliverable)`);
  }
}

export function runScope(scope: EvalScope, _invokeCandidate?: InvokeCandidate): RunReport { // eslint-disable-line @typescript-eslint/no-unused-vars
  const corpus = loadCorpus(scope);
  const ran_at = new Date().toISOString();
  if (corpus.length < MIN_TUPLES_FOR_GATE) {
    console.warn(`[eval] ${scope}: corpus below MIN_TUPLES=${MIN_TUPLES_FOR_GATE} (${corpus.length}) — short-circuit PASS, NOT real coverage`);
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
