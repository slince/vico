import { NavLink } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Bot,
  Puzzle,
  MessageSquare,
  Database,
  Settings,
  LogOut,
} from 'lucide-react';

const navItems = [
  { to: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { to: '/agents', label: 'Agent 管理', icon: Bot },
  { to: '/skills', label: 'Skill 管理', icon: Puzzle },
  { to: '/knowledge', label: '知识库', icon: Database },
  { to: '/conversations', label: '对话记录', icon: MessageSquare },
  { to: '/settings', label: 'LLM 设置', icon: Settings },
];

export function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="w-60 border-r bg-sidebar text-sidebar-foreground flex flex-col">
      <div className="p-4 border-b border-sidebar-border">
        <h1 className="text-xl font-bold tracking-tight">Vico</h1>
        <p className="text-xs text-muted-foreground mt-1">AI Agent 管理平台</p>
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
            {user?.username?.[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.username}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.role}</p>
          </div>
          <button onClick={logout} className="p-1.5 hover:bg-sidebar-accent rounded-md" title="退出登录">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
