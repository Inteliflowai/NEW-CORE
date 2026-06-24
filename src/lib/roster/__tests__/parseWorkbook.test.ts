// src/lib/roster/__tests__/parseWorkbook.test.ts
// Node env (default) — no jsdom header needed.
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseRosterWorkbook, parseStudentSheet } from '@/lib/roster/parseWorkbook';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a well-formed 5-sheet roster workbook fixture in memory. */
function buildFullWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  // Instructions sheet (not parsed by the importer — just present in the template)
  const wsInstructions = XLSX.utils.aoa_to_sheet([['Instructions go here']]);
  XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

  // Teachers sheet: 3 header/meta rows (indices 0-2) then data from index 3
  const wsTeachers = XLSX.utils.aoa_to_sheet([
    ['CORE Roster Template'],              // row 0
    [''],                                  // row 1
    ['Full Name', 'Email', 'Password'],    // row 2 (column headers — skipped)
    ['Alice Smith', 'alice@school.edu', 'Pass123!'],
    ['Bob Jones', 'BOB@SCHOOL.EDU', 'Pass456!'], // email should be lowercased
  ]);
  XLSX.utils.book_append_sheet(wb, wsTeachers, 'Teachers');

  // Classes sheet
  const wsClasses = XLSX.utils.aoa_to_sheet([
    ['CORE Roster Template'],
    [''],
    ['Class Name', 'Subject', 'Grade Level', 'Period', 'Teacher Email'],
    ['Math 101', 'Mathematics', '9', '1', 'alice@school.edu'],
    ['English 102', 'English', '10', '2', 'bob@school.edu'],
  ]);
  XLSX.utils.book_append_sheet(wb, wsClasses, 'Classes');

  // Students sheet
  const wsStudents = XLSX.utils.aoa_to_sheet([
    ['CORE Roster Template'],
    [''],
    ['Full Name', 'Email', 'Password', 'Grade Level'],
    ['Carol White', 'carol@school.edu', 'Student2026!', '9'],
    ['Dave Brown', 'DAVE@school.edu', 'Student2026!', '10'],
  ]);
  XLSX.utils.book_append_sheet(wb, wsStudents, 'Students');

  // Enrollments sheet
  const wsEnrollments = XLSX.utils.aoa_to_sheet([
    ['CORE Roster Template'],
    [''],
    ['Student Email', 'Class Name', 'Period', 'Teacher Email'],
    ['carol@school.edu', 'Math 101', '1', 'alice@school.edu'],
    ['dave@school.edu', 'English 102', '2', 'bob@school.edu'],
  ]);
  XLSX.utils.book_append_sheet(wb, wsEnrollments, 'Enrollments');

  // Parents sheet
  const wsParents = XLSX.utils.aoa_to_sheet([
    ['CORE Roster Template'],
    [''],
    ['Parent Full Name', 'Parent Email', 'Password', 'Student Email'],
    ['Eve White', 'eve@parent.com', 'Core2026!', 'carol@school.edu'],
  ]);
  XLSX.utils.book_append_sheet(wb, wsParents, 'Parents');

  // XLSX.write with type:'array' returns an ArrayBuffer directly in SheetJS 0.20.x
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** Build a workbook with placeholder/example rows. */
function buildWorkbookWithPlaceholders(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const wsTeachers = XLSX.utils.aoa_to_sheet([
    ['CORE Roster Template'],
    [''],
    ['Full Name', 'Email', 'Password'],
    ['Alice Smith', 'alice@school.edu', 'Pass123!'],          // real
    ['Example Teacher', 'teacher@example.com', 'Pass!'],      // placeholder (@example)
    ['Example Teacher 2', 'email@school.edu', 'Pass!'],       // placeholder (contains 'email')
    ['Example Teacher 3', 'john.email@school.edu', 'Pass!'],  // contains 'email' — placeholder
  ]);
  XLSX.utils.book_append_sheet(wb, wsTeachers, 'Teachers');

  // minimal other sheets
  for (const name of ['Classes', 'Students', 'Enrollments', 'Parents']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CORE'],[''],['Hdr']]), name);
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** Build a workbook where some rows have missing required cells. */
function buildWorkbookWithMissingCells(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const wsStudents = XLSX.utils.aoa_to_sheet([
    ['CORE Roster Template'],
    [''],
    ['Full Name', 'Email', 'Password', 'Grade Level'],
    ['Carol White', 'carol@school.edu', 'Student2026!', '9'],  // good
    ['No Email Student', '', 'Student2026!', '9'],              // missing email → issue
    ['', 'nofullname@school.edu', 'Student2026!', '9'],        // missing full name → issue
  ]);
  XLSX.utils.book_append_sheet(wb, wsStudents, 'Students');

  for (const name of ['Teachers', 'Classes', 'Enrollments', 'Parents']) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CORE'],[''],['Hdr']]), name);
  }

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** Build a workbook missing the Parents sheet. */
function buildWorkbookMissingParents(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['CORE'],[''],['Full Name', 'Email', 'Password'],
    ['Alice Smith', 'alice@school.edu', 'Pass123!'],
  ]), 'Teachers');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['CORE'],[''],['Class Name', 'Subject', 'Grade Level', 'Period', 'Teacher Email'],
    ['Math 101', 'Mathematics', '9', '1', 'alice@school.edu'],
  ]), 'Classes');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['CORE'],[''],['Full Name', 'Email', 'Password', 'Grade Level'],
    ['Carol White', 'carol@school.edu', 'Student2026!', '9'],
  ]), 'Students');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['CORE'],[''],['Student Email', 'Class Name', 'Period', 'Teacher Email'],
    ['carol@school.edu', 'Math 101', '1', 'alice@school.edu'],
  ]), 'Enrollments');

  // No Parents sheet

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** Build a single-sheet students-only workbook (for parseStudentSheet). */
function buildStudentOnlyWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['CORE Roster Template'],
    [''],
    ['Full Name', 'Email', 'Password', 'Grade Level'],
    ['Carol White', 'carol@school.edu', 'Student2026!', '9'],
    ['Dave Brown', 'dave@school.edu', '', '10'],  // no password — should use default
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Students');

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/** Build a CSV buffer (string → UTF-8 bytes) for parseStudentSheet. */
function buildStudentCsvBuffer(): ArrayBuffer {
  // CSV: header row + 2 data rows (no leading meta rows)
  const csv = [
    'Full Name,Email,Password,Grade Level',
    'Eve Green,eve@school.edu,Student2026!,8',
    'Frank Blue,frank@school.edu,,11',
  ].join('\n');
  const bytes = new TextEncoder().encode(csv);
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseRosterWorkbook', () => {
  it('parses a well-formed 5-sheet workbook with correct counts and values', () => {
    const result = parseRosterWorkbook(buildFullWorkbook());

    expect(result.roster.teachers).toHaveLength(2);
    expect(result.roster.classes).toHaveLength(2);
    expect(result.roster.students).toHaveLength(2);
    expect(result.roster.enrollments).toHaveLength(2);
    expect(result.roster.parents).toHaveLength(1);
  });

  it('lowercases all emails', () => {
    const result = parseRosterWorkbook(buildFullWorkbook());

    const teacherEmails = result.roster.teachers.map((t) => t.email);
    expect(teacherEmails).toContain('alice@school.edu');
    expect(teacherEmails).toContain('bob@school.edu'); // was 'BOB@SCHOOL.EDU'

    const studentEmails = result.roster.students.map((s) => s.email);
    expect(studentEmails).toContain('carol@school.edu');
    expect(studentEmails).toContain('dave@school.edu'); // was 'DAVE@school.edu'
  });

  it('returns correct field values for teachers', () => {
    const result = parseRosterWorkbook(buildFullWorkbook());
    const alice = result.roster.teachers.find((t) => t.email === 'alice@school.edu');
    expect(alice).toBeDefined();
    expect(alice!.fullName).toBe('Alice Smith');
    expect(alice!.password).toBe('Pass123!');
  });

  it('returns correct field values for classes', () => {
    const result = parseRosterWorkbook(buildFullWorkbook());
    const math = result.roster.classes.find((c) => c.name === 'Math 101');
    expect(math).toBeDefined();
    expect(math!.subject).toBe('Mathematics');
    expect(math!.gradeLevel).toBe('9');
    expect(math!.period).toBe('1');
    expect(math!.teacherEmail).toBe('alice@school.edu');
  });

  it('returns correct field values for enrollments', () => {
    const result = parseRosterWorkbook(buildFullWorkbook());
    const enroll = result.roster.enrollments.find(
      (e) => e.studentEmail === 'carol@school.edu',
    );
    expect(enroll).toBeDefined();
    expect(enroll!.className).toBe('Math 101');
    expect(enroll!.period).toBe('1');
    expect(enroll!.teacherEmail).toBe('alice@school.edu');
  });

  it('returns correct field values for parents', () => {
    const result = parseRosterWorkbook(buildFullWorkbook());
    const parent = result.roster.parents[0];
    expect(parent.fullName).toBe('Eve White');
    expect(parent.email).toBe('eve@parent.com');
    expect(parent.password).toBe('Core2026!');
    expect(parent.studentEmail).toBe('carol@school.edu');
  });

  it('has no issues for a well-formed workbook', () => {
    const result = parseRosterWorkbook(buildFullWorkbook());
    expect(result.issues).toHaveLength(0);
  });

  it('skips placeholder rows where email contains "email"', () => {
    const result = parseRosterWorkbook(buildWorkbookWithPlaceholders());
    // Only 'alice@school.edu' is real; the 3 placeholder rows must be skipped silently
    expect(result.roster.teachers).toHaveLength(1);
    expect(result.roster.teachers[0].email).toBe('alice@school.edu');
    // Placeholder skips should NOT generate issues
    const placeholderIssues = result.issues.filter((i) => i.sheet === 'Teachers');
    expect(placeholderIssues).toHaveLength(0);
  });

  it('skips placeholder rows where email contains "@example"', () => {
    const result = parseRosterWorkbook(buildWorkbookWithPlaceholders());
    const teacherEmails = result.roster.teachers.map((t) => t.email);
    expect(teacherEmails).not.toContain('teacher@example.com');
  });

  it('skips malformed rows missing required cells and records a RowIssue', () => {
    const result = parseRosterWorkbook(buildWorkbookWithMissingCells());

    // Only carol (the valid row) should be imported
    expect(result.roster.students).toHaveLength(1);
    expect(result.roster.students[0].email).toBe('carol@school.edu');

    // Two malformed rows → two issues
    const studentIssues = result.issues.filter((i) => i.sheet === 'Students');
    expect(studentIssues).toHaveLength(2);
    // Issues reference the correct 1-based row numbers (row index 4 and 5 in the sheet = rows 5 and 6 in 1-based)
    expect(studentIssues.map((i) => i.row)).toEqual(expect.arrayContaining([5, 6]));
  });

  it('returns empty array + an issue when a sheet is missing (e.g., no Parents)', () => {
    const result = parseRosterWorkbook(buildWorkbookMissingParents());

    expect(result.roster.parents).toHaveLength(0);
    const missingSheetIssue = result.issues.find(
      (i) => i.sheet === 'Parents' && i.message.toLowerCase().includes('missing'),
    );
    expect(missingSheetIssue).toBeDefined();

    // Other sheets should still parse correctly
    expect(result.roster.teachers).toHaveLength(1);
    expect(result.roster.students).toHaveLength(1);
    expect(result.roster.enrollments).toHaveLength(1);
  });

  it('uses default passwords from V1 when the password cell is empty', () => {
    // Build a workbook with an empty password column for a teacher
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['CORE'],[''],['Full Name', 'Email', 'Password'],
      ['No Pass Teacher', 'nopass@school.edu', ''],
    ]), 'Teachers');
    for (const name of ['Classes', 'Students', 'Enrollments', 'Parents']) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CORE'],[''],['Hdr']]), name);
    }
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const result = parseRosterWorkbook(bytes);
    expect(result.roster.teachers[0].password).toBe('Core2026!');
  });

  it('uses default Student password when student password cell is empty', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CORE'],[''],['Hdr']]), 'Teachers');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CORE'],[''],['Hdr']]), 'Classes');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['CORE'],[''],['Full Name', 'Email', 'Password', 'Grade Level'],
      ['No Pass Student', 'nopasStudent@school.edu', '', '9'],
    ]), 'Students');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CORE'],[''],['Hdr']]), 'Enrollments');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['CORE'],[''],['Hdr']]), 'Parents');
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const result = parseRosterWorkbook(bytes);
    expect(result.roster.students[0].password).toBe('Student2026!');
  });
});

