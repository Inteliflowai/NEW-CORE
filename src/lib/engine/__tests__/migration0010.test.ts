/**
 * Static-text test for migration 0010_engine_columns.sql.
 *
 * Guards that the migration file:
 *   1. Contains all required ADD COLUMN IF NOT EXISTS statements.
 *   2. Contains the 'numeric' CHECK extension for question_type (C13).
 *   3. Is idempotent (uses IF NOT EXISTS / DO blocks).
 *
 * This is a build-time assertion — it does NOT run against a live DB.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0010_engine_columns.sql'),
  'utf8',
);

describe('0010_engine_columns.sql — static-text assertions', () => {
  // ── quizzes ───────────────────────────────────────────────────────────────
  it('adds is_math column to quizzes', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quizzes\s+ADD COLUMN IF NOT EXISTS is_math boolean/i);
  });

  it('adds generation_model column to quizzes', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quizzes\s+ADD COLUMN IF NOT EXISTS generation_model text/i);
  });

  // ── quiz_questions ────────────────────────────────────────────────────────
  it('adds numeric_spec column to quiz_questions', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quiz_questions\s+ADD COLUMN IF NOT EXISTS numeric_spec jsonb/i);
  });

  it('adds rubric_version column to quiz_questions', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quiz_questions\s+ADD COLUMN IF NOT EXISTS rubric_version text/i);
  });

  it('extends question_type CHECK to include numeric (C13)', () => {
    // The new CHECK must mention all three types
    expect(sql).toMatch(/question_type IN \('mcq','open','numeric'\)/i);
  });

  it('drops old question_type CHECK before adding new one (idempotent pattern)', () => {
    expect(sql).toMatch(/DROP CONSTRAINT/i);
    expect(sql).toMatch(/ADD CONSTRAINT quiz_questions_question_type_check/i);
  });

  // ── quiz_attempts ─────────────────────────────────────────────────────────
  it('adds adapted_questions column to quiz_attempts', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quiz_attempts\s+ADD COLUMN IF NOT EXISTS adapted_questions jsonb/i);
  });

  it('adds grading_status column to quiz_attempts', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quiz_attempts\s+ADD COLUMN IF NOT EXISTS grading_status text/i);
  });

  it('adds grading_failed column to quiz_attempts', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quiz_attempts\s+ADD COLUMN IF NOT EXISTS grading_failed boolean/i);
  });

  it('adds raw_score column to quiz_attempts', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quiz_attempts\s+ADD COLUMN IF NOT EXISTS raw_score numeric/i);
  });

  it('adds score_pct column to quiz_attempts', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quiz_attempts\s+ADD COLUMN IF NOT EXISTS score_pct numeric/i);
  });

  // ── quiz_responses ────────────────────────────────────────────────────────
  it('adds grading_output column to quiz_responses', () => {
    expect(sql).toMatch(/ALTER TABLE public\.quiz_responses\s+ADD COLUMN IF NOT EXISTS grading_output jsonb/i);
  });

  // ── assignments ───────────────────────────────────────────────────────────
  it('adds generation_model column to assignments', () => {
    expect(sql).toMatch(/ALTER TABLE public\.assignments\s+ADD COLUMN IF NOT EXISTS generation_model text/i);
  });
});
