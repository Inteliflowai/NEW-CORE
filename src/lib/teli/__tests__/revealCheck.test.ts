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
  it('blocks only answer-handing, NOT subject/stats vocabulary (the LLM classifier judges context)', () => {
    // Teli holds NO diagnostic data; the never-reveal wall is the heuristic + the context-aware
    // LLM classifier. A blunt word-ban over-blocked legitimate STEM vocabulary, so the sync gate
    // no longer rejects these — score/percentile/divergence are valid in math/stats/physics work,
    // and the smart classifier (which reads the whole reply) catches any actual reveal in context.
    expect(failsSyncGate('The score of the game was 24 to 21 — what is the difference?')).toBe(false);
    expect(failsSyncGate('Which percentile would the 80th value fall in?')).toBe(false);
    expect(failsSyncGate("Let's test the series for divergence — what do the terms do?")).toBe(false);
    expect(failsSyncGate("Let's model this with an equation — what changes?")).toBe(false);
    expect(failsSyncGate('Which variables would you flag as the key ones?')).toBe(false);
    expect(failsSyncGate('What is the index of the second term?')).toBe(false);
    // Answer-handing is still caught synchronously by the heuristic, with or without numbers:
    expect(failsSyncGate('The answer is 42.')).toBe(true);
    expect(failsSyncGate('Just multiply 7 by 8 to get 56.')).toBe(true);
    expect(failsSyncGate('Try adding the first 3 terms together.')).toBe(false);
  });
  it('detects whether a reply names a thinking move', () => {
    expect(namesAThinkingMove("Let's separate what we know from what we're solving for.")).toBe(true);
    expect(namesAThinkingMove('What is the first thing the question asks?')).toBe(true); // ends in a question
    expect(namesAThinkingMove('Less dense.')).toBe(false);
  });
});
