'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { EmptyState } from '@/components/core/EmptyState';

interface ClassOption {
  class_id: string;
  label: string;
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
    return (
      <div
        aria-busy="true"
        className="inline-block w-40 h-8 rounded bg-surface animate-pulse"
      />
    );
  }

  if (!classes || classes.length === 0) {
    return <EmptyState variant="just-getting-started" />;
  }

  return (
    <select
      onChange={handleChange}
      defaultValue={searchParams.get('class') ?? undefined}
      className="text-fg bg-surface border border-surface rounded px-3 py-1 text-sm hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand"
    >
      {classes.map((c) => (
        <option key={c.class_id} value={c.class_id}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

export default ClassSwitcherPill;
