import { describe, it, expect } from 'vitest';
import { buildTeliSystemPrompt, RUNG_INSTRUCTIONS } from '@/lib/teli/prompt';
const base = { taskDescription: 'Explain why ice floats on water.', studentResponse: 'because its cold' };
describe('buildTeliSystemPrompt', () => {
  it('embeds the task + the never-reveal contract + the thinking-move directive', () => {
    const p = buildTeliSystemPrompt({ ...base, rung: 'nudge', isHelpRequest: true });
    expect(p).toContain('Explain why ice floats on water.');
    expect(p.toLowerCase()).toContain('never');
    expect(p.toLowerCase()).toContain('thinking move');
  });
  it('includes the active rung instruction only on a help request', () => {
    expect(buildTeliSystemPrompt({ ...base, rung: 'step', isHelpRequest: true })).toContain(RUNG_INSTRUCTIONS.step);
    expect(buildTeliSystemPrompt({ ...base, rung: null, isHelpRequest: false })).not.toContain(RUNG_INSTRUCTIONS.step);
  });
  it('NEVER contains an answer key', () => {
    const p = buildTeliSystemPrompt({ ...base, rung: 'encourage', isHelpRequest: true });
    expect(p.toLowerCase()).not.toContain('correct answer:');
    expect(p.toLowerCase()).not.toContain('answer key');
  });
  it('passes the student\'s own work through', () => {
    expect(buildTeliSystemPrompt({ ...base, rung: 'cue', isHelpRequest: true })).toContain('because its cold');
  });
  it('folds in personalization when provided', () => {
    const p = buildTeliSystemPrompt({ ...base, rung: 'nudge', isHelpRequest: true, studentContext: { learningStyle: 'visual' } });
    expect(p.toLowerCase()).toContain('visual');
  });
});
