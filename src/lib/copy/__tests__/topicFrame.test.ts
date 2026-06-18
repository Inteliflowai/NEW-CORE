import { describe, it, expect } from 'vitest';
import { topicFrame } from '@/lib/copy/topicFrame';

describe('topicFrame', () => {
  it('prefixes with "still building: " and title-cases the topic', () => {
    expect(topicFrame('fractions')).toBe('still building: Fractions');
  });

  it('title-cases multi-word topics', () => {
    expect(topicFrame('long division')).toBe('still building: Long Division');
  });

  it('title-cases already-uppercase input correctly', () => {
    expect(topicFrame('FRACTIONS')).toBe('still building: Fractions');
  });

  it('title-cases mixed-case input', () => {
    expect(topicFrame('aLgEbRa')).toBe('still building: Algebra');
  });

  it('handles a single character', () => {
    expect(topicFrame('x')).toBe('still building: X');
  });

  it('handles a topic already in Title Case', () => {
    expect(topicFrame('Long Division')).toBe('still building: Long Division');
  });

  it('trims leading/trailing whitespace before framing', () => {
    expect(topicFrame('  fractions  ')).toBe('still building: Fractions');
  });

  it('never uses the word "struggle" in output', () => {
    const result = topicFrame('fractions');
    expect(result).not.toMatch(/struggle/i);
  });
});
