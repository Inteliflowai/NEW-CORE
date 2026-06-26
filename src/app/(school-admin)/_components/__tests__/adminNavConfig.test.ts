import { describe, it, expect } from 'vitest';
import { adminNavEntries, pageTitleFor } from '@/app/(school-admin)/_components/adminNavConfig';

function hrefs(entries: ReturnType<typeof adminNavEntries>): string[] {
  return entries.flatMap((e) => ('items' in e ? e.items.map((i) => i.href) : [e.href]));
}

describe('adminNavEntries', () => {
  it('omits Student Attention for IT (no pedagogy capability)', () => {
    expect(hrefs(adminNavEntries(false))).not.toContain('/admin/students');
    expect(hrefs(adminNavEntries(false))).toEqual(expect.arrayContaining(['/admin/overview', '/admin/teachers', '/admin/classes', '/admin/analytics', '/admin/reports']));
  });
  it('includes Student Attention for the academic head', () => {
    expect(hrefs(adminNavEntries(true))).toContain('/admin/students');
  });
});

describe('pageTitleFor', () => {
  it('maps known admin routes', () => {
    expect(pageTitleFor('/admin/overview')).toBe('Overview');
    expect(pageTitleFor('/admin/classes')).toBe('Classes & Roster');
    expect(pageTitleFor('/admin/students')).toBe('Student Attention');
    expect(pageTitleFor('/something-else')).toBe('CORE');
  });
});
