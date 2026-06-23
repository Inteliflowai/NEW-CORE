import { describe, it, expect } from 'vitest';
import { categoryLabel, clean, distinctValues, groupByCategory } from '@/lib/content/category';

describe('categoryLabel', () => {
  it('uppercases subject and appends a Grade-prefixed grade', () => {
    expect(categoryLabel('Science', '7')).toBe('SCIENCE · GRADE 7');
  });
  it('does not double-prefix when the grade text already says "grade"', () => {
    expect(categoryLabel('Science', '7th grade')).toBe('SCIENCE · 7TH GRADE');
  });
  it('subject only when grade is null', () => {
    expect(categoryLabel('Math', null)).toBe('MATH');
  });
  it('null subject → OTHER (grade ignored when no subject)', () => {
    expect(categoryLabel(null, null)).toBe('OTHER');
    expect(categoryLabel(null, '7')).toBe('OTHER');
  });
  it('treats blank/whitespace subject as null', () => {
    expect(categoryLabel('   ', '8')).toBe('OTHER');
  });
});

describe('distinctValues', () => {
  it('returns trimmed, non-empty, de-duped values alpha-sorted', () => {
    const items = [
      { s: 'Science' }, { s: 'Art' }, { s: 'Science' }, { s: '  ' }, { s: null }, { s: 'Math' },
    ];
    expect(distinctValues(items, (i) => i.s)).toEqual(['Art', 'Math', 'Science']);
  });
});

describe('groupByCategory', () => {
  it('groups by subject · grade, Other last, item order preserved', () => {
    const items = [
      { id: 'a', subject: 'Science', grade_level: '7' },
      { id: 'b', subject: 'Math', grade_level: '8' },
      { id: 'c', subject: null, grade_level: null },
      { id: 'd', subject: 'Science', grade_level: '7' },
      { id: 'e', subject: 'Science', grade_level: '6' },
    ];
    const groups = groupByCategory(items);
    // Math 8 → Science 6 → Science 7 → Other
    expect(groups.map((g) => g.label)).toEqual([
      'MATH · GRADE 8', 'SCIENCE · GRADE 6', 'SCIENCE · GRADE 7', 'OTHER',
    ]);
    const sci7 = groups.find((g) => g.label === 'SCIENCE · GRADE 7')!;
    expect(sci7.items.map((i) => i.id)).toEqual(['a', 'd']); // insertion order preserved
    expect(groups.find((g) => g.label === 'OTHER')!.items.map((i) => i.id)).toEqual(['c']);
  });

  it('a single all-null group still yields one OTHER group', () => {
    const groups = groupByCategory([{ subject: null, grade_level: null }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('OTHER');
  });

  it('orders multi-digit grades numerically (Grade 7 before Grade 10), not lexically', () => {
    const items = [
      { subject: 'Science', grade_level: '10' },
      { subject: 'Science', grade_level: '7' },
      { subject: 'Science', grade_level: '8' },
    ];
    expect(groupByCategory(items).map((g) => g.label)).toEqual([
      'SCIENCE · GRADE 7', 'SCIENCE · GRADE 8', 'SCIENCE · GRADE 10',
    ]);
  });
});

describe('clean (exported for filter normalization)', () => {
  it('trims and maps blank to null', () => {
    expect(clean('  Science  ')).toBe('Science');
    expect(clean('   ')).toBeNull();
    expect(clean(null)).toBeNull();
  });
});

describe('distinctValues numeric ordering', () => {
  it('sorts grade values numerically (7 before 10)', () => {
    const items = [{ g: '10' }, { g: '7' }, { g: '8' }];
    expect(distinctValues(items, (i) => i.g)).toEqual(['7', '8', '10']);
  });
});
