import { EmptyState } from '@/components/core/EmptyState';

export default function TodayPage() {
  return (
    <div className="p-6">
      <h1 className="text-fg font-display text-2xl font-semibold mb-6">Today</h1>
      <EmptyState variant="just-getting-started" />
    </div>
  );
}
