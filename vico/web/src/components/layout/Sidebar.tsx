import {useEffect, useMemo, useState} from 'react';
import {NavLink, useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {useAuth} from '@/hooks/use-auth';
import {cn} from '@/lib/utils';
import {
  Bot,
  Cpu,
  Database,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  MessageSquare,
  PanelLeft,
  Puzzle,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';
import {Tooltip, TooltipContent, TooltipTrigger,} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const STORAGE_KEY = 'sidebar_collapsed';

export function Sidebar() {
  const { user, logout } = useAuth();
  const { t } = useTranslation('sidebar');
  const { t: tSettings } = useTranslation('settings');
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch { /* ignore */ }
  }, [collapsed]);

  const toggle = () => setCollapsed((prev) => !prev);

  const handleLogout = () => {
    setUserMenuOpen(false);
    logout();
  };

  // role 为自增列，不在 better-auth 的 User 类型里，此处做窄化断言
  const isAdmin = (user as { role?: string } | null)?.role === 'admin';

  const navItems = useMemo(() => [
    { to: '/dashboard', label: t('dashboard'), icon: LayoutDashboard },
    { to: '/chat', label: t('chat'), icon: MessageCircle },
  ], [t]);

  // 设置子项列表，与 Settings 页左侧 nav 保持一致，admin 项按角色过滤
  const settingsItems = useMemo(() => [
    { value: 'general', label: tSettings('general.tab'), icon: SettingsIcon, adminOnly: false },
    { value: 'users', label: tSettings('users.tab'), icon: Users, adminOnly: true },
    { value: 'models', label: tSettings('llm.tab'), icon: Cpu, adminOnly: false },
    { value: 'threads', label: tSettings('threads.tab'), icon: MessageSquare, adminOnly: true },
    { value: 'agents', label: tSettings('agents.tab'), icon: Bot, adminOnly: true },
    { value: 'skills', label: tSettings('skills.tab'), icon: Puzzle, adminOnly: true },
    { value: 'knowledge', label: tSettings('knowledge.tab'), icon: Database, adminOnly: true },
  ].filter((i) => !i.adminOnly || isAdmin), [tSettings, isAdmin]);

  return (
    <aside
      className={cn(
        'border-r bg-sidebar text-sidebar-foreground flex flex-col shrink-0 transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Header：logo 区 + 右侧折叠切换 */}
      <div className={cn(
        'flex items-center border-b border-sidebar-border',
        collapsed ? 'justify-between p-2' : 'p-4',
      )}>
        {collapsed ? (
          <h1 className="text-lg font-bold">V</h1>
        ) : (
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold tracking-tight">Vico</h1>
            <p className="text-xs text-muted-foreground mt-1">{t('brandSubtitle')}</p>
          </div>
        )}

        {/* Collapse toggle */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              onClick={toggle}
              className="hover:bg-sidebar-accent rounded-md shrink-0 p-1.5"
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
      <div className="border-t border-sidebar-border">
        {/* User menu：点击用户区弹出设置菜单列表 */}
        <DropdownMenu open={userMenuOpen} onOpenChange={setUserMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex items-center w-full text-left cursor-pointer hover:bg-sidebar-accent',
                collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-3',
              )}
            >
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium shrink-0">
                {user?.name?.[0]?.toUpperCase()}
              </div>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{(user as any)?.username ?? user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align={collapsed ? 'center' : 'start'}
            sideOffset={8}
            className="min-w-52"
          >
            {/* 头部：头像 + 用户信息 + 退出 */}
            <div className="flex items-center gap-2 px-2 py-2">
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium shrink-0">
                {user?.name?.[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{(user as any)?.username ?? user?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title={t('logout')}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
              >
                <LogOut size={16} />
              </button>
            </div>
            <DropdownMenuSeparator />
            {settingsItems.map((item) => (
              <DropdownMenuItem
                key={item.value}
                onClick={() => navigate(`/settings?section=${item.value}`)}
              >
                <item.icon />
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
