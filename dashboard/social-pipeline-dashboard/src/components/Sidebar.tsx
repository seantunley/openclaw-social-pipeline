import { NavLink } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useT, useLocale, LOCALES } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { useSummary } from '@/hooks/useSummary';
import { useQuery } from '@tanstack/react-query';
import { fetchEnvStatus } from '@/lib/api';
import Flag from './Flag';
import {
  LayoutDashboard,
  Play,
  CheckSquare,
  Megaphone,
  FlaskConical,
  Brain,
  ImageIcon,
  CalendarDays,
  Inbox,
  BarChart3,
  Settings as SettingsIcon,
  Trash,
  Sparkles,
  PenSquare,
  ChevronDown,
  Sun,
  Moon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  to: string;
  icon: LucideIcon;
  /** i18n key for the label. */
  labelKey: string;
}

interface NavGroup {
  /** i18n key for the group heading. */
  headingKey: string;
  items: NavItem[];
}

// Three groups, mirroring the Content Machine information architecture.
// Settings + Trash + Brand voice live BELOW the groups (utility shelf).
const GROUPS: NavGroup[] = [
  {
    headingKey: 'nav.groups.create',
    items: [
      { to: '/', icon: LayoutDashboard, labelKey: 'nav.overview' },
      { to: '/runs', icon: Play, labelKey: 'nav.runs' },
      { to: '/research', icon: FlaskConical, labelKey: 'nav.research' },
      { to: '/composer', icon: PenSquare, labelKey: 'nav.composer' },
      { to: '/media-studio', icon: ImageIcon, labelKey: 'nav.media_studio' },
    ],
  },
  {
    headingKey: 'nav.groups.engage',
    items: [
      { to: '/approvals', icon: CheckSquare, labelKey: 'nav.approvals' },
      { to: '/inbox', icon: Inbox, labelKey: 'nav.inbox' },
      { to: '/schedule', icon: CalendarDays, labelKey: 'nav.schedule' },
      { to: '/analytics', icon: BarChart3, labelKey: 'nav.analytics' },
    ],
  },
  // Phase E split: "Brand" is set-once configuration (voice, campaigns —
  // touched rarely after onboarding). "Tuning" is recurring (review the
  // learnings extracted from edits/rejections). Grouping them differently
  // makes the recurring review surface easier to find.
  {
    headingKey: 'nav.groups.brand',
    items: [
      { to: '/brand', icon: Sparkles, labelKey: 'nav.brand' },
      { to: '/campaigns', icon: Megaphone, labelKey: 'nav.campaigns' },
    ],
  },
  {
    headingKey: 'nav.groups.tuning',
    items: [
      { to: '/learnings', icon: Brain, labelKey: 'nav.learnings' },
    ],
  },
];

const UTILITY_ITEMS: NavItem[] = [
  { to: '/settings', icon: SettingsIcon, labelKey: 'nav.settings' },
  { to: '/trash', icon: Trash, labelKey: 'nav.trash' },
];

export default function Sidebar() {
  const t = useT();
  // Hide pages that depend on Postiz until it's actually configured. Until
  // POSTIZ_API_KEY is set, Inbox (engagement events) and Analytics (post
  // performance) are dead links. Cheaper to hide than to show empty states
  // that read as broken.
  const { data: envStatus } = useQuery({
    queryKey: ['env-status'],
    queryFn: fetchEnvStatus,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const postizConnected = (envStatus?.postiz ?? []).some(
    (v) => v.name === 'POSTIZ_API_KEY' && v.set,
  );

  const visibleGroups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((item) => {
      // Inbox needs Postiz to surface engagement events.
      if (item.to === '/inbox' && !postizConnected) return false;
      return true;
    }),
  }));

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-card border-r border-border">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
        <img
          src="/logo.jpg"
          alt=""
          className="h-9 w-9 rounded-lg object-cover ring-1 ring-white/10"
        />
        <div>
          <h1 className="text-sm font-bold bg-gradient-to-r from-brand-cyan via-brand-purple to-brand-pink bg-clip-text text-transparent">
            {t('app.title')}
          </h1>
          <p className="text-[10px] text-muted uppercase tracking-widest">
            Social Pipeline
          </p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {visibleGroups.map((group) => (
          <div key={group.headingKey}>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              {t(group.headingKey)}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <SidebarLink key={item.to} item={item} />
              ))}
            </div>
          </div>
        ))}

        <div className="pt-3 border-t border-border space-y-0.5">
          {UTILITY_ITEMS.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>
      </nav>

      <div className="border-t border-border px-3 py-3 space-y-2">
        <div className="flex gap-2">
          <div className="flex-1"><LanguagePicker /></div>
          <ThemeToggle />
        </div>
        <div className="rounded-lg bg-white/5 px-3 py-2">
          <p className="text-[10px] text-zinc-500">{t('app.pipeline_status')}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-zinc-300">{t('app.connected')}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const t = useT();
  const Icon = item.icon;
  // Pull the pending-approval count from the summary so the Approvals link
  // can surface a badge. The hook polls every 30s, which is fine — this is
  // ambient awareness, not a precise gauge.
  const { data: summary } = useSummary();
  const isApprovalsLink = item.to === '/approvals';
  const pendingCount = isApprovalsLink ? Number(summary?.pendingApproval ?? 0) : 0;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
          isActive
            ? 'bg-brand-purple/15 text-brand-cyan ring-1 ring-brand-purple/30'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5',
        )
      }
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1">{t(item.labelKey)}</span>
      {pendingCount > 0 && (
        <span className="rounded-full bg-brand-purple/20 px-2 py-0.5 text-[10px] font-semibold text-brand-cyan ring-1 ring-brand-purple/40">
          {pendingCount}
        </span>
      )}
    </NavLink>
  );
}

/**
 * Language picker dropdown. Stored in localStorage and reflected on
 * <html lang="…">. Persisted across sessions.
 */
function LanguagePicker() {
  const { locale, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = LOCALES.find((l) => l.id === locale)!;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10"
      >
        <Flag id={active.id} size={18} />
        <span className="flex-1 text-left truncate">{active.label}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 text-zinc-500 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-white/10 bg-zinc-900 shadow-lg overflow-hidden">
          {LOCALES.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setLocale(l.id);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-white/5',
                l.id === locale ? 'text-brand-cyan' : 'text-zinc-300',
              )}
            >
              <Flag id={l.id} size={18} />
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Theme toggle. Single-button flip between dark and light. Persists in
 * localStorage; the no-flash inline script in index.html applies the chosen
 * theme before first paint.
 */
function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const t = useT();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? t('app.theme.switch_to_light') : t('app.theme.switch_to_dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex items-center justify-center rounded-lg bg-white/5 px-3 py-2 text-zinc-300 hover:bg-white/10"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
