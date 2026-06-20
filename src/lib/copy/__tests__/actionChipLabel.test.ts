import { describe, it, expect } from 'vitest';
import { actionChipLabel } from '../actionChipLabel';

describe('actionChipLabel', () => {
  it('maps each action to label+tone', () => {
    expect(actionChipLabel('reteach')).toEqual({ label: 'reteach now', tone: 'risk' });
    expect(actionChipLabel('verbal_check')).toEqual({ label: 'check in', tone: 'warn' });
    expect(actionChipLabel('practice')).toEqual({ label: 'practice', tone: 'warn' });
    expect(actionChipLabel('profile')).toEqual({ label: 'look closer', tone: 'brand' });
    expect(actionChipLabel('monitor')).toEqual({ label: 'watch', tone: 'brand' });
  });
});
