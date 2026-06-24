// src/lib/roster/types.ts
// Pure types for the roster workbook parser — no framework imports.

export interface TeacherRow {
  fullName: string;
  email: string;
  password: string;
}

export interface ClassRow {
  name: string;
  subject: string;
  gradeLevel: string;
  period: string;
  teacherEmail: string;
}

export interface StudentRow {
  fullName: string;
  email: string;
  password: string;
  gradeLevel: string;
}

export interface EnrollmentRow {
  studentEmail: string;
  className: string;
  period: string;
  teacherEmail: string;
}

export interface ParentRow {
  fullName: string;
  email: string;
  password: string;
  studentEmail: string;
}

export interface ParsedRoster {
  teachers: TeacherRow[];
  classes: ClassRow[];
  students: StudentRow[];
  enrollments: EnrollmentRow[];
  parents: ParentRow[];
}

export interface RowIssue {
  sheet: string;
  row: number;
  message: string;
}

export interface ParseResult {
  roster: ParsedRoster;
  issues: RowIssue[];
}
