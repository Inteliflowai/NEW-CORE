// src/lib/insights/__tests__/classComprehension.test.ts
import { describe, it, expect } from 'vitest';
import { clBucketOf, classComprehensionIndex, classTrendDirection } from '@/lib/insights/classComprehension';

describe('clBucketOf', () => {
  it('maps the 6 states to 3 buckets (+null for not-assessed)', () => {
    expect(clBucketOf('needs_different_instruction')).toBe('reinforce');
    expect(clBucketOf('needs_more_time')).toBe('reinforce');
    expect(clBucketOf('on_track')).toBe('on_track');
    expect(clBucketOf('ready_to_extend')).toBe('enrich');
    expect(clBucketOf('insufficient_data')).toBeNull();
    expect(clBucketOf('not_attempted')).toBeNull();
  });
});

describe('classComprehensionIndex', () => {
  it('is the share (0-100) of ASSESSED states that are solid (on_track|enrich)', () => {
    expect(classComprehensionIndex([
      'on_track', 'ready_to_extend', 'needs_more_time', 'needs_different_instruction',
      'insufficient_data', 'not_attempted',
    ])).toBe(50);
  });
  it('returns null when nothing is assessed', () => {
    expect(classComprehensionIndex(['insufficient_data', 'not_attempted'])).toBeNull();
    expect(classComprehensionIndex([])).toBeNull();
  });
});

describe('classTrendDirection', () => {
  it('climbing when the last third beats the first third by > 3', () => {
    expect(classTrendDirection([40, 45, 50, 70, 80])).toBe('climbing');
  });
  it('sliding when it drops by > 3', () => {
    expect(classTrendDirection([80, 70, 60, 50, 40])).toBe('sliding');
  });
  it('steady within the threshold', () => {
    expect(classTrendDirection([60, 61, 60, 62, 61])).toBe('steady');
  });
  it('null below 3 points (cold-start)', () => {
    expect(classTrendDirection([60, 80])).toBeNull();
  });
});
