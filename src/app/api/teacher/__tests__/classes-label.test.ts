import { describe, it, expect } from 'vitest';
import { formatClassLabel } from '@/app/api/teacher/classes/route';

describe('formatClassLabel', () => {
  it('joins name + period', () =>
    expect(formatClassLabel({ name: 'Algebra I', period: '3' })).toBe('Algebra I — Period 3'));
  it('omits period when absent', () =>
    expect(formatClassLabel({ name: 'Algebra I', period: null })).toBe('Algebra I'));
});
