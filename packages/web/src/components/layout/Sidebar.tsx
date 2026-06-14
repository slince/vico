import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Bot,
  Puzzle,
  MessageSquare,
  MessageCircle,
  Database,
  Settings,
  LogOut,
  Users,
  Activity,
  ClipboardCheck,
} from 'lucide-react';

export function Sidebar() {
  const { user, logout } = useAuth();
  const { t } = useTranslation('sidebar');

  const navItems = useMemo(() => [
    { to: '/dashboard', label: t('dashboard'), icon: LayoutDashboard },
    { to: '/chat', label: t('chat'), icon: MessageCircle },
    { to: '/agents', label: t('agents'), icon: Bot },
    { to: '/teams', label: t('teams'), icon: Users },
    { to: '/skills', label: t('skills'), icon: Puzzle },
    { to: '/knowledge', label: t('knowledge'), icon: Database },
    { to: '/conversations', label: t('conversations'), icon: MessageSquare },
    { to: '/observability/traces', label: t('observability'), icon: Activity },
    { to: '/evals/datasets', label: t('evals'), icon: ClipboardCheck },
    { to: '/settings', label: t('settings'), icon: Settings },
  ], [t]);

  return (
    <aside className="w-60 border-r bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="p-4 border-b border-sidebar-border">
        <h1 className="text-xl font-bold tracking-tight">Vico</h1>
        <p className="text-xs text-muted-foreground mt-1">{t('brandSubtitle')}</p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent/50'
              )
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{(user as any)?.username ?? user?.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
          <button onClick={logout} className="p-1.5 hover:bg-sidebar-accent rounded-md" title={t('logout')}>
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
