/**
 * src/app/api/admin/provision-trial/validate.ts
 *
 * Pure input validation for POST /api/admin/provision-trial.
 * No framework imports — safe to import in Node unit tests without a pragma.
 */

export interface ProvisionInputBody {
  school_name?: unknown;
  teacher_email?: unknown;
  teacher_name?: unknown;
  student_roster?: unknown;
  parent?: unknown;
  trial_plan?: unknown;
  student_limit?: unknown;
}

export interface ValidatedProvisionInput {
  school_name: string;
  teacher_email: string;
  teacher_name: string;
  student_roster: string[];
  parent?: string;
  trial_plan: string;
  student_limit: number;
}

export type ValidationResult =
  | { ok: true; value: ValidatedProvisionInput }
  | { ok: false; error: string };

/** Max field lengths — guards against absurd payloads. */
const MAX_SCHOOL_NAME_LEN = 200;
const MAX_TEACHER_NAME_LEN = 200;
const MAX_EMAIL_LEN = 254;      // RFC 5321
const MAX_ROSTER_STUDENTS = 500;
const MAX_STUDENT_NAME_LEN = 200;
const MAX_STUDENT_LIMIT = 10_000;
const VALID_PLANS = ['pro', 'starter', 'enterprise'] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Exported pure validator. Returns a discriminated ok/error result. */
export function validateProvisionInput(body: ProvisionInputBody): ValidationResult {
  // ── school_name ───────────────────────────────────────────────────────────
  if (!body.school_name || typeof body.school_name !== 'string' || body.school_name.trim() === '') {
    return { ok: false, error: 'school_name is required' };
  }
  const school_name = body.school_name.trim();
  if (school_name.length > MAX_SCHOOL_NAME_LEN) {
    return { ok: false, error: `school_name exceeds ${MAX_SCHOOL_NAME_LEN} characters` };
  }

  // ── teacher_email ─────────────────────────────────────────────────────────
  if (!body.teacher_email || typeof body.teacher_email !== 'string' || body.teacher_email.trim() === '') {
    return { ok: false, error: 'teacher_email is required' };
  }
  const teacher_email = body.teacher_email.trim().toLowerCase();
  if (teacher_email.length > MAX_EMAIL_LEN) {
    return { ok: false, error: `teacher_email exceeds ${MAX_EMAIL_LEN} characters` };
  }
  if (!EMAIL_RE.test(teacher_email)) {
    return { ok: false, error: 'teacher_email is not a valid email address' };
  }

  // ── teacher_name ──────────────────────────────────────────────────────────
  if (!body.teacher_name || typeof body.teacher_name !== 'string' || body.teacher_name.trim() === '') {
    return { ok: false, error: 'teacher_name is required' };
  }
  const teacher_name = body.teacher_name.trim();
  if (teacher_name.length > MAX_TEACHER_NAME_LEN) {
    return { ok: false, error: `teacher_name exceeds ${MAX_TEACHER_NAME_LEN} characters` };
  }

  // ── student_roster ────────────────────────────────────────────────────────
  if (!Array.isArray(body.student_roster) || body.student_roster.length === 0) {
    return { ok: false, error: 'student_roster must be a non-empty array' };
  }
  if (body.student_roster.length > MAX_ROSTER_STUDENTS) {
    return { ok: false, error: `student_roster exceeds ${MAX_ROSTER_STUDENTS} entries` };
  }
  const student_roster: string[] = [];
  for (let i = 0; i < body.student_roster.length; i++) {
    const entry = body.student_roster[i];
    if (typeof entry !== 'string' || entry.trim() === '') {
      return { ok: false, error: `student_roster[${i}] must be a non-empty string` };
    }
    if (entry.trim().length > MAX_STUDENT_NAME_LEN) {
      return { ok: false, error: `student_roster[${i}] exceeds ${MAX_STUDENT_NAME_LEN} characters` };
    }
    student_roster.push(entry.trim());
  }

  // ── trial_plan (optional, default 'pro') ─────────────────────────────────
  let trial_plan = 'pro';
  if (body.trial_plan !== undefined) {
    if (typeof body.trial_plan !== 'string' || !(VALID_PLANS as readonly string[]).includes(body.trial_plan)) {
      return { ok: false, error: `trial_plan must be one of: ${VALID_PLANS.join(', ')}` };
    }
    trial_plan = body.trial_plan;
  }

  // ── student_limit (optional, default 300) ────────────────────────────────
  let student_limit = 300;
  if (body.student_limit !== undefined) {
    const raw = Number(body.student_limit);
    if (!Number.isInteger(raw) || raw < 1) {
      return { ok: false, error: 'student_limit must be a positive integer' };
    }
    if (raw > MAX_STUDENT_LIMIT) {
      return { ok: false, error: `student_limit exceeds ${MAX_STUDENT_LIMIT}` };
    }
    student_limit = raw;
  }

  // ── parent (optional) ────────────────────────────────────────────────────
  let parent: string | undefined;
  if (body.parent !== undefined) {
    if (typeof body.parent !== 'string') {
      return { ok: false, error: 'parent must be a string' };
    }
    const trimmed = body.parent.trim();
    if (trimmed.length > MAX_EMAIL_LEN) {
      return { ok: false, error: `parent exceeds ${MAX_EMAIL_LEN} characters` };
    }
    if (trimmed !== '' && !EMAIL_RE.test(trimmed)) {
      return { ok: false, error: 'parent is not a valid email address' };
    }
    parent = trimmed || undefined;
  }

  return {
    ok: true,
    value: { school_name, teacher_email, teacher_name, student_roster, parent, trial_plan, student_limit },
  };
}
