'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { EmptyState } from '@/components/core/EmptyState';

interface ClassOption {
  class_id: string;
  label: string;
  subject: string | null;
  student_count: number;
}

/** Truthful meta line for the selected class — subject omitted when null, count pluralized. */
export function classMetaLine({ subject, student_count }: { subject: string | null; student_count: number }): string {
  const noun = student_count === 1 ? 'student' : 'students';
  const count = `${student_count} ${noun}`;
  return subject ? `${subject} · ${count}` : count;
}

export function ClassSwitcherPill() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [classes, setClasses] = useState<ClassOption[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/teacher/classes')
      .then((r) => r.json())
      .then((data: { classes: ClassOption[] }) => {
        setClasses(data.classes);
        setLoading(false);
      })
      .catch(() => {
        setClasses([]);
        setLoading(false);
      });
  }, []);

  // Default the URL ?class= to the first class when none is selected, so teacher
  // screens that read ?class= render immediately instead of a "pick a class" state.
  // Re-runs on mount and on route change (pathname) — deliberately NOT keyed on
  // searchParams identity, which would loop; once the param is set the guard no-ops.
  useEffect(() => {
    if (classes && classes.length > 0 && !searchParams.get('class')) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('class', classes[0].class_id);
      router.replace(`${pathname}?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes, pathname]);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    const params = new URLSearchParams(searchParams.toString());
    params.set('class', id);
    router.replace(`${pathname}?${params.toString()}`);
  }

  if (loading) {
    return <div aria-busy="true" className="h-9 w-full rounded bg-sidebar-plate/20 animate-pulse" />;
  }

  if (!classes || classes.length === 0) {
    return <EmptyState variant="just-getting-started" />;
  }

  const selectedId = searchParams.get('class') ?? classes[0]?.class_id;
  const selected = classes.find((c) => c.class_id === selectedId) ?? classes[0];

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sidebar-fg-muted text-[10px] font-bold uppercase tracking-wider">Active class</p>
      <select
        onChange={handleChange}
        defaultValue={selectedId ?? undefined}
        aria-label="Active class"
        className="w-full rounded border border-sidebar-edge bg-sidebar-plate px-3 py-2 text-sm font-bold text-brand shadow-sticker focus:outline-none focus:ring-2 focus:ring-sidebar-active"
      >
        {classes.map((c) => (
          <option key={c.class_id} value={c.class_id}>
            {c.label}
          </option>
        ))}
      </select>
      <p className="text-sidebar-fg-muted text-[11px]">{classMetaLine(selected)}</p>
    </div>
  );
}

export default ClassSwitcherPill;
