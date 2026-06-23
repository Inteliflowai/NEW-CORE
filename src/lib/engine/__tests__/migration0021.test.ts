import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0021_student_drawings.sql'), 'utf-8');

describe('migration 0021', () => {
  it('creates a PRIVATE student-drawings bucket, idempotently', () => {
    expect(sql).toMatch(/insert into storage\.buckets/i);
    expect(sql).toMatch(/'student-drawings'/);
    expect(sql).toMatch(/false/);                         // public=false
    expect(sql).toMatch(/on conflict \(id\) do update/i); // idempotent
  });
});
