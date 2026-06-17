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

describe('0005 skills', () => {
  const s = () => sql('0005_skills.sql');
  it('creates skills + skill_learning_state + linkage columns', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.skills/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.skill_learning_state/);
    expect(s()).toMatch(/ALTER TABLE public\.quiz_questions[\s\S]*ADD COLUMN IF NOT EXISTS skill_id/);
    expect(s()).toMatch(/ALTER TABLE public\.assignments[\s\S]*ADD COLUMN IF NOT EXISTS skill_ids uuid\[\]/);
  });
  it('skill_learning_state CHECK carries exactly the 6 states', () => {
    for (const st of ['needs_different_instruction','needs_more_time','on_track','ready_to_extend','insufficient_data','not_attempted']) {
      expect(s()).toContain(`'${st}'`);
    }
    expect(s()).toMatch(/UNIQUE \(student_id, skill_id\)/);
  });
  it('keeps the idempotent CHECK re-add (072:68-78)', () => {
    expect(s()).toMatch(/DROP CONSTRAINT IF EXISTS skill_learning_state_state_check/);
    expect(s()).toMatch(/ADD CONSTRAINT skill_learning_state_state_check CHECK/);
  });
  it('skill_learning_state is service-role-write only (no authenticated write policy)', () => {
    expect(s()).not.toMatch(/CREATE POLICY[^\n]*skill_learning_state[^\n]*FOR INSERT TO authenticated/);
    expect(s()).toMatch(/GRANT ALL ON public\.skill_learning_state TO authenticated, anon, service_role/);
  });
});

describe('0006 snapshots', () => {
  const s = () => sql('0006_snapshots.sql');

  it('creates student_model_snapshots with the trajectory grain', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.student_model_snapshots/);
    expect(s()).toMatch(/student_id\s+uuid/);
    expect(s()).toMatch(/snapshot_date\s+date/);
  });

  it('carries the six signal fields + schema-version stamp (LIFT 046)', () => {
    for (const c of ['risk_score','avg_hints_per_attempt','divergence_direction','divergence_score','recent_effort_labels','snapshot_schema_version']) {
      expect(s()).toContain(c);
    }
  });

  it('carries the V1 039 base model fields', () => {
    for (const c of ['mastery_band','learning_style','consistency_label','dominant_effort_pattern','avg_score','improvement_4w']) {
      expect(s()).toContain(c);
    }
  });

  it('has UNIQUE (student_id, snapshot_date) — per-week trajectory grain', () => {
    expect(s()).toMatch(/UNIQUE \(student_id, snapshot_date\)/);
  });

  it('enables RLS + grants', () => {
    expect(s()).toMatch(/ALTER TABLE public\.student_model_snapshots ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/GRANT ALL ON public\.student_model_snapshots TO authenticated, anon, service_role/);
  });

  it('uses DROP POLICY IF EXISTS before CREATE POLICY (re-runnable)', () => {
    expect(s()).toMatch(/DROP POLICY IF EXISTS/);
    expect(s()).toMatch(/CREATE POLICY/);
  });

  it('service-role write policy exists (snapshots written by cron, not authenticated)', () => {
    expect(s()).toMatch(/CREATE POLICY[^\n]*sms_service_role_write[^\n]*/);
    expect(s()).toMatch(/TO service_role/);
  });

  it('authenticated users have scoped read policy only (no authenticated write)', () => {
    expect(s()).toMatch(/FOR SELECT\s+TO authenticated/);
    expect(s()).not.toMatch(/FOR INSERT\s+TO authenticated/);
    expect(s()).not.toMatch(/FOR UPDATE\s+TO authenticated/);
  });

  it('has per-student DESC index + partial v2 index (no forward-refs in FK targets)', () => {
    expect(s()).toMatch(/CREATE INDEX IF NOT EXISTS idx_sms_student_date/);
    expect(s()).toMatch(/CREATE INDEX IF NOT EXISTS idx_sms_v2_recent/);
    expect(s()).toMatch(/WHERE snapshot_schema_version = 'v2'/);
  });
});

