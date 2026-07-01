import React from 'react';
import { Card } from '@/components/core/Card';
import type { ChildTeacher } from '@/lib/parent/loadChildTeachers';

/** mailto-only contact card. Hidden when the child has no resolvable teacher. */
export function ContactTeacherCard({ teachers }: { teachers: ChildTeacher[] }): React.JSX.Element | null {
  if (teachers.length === 0) return null;
  return (
    <Card>
      <div className="flex flex-col gap-3">
        <p className="text-fg text-xs font-bold uppercase tracking-wide">Reach out to the teacher</p>
        <ul className="flex flex-col gap-3">
          {teachers.map((t) => (
            <li key={t.teacherId} className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-fg text-sm">{t.name}</span>
                <span className="text-fg-muted text-xs">{t.classLabel}</span>
              </span>
              <a
                href={`mailto:${t.email}`}
                className="text-brand text-sm underline whitespace-nowrap"
              >
                Send an email →
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default ContactTeacherCard;
