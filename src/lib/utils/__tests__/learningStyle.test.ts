// src/lib/utils/__tests__/learningStyle.test.ts
// Tests for normalizeLearningStyle — the write-boundary DB normalizer (C6).
// Only tests the normalizer — no i18n/display helpers are lifted into V2.
import { describe, it, expect } from 'vitest';
import { normalizeLearningStyle } from '@/lib/utils/learningStyle';

describe('normalizeLearningStyle', () => {
  // ── alias → canonical ──────────────────────────────────────────────────────
  it('read_write → text', () => {
    expect(normalizeLearningStyle('read_write')).toBe('text');
  });

  it('read/write → text', () => {
    expect(normalizeLearningStyle('read/write')).toBe('text');
  });

  it('read-write → text', () => {
    expect(normalizeLearningStyle('read-write')).toBe('text');
  });

  it('readwrite → text', () => {
    expect(normalizeLearningStyle('readwrite')).toBe('text');
  });

  it('tactile → kinesthetic', () => {
    expect(normalizeLearningStyle('tactile')).toBe('kinesthetic');
  });

  // ── accepted pass-through values ──────────────────────────────────────────
  it('visual → visual', () => {
    expect(normalizeLearningStyle('visual')).toBe('visual');
  });

  it('auditory → auditory', () => {
    expect(normalizeLearningStyle('auditory')).toBe('auditory');
  });

  it('text → text', () => {
    expect(normalizeLearningStyle('text')).toBe('text');
  });

  it('kinesthetic → kinesthetic', () => {
    expect(normalizeLearningStyle('kinesthetic')).toBe('kinesthetic');
  });

  it('social → social', () => {
    expect(normalizeLearningStyle('social')).toBe('social');
  });

  it('emerging → emerging', () => {
    expect(normalizeLearningStyle('emerging')).toBe('emerging');
  });

  // ── null / empty / garbage → emerging ─────────────────────────────────────
  it('empty string → emerging', () => {
    expect(normalizeLearningStyle('')).toBe('emerging');
  });

  it('null → emerging', () => {
    expect(normalizeLearningStyle(null)).toBe('emerging');
  });

  it('undefined → emerging', () => {
    expect(normalizeLearningStyle(undefined)).toBe('emerging');
  });

  it('garbage string → emerging', () => {
    expect(normalizeLearningStyle('foobar123')).toBe('emerging');
  });

  it('case-insensitive: VISUAL → visual', () => {
    expect(normalizeLearningStyle('VISUAL')).toBe('visual');
  });

  it('case-insensitive: Read_Write → text', () => {
    expect(normalizeLearningStyle('Read_Write')).toBe('text');
  });
});
