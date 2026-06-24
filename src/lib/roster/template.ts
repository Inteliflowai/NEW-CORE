// src/lib/roster/template.ts
// Pure, import-safe XLSX template builder — NO Next.js / Supabase / React imports.
// Mirrors V1 template from app/api/import/template/route.ts.
//
// NOTE on SheetJS 0.20.x: XLSX.write(..., { type: 'array' }) returns an
// ArrayBuffer, so we wrap it in new Uint8Array(...) to match the return type.

import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Constants — sheet names
// ---------------------------------------------------------------------------

const SHEET_INSTRUCTIONS = 'Instructions';
const SHEET_TEACHERS = 'Teachers';
const SHEET_CLASSES = 'Classes';
const SHEET_STUDENTS = 'Students';
const SHEET_ENROLLMENTS = 'Enrollments';
const SHEET_PARENTS = 'Parents';

// ---------------------------------------------------------------------------
// Helper: build a single data sheet
//
// Row layout (mirrors V1 makeSheet):
//   Row 0: title  (merged across all columns)
//   Row 1: subtitle  (merged across all columns)
//   Row 2: blank spacer
//   Row 3: column headers
//   Row 4+: example rows
// ---------------------------------------------------------------------------

function makeSheet(
  title: string,
  subtitle: string,
  headers: string[],
  examples: string[][],
): XLSX.WorkSheet {
  const rows: unknown[][] = [
    [title],        // row 0
    [subtitle],     // row 1
    [],             // row 2 — blank spacer
    headers,        // row 3 — column headers
    ...examples,    // row 4+
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths — generously wide so example content is readable.
  ws['!cols'] = headers.map(() => ({ wch: 30 }));

  // Merge title + subtitle rows across all columns so they look like headings.
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
  ];

  return ws;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a 6-sheet (.xlsx) downloadable roster template.
 *
 * Sheets in order: Instructions, Teachers, Classes, Students,
 * Enrollments, Parents.
 *
 * Mirrors V1's template exactly: verbatim column headers, same example rows,
 * same password-default phrasing (V1 grounding §E).
 *
 * Returns a Uint8Array suitable for use in a NextResponse body or a
 * Blob / file-save in the browser.
 */
export function buildRosterTemplate(): Uint8Array {
  const wb = XLSX.utils.book_new();

  // ── Instructions sheet ─────────────────────────────────────────────────
  const instrRows: unknown[][] = [
    ['CORE Learning Platform — Roster Import Template'],
    [''],
    ['HOW TO USE THIS FILE'],
    ['1. Fill in each sheet with your school data.'],
    ['2. Do NOT change sheet names or column headers.'],
    ['3. Delete the example rows (highlighted in grey) before importing.'],
    ['4. Save as .xlsx and upload to the Import Roster page.'],
    ['NOTE: Example rows use @example.com addresses and are ignored on import — replace them with your real rows.'],
    [''],
    ['SHEET ORDER (import processes in this order):'],
    ['  1. Teachers  — create teacher accounts first'],
    ['  2. Classes   — create classes (requires teachers to exist)'],
    ['  3. Students  — create student accounts'],
    ['  4. Enrollments — link students to classes'],
    ['  5. Parents   — create parent accounts and link to students'],
    [''],
    ['PASSWORD RULES:'],
    ['  • Leave password blank to use the default: Core2026! (teachers/parents) or Student2026! (students)'],
    ['  • Passwords must be at least 6 characters'],
    ['  • Users should change their password after first login'],
    [''],
    ['DUPLICATE HANDLING:'],
    ['  • Existing accounts are skipped (never overwritten)'],
    ['  • Existing enrollments are skipped'],
    ['  • Safe to re-import — duplicates show as "Skipped"'],
    [''],
    ['PERIOD FORMAT:'],
    ['  • Use consistent period labels: "Period 1", "P1", "Block A", etc.'],
    ['  • Period is used to distinguish classes with the same name'],
    ['  • Example: "Math" Period 1 and "Math" Period 2 are separate classes'],
    [''],
    ['NEED HELP? Contact your CORE administrator.'],
  ];
  const instrWs = XLSX.utils.aoa_to_sheet(instrRows);
  instrWs['!cols'] = [{ wch: 70 }];
  instrWs['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  XLSX.utils.book_append_sheet(wb, instrWs, SHEET_INSTRUCTIONS);

  // ── Teachers sheet ─────────────────────────────────────────────────────
  // Columns: Full Name | Email | Password (leave blank for Core2026!)
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(
      'CORE Roster Import — Teachers',
      'Fill in one row per teacher. Delete example rows before importing.',
      ['Full Name', 'Email', 'Password (leave blank for Core2026!)'],
      [
        ['Ms. Jane Smith',    'jsmith@example.com',    'Core2026!'],
        ['Mr. Carlos Rivera', 'crivera@example.com',   'Core2026!'],
      ],
    ),
    SHEET_TEACHERS,
  );

  // ── Classes sheet ──────────────────────────────────────────────────────
  // Columns: Class Name | Subject | Grade Level | Period | Teacher Email
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(
      'CORE Roster Import — Classes',
      'Fill in one row per class. Same class name with different periods = separate classes.',
      ['Class Name', 'Subject', 'Grade Level', 'Period', 'Teacher Email'],
      [
        ['Math 8A',    'Mathematics',             'Grade 8', 'Period 1', 'jsmith@example.com'],
        ['Math 8B',    'Mathematics',             'Grade 8', 'Period 2', 'jsmith@example.com'],
        ['English 9',  'English Language Arts',   'Grade 9', 'Period 1', 'crivera@example.com'],
      ],
    ),
    SHEET_CLASSES,
  );

  // ── Students sheet ─────────────────────────────────────────────────────
  // Columns: Full Name | Email | Password (leave blank for Student2026!) | Grade Level
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(
      'CORE Roster Import — Students',
      'Fill in one row per student. Enrollments are handled in the Enrollments sheet.',
      ['Full Name', 'Email', 'Password (leave blank for Student2026!)', 'Grade Level'],
      [
        ['Luis Garcia',    'lgarcia@example.com',  'Student2026!', 'Grade 8'],
        ['Maria Santos',   'msantos@example.com',  'Student2026!', 'Grade 8'],
        ['James Chen',     'jchen@example.com',    'Student2026!', 'Grade 9'],
        ['Olivia Wilson',  'owilson@example.com',  'Student2026!', 'Grade 9'],
      ],
    ),
    SHEET_STUDENTS,
  );

  // ── Enrollments sheet ──────────────────────────────────────────────────
  // Columns: Student Email | Class Name | Period | Teacher Email
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(
      'CORE Roster Import — Enrollments',
      'Fill in one row per student-class pairing. Include period to avoid wrong class match.',
      ['Student Email', 'Class Name', 'Period', 'Teacher Email'],
      [
        ['lgarcia@example.com',  'Math 8A',    'Period 1', 'jsmith@example.com'],
        ['msantos@example.com',  'Math 8A',    'Period 1', 'jsmith@example.com'],
        ['jchen@example.com',    'Math 8B',    'Period 2', 'jsmith@example.com'],
        ['owilson@example.com',  'English 9',  'Period 1', 'crivera@example.com'],
        ['lgarcia@example.com',  'English 9',  'Period 1', 'crivera@example.com'],
      ],
    ),
    SHEET_ENROLLMENTS,
  );

  // ── Parents sheet ──────────────────────────────────────────────────────
  // Columns: Parent Full Name | Parent Email | Password (leave blank for Core2026!) | Student Email
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(
      'CORE Roster Import — Parents',
      'Fill in one row per parent. One parent can be linked to multiple students (add duplicate rows).',
      ['Parent Full Name', 'Parent Email', 'Password (leave blank for Core2026!)', 'Student Email'],
      [
        ['Robert Garcia',  'rgarcia@example.com',  'Core2026!', 'lgarcia@example.com'],
        ['Elena Santos',   'esantos@example.com',  'Core2026!', 'msantos@example.com'],
        ['David Chen',     'dchen@example.com',    'Core2026!', 'jchen@example.com'],
        ['Sarah Wilson',   'swilson@example.com',  'Core2026!', 'owilson@example.com'],
        // Same parent linked to a second student — demonstrates one-parent-many-students
        ['Robert Garcia',  'rgarcia@example.com',  'Core2026!', 'msantos@example.com'],
      ],
    ),
    SHEET_PARENTS,
  );

  // ── Serialize ──────────────────────────────────────────────────────────
  // XLSX.write with type:'array' returns ArrayBuffer in SheetJS 0.20.x.
  // Wrap in Uint8Array to satisfy the return type.
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
