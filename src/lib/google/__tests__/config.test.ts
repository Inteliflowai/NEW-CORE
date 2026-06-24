import { describe, it, expect } from 'vitest';
import { GC_SCOPES, GC_REQUIRED_SCOPES } from '@/lib/google/config';

describe('google/config scopes', () => {
  it('GC_SCOPES is the 7-scope connect set incl. drive.readonly', () => {
    for (const s of [
      'openid', 'email', 'profile',
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.rosters.readonly',
      'https://www.googleapis.com/auth/classroom.profile.emails',
      'https://www.googleapis.com/auth/classroom.coursework.students',
      'https://www.googleapis.com/auth/classroom.courseworkmaterials',
      'https://www.googleapis.com/auth/drive.readonly',
    ]) expect(GC_SCOPES).toContain(s);
  });
  it('GC_REQUIRED_SCOPES is the write+roster subset (no drive, no login triplet)', () => {
    expect(GC_REQUIRED_SCOPES).not.toContain('https://www.googleapis.com/auth/drive.readonly');
    expect(GC_REQUIRED_SCOPES).not.toContain('openid');
    expect(GC_REQUIRED_SCOPES).toContain('https://www.googleapis.com/auth/classroom.coursework.students');
    expect(GC_REQUIRED_SCOPES).toContain('https://www.googleapis.com/auth/classroom.rosters.readonly');
  });
});