describe('parseStudentSheet', () => {
  it('parses a single-sheet students workbook (row-index-3 start)', () => {
    const result = parseStudentSheet(buildStudentOnlyWorkbook());
    expect(result.students).toHaveLength(2);
    expect(result.students[0].email).toBe('carol@school.edu');
    expect(result.students[0].fullName).toBe('Carol White');
    expect(result.students[1].email).toBe('dave@school.edu');
  });

  it('uses default Student password when empty in single-sheet workbook', () => {
    const result = parseStudentSheet(buildStudentOnlyWorkbook());
    // Dave has no password in fixture
    const dave = result.students.find((s) => s.email === 'dave@school.edu');
    expect(dave!.password).toBe('Student2026!');
  });

  it('prefers a sheet named "Students" if it exists', () => {
    // The buildStudentOnlyWorkbook already uses "Students" as the sheet name
    const result = parseStudentSheet(buildStudentOnlyWorkbook());
    expect(result.students.length).toBeGreaterThan(0);
  });

  it('parses a CSV where the first row is a header row (skipped)', () => {
    const result = parseStudentSheet(buildStudentCsvBuffer());
    expect(result.students).toHaveLength(2);
    expect(result.students[0].email).toBe('eve@school.edu');
    expect(result.students[0].fullName).toBe('Eve Green');
    expect(result.students[1].email).toBe('frank@school.edu');
  });

  it('lowercases emails in CSV import', () => {
    const csv = [
      'Full Name,Email,Password,Grade Level',
      'Upper Case,UPPER@SCHOOL.EDU,Pass!,9',
    ].join('\n');
    const bytes = new TextEncoder().encode(csv);
    const result = parseStudentSheet(bytes.buffer);
    expect(result.students[0].email).toBe('upper@school.edu');
  });

  it('skips placeholder rows in CSV', () => {
    const csv = [
      'Full Name,Email,Password,Grade Level',
      'Example,student@example.com,Pass!,9',
      'Real Student,real@school.edu,Pass!,9',
    ].join('\n');
    const bytes = new TextEncoder().encode(csv);
    const result = parseStudentSheet(bytes.buffer);
    expect(result.students).toHaveLength(1);
    expect(result.students[0].email).toBe('real@school.edu');
  });

  it('records a RowIssue for a CSV row missing email', () => {
    const csv = [
      'Full Name,Email,Password,Grade Level',
      'No Email,,Pass!,9',
    ].join('\n');
    const bytes = new TextEncoder().encode(csv);
    const result = parseStudentSheet(bytes.buffer);
    expect(result.students).toHaveLength(0);
    expect(result.issues).toHaveLength(1);
  });
});
