import { describe, it, expect } from 'vitest';
import {
  US_STATES, isUsStateCode, frameworkLabelForState, frameworkShortLabelForState, standardsGuidance,
} from '@/lib/standards/frameworks';

describe('standards/frameworks', () => {
  it('lists 50 states + DC, each with a 2-letter code', () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES.every((s) => /^[A-Z]{2}$/.test(s.code))).toBe(true);
    expect(US_STATES.find((s) => s.code === 'TX')?.name).toBe('Texas');
  });
  it('isUsStateCode is case-insensitive and rejects junk', () => {
    expect(isUsStateCode('ca')).toBe(true);
    expect(isUsStateCode('CA')).toBe(true);
    expect(isUsStateCode('ZZ')).toBe(false);
    expect(isUsStateCode(null)).toBe(false);
    expect(isUsStateCode('')).toBe(false);
  });
  it('maps named-standard states to their framework, others to Common Core + NGSS', () => {
    expect(frameworkLabelForState('TX')).toMatch(/TEKS/);
    expect(frameworkLabelForState('FL')).toMatch(/B\.E\.S\.T/);
    expect(frameworkLabelForState('VA')).toMatch(/SOL|Standards of Learning/);
    expect(frameworkLabelForState('CA')).toMatch(/Common Core/);
    expect(frameworkLabelForState(null)).toMatch(/Common Core/); // national reference fallback
  });
  it('frameworkShortLabelForState returns concise storage/UI labels', () => {
    expect(frameworkShortLabelForState('TX')).toBe('TEKS');
    expect(frameworkShortLabelForState('FL')).toBe('B.E.S.T.');
    expect(frameworkShortLabelForState('VA')).toBe('SOL');
    expect(frameworkShortLabelForState('ca')).toBe('Common Core + NGSS'); // case-insensitive default
    expect(frameworkShortLabelForState(null)).toBe('Common Core + NGSS');
  });
  it('standardsGuidance names the state when known and stays generic when not', () => {
    expect(standardsGuidance('TX')).toMatch(/Texas|TX/);
    expect(standardsGuidance('TX')).toMatch(/propose/i);
    expect(standardsGuidance(null)).toMatch(/generally|US K-12/i);
    expect(standardsGuidance(null)).not.toMatch(/\bnull\b/);
  });
});
