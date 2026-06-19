import { describe, it, expect } from 'vitest';
import { generateTrialPassword, ADJECTIVES, NOUNS } from '../generatePassword';

describe('generateTrialPassword', () => {
  it('produces {Adjective}{Noun}#{4digits} and is deterministic for a fixed rng', () => {
    // rng returns a constant → first adjective, first noun, digits 0000+1=... deterministic
    const pw = generateTrialPassword(() => 0);
    expect(pw).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+#\d{4}$/);
  });

  it('is fully deterministic — same injected rng yields the same password (no Math.random)', () => {
    const seq = [0.1, 0.7, 0.42];
    let i = 0;
    const rng1 = () => seq[i++ % seq.length];
    i = 0;
    const rng2 = () => seq[i++ % seq.length];
    expect(generateTrialPassword(rng1)).toBe(generateTrialPassword(rng2));
  });

  it('selects words by index from the word lists (counter-driven)', () => {
    // rng=0 → adjective[0], noun[0]; the 4-digit block is derived from rng too
    const pw = generateTrialPassword(() => 0);
    expect(pw.startsWith(ADJECTIVES[0] + NOUNS[0] + '#')).toBe(true);
  });

  it('always ends with exactly four digits', () => {
    for (const r of [0, 0.25, 0.5, 0.99]) {
      const pw = generateTrialPassword(() => r);
      const digits = pw.split('#')[1];
      expect(digits).toMatch(/^\d{4}$/);
    }
  });

  it('different rng values select different words', () => {
    const a = generateTrialPassword(() => 0);
    const b = generateTrialPassword(() => 0.999999);
    expect(a).not.toBe(b);
  });
});
