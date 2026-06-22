import { describe, it, expect } from 'vitest';
import { heuristicRevealsAnswer, failsSyncGate, namesAThinkingMove } from '@/lib/teli/revealCheck';
describe('reveal-check sync gate', () => {
  it('flags the obvious answer-handing templates', () => {
    expect(heuristicRevealsAnswer('The answer is 42.')).toBe(true);
    expect(heuristicRevealsAnswer('So the correct answer would be photosynthesis.')).toBe(true);
    expect(heuristicRevealsAnswer('Just multiply 7 by 8 to get 56.')).toBe(true);
    expect(heuristicRevealsAnswer('You should write that the mitochondria is the powerhouse.')).toBe(true);
  });
  it('allows genuine Socratic hints, including ones with numbers', () => {
    expect(heuristicRevealsAnswer('What happens to the 2 numbers when you combine them?')).toBe(false);
    expect(heuristicRevealsAnswer('Great start — what is the first thing the leaf needs?')).toBe(false);
  });
  it('fails the gate on diagnostic vocabulary but NOT on bare numbers', () => {
    expect(failsSyncGate('Your score shows you should try again.')).toBe(true);
    expect(failsSyncGate('Try adding the first 3 terms together.')).toBe(false);
  });
  it('allows ordinary K-12 subject vocabulary but still blocks pure assessment/diagnostic jargon', () => {
    // The dashboard leak-guard BANNED_WORDS list over-blocks normal tutoring verbs. The
    // never-reveal wall is the heuristic + the LLM classifier, NOT a subject-word ban — so a
    // clean Socratic hint using these words must pass the sync gate (was wrongly forced 'unsafe').
    expect(failsSyncGate("Let's model this with an equation — what changes?")).toBe(false);
    expect(failsSyncGate('Which variables would you flag as the key ones?')).toBe(false);
    expect(failsSyncGate('What signal in the data shows the trend changing?')).toBe(false);
    expect(failsSyncGate('Notice the threshold where the function changes sign.')).toBe(false);
    expect(failsSyncGate('What is the index of the second term?')).toBe(false);
    // Genuine assessment/diagnostic jargon a tutor should never utter to a student is STILL gated:
    expect(failsSyncGate('Your percentile shows you should try again.')).toBe(true);
    expect(failsSyncGate('Your divergence value there is low.')).toBe(true);
  });
  it('detects whether a reply names a thinking move', () => {
    expect(namesAThinkingMove("Let's separate what we know from what we're solving for.")).toBe(true);
    expect(namesAThinkingMove('What is the first thing the question asks?')).toBe(true); // ends in a question
    expect(namesAThinkingMove('Less dense.')).toBe(false);
  });
});
