// src/lib/copy/__tests__/riskBandLabel.test.ts
import { describe, it, expect } from 'vitest';
import { riskBandLabel } from '../riskBandLabel';

describe('riskBandLabel — 0to100 scale (default)', () => {
  it('0 → low', () => expect(riskBandLabel(0)).toBe('low'));
  it('24 → low', () => expect(riskBandLabel(24)).toBe('low'));
  it('25 → medium', () => expect(riskBandLabel(25)).toBe('medium'));
  it('49 → medium', () => expect(riskBandLabel(49)).toBe('medium'));
  it('50 → high', () => expect(riskBandLabel(50)).toBe('high'));
  it('74 → high', () => expect(riskBandLabel(74)).toBe('high'));
  it('75 → critical', () => expect(riskBandLabel(75)).toBe('critical'));
  it('100 → critical', () => expect(riskBandLabel(100)).toBe('critical'));
});

describe('riskBandLabel — explicit 0to100 scale', () => {
  it('0 → low', () => expect(riskBandLabel(0, '0to100')).toBe('low'));
  it('50 → high', () => expect(riskBandLabel(50, '0to100')).toBe('high'));
  it('75 → critical', () => expect(riskBandLabel(75, '0to100')).toBe('critical'));
});

describe('riskBandLabel — 0to1 scale', () => {
  it('0.0 → low', () => expect(riskBandLabel(0.0, '0to1')).toBe('low'));
  it('0.24 → low', () => expect(riskBandLabel(0.24, '0to1')).toBe('low'));
  it('0.25 → medium', () => expect(riskBandLabel(0.25, '0to1')).toBe('medium'));
  it('0.49 → medium', () => expect(riskBandLabel(0.49, '0to1')).toBe('medium'));
  it('0.50 → high', () => expect(riskBandLabel(0.50, '0to1')).toBe('high'));
  it('0.74 → high', () => expect(riskBandLabel(0.74, '0to1')).toBe('high'));
  it('0.75 → critical', () => expect(riskBandLabel(0.75, '0to1')).toBe('critical'));
  it('1.0 → critical', () => expect(riskBandLabel(1.0, '0to1')).toBe('critical'));
});
