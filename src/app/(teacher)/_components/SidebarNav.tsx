'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { NAV_ENTRIES, isGroup, matchActive, type NavItem, type NavIconKey } from './navConfig';
import {
  IconToday, IconRoster, IconGradebook, IconAlerts, IconHighFive,
  IconLessons, IconQuizzes, IconInsights, IconUpload, IconBolt,
} from '@/components/core/icons';

const ICON: Record<NavIconKey, (p: { className?: string }) => React.JSX.Element> = {
  today: IconToday,
  challenges: IconBolt,
  roster: IconRoster,
  gradebook: IconGradebook,
  alerts: IconAlerts,
  highFive: IconHighFive,
  lessons: IconLessons,
  quizzes: IconQuizzes,
  insights: IconInsights,
  upload: IconUpload,
  googleClassroom: IconUpload,
};

function NavLink({ item, alertCount }: { item: NavItem; alertCount?: number }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = matchActive(pathname, item.href, item.alsoActiveWhen);
  const Icon = ICON[item.icon];
  // Carry the active class through navigation so screens never land param-less
  // (which would flash the server "pick a class" state before the switcher re-adds it).
  const cls = searchParams.get('class');
  const href = cls ? `${item.href}?class=${encodeURIComponent(cls)}` : item.href;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={[
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
        active
          ? 'bg-sidebar-active text-sidebar-active-fg shadow-sticker'
          : 'text-sidebar-fg hover:bg-sidebar-fg/15',
      ].join(' ')}
    >
      <Icon className="size-[18px] shrink-0" />
      {item.label}
      {item.badgeKey === 'alerts' && (alertCount ?? 0) > 0 && (
        <span aria-label={alertCount === 1 ? '1 student needs attention' : `${alertCount} students need attention`}
          className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full border-2 border-sidebar-edge bg-risk px-1.5 text-xs font-bold text-fg">
          {alertCount}
        </span>
      )}
    </Link>
  );
}

export function SidebarNav({ alertCount }: { alertCount?: number }) {
  return (
    <nav aria-label="Teacher navigation" className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
      {NAV_ENTRIES.map((entry) =>
        isGroup(entry) ? (
          <div key={entry.groupLabel} className="flex flex-col gap-1">
            <span className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-sidebar-fg-muted">
              {entry.groupLabel}
            </span>
            {entry.items.map((i) => (
              <NavLink key={i.href} item={i} alertCount={alertCount} />
            ))}
          </div>
        ) : (
          <NavLink key={entry.href} item={entry} alertCount={alertCount} />
        ),
      )}
    </nav>
  );
}

export default SidebarNav;
