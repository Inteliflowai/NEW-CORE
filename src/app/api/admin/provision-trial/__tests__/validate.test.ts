/**
 * Unit tests for validateProvisionInput — pure Node, no framework pragma required.
 * Tests: valid input passes; each rejection case returns the right error.
 */
import { describe, it, expect } from 'vitest';
import { validateProvisionInput } from '../validate';

const VALID_BASE = {
  school_name: 'Westfield Academy',
  teacher_email: 'teacher@school.edu',
  teacher_name: 'Jane Smith',
  student_roster: ['Alex Johnson', 'Sofia Martinez'],
  trial_plan: 'pro',
  student_limit: 30,
};

describe('validateProvisionInput — valid input', () => {
  it('passes a fully valid payload', () => {
    const result = validateProvisionInput(VALID_BASE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.school_name).toBe('Westfield Academy');
    expect(result.value.teacher_email).toBe('teacher@school.edu');
    expect(result.value.teacher_name).toBe('Jane Smith');
    expect(result.value.student_roster).toEqual(['Alex Johnson', 'Sofia Martinez']);
    expect(result.value.trial_plan).toBe('pro');
    expect(result.value.student_limit).toBe(30);
  });

  it('trims whitespace from school_name and teacher_name', () => {
    const result = validateProvisionInput({
      ...VALID_BASE,
      school_name: '  Westfield Academy  ',
      teacher_name: '  Jane Smith  ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.school_name).toBe('Westfield Academy');
    expect(result.value.teacher_name).toBe('Jane Smith');
  });

  it('normalises teacher_email to lowercase', () => {
    const result = validateProvisionInput({ ...VALID_BASE, teacher_email: 'Teacher@School.EDU' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.teacher_email).toBe('teacher@school.edu');
  });

  it('defaults trial_plan to "pro" when omitted', () => {
    const { trial_plan: _omit, ...rest } = VALID_BASE;
    const result = validateProvisionInput(rest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trial_plan).toBe('pro');
  });

  it('defaults student_limit to 300 when omitted', () => {
    const { student_limit: _omit, ...rest } = VALID_BASE;
    const result = validateProvisionInput(rest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.student_limit).toBe(300);
  });

  it('accepts optional parent field when valid email', () => {
    const result = validateProvisionInput({ ...VALID_BASE, parent: 'parent@home.com' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parent).toBe('parent@home.com');
  });
});

describe('validateProvisionInput — missing required fields', () => {
  it('rejects missing school_name', () => {
    const { school_name: _omit, ...rest } = VALID_BASE;
    const result = validateProvisionInput(rest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/school_name/);
  });

  it('rejects empty school_name', () => {
    const result = validateProvisionInput({ ...VALID_BASE, school_name: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/school_name/);
  });

  it('rejects missing teacher_email', () => {
    const { teacher_email: _omit, ...rest } = VALID_BASE;
    const result = validateProvisionInput(rest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/teacher_email/);
  });

  it('rejects missing teacher_name', () => {
    const { teacher_name: _omit, ...rest } = VALID_BASE;
    const result = validateProvisionInput(rest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/teacher_name/);
  });
});

describe('validateProvisionInput — email validation', () => {
  it('rejects a malformed email (no @)', () => {
    const result = validateProvisionInput({ ...VALID_BASE, teacher_email: 'notanemail' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/teacher_email/);
  });

  it('rejects email with no TLD (no dot after @)', () => {
    const result = validateProvisionInput({ ...VALID_BASE, teacher_email: 'user@domain' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/teacher_email/);
  });

  it('rejects email with spaces', () => {
    const result = validateProvisionInput({ ...VALID_BASE, teacher_email: 'user @school.edu' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/teacher_email/);
  });
});

describe('validateProvisionInput — student_roster validation', () => {
  it('rejects an empty array', () => {
    const result = validateProvisionInput({ ...VALID_BASE, student_roster: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/student_roster/);
  });

  it('rejects a non-array value', () => {
    const result = validateProvisionInput({ ...VALID_BASE, student_roster: 'Alex Johnson' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/student_roster/);
  });

  it('rejects a roster with an empty-string entry', () => {
    const result = validateProvisionInput({ ...VALID_BASE, student_roster: ['Alex', '', 'Sofia'] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/student_roster/);
  });
});

describe('validateProvisionInput — length caps (absurd values)', () => {
  it('rejects school_name over 200 chars', () => {
    const result = validateProvisionInput({ ...VALID_BASE, school_name: 'A'.repeat(201) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/school_name/);
  });

  it('rejects teacher_email over 254 chars', () => {
    // 249 local chars + '@x.edu' (6) = 255 chars — over the 254 RFC limit
    const local = 'a'.repeat(249);
    const result = validateProvisionInput({ ...VALID_BASE, teacher_email: `${local}@x.edu` });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/teacher_email/);
  });

  it('rejects student_limit over 10000', () => {
    const result = validateProvisionInput({ ...VALID_BASE, student_limit: 10_001 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/student_limit/);
  });

  it('rejects invalid trial_plan value', () => {
    const result = validateProvisionInput({ ...VALID_BASE, trial_plan: 'ultra' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/trial_plan/);
  });
});
