import { EmptyState } from '@/components/core/EmptyState';

export default async function StudentPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;

  return (
    <div className="p-6">
      <h1 className="text-fg font-display text-2xl font-semibold mb-6">
        Student {studentId}
      </h1>
      <EmptyState variant="just-getting-started" />
    </div>
  );
}
