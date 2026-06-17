/* eslint-disable no-console */
// ============================================================
// scripts/eval/ci.ts — CI entry for the eval rig.
//
// Runs all scopes against the corpus and exits non-zero on
// regression. Stage A behavior: short-circuits with "corpus too
// small" until >= MIN_TUPLES_FOR_GATE promoted tuples exist for a
// scope — avoids blocking PRs while corpus is being built.
// ============================================================

import { runAll } from './runner';

function main() {
  const reports = runAll();
  let regressed = false;
  for (const r of reports) {
    console.log(`[eval] ${r.scope}: gate=${r.gate} tuples=${r.total_tuples} — ${r.gate_reason}`);
    if (r.gate === 'regression') regressed = true;
  }
  process.exit(regressed ? 1 : 0);
}
main();
