/**
 * Static-text test for supabase/migrations/0011_signals.sql.
 *
 * Guards that the migration file:
 *   1.  Contains all required ADD COLUMN IF NOT EXISTS statements for homework_attempts.
 *   2.  Uses the idempotent named-constraint form for effort_label CHECK (C16).
 *   3.  Creates misconception_types with the correct kind CHECK.
 *   4.  Seeds all 8 error_type + 6 reasoning_pattern codes (C5).
 *   5.  Creates misconception_observations with the correct FK + index.
 *   6.  Enables RLS and creates the two correct policies:
 *         service_role ALL; staff-only authenticated read via get_my_role() (C9).
 *   7.  misconception_types grants are SELECT-only to clients (C17).
 *   8.  misconception_observations grants are SELECT-only to clients.
 *   9.  Tightens skill_learning_state sls_school_read to staff-only via get_my_role() (C9).
 *   10. Tightens student_model_snapshots sms_scoped_read to own-row + guardian + staff (C21).
 *   11. Adds consistency_score to student_model_snapshots.
 *   12. Contains the DO-block grading_status CHECK swap with correct allowed values.
 *   13. Is idempotent (IF NOT EXISTS, DO blocks, ON CONFLICT DO NOTHING).
 *
 * This is a build-time assertion — it does NOT run against a live DB.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0011_signals.sql'),
  'utf8',
);

describe('0011_signals.sql — static-text assertions', () => {

  // ── C16: homework_attempts columns (split column + named CHECK) ──────────────
  it('adds effort_label column separately (no inline CHECK)', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.homework_attempts ADD COLUMN IF NOT EXISTS effort_label text;/i,
    );
  });

  it('uses idempotent named-constraint DO-block for effort_label CHECK (C16)', () => {
    // Must have a DO block that checks/drops the named constraint before adding it
    expect(sql).toMatch(/homework_attempts_effort_label_check/i);
    expect(sql).toMatch(/DROP CONSTRAINT homework_attempts_effort_label_check/i);
    expect(sql).toMatch(/ADD CONSTRAINT homework_attempts_effort_label_check/i);
  });

  it('constrains effort_label to the 4 allowed values', () => {
    expect(sql).toMatch(/effortful_success/);
    expect(sql).toMatch(/struggling_trying/);
    expect(sql).toMatch(/independent_success/);
    expect(sql).toMatch(/independent_struggle/);
  });

  it('adds allow_redo column to homework_attempts', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.homework_attempts ADD COLUMN IF NOT EXISTS allow_redo boolean/i,
    );
  });

  it('adds is_redo column to homework_attempts', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.homework_attempts ADD COLUMN IF NOT EXISTS is_redo boolean/i,
    );
  });

  it('adds flagged_by column to homework_attempts', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.homework_attempts ADD COLUMN IF NOT EXISTS flagged_by text/i,
    );
  });

  // ── misconception_types table (C5 canonical taxonomy) ───────────────────────
  it('creates misconception_types table with IF NOT EXISTS', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.misconception_types/i);
  });

  it('constrains kind to error_type and reasoning_pattern', () => {
    expect(sql).toMatch(/kind IN \('error_type', 'reasoning_pattern'\)/i);
  });

  // ── C5: error_type seeds (8 codes) ──────────────────────────────────────────
  it('seeds error_type: none', () => {
    expect(sql).toMatch(/'none',\s+'error_type'/i);
  });

  it('seeds error_type: factual_error', () => {
    expect(sql).toMatch(/'factual_error',\s+'error_type'/i);
  });

  it('seeds error_type: reasoning_gap', () => {
    expect(sql).toMatch(/'reasoning_gap',\s+'error_type'/i);
  });

  it('seeds error_type: incomplete', () => {
    expect(sql).toMatch(/'incomplete',\s+'error_type'/i);
  });

  it('seeds error_type: misunderstood_question', () => {
    expect(sql).toMatch(/'misunderstood_question',\s+'error_type'/i);
  });

  it('seeds error_type: vocabulary_confusion', () => {
    expect(sql).toMatch(/'vocabulary_confusion',\s+'error_type'/i);
  });

  it('seeds error_type: off_topic', () => {
    expect(sql).toMatch(/'off_topic',\s+'error_type'/i);
  });

  it('seeds error_type: blank', () => {
    expect(sql).toMatch(/'blank',\s+'error_type'/i);
  });

  // ── C5: reasoning_pattern seeds (6 codes) ────────────────────────────────────
  it('seeds reasoning_pattern: surface_recall', () => {
    expect(sql).toMatch(/'surface_recall',\s+'reasoning_pattern'/i);
  });

  it('seeds reasoning_pattern: partial_reasoning', () => {
    expect(sql).toMatch(/'partial_reasoning',\s+'reasoning_pattern'/i);
  });

  it('seeds reasoning_pattern: full_reasoning', () => {
    expect(sql).toMatch(/'full_reasoning',\s+'reasoning_pattern'/i);
  });

  it('seeds reasoning_pattern: misconception', () => {
    expect(sql).toMatch(/'misconception',\s+'reasoning_pattern'/i);
  });

  it('seeds reasoning_pattern: creative_extension', () => {
    expect(sql).toMatch(/'creative_extension',\s+'reasoning_pattern'/i);
  });

  it('seeds reasoning_pattern: blank_or_off_topic', () => {
    expect(sql).toMatch(/'blank_or_off_topic',\s+'reasoning_pattern'/i);
  });

  it('uses ON CONFLICT DO NOTHING for seed inserts (idempotent)', () => {
    expect(sql).toMatch(/ON CONFLICT \(code\) DO NOTHING/i);
  });

  // ── misconception_observations table ─────────────────────────────────────────
  it('creates misconception_observations table with IF NOT EXISTS', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.misconception_observations/i);
  });

  it('misconception_observations has student_id FK to users', () => {
    expect(sql).toMatch(/student_id\s+uuid\s+NOT NULL REFERENCES public\.users\(id\)/i);
  });

  it('misconception_observations has skill_id FK to skills', () => {
    expect(sql).toMatch(/skill_id\s+uuid\s+REFERENCES public\.skills\(id\)/i);
  });

  it('misconception_observations has quiz_response_id FK to quiz_responses', () => {
    expect(sql).toMatch(/quiz_response_id\s+uuid\s+REFERENCES public\.quiz_responses\(id\)/i);
  });

  it('creates index on (student_id, skill_id, error_type)', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_mo_student_skill_error/i);
    expect(sql).toMatch(/ON public\.misconception_observations \(student_id, skill_id, error_type\)/i);
  });

  // ── RLS policies: misconception_observations ──────────────────────────────────
  it('enables RLS on misconception_observations', () => {
    expect(sql).toMatch(/ALTER TABLE public\.misconception_observations ENABLE ROW LEVEL SECURITY/i);
  });

  it('creates service_role all-access policy on misconception_observations', () => {
    expect(sql).toMatch(/CREATE POLICY "mo_service_role_all" ON public\.misconception_observations/i);
    expect(sql).toMatch(/TO service_role/);
  });

  it('C9: mo_school_read policy uses get_my_role() for staff-only read (not school-scope-only)', () => {
    expect(sql).toMatch(/CREATE POLICY "mo_school_read" ON public\.misconception_observations/i);
    expect(sql).toMatch(/FOR SELECT\s+TO authenticated/i);
    // Must use get_my_role() check — not just school_id = get_my_school_id()
    expect(sql).toMatch(/get_my_role\(\) IN \('teacher'/i);
  });

  it('C9: mo_school_read includes school_admin, school_sysadmin, platform_admin', () => {
    const moSection = sql.slice(sql.indexOf('"mo_school_read"'));
    expect(moSection).toMatch(/school_admin/);
    expect(moSection).toMatch(/school_sysadmin/);
    expect(moSection).toMatch(/platform_admin/);
  });

  // ── C17: Grants — misconception_types SELECT-only to clients ─────────────────
  it('C17: grants SELECT (not ALL) on misconception_types to authenticated and anon', () => {
    expect(sql).toMatch(/GRANT SELECT ON public\.misconception_types TO authenticated, anon/i);
  });

  it('C17: grants ALL on misconception_types to service_role only', () => {
    expect(sql).toMatch(/GRANT ALL\s+ON public\.misconception_types TO service_role/i);
  });

  it('C17: does NOT grant ALL on misconception_types to authenticated or anon', () => {
    // Should not have GRANT ALL ... misconception_types ... TO authenticated
    expect(sql).not.toMatch(
      /GRANT ALL ON public\.misconception_types\s+TO (authenticated|anon)/i,
    );
  });

  it('grants SELECT on misconception_observations to authenticated and anon', () => {
    expect(sql).toMatch(/GRANT SELECT ON public\.misconception_observations TO authenticated, anon/i);
  });

  it('grants ALL on misconception_observations to service_role', () => {
    expect(sql).toMatch(/GRANT ALL\s+ON public\.misconception_observations TO service_role/i);
  });

  // ── C9: skill_learning_state sls_school_read tightened to staff-only ──────────
  it('C9: drops existing sls_school_read policy', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS sls_school_read ON public\.skill_learning_state/i);
  });

  it('C9: new sls_school_read policy uses get_my_role() for staff-only read', () => {
    expect(sql).toMatch(/CREATE POLICY sls_school_read ON public\.skill_learning_state/i);
    expect(sql).toMatch(/FOR SELECT TO authenticated/i);
    // Must gate on get_my_role() — not plain school_id = get_my_school_id()
    const slsSection = sql.slice(sql.lastIndexOf('CREATE POLICY sls_school_read'));
    expect(slsSection).toMatch(/get_my_role\(\) IN \('teacher'/i);
  });

  it('C9: sls_school_read includes all staff roles', () => {
    const slsSection = sql.slice(sql.lastIndexOf('CREATE POLICY sls_school_read'));
    expect(slsSection).toMatch(/school_admin/);
    expect(slsSection).toMatch(/school_sysadmin/);
    expect(slsSection).toMatch(/platform_admin/);
  });

  // ── C21: student_model_snapshots sms_scoped_read tightened ──────────────────
  it('C21: drops existing sms_scoped_read policy', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "sms_scoped_read" ON public\.student_model_snapshots/i);
  });

  it('C21: new sms_scoped_read allows student to read own row', () => {
    const smsSection = sql.slice(sql.lastIndexOf('CREATE POLICY "sms_scoped_read"'));
    expect(smsSection).toMatch(/student_id = auth\.uid\(\)/i);
  });

  it('C21: new sms_scoped_read allows guardian to read their child', () => {
    const smsSection = sql.slice(sql.lastIndexOf('CREATE POLICY "sms_scoped_read"'));
    expect(smsSection).toMatch(/public\.guardians g/i);
    expect(smsSection).toMatch(/g\.parent_id = auth\.uid\(\)/i);
    expect(smsSection).toMatch(/g\.student_id = student_model_snapshots\.student_id/i);
  });

  it('C21: new sms_scoped_read allows staff to read their school via get_my_role()', () => {
    const smsSection = sql.slice(sql.lastIndexOf('CREATE POLICY "sms_scoped_read"'));
    expect(smsSection).toMatch(/get_my_role\(\) IN \('teacher'/i);
    expect(smsSection).toMatch(/school_id = public\.get_my_school_id\(\)/i);
  });

  // ── consistency_score column ──────────────────────────────────────────────────
  it('adds consistency_score column to student_model_snapshots', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.student_model_snapshots\s+ADD COLUMN IF NOT EXISTS consistency_score numeric/i,
    );
  });

  // ── quiz_attempts: grading_status CHECK (idempotent DO-block) ─────────────────
  it('uses a DO block to drop any existing grading_status CHECK (idempotent)', () => {
    // Must have a DECLARE block looking for grading_status constraints
    expect(sql).toMatch(/grading_status%/i);
    expect(sql).toMatch(/DROP CONSTRAINT/i);
  });

  it('adds named grading_status CHECK with pending and complete', () => {
    expect(sql).toMatch(/ADD CONSTRAINT quiz_attempts_grading_status_check/i);
    expect(sql).toMatch(
      /grading_status IS NULL OR grading_status IN \('pending', 'complete'\)/i,
    );
  });

  // ── General idempotency guards ─────────────────────────────────────────────────
  it('uses ADD COLUMN IF NOT EXISTS throughout (no bare ADD COLUMN)', () => {
    // All ADD COLUMN occurrences must be IF NOT EXISTS
    const bareAddColumn = /ADD COLUMN(?!\s+IF NOT EXISTS)/gi;
    expect(sql).not.toMatch(bareAddColumn);
  });

  it('uses ON CONFLICT (code) DO NOTHING for seed upserts', () => {
    expect(sql).toMatch(/ON CONFLICT \(code\) DO NOTHING/i);
  });
});
