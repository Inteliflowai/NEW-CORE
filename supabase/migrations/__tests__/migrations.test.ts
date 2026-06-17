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

describe('0002 classes_enrollments', () => {
  const s = () => sql('0002_classes_enrollments.sql');

  it('creates classes + enrollments with the unique seat key', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.classes/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.enrollments/);
    expect(s()).toMatch(/UNIQUE\(class_id, student_id\)/);
  });

  it('ports the seat-enforcement trigger (LIFT 049, references active license)', () => {
    expect(s()).toMatch(/FUNCTION public\.enforce_enrollment_limit\(\)[\s\S]*SECURITY DEFINER/);
    expect(s()).toMatch(/status = 'active'/);
    expect(s()).toMatch(/CREATE TRIGGER trg_enforce_enrollment_limit\s+BEFORE INSERT ON public\.enrollments/);
  });

  it('has the to_regclass guard so 0002 is inert until 0007 creates school_licenses', () => {
    expect(s()).toMatch(/to_regclass\('public\.school_licenses'\) IS NULL THEN RETURN NEW/);
  });

  it('defines the 3 enrollment/class SECURITY DEFINER helpers (after tables, before policies)', () => {
    expect(s()).toMatch(/FUNCTION public\.get_teacher_student_ids\([\s\S]*\)[\s\S]*SECURITY DEFINER/);
    expect(s()).toMatch(/FUNCTION public\.get_teacher_class_ids\([\s\S]*\)[\s\S]*SECURITY DEFINER/);
    expect(s()).toMatch(/FUNCTION public\.get_student_class_ids\([\s\S]*\)[\s\S]*SECURITY DEFINER/);
  });

  it('policy enrollments_school_read appears after get_teacher_class_ids definition (no forward-ref)', () => {
    const src = s();
    const helperPos = src.indexOf('FUNCTION public.get_teacher_class_ids');
    const policyPos = src.indexOf('enrollments_school_read');
    expect(helperPos, 'get_teacher_class_ids not found').toBeGreaterThan(-1);
    expect(policyPos, 'enrollments_school_read policy not found').toBeGreaterThan(-1);
    expect(policyPos, 'policy must appear after helper').toBeGreaterThan(helperPos);
  });

  it('enables RLS + grants', () => {
    expect(s()).toMatch(/ALTER TABLE public\.classes\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.enrollments ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/GRANT ALL ON public\.classes\s+TO authenticated, anon, service_role/);
    expect(s()).toMatch(/GRANT ALL ON public\.enrollments TO authenticated, anon, service_role/);
  });

  it('uses DROP POLICY IF EXISTS before CREATE POLICY (re-runnable)', () => {
    expect(s()).toMatch(/DROP POLICY IF EXISTS/);
    expect(s()).toMatch(/CREATE POLICY/);
  });

  it('classes table has all V1 columns including google_grade_sync_enabled, enrollment_count', () => {
    expect(s()).toMatch(/google_course_id\s+text/);
    expect(s()).toMatch(/google_grade_sync_enabled\s+boolean/);
    expect(s()).toMatch(/google_feed_enabled\s+boolean/);
    expect(s()).toMatch(/enrollment_count\s+int/);
  });
});

describe('0003 lessons_quizzes', () => {
  const s = () => sql('0003_lessons_quizzes.sql');

  it('creates the 5 tables', () => {
    for (const t of ['lessons','quizzes','quiz_questions','quiz_attempts','quiz_responses']) {
      expect(s()).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`));
    }
  });

  it('uses the real V1 enums (lesson status, question_type, mastery_band)', () => {
    expect(s()).toMatch(/status\s+text\s+DEFAULT 'draft' CHECK \(status IN \('draft','pending_review','approved','published','archived'\)\)/);
    expect(s()).toMatch(/question_type\s+text NOT NULL CHECK \(question_type IN \('mcq','open'\)\)/);
    expect(s()).toMatch(/mastery_band\s+text\s+CHECK \(mastery_band IN \('reteach','grade_level','advanced'\)\)/);
  });

  it('quiz_responses carries the cognitive + behavioral telemetry columns', () => {
    for (const c of ['cognitive_notes','response_time_ms','hesitation_ms','answer_changes','navigation_backs','pause_count','total_pause_ms','word_count']) {
      expect(s()).toContain(c);
    }
  });

  it('enables RLS + grants on quiz_responses', () => {
    expect(s()).toMatch(/ALTER TABLE public\.quiz_responses ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/GRANT ALL ON public\.quiz_responses TO authenticated, anon, service_role/);
  });
});

describe('0004 assignments_homework', () => {
  const s = () => sql('0004_assignments_homework.sql');
  it('creates assignments + homework_attempts', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.assignments/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.homework_attempts/);
  });
  it('assignments has content NOT NULL + mastery_band enum', () => {
    expect(s()).toMatch(/content\s+jsonb\s+NOT NULL/);
    expect(s()).toMatch(/mastery_band\s+text\s+CHECK \(mastery_band IN \('reteach','grade_level','advanced'\)\)/);
  });
  it('homework_attempts carries the gap-signal columns', () => {
    for (const c of ['score_pct','ai_feedback','teli_hint_count','submitted_on_time']) {
      expect(s()).toContain(c);
    }
  });
  it('enables RLS + grants', () => {
    expect(s()).toMatch(/ALTER TABLE public\.homework_attempts\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/GRANT ALL ON public\.assignments\s+TO authenticated, anon, service_role/);
  });
});
