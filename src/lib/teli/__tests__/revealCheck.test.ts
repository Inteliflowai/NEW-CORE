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
  it('detects whether a reply names a thinking move', () => {
    expect(namesAThinkingMove("Let's separate what we know from what we're solving for.")).toBe(true);
    expect(namesAThinkingMove('What is the first thing the question asks?')).toBe(true); // ends in a question
    expect(namesAThinkingMove('Less dense.')).toBe(false);
  });
});
