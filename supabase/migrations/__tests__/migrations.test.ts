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

  it('users.school_id has ON DELETE CASCADE (cleanup must not leave orphaned users)', () => {
    // The users table school_id FK line must carry ON DELETE CASCADE
    expect(s()).toMatch(/school_id\s+uuid\s+REFERENCES public\.schools\(id\) ON DELETE CASCADE/);
  });

  it('users.trial_school_id has ON DELETE SET NULL (trial ref — not a primary ownership FK)', () => {
    expect(s()).toMatch(/trial_school_id\s+uuid\s+REFERENCES public\.schools\(id\) ON DELETE SET NULL/);
  });

  // C4 cascade tests
  it('guardians.parent_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/guardians[\s\S]*?parent_id\s+uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  });
  it('guardians.student_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/guardians[\s\S]*?student_id\s+uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  });
  it('users.parent_id remains WITHOUT cascade (not a guardians FK)', () => {
    // regression guard: the users.parent_id self-FK must NOT be cascaded
    expect(s()).toMatch(/parent_id\s+uuid\s+REFERENCES public\.users\(id\),/);
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

  it('classes.school_id has ON DELETE CASCADE (school delete cascades to classes)', () => {
    expect(s()).toMatch(/school_id\s+uuid\s+NOT NULL REFERENCES public\.schools\(id\) ON DELETE CASCADE/);
  });

  // C4 cascade tests
  it('classes.teacher_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/classes[\s\S]*?teacher_id\s+uuid\s+REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  });
  it('enrollments.class_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/enrollments[\s\S]*?class_id\s+uuid\s+NOT NULL REFERENCES public\.classes\(id\) ON DELETE CASCADE/);
  });
  it('enrollments.student_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/enrollments[\s\S]*?student_id\s+uuid\s+NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
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

  // C4 cascade tests
  it('lessons.class_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/lessons[\s\S]*?class_id\s+uuid\s+NOT NULL REFERENCES public\.classes\(id\) ON DELETE CASCADE/);
  });
  it('lessons.teacher_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/lessons[\s\S]*?teacher_id\s+uuid\s+NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  });
  it('quizzes.lesson_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/quizzes[\s\S]*?lesson_id\s+uuid\s+REFERENCES public\.lessons\(id\) ON DELETE CASCADE/);
  });
  it('quizzes.class_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/quizzes[\s\S]*?class_id\s+uuid\s+NOT NULL REFERENCES public\.classes\(id\) ON DELETE CASCADE/);
  });
  it('quizzes.teacher_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/quizzes[\s\S]*?teacher_id\s+uuid\s+NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  });
  it('quiz_attempts.quiz_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/quiz_attempts[\s\S]*?quiz_id\s+uuid\s+NOT NULL REFERENCES public\.quizzes\(id\) ON DELETE CASCADE/);
  });
  it('quiz_attempts.student_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/quiz_attempts[\s\S]*?student_id\s+uuid\s+NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
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

  // C4 cascade tests
  it('assignments.student_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/assignments[\s\S]*?student_id\s+uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  });
  it('assignments.class_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/assignments[\s\S]*?class_id\s+uuid NOT NULL REFERENCES public\.classes\(id\) ON DELETE CASCADE/);
  });
  it('assignments.lesson_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/assignments[\s\S]*?lesson_id\s+uuid REFERENCES public\.lessons\(id\) ON DELETE CASCADE/);
  });
  it('homework_attempts.assignment_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/homework_attempts[\s\S]*?assignment_id\s+uuid NOT NULL REFERENCES public\.assignments\(id\) ON DELETE CASCADE/);
  });
  it('homework_attempts.student_id ON DELETE CASCADE', () => {
    expect(s()).toMatch(/homework_attempts[\s\S]*?student_id\s+uuid NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
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
    expect(s()).toMatch(/school_id\s+uuid\s+NOT NULL REFERENCES public\.schools\(id\) ON DELETE CASCADE UNIQUE/);
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

  it('school_licenses.school_id has ON DELETE CASCADE (license must vanish with school)', () => {
    expect(s()).toMatch(/school_id\s+uuid\s+NOT NULL REFERENCES public\.schools\(id\) ON DELETE CASCADE UNIQUE/);
  });

  it('license_usage.school_id has ON DELETE CASCADE', () => {
    expect(s()).toMatch(/license_usage[\s\S]*?school_id\s+uuid\s+NOT NULL REFERENCES public\.schools\(id\) ON DELETE CASCADE/);
  });

  it('license_events.school_id has ON DELETE CASCADE', () => {
    expect(s()).toMatch(/license_events[\s\S]*?school_id\s+uuid\s+NOT NULL REFERENCES public\.schools\(id\) ON DELETE CASCADE/);
  });
});

describe('0009 security_hardening', () => {
  const s = () => sql('0009_security_hardening.sql');

  it('recreates enforce_enrollment_limit with SET search_path = public', () => {
    expect(s()).toMatch(/FUNCTION public\.enforce_enrollment_limit\(\)[\s\S]*SET search_path = public/);
  });

  it('recreates handle_license_updated_at with SET search_path = public', () => {
    expect(s()).toMatch(/FUNCTION public\.handle_license_updated_at\(\)[\s\S]*SET search_path = public/);
  });

  it('revokes EXECUTE on is_platform_admin from anon', () => {
    expect(s()).toMatch(/REVOKE EXECUTE ON FUNCTION public\.is_platform_admin\(\)\s+FROM[\s\S]*anon/);
  });

  it('revokes EXECUTE on get_my_school_id from anon', () => {
    expect(s()).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_my_school_id\(\)\s+FROM[\s\S]*anon/);
  });

  it('revokes EXECUTE on get_my_role from anon', () => {
    expect(s()).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_my_role\(\)\s+FROM[\s\S]*anon/);
  });

  it('revokes EXECUTE on get_teacher_class_ids from anon', () => {
    expect(s()).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_teacher_class_ids\(uuid\)\s+FROM[\s\S]*anon/);
  });

  it('revokes EXECUTE on get_teacher_student_ids from anon', () => {
    expect(s()).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_teacher_student_ids\(uuid\)\s+FROM[\s\S]*anon/);
  });

  it('revokes EXECUTE on get_student_class_ids from anon', () => {
    expect(s()).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_student_class_ids\(uuid\)\s+FROM[\s\S]*anon/);
  });

  it('retains EXECUTE grant for authenticated + service_role on all 6 helpers', () => {
    for (const fn of [
      'is_platform_admin()',
      'get_my_school_id()',
      'get_my_role()',
      'get_teacher_class_ids(uuid)',
      'get_teacher_student_ids(uuid)',
      'get_student_class_ids(uuid)',
    ]) {
      expect(s(), `missing GRANT EXECUTE for ${fn}`).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn.replace('(', '\\(').replace(')', '\\)')}\\s+TO authenticated, service_role`)
      );
    }
  });

  it('both recreated functions keep SECURITY DEFINER', () => {
    expect(s()).toMatch(/enforce_enrollment_limit[\s\S]*SECURITY DEFINER/);
    expect(s()).toMatch(/handle_license_updated_at[\s\S]*SECURITY DEFINER/);
  });
});

describe('0008 platform', () => {
  const s = () => sql('0008_platform.sql');

  it('creates all 4 tables', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.platform_events/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.platform_links/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.external_identities/);
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.webhook_idempotency_keys/);
  });

  it('platform_events carries the full V1 034 column set (media-meter substrate)', () => {
    for (const c of ['source', 'event_type', 'school_id', 'student_id', 'payload', 'processed', 'error', 'created_at']) {
      expect(s(), `platform_events missing column: ${c}`).toContain(c);
    }
  });

  it("platform_links product CHECK INCLUDES 'lift' (P1 LIFT pre-populate handoff)", () => {
    // The CHECK must be ('spark','lift','custom') — 'lift' is required for LIFT row provisioning
    expect(s()).toMatch(/product\s+text\s+NOT NULL CHECK \(product IN \('spark','lift','custom'\)\)/);
    expect(s(), "product CHECK must contain 'lift'").toContain("'lift'");
  });

  it('platform_links has all required columns including GA-rework rotatable-key cols', () => {
    for (const c of ['api_key', 'core_base_url', 'enabled', 'key_version', 'rotated_at', 'expires_at', 'last_used_at']) {
      expect(s(), `platform_links missing column: ${c}`).toContain(c);
    }
    expect(s()).toMatch(/UNIQUE \(school_id, product\)/);
  });

  it('external_identities has UNIQUE (school_id, provider, external_id)', () => {
    expect(s()).toMatch(/UNIQUE \(school_id, provider, external_id\)/);
    for (const c of ['school_id', 'provider', 'external_id', 'core_student_id']) {
      expect(s(), `external_identities missing column: ${c}`).toContain(c);
    }
  });

  it('webhook_idempotency_keys has status CHECK (in_progress|completed|failed) + UNIQUE (endpoint, idempotency_key)', () => {
    expect(s()).toMatch(/status\s+text\s+NOT NULL CHECK \(status IN \('in_progress','completed','failed'\)\)/);
    expect(s()).toMatch(/UNIQUE \(endpoint, idempotency_key\)/);
    for (const c of ['endpoint', 'idempotency_key', 'response_body', 'expires_at']) {
      expect(s(), `webhook_idempotency_keys missing column: ${c}`).toContain(c);
    }
  });

  it('enables RLS on all 4 tables', () => {
    expect(s()).toMatch(/ALTER TABLE public\.platform_events\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.platform_links\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.external_identities\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.webhook_idempotency_keys ENABLE ROW LEVEL SECURITY/);
  });

  it('uses DROP POLICY IF EXISTS before CREATE POLICY (re-runnable)', () => {
    expect(s()).toMatch(/DROP POLICY IF EXISTS/);
    expect(s()).toMatch(/CREATE POLICY/);
  });

  it('grants ALL to authenticated, anon, service_role on all 4 tables', () => {
    expect(s()).toMatch(/GRANT ALL ON public\.platform_events\s+TO authenticated, anon, service_role/);
    expect(s()).toMatch(/GRANT ALL ON public\.platform_links\s+TO authenticated, anon, service_role/);
    expect(s()).toMatch(/GRANT ALL ON public\.external_identities\s+TO authenticated, anon, service_role/);
    expect(s()).toMatch(/GRANT ALL ON public\.webhook_idempotency_keys TO authenticated, anon, service_role/);
  });

  it('no forward-refs — FKs only reference schools and users (0001)', () => {
    const refs = s().match(/REFERENCES public\.(\w+)/g) || [];
    for (const ref of refs) {
      const table = ref.replace('REFERENCES public.', '');
      expect(['schools', 'users'], `unexpected forward-ref to ${table}`).toContain(table);
    }
  });
});

describe('0012_spark.sql', () => {
  const s = () => sql('0012_spark.sql');

  it('adds spark binding columns to assignments (idempotent)', () => {
    expect(s()).toMatch(/ALTER TABLE public\.assignments/);
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS spark_assignment_id/);
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS spark_attempt_id/);
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS spark_experiment_id/);
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS spark_status\s+text DEFAULT 'none'/);
    expect(s()).toMatch(/assignments_spark_status_check/);
  });

  it('creates spark_completions with the (assignment_id, student_id) upsert key + cascade FKs', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.spark_completions/);
    expect(s()).toMatch(/assignment_id\s+uuid\s+NOT NULL REFERENCES public\.assignments\(id\) ON DELETE CASCADE/);
    expect(s()).toMatch(/student_id\s+uuid\s+NOT NULL REFERENCES public\.users\(id\) ON DELETE CASCADE/);
    expect(s()).toMatch(/UNIQUE \(assignment_id, student_id\)/);
    expect(s()).toMatch(/content_quality\s+text\s+CHECK \(content_quality IN \('engaged','minimal','non_engaged'\)\)/);
  });

  it('enables RLS with service_role-all + staff-only school-scoped read (no student/parent)', () => {
    expect(s()).toMatch(/ALTER TABLE public\.spark_completions ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/spark_completions_service_role_all/);
    expect(s()).toMatch(/spark_completions_staff_read/);
    expect(s()).toMatch(/public\.get_my_role\(\) IN \('teacher','school_admin','school_sysadmin','platform_admin'\)/);
  });
});

describe('0013_quiz_runner.sql', () => {
  const s = () => sql('0013_quiz_runner.sql');
  it('adds quiz_attempts runner columns', () => {
    expect(s()).toMatch(/ALTER TABLE\s+(public\.)?quiz_attempts\s+ADD COLUMN.*last_active_at/i);
    expect(s()).toMatch(/forfeit_reason[\s\S]*CHECK[\s\S]*'closure'[\s\S]*'time_up'/i);
    expect(s()).toMatch(/ADD COLUMN.*study_guide/i);
  });
  it('adds quiz_responses behavioral columns + unique constraint', () => {
    expect(s()).toMatch(/quiz_responses[\s\S]*focus_loss_count/i);
    expect(s()).toMatch(/quiz_responses[\s\S]*paste_count/i);
    expect(s()).toMatch(/quiz_responses[\s\S]*hints_used/i);
    expect(s()).toMatch(/UNIQUE\s*\(\s*attempt_id\s*,\s*question_id\s*\)/i);
  });
  it('creates the behavioral_signals per-student model table', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.behavioral_signals/i);
    expect(s()).toMatch(/student_id[\s\S]*PRIMARY KEY|PRIMARY KEY[\s\S]*student_id/i);
    expect(s()).toMatch(/computed\s+jsonb/i);
    expect(s()).toMatch(/observation_count\s+int/i);
  });
});

describe('0014_quiz_session_aggregates.sql', () => {
  const s = () => sql('0014_quiz_session_aggregates.sql');
  it('adds session_aggregates jsonb column to quiz_attempts', () => {
    expect(s()).toMatch(/ALTER TABLE\s+(public\.)?quiz_attempts\s+ADD COLUMN.*session_aggregates\s+jsonb/i);
  });
  it('session_aggregates has NOT NULL default empty object', () => {
    expect(s()).toMatch(/DEFAULT\s+'{}'::jsonb/i);
  });
});

describe('0015 assignment_player', () => {
  const s = () => sql('0015_assignment_player.sql');

  it('adds the four player columns idempotently with the chosen nullability', () => {
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS task_grades\s+jsonb/i);
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS hours_to_submit\s+numeric/i);
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS review_required\s+boolean\s+NOT NULL\s+DEFAULT\s+false/i);
    expect(s()).toMatch(/ADD COLUMN IF NOT EXISTS attempt_no\s+int\s+NOT NULL\s+DEFAULT\s+1/i);
  });

  it('adds an idempotent named status CHECK covering the lifecycle vocabulary', () => {
    expect(s()).toMatch(/homework_attempts_status_check/);
    expect(s()).toMatch(/DROP CONSTRAINT[^;]*homework_attempts_status_check|conname = 'homework_attempts_status_check'/);
    for (const v of ['in_progress', 'submitted', 'grading', 'graded', 'pending_grade']) {
      expect(s()).toContain(`'${v}'`);
    }
  });
});

describe('0017 teacher completion', () => {
  const s = () => sql('0017_teacher_completion.sql');
  it('creates the alerts table with severity + status CHECKs and the occurrence unique index', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.alerts/);
    expect(s()).toMatch(/source_kind\s+text[\s\S]*?check \(source_kind in[\s\S]*?'low_quiz'[\s\S]*?'strong_result'\)/i);
    expect(s()).toMatch(/severity\s+text[\s\S]*?check \(severity in \('urgent','watch','info'\)\)/i);
    expect(s()).toMatch(/status\s+text[\s\S]*?check \(status in \('open','resolved'\)\)/i);
    expect(s()).toMatch(/create unique index[\s\S]*alerts_occurrence_uq[\s\S]*\(student_id, class_id, source_kind, source_ref\)/i);
  });
  it('creates the high_fives table', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.high_fives/);
    expect(s()).toMatch(/note_text\s+text\s+not null/i);
    expect(s()).toMatch(/ai_drafted\s+boolean\s+not null\s+default false/i);
  });
  it('enables RLS on both alerts and high_fives', () => {
    expect(s()).toMatch(/ALTER TABLE public\.alerts\s+ENABLE ROW LEVEL SECURITY/i);
    expect(s()).toMatch(/ALTER TABLE public\.high_fives\s+ENABLE ROW LEVEL SECURITY/i);
  });
  it('creates the service_role-all policies on both tables (DROP-then-CREATE, re-runnable)', () => {
    expect(s()).toMatch(/DROP POLICY IF EXISTS "alerts_service_role_all" ON public\.alerts/i);
    expect(s()).toMatch(/CREATE POLICY "alerts_service_role_all" ON public\.alerts FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/i);
    expect(s()).toMatch(/DROP POLICY IF EXISTS "high_fives_service_role_all" ON public\.high_fives/i);
    expect(s()).toMatch(/CREATE POLICY "high_fives_service_role_all" ON public\.high_fives FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/i);
  });
  it('alerts are teacher-only: NO authenticated read policy on alerts', () => {
    expect(s()).not.toMatch(/CREATE POLICY[^\n]*ON public\.alerts[^\n]*FOR SELECT TO authenticated/i);
  });
  it('high_fives lets a student read their own notes', () => {
    expect(s()).toMatch(/CREATE POLICY "high_fives_student_read" ON public\.high_fives FOR SELECT TO authenticated USING \(student_id = auth\.uid\(\)\)/i);
  });
  it('grants SELECT to authenticated/anon + ALL to service_role on both tables', () => {
    expect(s()).toMatch(/GRANT SELECT ON public\.alerts\s+TO authenticated, anon/i);
    expect(s()).toMatch(/GRANT ALL\s+ON public\.alerts\s+TO service_role/i);
    expect(s()).toMatch(/GRANT SELECT ON public\.high_fives\s+TO authenticated, anon/i);
    expect(s()).toMatch(/GRANT ALL\s+ON public\.high_fives\s+TO service_role/i);
  });
});

describe('0016 tutor_tables', () => {
  const s = () => sql('0016_tutor_tables.sql');
  it('creates tutor_sessions with counters + one-active-session unique index', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.tutor_sessions/);
    expect(s()).toMatch(/hint_count\s+int\s+NOT NULL DEFAULT 0/);
    expect(s()).toMatch(/help_request_count\s+int\s+NOT NULL DEFAULT 0/);
    expect(s()).toMatch(/status\s+text\s+NOT NULL DEFAULT 'active'\s+CHECK \(status IN \('active','completed'\)\)/);
    expect(s()).toMatch(/attempt_id\s+uuid\s+REFERENCES public\.homework_attempts\(id\) ON DELETE SET NULL/);
    expect(s()).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON public\.tutor_sessions \(attempt_id\) WHERE status = 'active'/);
  });
  it('creates tutor_messages with role + hint_rung checks and cascade', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.tutor_messages/);
    expect(s()).toMatch(/session_id\s+uuid\s+NOT NULL REFERENCES public\.tutor_sessions\(id\) ON DELETE CASCADE/);
    expect(s()).toMatch(/role\s+text\s+NOT NULL CHECK \(role IN \('student','teli','system'\)\)/);
    expect(s()).toMatch(/hint_rung\s+text\s+CHECK \(hint_rung IN \('nudge','cue','step','encourage'\)\)/);
    expect(s()).toMatch(/is_help_request\s+boolean\s+NOT NULL DEFAULT false/);
  });
  it('defines the atomic session bump function', () => {
    expect(s()).toMatch(/FUNCTION public\.bump_tutor_session\(p_session_id uuid\)/);
    expect(s()).toMatch(/hint_count = hint_count \+ 1/);
    expect(s()).toMatch(/GRANT EXECUTE ON FUNCTION public\.bump_tutor_session\(uuid\).*TO service_role/);
  });
  it('enables RLS + service_role policy + grants on both tables', () => {
    expect(s()).toMatch(/ALTER TABLE public\.tutor_sessions\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/ALTER TABLE public\.tutor_messages\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/DROP POLICY IF EXISTS/);
    expect(s()).toMatch(/CREATE POLICY .*service_role/);
    expect(s()).toMatch(/GRANT ALL\s+ON public\.tutor_sessions\s+TO service_role/);
    expect(s()).toMatch(/GRANT ALL\s+ON public\.tutor_messages\s+TO service_role/);
  });
  it('indexes the hot lookup paths', () => {
    expect(s()).toMatch(/CREATE INDEX IF NOT EXISTS .*tutor_messages.*session_id/);
  });
});

describe('0019 content_studio', () => {
  const s = () => sql('0019_content_studio.sql');
  it('0019 adds lessons.file_hash + source and provisions the lesson-uploads bucket', () => {
    expect(s()).toMatch(/add column if not exists file_hash text/i);
    expect(s()).toMatch(/add column if not exists source\s+text default 'upload'/i);
    expect(s()).toMatch(/insert into storage\.buckets[\s\S]*'lesson-uploads'[\s\S]*false/i);
  });
});

describe('0022 google_connections', () => {
  const s = () => sql('0022_google_connections.sql');
  it('creates the per-teacher token vault with user_id PK', () => {
    expect(s()).toMatch(/CREATE TABLE IF NOT EXISTS public\.google_connections/);
    expect(s()).toMatch(/user_id\s+uuid\s+PRIMARY KEY\s+REFERENCES public\.users\(id\)/);
  });
  it('has encrypted token columns + expiry + scopes (no plaintext token columns)', () => {
    for (const c of ['access_token_enc', 'refresh_token_enc', 'token_expiry', 'granted_scopes', 'google_id', 'email']) {
      expect(s(), `missing column ${c}`).toContain(c);
    }
    expect(s()).not.toMatch(/access_token\s+text/);   // must be _enc, never plaintext
  });
  it('enables RLS deny-by-default (platform-admin policy only) + grants', () => {
    expect(s()).toMatch(/ALTER TABLE public\.google_connections\s+ENABLE ROW LEVEL SECURITY/);
    expect(s()).toMatch(/CREATE POLICY [\s\S]*google_connections[\s\S]*USING \(public\.is_platform_admin\(\)\)/);
    expect(s()).toMatch(/GRANT ALL ON public\.google_connections\s+TO authenticated, anon, service_role/);
  });
});

describe('0023 behavioral_signals_rls', () => {
  const s = () => sql('0023_behavioral_signals_rls.sql');
  it('enables RLS on behavioral_signals (closes the 0013 RLS gap)', () => {
    expect(s()).toMatch(/ALTER TABLE public\.behavioral_signals\s+ENABLE ROW LEVEL SECURITY/);
  });
  it('adds a deny-by-default platform-admin policy (DROP-then-CREATE, re-runnable)', () => {
    expect(s()).toMatch(/DROP POLICY IF EXISTS behavioral_signals_platform_all ON public\.behavioral_signals/);
    expect(s()).toMatch(/CREATE POLICY behavioral_signals_platform_all ON public\.behavioral_signals FOR ALL\s+USING \(public\.is_platform_admin\(\)\) WITH CHECK \(public\.is_platform_admin\(\)\)/);
  });
});

describe('0024 gc_roster', () => {
  const s = () => sql('0024_gc_roster.sql');
  it('adds email + last_seen_at to external_identities (idempotent ADD COLUMN IF NOT EXISTS)', () => {
    expect(s()).toMatch(/ALTER TABLE public\.external_identities\s+ADD COLUMN IF NOT EXISTS email\s+text/);
    expect(s()).toMatch(/ALTER TABLE public\.external_identities\s+ADD COLUMN IF NOT EXISTS last_seen_at\s+timestamptz/);
  });
  it('adds enrollments.source for per-class GC provenance (idempotent ADD COLUMN IF NOT EXISTS)', () => {
    expect(s()).toMatch(/ALTER TABLE public\.enrollments\s+ADD COLUMN IF NOT EXISTS source\s+text/);
  });
  it('does NOT recreate or rename the existing (school_id, provider, external_id) shape', () => {
    expect(s()).not.toMatch(/CREATE TABLE[^;]*external_identities/);
    expect(s()).not.toMatch(/external_user_id/);   // never copy V1 column names
    // NOTE: the 0008 block (lines ~530) holds the positive "UNIQUE(school_id, provider,
    // external_id) preserved" assertion; 0024 only asserts it does not recreate/rename the
    // table (MIN-8 cross-reference — do not duplicate the positive assertion here).
  });
  it('adds a UNIQUE index on classes(school_id, google_course_id) for a clean course upsert', () => {
    expect(s()).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_classes_school_google_course\s+ON public\.classes\s*\(\s*school_id\s*,\s*google_course_id\s*\)/);
    // guarded so it cannot fail if pre-existing dup data exists (WHERE google_course_id IS NOT NULL)
    expect(s()).toMatch(/WHERE google_course_id IS NOT NULL/);
  });
  it('adds a plain (school_id, provider, email) email lookup index on external_identities', () => {
    expect(s()).toMatch(/CREATE INDEX IF NOT EXISTS idx_external_identities_email\s+ON public\.external_identities\s*\(\s*school_id\s*,\s*provider\s*,\s*email\s*\)/);
  });
});
