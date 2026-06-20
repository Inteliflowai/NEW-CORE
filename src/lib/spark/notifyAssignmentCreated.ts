// src/lib/spark/notifyAssignmentCreated.ts — CORE→SPARK create-notify (V2 port of V1 contract).
// POST {SPARK_API_URL}/api/integration/webhooks/core, Bearer {CORE_SPARK_API_SECRET},
// X-Idempotency-Key {core_homework_id}_{student_id}, 35s timeout. Never throws.
// rubric_rolling_averages omitted — V2 has no SPARK history (cold-start parity).
import { randomUUID } from 'crypto';
import { SPARK_API_URL, CORE_SPARK_API_SECRET } from './config';
import { bandToSparkBand, gradeToBand, type CoreBand } from './contract';

export interface NotifyInput {
  coreHomeworkId: string;          // assignments.id
  studentId: string;               // users.id (CORE-native)
  schoolId: string;
  coreClassId?: string | null;
  teacherId?: string | null;
  band: CoreBand;
  learningStyle: string | null;
  grade: string | number | null;
  subject: string | null;
  conceptTags: string[];
  title: string;
  content: string;                 // lesson_plan.content (free-text)
}

export interface NotifyResult {
  success: boolean;
  sparkAssignmentId: string;
  sparkAttemptId?: string;
  syntheticExperimentId?: string;
  error?: string;
  skipped?: 'grade_band';
}

export async function notifyAssignmentCreated(input: NotifyInput): Promise<NotifyResult> {
  const sparkAssignmentId = randomUUID();
  const gradeBand = gradeToBand(input.grade);
  if (!gradeBand) {
    return { success: false, sparkAssignmentId, skipped: 'grade_band', error: 'grade outside 3-12 (SPARK rejects K-2)' };
  }

  const idempotencyKey = `${input.coreHomeworkId}_${input.studentId}`;
  const body = {
    event: 'spark_assignment_created',
    data: {
      spark_assignment_id: sparkAssignmentId,
      core_homework_id: input.coreHomeworkId,
      student_id: input.studentId,
      school_id: input.schoolId,
      core_class_id: input.coreClassId ?? null,
      teacher_id: input.teacherId ?? undefined,
      lesson_plan: {
        content: input.content,
        concept_tags: input.conceptTags,
        subject_domain: input.subject ?? 'general',
        title: input.title,
        grade_band: gradeBand,
      },
      student_profile: {
        grade: input.grade != null ? String(input.grade) : undefined,
        learning_style: input.learningStyle ?? undefined,
        student_band: bandToSparkBand(input.band),
        locale: 'en-US',
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const res = await fetch(`${SPARK_API_URL}/api/integration/webhooks/core`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CORE_SPARK_API_SECRET}`,
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { success: false, sparkAssignmentId, error: `SPARK HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      success?: boolean;
      spark_attempt_id?: string;
      synthetic_experiment_id?: string;
      error?: string;
    };
    return {
      success: json.success !== false,
      sparkAssignmentId,
      sparkAttemptId: json.spark_attempt_id,
      syntheticExperimentId: json.synthetic_experiment_id,
      error: json.error,
    };
  } catch (err) {
    return { success: false, sparkAssignmentId, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
