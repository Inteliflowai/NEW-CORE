// src/lib/teacher/classLabel.ts
// Single source of truth for a teacher-facing class label. Extracted from the
// /api/teacher/classes route so the library Class selector and the route agree.

export function formatClassLabel(c: { name: string; period?: string | null }): string {
  return c.period ? `${c.name} — Period ${c.period}` : c.name;
}