describe('0007 licensing', () => {
  const s = () => sql('0007_licensing.sql');

  it('creates all five licensing tables', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.school_licenses/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.license_keys/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.license_usage/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.license_events/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.trial_events/);
  });

  it('school_licenses is one-per-school with the status gating enum', () => {
    expect(s()).toMatch(/school_id\s+uuid\s+NOT NULL REFERENCES public\.schools\(id\) UNIQUE/);
    expect(s()).toMatch(/status\s+text\s+NOT NULL CHECK \(status IN \('trialing','active','past_due','suspended','cancelled'\)\)/);
  });

  it('reconciles tier to professional on BOTH tables (spec §2.3 — no bare pro)', () => {
    // Both school_licenses and license_keys must use 'professional', not 'pro'
    const matches = s().match(/CHECK \(tier IN \('essentials','professional','enterprise'\)\)/g);
    expect(matches, 'tier CHECK should appear on both school_licenses and license_keys').toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
    expect(s()).not.toMatch(/CHECK \(tier IN \('essentials', 'pro', 'enterprise'\)\)/);
    expect(s()).not.toContain("'pro'");
  });

  it('keeps seat + trial date columns on school_licenses (LIFT 020+049)', () => {
    expect(s()).toMatch(/student_limit\s+int\s+NOT NULL DEFAULT 300/);
    expect(s()).toMatch(/trial_starts_at\s+timestamptz/);
    expect(s()).toMatch(/trial_ends_at\s+timestamptz/);
    expect(s()).toMatch(/trial_converted\s+bool/);
  });

  it('keeps reserved Stripe columns + override/block jsonb on school_licenses', () => {
    for (const c of ['stripe_customer_id','stripe_subscription_id','feature_overrides','feature_blocks']) {
      expect(s()).toContain(c);
    }
  });

  it('license_keys has allowed_email_domains (anti-piracy domain-lock, LIFT 049)', () => {
    expect(s()).toMatch(/allowed_email_domains\s+jsonb\s+DEFAULT '\[\]'/);
  });

  it('license_keys has signature column (HMAC burn ledger)', () => {
    expect(s()).toMatch(/signature\s+text\s+NOT NULL/);
  });

  it('license_usage has monthly snapshot columns (LIFT 020)', () => {
    expect(s()).toMatch(/UNIQUE\(school_id, month\)/);
    for (const c of ['students_enrolled','active_students','quiz_attempts','hw_submissions','teli_interactions']) {
      expect(s()).toContain(c);
    }
  });

  it('trial_events has the full multi-value event_type CHECK (LIFT 035)', () => {
    const src = s();
    for (const evt of ['trial_signup','first_login','day_25_email_sent','day_30_email_sent','trial_converted','trial_cancelled','manual_nudge_sent','upgrade_clicked']) {
      expect(src).toContain(`'${evt}'`);
    }
  });

  it('activated_via_key_id back-ref added to school_licenses (LIFT 049)', () => {
    expect(s()).toMatch(/activated_via_key_id\s+uuid\s+REFERENCES public\.license_keys\(id\)/);
  });

  it('no forward-refs — FKs only reference schools and users (0001)', () => {
    // Collect all REFERENCES targets; none should reference tables created after 0007
    const refs = s().match(/REFERENCES public\.(\w+)/g) || [];
    for (const ref of refs) {
      const table = ref.replace('REFERENCES public.', '');
      expect(['schools','users','license_keys'], `unexpected forward-ref to ${table}`).toContain(table);
    }
  });

  it('enables RLS on all five tables', () => {
    expect(s()).toMatch(/ALTER TABLE public\.school_licenses ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.license_keys\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.license_usage\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.license_events\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.trial_events\s+ENABLE ROW LEVEL SECURITY/);
  });

  it('uses DROP POLICY IF EXISTS before CREATE POLICY (re-runnable)', () => {
    expect(s()).toMatch(/DROP POLICY IF EXISTS/);
    expect(s()).toMatch(/CREATE POLICY/);
  });

  it('grants ALL to authenticated, anon, service_role on all five tables', () => {
    expect(s()).toMatch(/GRANT ALL ON public\.school_licenses TO authenticated, anon, service_role/);
    expect(s()).toMatch(/GRANT ALL ON public\.license_keys\s+TO authenticated, anon, service_role/);
    expect(s()).toMatch(/GRANT ALL ON public\.license_usage\s+TO authenticated, anon, service_role/);
    expect(s()).toMatch(/GRANT ALL ON public\.license_events\s+TO authenticated, anon, service_role/);
    expect(s()).toMatch(/GRANT ALL ON public\.trial_events\s+TO authenticated, anon, service_role/);
  });
});
