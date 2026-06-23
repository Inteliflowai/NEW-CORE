import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/0020_content_studio_generate.sql'),
  'utf-8',
);

describe('migration 0020', () => {
  it('adds the multi-day + standards columns to lessons (idempotent)', () => {
    expect(sql).toMatch(/alter table public\.lessons/i);
    expect(sql).toMatch(/add column if not exists chapter_title\s+text/i);
    expect(sql).toMatch(/add column if not exists day_index\s+int/i);
    expect(sql).toMatch(/add column if not exists standard_codes\s+text\[\]\s+default '\{\}'/i);
    expect(sql).toMatch(/add column if not exists standard_framework\s+text/i);
  });
  it('adds schools.state (idempotent)', () => {
    expect(sql).toMatch(/alter table public\.schools/i);
    expect(sql).toMatch(/add column if not exists state\s+text/i);
  });
  it('indexes the unit grouping key', () => {
    expect(sql).toMatch(/create index if not exists lessons_class_chapter_idx/i);
  });
});
