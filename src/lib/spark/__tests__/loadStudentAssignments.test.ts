import { describe, it, expect, vi } from 'vitest';
import { loadStudentAssignments } from '../loadStudentAssignments';

function makeAdmin(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return { from: vi.fn(() => chain) } as never;
}

describe('loadStudentAssignments', () => {
  it('maps rows to { id, title, sparkStatus } using content.title', async () => {
    const rows = [
      { id: 'a1', content: { title: 'Ecosystems Challenge' }, spark_status: 'created' },
      { id: 'a2', content: { title: 'Forces & Motion' }, spark_status: 'none' },
    ];
    const result = await loadStudentAssignments(makeAdmin(rows), 'stu-1');
    expect(result).toEqual([
      { id: 'a1', title: 'Ecosystems Challenge', sparkStatus: 'created' },
      { id: 'a2', title: 'Forces & Motion', sparkStatus: 'none' },
    ]);
  });

  it('falls back title to "Assignment" when content.title is missing', async () => {
    const rows = [{ id: 'a3', content: null, spark_status: null }];
    const result = await loadStudentAssignments(makeAdmin(rows), 'stu-2');
    expect(result).toEqual([{ id: 'a3', title: 'Assignment', sparkStatus: 'none' }]);
  });

  it('returns [] when no assignments', async () => {
    const result = await loadStudentAssignments(makeAdmin([]), 'stu-3');
    expect(result).toEqual([]);
  });
});
