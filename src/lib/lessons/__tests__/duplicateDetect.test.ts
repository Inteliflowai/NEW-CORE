import { describe, it, expect } from 'vitest';
import { detectDuplicates, tokenize, jaccard } from '@/lib/lessons/duplicateDetect';

describe('duplicateDetect', () => {
  it('jaccard: identical sets = 1, disjoint = 0, both empty = 0 (no signal)', () => {
    expect(jaccard(tokenize('photosynthesis basics'), tokenize('photosynthesis basics'))).toBe(1);
    expect(jaccard(tokenize('fractions'), tokenize('volcanoes'))).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
  it('flags a near-duplicate above threshold (0.6 = 0.6*title + 0.4*tags)', () => {
    const existing = [{ id: 'L1', title: 'Photosynthesis Basics', concept_tags: ['photosynthesis', 'chloroplast'] }];
    const m = detectDuplicates({ title: 'Photosynthesis Basics', concept_tags: ['Photosynthesis', 'light reactions'] }, existing);
    expect(m).toHaveLength(1);
    expect(m[0].lesson.id).toBe('L1');
    expect(m[0].similarity).toBeGreaterThanOrEqual(0.6);
  });
  it('does NOT flag a distinct lesson, and skips the candidate self-id', () => {
    const existing = [{ id: 'L1', title: 'The American Revolution', concept_tags: ['1776'] }];
    expect(detectDuplicates({ title: 'Cellular Respiration', concept_tags: ['ATP'] }, existing)).toHaveLength(0);
    expect(detectDuplicates({ id: 'L1', title: 'The American Revolution', concept_tags: ['1776'] }, existing)).toHaveLength(0);
  });
});
