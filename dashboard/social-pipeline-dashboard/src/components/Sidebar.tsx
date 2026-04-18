import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Play,
  CheckSquare,
  Megaphone,
  ImageIcon,
  CalendarDays,
  Inbox,
  BarChart3,
  Settings,
  Cog,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/runs', icon: Play, label: 'Runs' },
  { to: '/approvals', icon: CheckSquare, label: 'Approvals' },
  { to: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { to: '/media-studio', icon: ImageIcon, label: 'Media Studio' },
  { to: '/schedule', icon: CalendarDays, label: 'Schedule' },
  { to: '/inbox', icon: Inbox, label: 'Inbox' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-card border-r border-border">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600">
          <Cog className="h-4 w-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-zinc-100">OpenClaw</h1>
          <p className="text-[10px] text-muted uppercase tracking-widest">Social Pipeline</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-indigo-500/10 text-indigo-400'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
              )
            }
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border px-4 py-4">
        <div className="rounded-lg bg-white/5 px-3 py-2.5">
          <p className="text-xs text-zinc-500">Pipeline Status</p>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-zinc-300">Connected</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
