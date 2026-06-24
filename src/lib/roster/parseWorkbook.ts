// src/lib/roster/parseWorkbook.ts
// Pure, import-safe workbook parser — NO Next.js / Supabase / React imports.
// Mirrors V1 behavior from app/(dashboard)/import/actions.ts (section E of grounding).

import * as XLSX from 'xlsx';
import type {
  ParseResult,
  ParsedRoster,
  RowIssue,
  TeacherRow,
  ClassRow,
  StudentRow,
  EnrollmentRow,
  ParentRow,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sheet names expected in a full 5-sheet roster workbook. */
const SHEET_TEACHERS = 'Teachers';
const SHEET_CLASSES = 'Classes';
const SHEET_STUDENTS = 'Students';
const SHEET_ENROLLMENTS = 'Enrollments';
const SHEET_PARENTS = 'Parents';

/** Default passwords from V1 (mirror exactly). */
const DEFAULT_TEACHER_PASSWORD = 'Core2026!';
const DEFAULT_STUDENT_PASSWORD = 'Student2026!';
const DEFAULT_PARENT_PASSWORD = 'Core2026!';

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/**
 * Convert raw row array value to a trimmed string.
 * Mirrors V1: `cell(row,i) = String(row[i] || '').trim()`
 */
function cell(row: string[], i: number): string {
  return String(row[i] ?? '').trim();
}

/**
 * Return true if this row should be silently skipped as a placeholder.
 * V1 rule: skip if the email cell `includes('email') || includes('@example')`.
 */
function isPlaceholder(emailValue: string): boolean {
  const lower = emailValue.toLowerCase();
  return lower.includes('email') || lower.includes('@example');
}

/**
 * Parse a sheet's raw 2D array starting from row index 3 (V1 behavior).
 * Returns both the usable rows and the raw rows array for row-number accounting.
 */
function sheetRows(ws: XLSX.WorkSheet): string[][] {
  const all = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
  // Data starts at index 3 (rows 0-2 are meta/headers in the V1 template)
  return (all as string[][]).slice(3);
}

/**
 * Row-number in the 1-based sheet view given a 0-based slice index.
 * Rows 0-2 are meta, so the first data slice-index 0 = sheet row 4 = 1-based row 4.
 * We report 1-based row numbers for human readability in RowIssue.
 */
function rowNumber(sliceIndex: number): number {
  return sliceIndex + 4; // slice index 0 → sheet row index 3 → 1-based row 4
}

// ---------------------------------------------------------------------------
// Per-sheet parsers
// ---------------------------------------------------------------------------

function parseTeachers(
  wb: XLSX.WorkBook,
  issues: RowIssue[],
): TeacherRow[] {
  const ws = wb.Sheets[SHEET_TEACHERS];
  if (!ws) {
    issues.push({ sheet: SHEET_TEACHERS, row: 0, message: 'Missing sheet' });
    return [];
  }
  const rows = sheetRows(ws);
  const teachers: TeacherRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fullName = cell(row, 0);
    const emailRaw = cell(row, 1);
    const password = cell(row, 2) || DEFAULT_TEACHER_PASSWORD;

    if (!emailRaw && !fullName) continue; // completely empty row — skip silently
    if (isPlaceholder(emailRaw)) continue; // placeholder — skip silently
    if (!emailRaw || !fullName) {
      issues.push({
        sheet: SHEET_TEACHERS,
        row: rowNumber(i),
        message: `Missing required cell(s): fullName=${JSON.stringify(fullName)}, email=${JSON.stringify(emailRaw)}`,
      });
      continue;
    }
    teachers.push({ fullName, email: emailRaw.toLowerCase(), password });
  }
  return teachers;
}

