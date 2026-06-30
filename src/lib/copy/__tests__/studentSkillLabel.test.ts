import { describe, it, expect } from 'vitest';
import { studentSkillLabel, growthLeadSentence, growthDirectionCopy } from '../studentSkillLabel';
import { hasDiagnosticVocab, hasLeak } from '@/lib/copy/leakGuard';

describe('studentSkillLabel', () => {
  it('maps reteach states to "Building strength"', () => {
    expect(studentSkillLabel('needs_different_instruction')).toBe('Building strength');
    expect(studentSkillLabel('needs_more_time')).toBe('Building strength');
  });

  it('maps on_track to "Solid"', () => {
    expect(studentSkillLabel('on_track')).toBe('Solid');
  });

  it('maps ready_to_extend to "Excelling"', () => {
    expect(studentSkillLabel('ready_to_extend')).toBe('Excelling');
  });

  it('returns null for cold-start states', () => {
    expect(studentSkillLabel('insufficient_data')).toBeNull();
    expect(studentSkillLabel('not_attempted')).toBeNull();
  });

  it('output never contains a CL verb (four-audience gate)', () => {
    const states = ['needs_different_instruction','needs_more_time','on_track','ready_to_extend'] as const;
    for (const s of states) {
      const label = studentSkillLabel(s);
      if (label) {
        expect(hasDiagnosticVocab(label)).toBe(false);
        expect(hasLeak(label)).toBe(false);
      }
    }
  });
});

describe('growthLeadSentence', () => {
  it('returns a string for every direction', () => {
    for (const dir of ['climbing','steady','sliding',null] as const) {
      const s = growthLeadSentence(dir);
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(5);
      expect(hasLeak(s)).toBe(false);
      expect(hasDiagnosticVocab(s)).toBe(false);
    }
  });
});

describe('growthDirectionCopy', () => {
  it('returns a string for every direction', () => {
    for (const dir of ['climbing','steady','sliding',null] as const) {
      const s = growthDirectionCopy(dir);
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(5);
      expect(hasLeak(s)).toBe(false);
      expect(hasDiagnosticVocab(s)).toBe(false);
    }
  });
});
