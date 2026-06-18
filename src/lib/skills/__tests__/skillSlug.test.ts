// src/lib/skills/__tests__/skillSlug.test.ts
import { describe, it, expect } from 'vitest';
import { slugifySkillTag, skillDisplayName, normalizeSubject } from '../skillSlug';

describe('slugifySkillTag', () => {
  it('lowercases input', () => {
    expect(slugifySkillTag('Decimal Operations')).toBe('decimal_operations');
  });

  it('strips combining accents (NFD normalization)', () => {
    expect(slugifySkillTag('Multiplicação')).toBe('multiplicacao');
    expect(slugifySkillTag('fração')).toBe('fracao');
    expect(slugifySkillTag('décimal')).toBe('decimal');
  });

  it('apostrophes vanish (do not split)', () => {
    expect(slugifySkillTag("doesn't")).toBe('doesnt');
    expect(slugifySkillTag("l'addition")).toBe('laddition');
    expect(slugifySkillTag('it’s')).toBe('its');
  });

  it('collapses non-alnum runs to single underscore', () => {
    expect(slugifySkillTag('a  b')).toBe('a_b');
    expect(slugifySkillTag('a--b')).toBe('a_b');
    expect(slugifySkillTag('a!@#b')).toBe('a_b');
  });

  it('trims leading and trailing underscores', () => {
    expect(slugifySkillTag('  leading')).toBe('leading');
    expect(slugifySkillTag('trailing  ')).toBe('trailing');
    expect(slugifySkillTag('---both---')).toBe('both');
  });

  it('caps at 80 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugifySkillTag(long)).toHaveLength(80);
  });

  it('already-snake-case tag passes through unchanged', () => {
    expect(slugifySkillTag('decimal_ops')).toBe('decimal_ops');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(slugifySkillTag('   ')).toBe('');
  });

  it('handles empty string', () => {
    expect(slugifySkillTag('')).toBe('');
  });
});

describe('skillDisplayName', () => {
  it('trims outer whitespace', () => {
    expect(skillDisplayName('  Fractions  ')).toBe('Fractions');
  });

  it('collapses internal whitespace to single space', () => {
    expect(skillDisplayName('Decimal   Operations')).toBe('Decimal Operations');
  });

  it('caps at 120 characters', () => {
    const long = 'A '.repeat(70); // 140 chars
    expect(skillDisplayName(long)).toHaveLength(120);
  });

  it('preserves original casing', () => {
    expect(skillDisplayName('Multiplicação de Frações')).toBe('Multiplicação de Frações');
  });
});

describe('normalizeSubject', () => {
  it('returns trimmed string for normal input', () => {
    expect(normalizeSubject('Math')).toBe('Math');
  });

  it('returns null for empty string', () => {
    expect(normalizeSubject('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(normalizeSubject('   ')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizeSubject(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizeSubject(undefined)).toBeNull();
  });

  it('trims surrounding whitespace before returning', () => {
    expect(normalizeSubject('  Math  ')).toBe('Math');
  });
});
