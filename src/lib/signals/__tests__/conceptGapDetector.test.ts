import { describe, it, expect } from 'vitest';
import { detectConceptGaps, THRESHOLD_PCT, MIN_STUDENTS } from '../conceptGapDetector';

describe('THRESHOLD_PCT and MIN_STUDENTS constants', () => {
  it('THRESHOLD_PCT is 40', () => {
    expect(THRESHOLD_PCT).toBe(40);
  });
  it('MIN_STUDENTS is 5', () => {
    expect(MIN_STUDENTS).toBe(5);
  });
});

describe('detectConceptGaps', () => {
  // Helper: build per-student per-question data
  function makeData(
    questions: { questionIndex: number; questionText: string }[],
    responses: { studentId: string; questionIndex: number; isCorrect: boolean }[],
  ) {
    return { questions, responses };
  }

  it('returns empty array when fewer than MIN_STUDENTS students', () => {
    const data = makeData(
      [{ questionIndex: 1, questionText: 'Q1' }],
      [
        { studentId: 'A', questionIndex: 1, isCorrect: false },
        { studentId: 'B', questionIndex: 1, isCorrect: false },
        { studentId: 'C', questionIndex: 1, isCorrect: false },
        { studentId: 'D', questionIndex: 1, isCorrect: false },
        // Only 4 students — below MIN_STUDENTS (5)
      ],
    );
    expect(detectConceptGaps(data)).toHaveLength(0);
  });

  it('returns empty array when pct_incorrect is below THRESHOLD_PCT (40)', () => {
    // 5 students, 1 wrong (20%) — below threshold
    const data = makeData(
      [{ questionIndex: 1, questionText: 'Q1' }],
      [
        { studentId: 'A', questionIndex: 1, isCorrect: false },
        { studentId: 'B', questionIndex: 1, isCorrect: true },
        { studentId: 'C', questionIndex: 1, isCorrect: true },
        { studentId: 'D', questionIndex: 1, isCorrect: true },
        { studentId: 'E', questionIndex: 1, isCorrect: true },
      ],
    );
    expect(detectConceptGaps(data)).toHaveLength(0);
  });

  it('returns a gap when pct_incorrect is exactly THRESHOLD_PCT', () => {
    // 5 students, 2 wrong = 40% — exactly at threshold
    const data = makeData(
      [{ questionIndex: 1, questionText: 'What is photosynthesis?' }],
      [
        { studentId: 'A', questionIndex: 1, isCorrect: false },
        { studentId: 'B', questionIndex: 1, isCorrect: false },
        { studentId: 'C', questionIndex: 1, isCorrect: true },
        { studentId: 'D', questionIndex: 1, isCorrect: true },
        { studentId: 'E', questionIndex: 1, isCorrect: true },
      ],
    );
    const gaps = detectConceptGaps(data);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].question_index).toBe(1);
    expect(gaps[0].pct_incorrect).toBe(40);
    expect(gaps[0].question_text).toBe('What is photosynthesis?');
  });

  it('returns multiple gaps when multiple questions cross the threshold', () => {
    // 5 students; Q1: 3/5 wrong (60%); Q2: 2/5 wrong (40%); Q3: 1/5 wrong (20%)
    const data = makeData(
      [
        { questionIndex: 1, questionText: 'Q1' },
        { questionIndex: 2, questionText: 'Q2' },
        { questionIndex: 3, questionText: 'Q3' },
      ],
      [
        { studentId: 'A', questionIndex: 1, isCorrect: false },
        { studentId: 'A', questionIndex: 2, isCorrect: false },
        { studentId: 'A', questionIndex: 3, isCorrect: false },
        { studentId: 'B', questionIndex: 1, isCorrect: false },
        { studentId: 'B', questionIndex: 2, isCorrect: false },
        { studentId: 'B', questionIndex: 3, isCorrect: true },
        { studentId: 'C', questionIndex: 1, isCorrect: false },
        { studentId: 'C', questionIndex: 2, isCorrect: true },
        { studentId: 'C', questionIndex: 3, isCorrect: true },
        { studentId: 'D', questionIndex: 1, isCorrect: true },
        { studentId: 'D', questionIndex: 2, isCorrect: true },
        { studentId: 'D', questionIndex: 3, isCorrect: true },
        { studentId: 'E', questionIndex: 1, isCorrect: true },
        { studentId: 'E', questionIndex: 2, isCorrect: true },
        { studentId: 'E', questionIndex: 3, isCorrect: true },
      ],
    );
    const gaps = detectConceptGaps(data);
    // Q1 (60%) and Q2 (40%) exceed/meet threshold; Q3 (20%) does not
    expect(gaps).toHaveLength(2);
    const indices = gaps.map((g) => g.question_index).sort();
    expect(indices).toEqual([1, 2]);
  });

  it('requires MIN_STUDENTS responses per question (not overall)', () => {
    // 6 students total, but Q2 only has responses from 3 -> Q2 skipped even if 100% wrong
    const data = makeData(
      [
        { questionIndex: 1, questionText: 'Q1' },
        { questionIndex: 2, questionText: 'Q2' },
      ],
      [
        { studentId: 'A', questionIndex: 1, isCorrect: false },
        { studentId: 'B', questionIndex: 1, isCorrect: false },
        { studentId: 'C', questionIndex: 1, isCorrect: false },
        { studentId: 'D', questionIndex: 1, isCorrect: true },
        { studentId: 'E', questionIndex: 1, isCorrect: true },
        { studentId: 'F', questionIndex: 1, isCorrect: true },
        // Q2: only 3 students answered
        { studentId: 'A', questionIndex: 2, isCorrect: false },
        { studentId: 'B', questionIndex: 2, isCorrect: false },
        { studentId: 'C', questionIndex: 2, isCorrect: false },
      ],
    );
    const gaps = detectConceptGaps(data);
    // Q1: 3/6 = 50% >= 40%, 6 students -> gap. Q2: only 3 responses -> skipped.
    expect(gaps).toHaveLength(1);
    expect(gaps[0].question_index).toBe(1);
  });
});