function parseClasses(
  wb: XLSX.WorkBook,
  issues: RowIssue[],
): ClassRow[] {
  const ws = wb.Sheets[SHEET_CLASSES];
  if (!ws) {
    issues.push({ sheet: SHEET_CLASSES, row: 0, message: 'Missing sheet' });
    return [];
  }
  const rows = sheetRows(ws);
  const classes: ClassRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = cell(row, 0);
    const subject = cell(row, 1);
    const gradeLevel = cell(row, 2);
    const period = cell(row, 3);
    const teacherEmailRaw = cell(row, 4);

    if (!name && !teacherEmailRaw) continue; // empty row
    if (isPlaceholder(teacherEmailRaw)) continue;
    if (!name || !teacherEmailRaw) {
      issues.push({
        sheet: SHEET_CLASSES,
        row: rowNumber(i),
        message: `Missing required cell(s): name=${JSON.stringify(name)}, teacherEmail=${JSON.stringify(teacherEmailRaw)}`,
      });
      continue;
    }
    classes.push({
      name,
      subject,
      gradeLevel,
      period,
      teacherEmail: teacherEmailRaw.toLowerCase(),
    });
  }
  return classes;
}

function parseStudents(
  ws: XLSX.WorkSheet,
  sheetName: string,
  startIndex: number,
  issues: RowIssue[],
): StudentRow[] {
  const all = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
  const rows = all.slice(startIndex);
  const students: StudentRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fullName = cell(row, 0);
    const emailRaw = cell(row, 1);
    const password = cell(row, 2) || DEFAULT_STUDENT_PASSWORD;
    const gradeLevel = cell(row, 3);

    if (!emailRaw && !fullName) continue; // empty row
    if (isPlaceholder(emailRaw)) continue;
    if (!emailRaw || !fullName) {
      // 1-based row number: startIndex + i + 1 (1-based within entire sheet)
      const oneBasedRow = startIndex + i + 1;
      issues.push({
        sheet: sheetName,
        row: oneBasedRow,
        message: `Missing required cell(s): fullName=${JSON.stringify(fullName)}, email=${JSON.stringify(emailRaw)}`,
      });
      continue;
    }
    students.push({ fullName, email: emailRaw.toLowerCase(), password, gradeLevel });
  }
  return students;
}

function parseEnrollments(
  wb: XLSX.WorkBook,
  issues: RowIssue[],
): EnrollmentRow[] {
  const ws = wb.Sheets[SHEET_ENROLLMENTS];
  if (!ws) {
    issues.push({ sheet: SHEET_ENROLLMENTS, row: 0, message: 'Missing sheet' });
    return [];
  }
  const rows = sheetRows(ws);
  const enrollments: EnrollmentRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const studentEmailRaw = cell(row, 0);
    const className = cell(row, 1);
    const period = cell(row, 2);
    const teacherEmailRaw = cell(row, 3);

    if (!studentEmailRaw && !className) continue;
    if (isPlaceholder(studentEmailRaw)) continue;
    if (!studentEmailRaw || !className) {
      issues.push({
        sheet: SHEET_ENROLLMENTS,
        row: rowNumber(i),
        message: `Missing required cell(s): studentEmail=${JSON.stringify(studentEmailRaw)}, className=${JSON.stringify(className)}`,
      });
      continue;
    }
    enrollments.push({
      studentEmail: studentEmailRaw.toLowerCase(),
      className,
      period,
      teacherEmail: teacherEmailRaw.toLowerCase(),
    });
  }
  return enrollments;
}

function parseParents(
  wb: XLSX.WorkBook,
  issues: RowIssue[],
): ParentRow[] {
  const ws = wb.Sheets[SHEET_PARENTS];
  if (!ws) {
    issues.push({ sheet: SHEET_PARENTS, row: 0, message: 'Missing sheet' });
    return [];
  }
  const rows = sheetRows(ws);
  const parents: ParentRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fullName = cell(row, 0);
    const emailRaw = cell(row, 1);
    const password = cell(row, 2) || DEFAULT_PARENT_PASSWORD;
    const studentEmailRaw = cell(row, 3);

    if (!emailRaw && !fullName) continue;
    if (isPlaceholder(emailRaw)) continue;
    if (!emailRaw || !fullName || !studentEmailRaw) {
      issues.push({
        sheet: SHEET_PARENTS,
        row: rowNumber(i),
        message: `Missing required cell(s): fullName=${JSON.stringify(fullName)}, email=${JSON.stringify(emailRaw)}, studentEmail=${JSON.stringify(studentEmailRaw)}`,
      });
      continue;
    }
    parents.push({
      fullName,
      email: emailRaw.toLowerCase(),
      password,
      studentEmail: studentEmailRaw.toLowerCase(),
    });
  }
  return parents;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a complete 5-sheet roster workbook (Teachers / Classes / Students /
 * Enrollments / Parents). Mirrors V1 importer behavior exactly:
 * - Data rows start at sheet row index 3 (rows 0-2 are meta/headers).
 * - Placeholder rows (email contains 'email' or '@example') are silently skipped.
 * - Rows with missing required cells are skipped + a RowIssue recorded.
 * - Missing sheets yield an empty array + a RowIssue.
 * - All emails are lowercased.
 */
