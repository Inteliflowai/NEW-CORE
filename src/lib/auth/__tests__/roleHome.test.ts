import { describe, it, expect } from 'vitest';
import { ROLE_HOME, homeForRole } from '../roleHome';

describe('roleHome', () => {
  it('maps every DB role to a path', () => {
    expect(ROLE_HOME.teacher).toBe('/today');
    expect(ROLE_HOME.platform_admin).toBe('/provision');
    expect(ROLE_HOME.school_admin).toBe('/admin/dashboard');
    expect(ROLE_HOME.school_sysadmin).toBe('/admin/dashboard');
    expect(ROLE_HOME.student).toBe('/student/dashboard');
    expect(ROLE_HOME.parent).toBe('/parent/dashboard');
  });

  it('homeForRole returns the mapped path for a known role', () => {
    expect(homeForRole('teacher')).toBe('/today');
    expect(homeForRole('platform_admin')).toBe('/provision');
  });

  it('homeForRole falls back to /login for null/unknown', () => {
    expect(homeForRole(null)).toBe('/login');
    expect(homeForRole(undefined)).toBe('/login');
    expect(homeForRole('nope')).toBe('/login');
  });
});
