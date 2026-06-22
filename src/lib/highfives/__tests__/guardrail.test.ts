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

  // I3 — four-audience leak classes that reach the student verbatim.
  describe('four-audience leaks', () => {
    it('flags the spelled-out word "percent"', () => {
      expect(validateHighFive('You got ninety percent of them right.').length).toBeGreaterThan(0);
    });
    it('flags band-enum vocabulary', () => {
      for (const t of [
        'You are working above grade level now.',
        'You moved up to advanced this week.',
        'You are proficient on these.',
        'This was a great reteach.',
        'Real mastery here.',
        'You jumped a band.',
        'You were below basic before.',
        'You are at basic now.',
        'No more remedial work for you.',
      ]) {
        expect(validateHighFive(t).length).toBeGreaterThan(0);
      }
    });
    it('does not false-positive on ordinary words that contain a band term', () => {
      // "basics" / "bands" must NOT trip the "basic" / "band" word-boundary patterns.
      expect(validateHighFive('Ann, you nailed the basics by breaking each step apart.')).toEqual([]);
      expect(validateHighFive('Ann, the rubber bands held your bridge together — nice fix.')).toEqual([]);
    });
    it('flags peer-relative framing', () => {
      for (const t of [
        'You were at the top of the class today.',
        'You were the best in the room.',
        'You are ahead of everyone now.',
        'You beat the whole group.',
        'You finished before your classmates.',
        'You did better than half the room.',
        'You worked harder than most of the class.',
        'You scored higher than the rest.',
        'You went faster than others.',
      ]) {
        expect(validateHighFive(t).length).toBeGreaterThan(0);
      }
    });
    it('flags letter grades', () => {
      for (const t of [
        'You got an A on this one.',
        'You got a B today.',
        'You earned an A for that.',
        'You earned a C this time.',
      ]) {
        expect(validateHighFive(t).length).toBeGreaterThan(0);
      }
    });
    it('flags emoji-only / punctuation-only praise', () => {
      for (const t of ['🎉🎉🎉', '!!!', '👏', '...!!', '   👍  ']) {
        expect(validateHighFive(t).length).toBeGreaterThan(0);
      }
    });
    it('does not false-positive on real notes that happen to include emoji or punctuation', () => {
      expect(validateHighFive('Ann, you kept untangling that problem step by step 👏')).toEqual([]);
    });
  });
});
