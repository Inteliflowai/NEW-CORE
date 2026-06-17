// supabase/migrations/__tests__/migrations.test.ts
// Static SQL-text assertions for migration files.
// No live Postgres — the harness reads the .sql text and asserts schema/RLS
// contracts that every later plan depends on.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = (f: string) =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations', f), 'utf8');

describe('0001 identity_roles', () => {
  const s = () => sql('0001_identity_roles.sql');

  it('creates schools, users, guardians', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.schools/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.users/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.guardians/);
  });

  it('users.role CHECK includes all 6 roles incl. school_sysadmin (spec §1.2)', () => {
    const m = s().match(/role\s+text\s+NOT NULL\s+CHECK \(role IN \(([^)]*)\)\)/);
    expect(m, 'role CHECK constraint not found').toBeTruthy();
    const list = m![1];
    for (const r of ['teacher', 'student', 'parent', 'school_admin', 'school_sysadmin', 'platform_admin']) {
      expect(list, `role '${r}' missing from CHECK`).toContain(`'${r}'`);
    }
  });

  it('defines the 3 safe SECURITY DEFINER RLS helpers (bodies only touch users/schools)', () => {
    expect(s()).toMatch(/FUNCTION public\.is_platform_admin\(\)[\s\S]*SECURITY DEFINER/);
    expect(s()).toMatch(/FUNCTION public\.get_my_school_id\(\)[\s\S]*SECURITY DEFINER/);
    expect(s()).toMatch(/FUNCTION public\.get_my_role\(\)[\s\S]*SECURITY DEFINER/);
  });

  it('does NOT define enrollment/class helpers (they belong in 0002 — forward-ref guard)', () => {
    // These helpers reference enrollments/classes which do not exist until 0002.
    // If they appear here, CREATE at migration time would fail on a fresh DB.
    expect(s()).not.toMatch(/FUNCTION public\.get_teacher_student_ids/);
    expect(s()).not.toMatch(/FUNCTION public\.get_teacher_class_ids/);
    expect(s()).not.toMatch(/FUNCTION public\.get_student_class_ids/);
  });

  it('enables RLS on all three tables', () => {
    expect(s()).toMatch(/ALTER TABLE public\.schools\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.users\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.guardians\s+ENABLE ROW LEVEL SECURITY/);
  });

  it('uses DROP POLICY IF EXISTS before CREATE POLICY (re-runnable)', () => {
    expect(s()).toMatch(/DROP POLICY IF EXISTS/);
    expect(s()).toMatch(/CREATE POLICY/);
  });

  it('grants ALL to authenticated, anon, service_role on every table (Bug #7)', () => {
    expect(s()).toMatch(/GRANT ALL ON public\.schools\s+TO authenticated, anon, service_role/);
    expect(s()).toMatch(/GRANT ALL ON public\.users\s+TO authenticated, anon, service_role/);
    expect(s()).toMatch(/GRANT ALL ON public\.guardians\s+TO authenticated, anon, service_role/);
  });

  it('includes trial columns on schools (LIFT 035)', () => {
    expect(s()).toMatch(/is_trial\s+boolean/);
    expect(s()).toMatch(/trial_started_at\s+timestamptz/);
    expect(s()).toMatch(/trial_expires_at\s+timestamptz/);
    expect(s()).toMatch(/trial_status\s+text/);
    expect(s()).toMatch(/trial_credentials\s+jsonb/);
  });

  it('includes trial columns on users (LIFT 035)', () => {
    expect(s()).toMatch(/is_trial_user\s+boolean/);
    expect(s()).toMatch(/trial_school_id\s+uuid/);
  });

  it('preserves real V1 columns: full_name, email, lift_candidate_id, lift_data', () => {
    expect(s()).toMatch(/full_name\s+text\s+NOT NULL/);
    expect(s()).toMatch(/email\s+text\s+NOT NULL/);
    expect(s()).toMatch(/lift_candidate_id\s+text/);
    expect(s()).toMatch(/lift_data\s+jsonb/);
  });
});