export function parseRosterWorkbook(bytes: ArrayBuffer | Uint8Array): ParseResult {
  const wb = XLSX.read(bytes, { type: 'array' });
  const issues: RowIssue[] = [];

  const teachers = parseTeachers(wb, issues);
  const classes = parseClasses(wb, issues);

  // Students sheet (full workbook path always starts at index 3)
  const studentsWs = wb.Sheets[SHEET_STUDENTS];
  let students: StudentRow[] = [];
  if (!studentsWs) {
    issues.push({ sheet: SHEET_STUDENTS, row: 0, message: 'Missing sheet' });
  } else {
    students = parseStudents(studentsWs, SHEET_STUDENTS, 3, issues);
  }

  const enrollments = parseEnrollments(wb, issues);
  const parents = parseParents(wb, issues);

  const roster: ParsedRoster = { teachers, classes, students, enrollments, parents };
  return { roster, issues };
}

/**
 * Parse a single-sheet students workbook OR a CSV.
 *
 * Workbook behavior: uses a sheet named "Students" if present, otherwise
 * the first sheet. Starts at row index 3 (V1 convention — rows 0-2 are meta).
 *
 * CSV / header-only behavior: if the first row looks like a header row
 * (any cell contains 'email' or 'name', case-insensitive), starts at row
 * index 1 instead of row index 3. This handles CSVs that have a single
 * header row with no preceding meta rows.
 */
export function parseStudentSheet(
  bytes: ArrayBuffer | Uint8Array,
): { students: StudentRow[]; issues: RowIssue[] } {
  const wb = XLSX.read(bytes, { type: 'array' });
  const issues: RowIssue[] = [];

  // Prefer a sheet named "Students"; fall back to the first sheet.
  const sheetName =
    wb.SheetNames.includes(SHEET_STUDENTS)
      ? SHEET_STUDENTS
      : wb.SheetNames[0];

  const ws = wb.Sheets[sheetName];
  if (!ws) {
    issues.push({ sheet: sheetName ?? 'unknown', row: 0, message: 'Missing sheet' });
    return { students: [], issues };
  }

  // Detect whether the workbook has the 3-row meta preamble (V1 xlsx template)
  // or is a flat CSV/xlsx with only a single header row.
  const allRows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 }) as string[][];
  const startIndex = detectStartIndex(allRows);

  const students = parseStudents(ws, sheetName, startIndex, issues);
  return { students, issues };
}

/**
 * Detect the first data row index.
 *
 * Rules (applied in order):
 * 1. If row[3] looks like a header (any cell lowercased contains 'email' or 'name'),
 *    use the V1 template convention → start at 3.
 * 2. If row[0] looks like a header (same check), start at 1 (CSV convention).
 * 3. Default to 3 (V1 template convention).
 */
function detectStartIndex(rows: string[][]): number {
  const isHeaderLike = (row: string[] | undefined): boolean => {
    if (!row) return false;
    return row.some((c) => {
      const lower = String(c ?? '').toLowerCase();
      return lower.includes('email') || lower.includes('name');
    });
  };

  // If the workbook has at least 4 rows and row[2] looks like a header
  // (V1 template structure), data starts at index 3.
  if (rows.length >= 4 && isHeaderLike(rows[2])) {
    return 3;
  }

  // If row[0] looks like a header (CSV with a single header row), start at 1.
  if (isHeaderLike(rows[0])) {
    return 1;
  }

  // Default: V1 convention
  return 3;
}
