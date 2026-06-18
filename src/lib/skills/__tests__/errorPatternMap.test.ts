// src/lib/skills/__tests__/errorPatternMap.test.ts
// Unit tests for toSessionErrorPattern — every branch + null.
import { describe, it, expect } from 'vitest';
import { toSessionErrorPattern } from '../errorPatternMap';

describe('toSessionErrorPattern', () => {
  // ── conceptual branch ────────────────────────────────────────────────
  it('returns conceptual when reasoning_pattern is misconception', () => {
    expect(toSessionErrorPattern({ reasoning_pattern: 'misconception' })).toBe('conceptual');
  });

  it('returns conceptual when error_type is reasoning_gap', () => {
    expect(toSessionErrorPattern({ error_type: 'reasoning_gap' })).toBe('conceptual');
  });

  it('returns conceptual when error_type is vocabulary_confusion', () => {
    expect(toSessionErrorPattern({ error_type: 'vocabulary_confusion' })).toBe('conceptual');
  });

  it('returns conceptual: misconception wins over a non-matching error_type', () => {
    expect(toSessionErrorPattern({ error_type: 'incomplete', reasoning_pattern: 'misconception' })).toBe('conceptual');
  });

  // ── procedural branch ────────────────────────────────────────────────
  it('returns procedural when reasoning_pattern is surface_recall', () => {
    expect(toSessionErrorPattern({ reasoning_pattern: 'surface_recall' })).toBe('procedural');
  });

  it('returns procedural when error_type is incomplete', () => {
    expect(toSessionErrorPattern({ error_type: 'incomplete' })).toBe('procedural');
  });

  it('returns procedural: surface_recall overrides error_type incomplete (both match procedural)', () => {
    expect(toSessionErrorPattern({ error_type: 'incomplete', reasoning_pattern: 'surface_recall' })).toBe('procedural');
  });

  // ── careless branch ──────────────────────────────────────────────────
  it('returns careless when error_type is factual_error', () => {
    expect(toSessionErrorPattern({ error_type: 'factual_error' })).toBe('careless');
  });

  it('returns careless when error_type is misunderstood_question', () => {
    expect(toSessionErrorPattern({ error_type: 'misunderstood_question' })).toBe('careless');
  });

  // ── random branch ─────────────────────────────────────────────────────
  it('returns random when error_type is off_topic', () => {
    expect(toSessionErrorPattern({ error_type: 'off_topic' })).toBe('random');
  });

  it('returns random when error_type is blank', () => {
    expect(toSessionErrorPattern({ error_type: 'blank' })).toBe('random');
  });

  it('returns random when reasoning_pattern is blank_or_off_topic', () => {
    expect(toSessionErrorPattern({ reasoning_pattern: 'blank_or_off_topic' })).toBe('random');
  });

  // ── null (no error signal) branch ─────────────────────────────────────
  it('returns null when both fields are null (no error)', () => {
    expect(toSessionErrorPattern({ error_type: null, reasoning_pattern: null })).toBeNull();
  });

  it('returns null when both fields are undefined', () => {
    expect(toSessionErrorPattern({})).toBeNull();
  });

  it('returns null when error_type is none (full success)', () => {
    expect(toSessionErrorPattern({ error_type: 'none' })).toBeNull();
  });

  it('returns null when reasoning_pattern is full_reasoning', () => {
    expect(toSessionErrorPattern({ reasoning_pattern: 'full_reasoning' })).toBeNull();
  });

  it('returns null when reasoning_pattern is creative_extension', () => {
    expect(toSessionErrorPattern({ reasoning_pattern: 'creative_extension' })).toBeNull();
  });

  it('returns null when reasoning_pattern is partial_reasoning (not mapped)', () => {
    expect(toSessionErrorPattern({ reasoning_pattern: 'partial_reasoning' })).toBeNull();
  });
});
