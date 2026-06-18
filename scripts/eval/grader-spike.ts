// scripts/eval/grader-spike.ts
// Week-1 grader spike (spec §3.1/§10.5). Runs the CURRENTLY-CONFIGURED grader
// (CLAUDE_GRADING_MODEL via the engine fn) against hand-graded OEQs. Decides
// Opus-vs-keep-Sonnet/GPT. Needs ANTHROPIC_API_KEY + OPENAI_API_KEY in env.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gradeOpenResponse } from '../../src/lib/engine/grading';
import { CLAUDE_GRADING_MODEL } from '../../src/lib/ai/models';

interface Item { id: string; question: string; rubric: string; response: string; expected_score: number; note: string; }

async function main() {
  const items: Item[] = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/eval/fixtures/grader-spike.json'), 'utf8'));
  console.log(`[grader-spike] model=${CLAUDE_GRADING_MODEL} items=${items.length}\n`);
  let totalDrift = 0; let maxDrift = 0;
  for (const it of items) {
    const g = await gradeOpenResponse({ questionText: it.question, rubric: it.rubric, response: it.response });
    const drift = Math.abs(g.score - it.expected_score);
    totalDrift += drift; maxDrift = Math.max(maxDrift, drift);
    console.log(`${it.id}: expected=${it.expected_score} got=${g.score} drift=${drift.toFixed(2)} pattern=${g.reasoning_pattern} — ${it.note}`);
  }
  const mean = totalDrift / items.length;
  const pass = mean <= 0.25 && maxDrift <= 0.5;
  console.log(`\n[grader-spike] mean_drift=${mean.toFixed(3)} max_drift=${maxDrift.toFixed(2)} → ${pass ? 'PASS' : 'FAIL'}`);
  process.exit(pass ? 0 : 1);
}
main();
