// src/lib/roster/__tests__/template.test.ts
// Node env (default) — no jsdom header needed.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildRosterTemplate } from '@/lib/roster/template';

// ---------------------------------------------------------------------------
// Expected sheet names and header rows (verbatim from V1 grounding §E)
// ---------------------------------------------------------------------------

const EXPECTED_SHEET_NAMES = [
  'Instructions',
  'Teachers',
  'Classes',
  'Students',
  'Enrollments',
  'Parents',
];

const EXPECTED_HEADERS: Record<string, string[]> = {
  Teachers: ['Full Name', 'Email', 'Password (leave blank for Core2026!)'],
  Classes: ['Class Name', 'Subject', 'Grade Level', 'Period', 'Teacher Email'],
  Students: [
    'Full Name',
    'Email',
    'Password (leave blank for Student2026!)',
    'Grade Level',
  ],
  Enrollments: ['Student Email', 'Class Name', 'Period', 'Teacher Email'],
  Parents: [
    'Parent Full Name',
    'Parent Email',
    'Password (leave blank for Core2026!)',
    'Student Email',
  ],
};

// ---------------------------------------------------------------------------
// Helper: get the first (header) row of a worksheet as strings
// ---------------------------------------------------------------------------

function headerRow(wb: XLSX.WorkBook, sheetName: string): string[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const all = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
  // The data sheet uses 4 rows of preamble (title + subtitle + blank + header),
  // so the header row is at index 3.
  return (all[3] ?? []).map((c) => String(c ?? '').trim());
}

// ---------------------------------------------------------------------------
// Helper: parse the returned Uint8Array back into a workbook
// ---------------------------------------------------------------------------

function parseTemplate(): XLSX.WorkBook {
  const bytes = buildRosterTemplate();
  return XLSX.read(bytes, { type: 'array' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildRosterTemplate', () => {
  it('returns a Uint8Array', () => {
    const result = buildRosterTemplate();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it('round-trips through XLSX.read without throwing', () => {
    expect(() => parseTemplate()).not.toThrow();
  });

  it('produces exactly 6 sheets in the correct order', () => {
    const wb = parseTemplate();
    expect(wb.SheetNames).toEqual(EXPECTED_SHEET_NAMES);
  });

  it('Teachers sheet has the expected header row at row index 3', () => {
    const wb = parseTemplate();
    expect(headerRow(wb, 'Teachers')).toEqual(EXPECTED_HEADERS['Teachers']);
  });

  it('Classes sheet has the expected header row at row index 3', () => {
    const wb = parseTemplate();
    expect(headerRow(wb, 'Classes')).toEqual(EXPECTED_HEADERS['Classes']);
  });

  it('Students sheet has the expected header row at row index 3', () => {
    const wb = parseTemplate();
    expect(headerRow(wb, 'Students')).toEqual(EXPECTED_HEADERS['Students']);
  });

  it('Enrollments sheet has the expected header row at row index 3', () => {
    const wb = parseTemplate();
    expect(headerRow(wb, 'Enrollments')).toEqual(EXPECTED_HEADERS['Enrollments']);
  });

  it('Parents sheet has the expected header row at row index 3', () => {
    const wb = parseTemplate();
    expect(headerRow(wb, 'Parents')).toEqual(EXPECTED_HEADERS['Parents']);
  });

  it('Instructions sheet is present and contains guidance text', () => {
    const wb = parseTemplate();
    const ws = wb.Sheets['Instructions'];
    expect(ws).toBeDefined();
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
    // At least a few rows of text
    expect(rows.length).toBeGreaterThan(3);
    // Some row should mention "sheet" or "password" (case-insensitive)
    const allText = rows
      .flat()
      .map((c) => String(c ?? '').toLowerCase())
      .join(' ');
    expect(allText).toContain('sheet');
    expect(allText).toContain('password');
  });

  it('each data sheet has at least 2 example rows after the header', () => {
    const wb = parseTemplate();
    for (const name of EXPECTED_SHEET_NAMES.filter((n) => n !== 'Instructions')) {
      const ws = wb.Sheets[name];
      expect(ws).toBeDefined();
      const all = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
      // rows 0-2 = preamble, row 3 = headers, row 4+ = examples
      const examples = all.slice(4).filter((r) => r.some((c) => c !== '' && c != null));
      expect(examples.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: parsing an unedited template should yield zero real rows
// ---------------------------------------------------------------------------
// Import parseRosterWorkbook here — NOT in the describe block above so the
// existing header-round-trip tests stay isolated.

import { parseRosterWorkbook } from '@/lib/roster/parseWorkbook';

describe('parseRosterWorkbook(buildRosterTemplate()) — unedited template imports nothing', () => {
  it('yields 0 teachers, 0 classes, 0 students, 0 enrollments, 0 parents and no issues', () => {
    const bytes = buildRosterTemplate();
    const { roster, issues } = parseRosterWorkbook(bytes);
    expect(roster.teachers).toHaveLength(0);
    expect(roster.classes).toHaveLength(0);
    expect(roster.students).toHaveLength(0);
    expect(roster.enrollments).toHaveLength(0);
    expect(roster.parents).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });
});
