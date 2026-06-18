// src/lib/skills/resolveSkills.ts
// Phase 2a — skill-registry resolution (DB side).
//
// resolveSkillIds: raw AI concept tags → skills.id map for one
// (school, subject) scope. Existing slugs match; unknown slugs
// auto-create as status='unreviewed' (nothing is ever dropped —
// teachers can rename/merge later). Race-safe: a unique-violation
// on insert (two generations racing the same new tag) falls back
// to re-select.
//
// Both helpers are fail-soft for callers: wrap in try/catch at the
// call site; a registry hiccup must never fail quiz gen or
// homework creation.

import type { SupabaseClient } from '@supabase/supabase-js';
import { slugifySkillTag, skillDisplayName, normalizeSubject } from '@/lib/skills/skillSlug';

interface SkillRow {
  id: string;
  subject: string | null;
  slug: string;
}

/**
 * Resolve raw concept tags to skill ids within a (school, subject)
 * scope, creating unreviewed registry rows for unknown tags.
 * Returns Map<rawTag, skillId>. Tags that slugify to empty are
 * skipped (absent from the map).
 */
export async function resolveSkillIds(
  admin: SupabaseClient,
  args: {
    schoolId: string;
    subject: string | null | undefined;
    tags: string[];
    createdBy?: 'ai' | 'teacher' | 'backfill';
  },
): Promise<Map<string, string>> {
  const subject = normalizeSubject(args.subject);
  const createdBy = args.createdBy ?? 'ai';
  const out = new Map<string, string>();

  // raw tag → slug (dedup slugs; several raw variants may fold together)
  const slugByTag = new Map<string, string>();
  for (const tag of args.tags) {
    if (typeof tag !== 'string') continue;
    const slug = slugifySkillTag(tag);
    if (slug) slugByTag.set(tag, slug);
  }
  if (!slugByTag.size) return out;
  const slugs = Array.from(new Set(slugByTag.values()));

  // Existing rows for this school + slug set; subject match applied
  // in JS (PostgREST can't express COALESCE(subject,'') = x cleanly).
  const { data: existing, error: selErr } = await admin
    .from('skills')
    .select('id, subject, slug')
    .eq('school_id', args.schoolId)
    .in('slug', slugs);
  if (selErr) {
    console.error('[resolveSkillIds] select error:', {
      message: selErr.message, code: selErr.code,
    });
    return out;
  }

  const idBySlug = new Map<string, string>();
  for (const row of (existing ?? []) as SkillRow[]) {
    if (normalizeSubject(row.subject) === subject) idBySlug.set(row.slug, row.id);
  }

  // Create missing slugs (first-seen raw tag names the skill)
  const missing = slugs.filter((s) => !idBySlug.has(s));
  if (missing.length) {
    const nameBySlug = new Map<string, string>();
    for (const [tag, slug] of slugByTag) {
      if (!nameBySlug.has(slug)) nameBySlug.set(slug, skillDisplayName(tag));
    }
    const rows = missing.map((slug) => ({
      school_id: args.schoolId,
      subject,
      name: nameBySlug.get(slug) ?? slug,
      slug,
      status: 'unreviewed',
      created_by: createdBy,
    }));

    const { data: inserted, error: insErr } = await admin
      .from('skills')
      .insert(rows)
      .select('id, subject, slug');

    if (!insErr) {
      for (const row of (inserted ?? []) as SkillRow[]) idBySlug.set(row.slug, row.id);
    } else {
      // 23505 = a concurrent generation created the same slug between
      // our select and insert — re-select wins. Anything else: log,
      // resolve what we can.
      if (insErr.code !== '23505') {
        console.error('[resolveSkillIds] insert error:', {
          message: insErr.message, code: insErr.code,
        });
      }
      const { data: retry } = await admin
        .from('skills')
        .select('id, subject, slug')
        .eq('school_id', args.schoolId)
        .in('slug', missing);
      for (const row of (retry ?? []) as SkillRow[]) {
        if (normalizeSubject(row.subject) === subject) idBySlug.set(row.slug, row.id);
      }
    }
  }

  for (const [tag, slug] of slugByTag) {
    const id = idBySlug.get(slug);
    if (id) out.set(tag, id);
  }
  return out;
}
