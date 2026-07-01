import {useEffect, useMemo, useState} from 'react';
import {NavLink} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {useAuth} from '@/hooks/useAuth';
import {cn} from '@/lib/utils';
import {
  Bot,
  Database,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MessageSquare,
  PanelLeft,
  Puzzle,
  Settings,
  Users,
} from 'lucide-react';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';

const STORAGE_KEY = 'sidebar_collapsed';

export function Sidebar() {
  const { user, logout } = useAuth();
  const { t } = useTranslation('sidebar');

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch { /* ignore */ }
  }, [collapsed]);

  const toggle = () => setCollapsed((prev) => !prev);

  const navItems = useMemo(() => [
    { to: '/dashboard', label: t('dashboard'), icon: LayoutDashboard },
    { to: '/chat', label: t('chat'), icon: MessageCircle },
    { to: '/agents', label: t('agents'), icon: Bot },
    { to: '/teams', label: t('teams'), icon: Users },
    { to: '/skills', label: t('skills'), icon: Puzzle },
    { to: '/knowledge', label: t('knowledge'), icon: Database },
    { to: '/conversations', label: t('conversations'), icon: MessageSquare },
    { to: '/settings', label: t('settings'), icon: Settings },
  ], [t]);

  return (
    <aside
      className={cn(
        'border-r bg-sidebar text-sidebar-foreground flex flex-col shrink-0 transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Header */}
      <div className={cn(
        'flex items-center border-b border-sidebar-border',
        collapsed ? 'justify-center p-3' : 'p-4',
      )}>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold tracking-tight">Vico</h1>
            <p className="text-xs text-muted-foreground mt-1">{t('brandSubtitle')}</p>
          </div>
        )}
        {collapsed && (
          <h1 className="text-lg font-bold">V</h1>
        )}
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 space-y-1', collapsed ? 'flex flex-col items-center p-2' : 'p-3')}>
        {navItems.map(({ to, label, icon: Icon }) => {
          const link = (
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  'text-sm transition-colors cursor-pointer',
                  collapsed
                    ? 'flex items-center justify-center h-10 w-10 rounded-lg'
                    : 'flex items-center gap-3 px-3 py-2 rounded-md',
                  isActive
                    ? 'bg-black/5 dark:bg-white/5 text-sidebar-accent-foreground font-medium'
                    : 'text-sidebar-foreground hover:bg-black/5 dark:hover:bg-white/5',
                )
              }
            >
              <Icon size={18} className="shrink-0 block" />
              {!collapsed && label}
            </NavLink>
          );

          if (collapsed) {
            return (
              <Tooltip key={to} delayDuration={300}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          }
          return <span key={to}>{link}</span>;
        })}
      </nav>

      {/* Footer */}
      <div className={cn(
        'border-t border-sidebar-border',
        collapsed ? 'flex flex-col items-center gap-2 p-2' : 'flex items-center gap-1 p-3',
      )}>
        {/* User info */}
        {!collapsed && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium shrink-0">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{(user as any)?.username ?? user?.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
        )}

        {/* Logout */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={logout}
              className={cn(
                'hover:bg-sidebar-accent rounded-md shrink-0',
                collapsed ? 'p-2 flex items-center justify-center' : 'p-1.5',
              )}
              title={!collapsed ? t('logout') : undefined}
            >
              <LogOut size={16} />
            </button>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">
              {t('logout')}
            </TooltipContent>
          )}
        </Tooltip>

        {/* Collapse toggle */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={toggle}
              className={cn(
                'hover:bg-sidebar-accent rounded-md shrink-0',
                collapsed ? 'p-2' : 'p-1.5',
              )}
            >
              <PanelLeft
                size={16}
                className={cn(
                  'transition-transform duration-200',
                  collapsed && 'rotate-180',
                )}
              />
            </button>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">
              {t('expand') ?? '展开菜单'}
            </TooltipContent>
          )}
        </Tooltip>
      </div>
    </aside>
  );
}
