import { describe, it, expect } from 'vitest';
import { HUMANITIES_TEMPLATE, STEM_TEMPLATE, getTemplate, totalPoints, totalMinutes } from '@/lib/chapters/chapterTemplates';

describe('HUMANITIES_TEMPLATE', () => {
  it('has exactly 5 sections ordered 1-5', () => {
    expect(HUMANITIES_TEMPLATE.sections).toHaveLength(5);
    HUMANITIES_TEMPLATE.sections.forEach((s, i) => expect(s.order).toBe(i + 1));
  });
  it('total_minutes == 44 (sum of section time_minutes)', () => {
    expect(totalMinutes(HUMANITIES_TEMPLATE)).toBe(44);
  });
  it('total_points == 60 (sum of section total_points)', () => {
    expect(totalPoints(HUMANITIES_TEMPLATE)).toBe(60);
  });
  it('section 1 is vocabulary / foundational / 10pt / 8min / 6 questions', () => {
    const s = HUMANITIES_TEMPLATE.sections[0];
    expect(s.kind).toBe('vocabulary');
    expect(s.power_skill).toBe('foundational');
    expect(s.total_points).toBe(10);
    expect(s.time_minutes).toBe(8);
    expect(s.question_count).toBe(6);
  });
  it('section 5 is mini_essay / communicate / 10pt / 8min / 1 question', () => {
    const s = HUMANITIES_TEMPLATE.sections[4];
    expect(s.kind).toBe('mini_essay');
    expect(s.power_skill).toBe('communicate');
    expect(s.total_points).toBe(10);
    expect(s.question_count).toBe(1);
  });
});

describe('STEM_TEMPLATE', () => {
  it('sections 1-4 are identical to humanities (content shift only at gen time)', () => {
    for (let i = 0; i < 4; i++) {
      expect(STEM_TEMPLATE.sections[i]).toEqual(HUMANITIES_TEMPLATE.sections[i]);
    }
  });
  it('section 5 is multi_step_problem / think / 10pt / 8min / 1 question', () => {
    const s = STEM_TEMPLATE.sections[4];
    expect(s.kind).toBe('multi_step_problem');
    expect(s.power_skill).toBe('think');
    expect(s.total_points).toBe(10);
    expect(s.question_count).toBe(1);
  });
  it('total_minutes == 44 and total_points == 60', () => {
    expect(totalMinutes(STEM_TEMPLATE)).toBe(44);
    expect(totalPoints(STEM_TEMPLATE)).toBe(60);
  });
});

describe('getTemplate', () => {
  it('returns HUMANITIES_TEMPLATE for "humanities"', () => { expect(getTemplate('humanities')).toBe(HUMANITIES_TEMPLATE); });
  it('returns STEM_TEMPLATE for "stem"', () => { expect(getTemplate('stem')).toBe(STEM_TEMPLATE); });
});
