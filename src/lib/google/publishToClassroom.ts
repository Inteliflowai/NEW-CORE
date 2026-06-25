// src/lib/google/publishToClassroom.ts
// Engine: publish a quiz or assignment as a DRAFT Google Classroom courseWork, pin an idempotent
// "Open in CORE" courseWorkMaterials link, and upsert into google_publications.
//
// Idempotent: SELECT first by (resource_type, resource_id, google_course_id); if found, return
// alreadyPublished:true without creating a duplicate courseWork.
//
// Open-CORE pin: one per course (resource_type='course_link', school-scoped SELECT).
// The partial unique index uq_gpub_course_link is the concurrency backstop; a 23505 on the insert
// is tolerated (concurrent first-publish beat us) — do not throw.
//
// resource_id convention (C1): caller passes lesson_id for assignments, quiz_id for quizzes.
// grade_passback_enabled = (resourceType === 'assignment'); quiz courseWork uses maxPoints:null.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCourseWork, createCourseWorkMaterial } from '@/lib/google/classroom';

export interface PublishArgs {
  token: string;
  schoolId: string;
  classId: string;
  googleCourseId: string;
  resourceType: 'quiz' | 'assignment';
  resourceId: string;       // quizzes.id for a quiz; lessons.id (assignment column) for an assignment
  title: string;
  linkUrl: string;
  courseLinkUrl: string;
  maxPoints?: number | null; // assignments only; quizzes never push a grade (maxPoints=null)
  createdBy: string;         // teacher user id (M4)
}

export interface PublishResult {
  google_coursework_id: string;
  alreadyPublished: boolean;
  courseLinkPinned: boolean;
}

export async function publishToClassroom(admin: SupabaseClient, args: PublishArgs): Promise<PublishResult> {
  // 1. Idempotent: check for an existing publication of this resource on this course.
  const { data: existing } = await admin
    .from('google_publications')
    .select('google_coursework_id')
    .eq('resource_type', args.resourceType)
    .eq('resource_id', args.resourceId)
    .eq('google_course_id', args.googleCourseId)
    .maybeSingle();

  let alreadyPublished = false;
  let courseworkId: string;

  if (existing?.google_coursework_id) {
    alreadyPublished = true;
    courseworkId = existing.google_coursework_id as string;
  } else {
    // 2. Create a DRAFT courseWork in Google Classroom.
    const cw = await createCourseWork(args.token, args.googleCourseId, {
      title: args.title,
      linkUrl: args.linkUrl,
      // Quizzes never push grades — maxPoints must not be set (null). Assignments default 100 if
      // the caller doesn't supply one (M9).
      maxPoints: args.resourceType === 'assignment' ? (args.maxPoints ?? 100) : null,
    });
    courseworkId = cw.id;

    // 3. Upsert into google_publications.
    await admin.from('google_publications').upsert(
      {
        school_id: args.schoolId,
        class_id: args.classId,
        resource_type: args.resourceType,
        resource_id: args.resourceId,
        google_course_id: args.googleCourseId,
        google_coursework_id: courseworkId,
        grade_passback_enabled: args.resourceType === 'assignment',
        max_points: args.resourceType === 'assignment' ? (args.maxPoints ?? 100) : null,
        created_by: args.createdBy, // M4
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'resource_type,resource_id,google_course_id' },
    );
  }

  // 4. Pin the "Open in CORE" courseWorkMaterials link once per course.
  //    SELECT is school-scoped (M9); resource_id = classId sentinel so the 3-col UNIQUE binds (M2).
  let courseLinkPinned = false;
  const { data: link } = await admin
    .from('google_publications')
    .select('id')
    .eq('resource_type', 'course_link')
    .eq('google_course_id', args.googleCourseId)
    .eq('school_id', args.schoolId)
    .maybeSingle();

  if (!link) {
    const mat = await createCourseWorkMaterial(args.token, args.googleCourseId, {
      title: 'Open in CORE',
      linkUrl: args.courseLinkUrl,
    });
    const { error: insErr } = await admin.from('google_publications').insert({
      school_id: args.schoolId,
      class_id: args.classId,
      resource_type: 'course_link',
      resource_id: args.classId, // sentinel: makes the 3-col UNIQUE apply (M2)
      google_course_id: args.googleCourseId,
      google_coursework_id: mat.id,
      grade_passback_enabled: false,
      created_by: args.createdBy,
    });
    // 23505 = a concurrent first-publish already pinned it; treat as already-pinned, do not throw.
    // Any other error is logged non-fatally — the courseWork is already published; a missing pin
    // is recoverable on re-publish.
    if (insErr && (insErr as { code?: string }).code !== '23505') {
      console.error('[gc] course_link pin insert failed (non-fatal):', insErr.message);
    } else if (!insErr) {
      courseLinkPinned = true;
    }
  }

  return { google_coursework_id: courseworkId, alreadyPublished, courseLinkPinned };
}
