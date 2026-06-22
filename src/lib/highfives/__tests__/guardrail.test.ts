import { describe, it, expect } from 'vitest';
import { validateHighFive } from '@/lib/highfives/guardrail';

describe('validateHighFive', () => {
  it('passes a specific, named-effort note', () => {
    expect(validateHighFive('Ann, you kept working on the fraction problems even when they got tricky.')).toEqual([]);
  });
  it('flags empty praise', () => {
    expect(validateHighFive('Great job!! Amazing work!').length).toBeGreaterThan(0);
  });
  it('flags a leaked number/percent', () => {
    expect(validateHighFive('You scored 95% — awesome').length).toBeGreaterThan(0);
  });
  it('flags a banned coach-posture word', () => {
    expect(validateHighFive('Your score signal improved').length).toBeGreaterThan(0);
  });
  it('returns suggestions for each violation', () => {
    const v = validateHighFive('Perfect! You got this!');
    expect(v.every((x) => x.suggestion.length > 0)).toBe(true);
  });
});
