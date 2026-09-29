// 1. React
import { useMemo } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Settings as SettingsIcon,
  Users,
  Cpu,
  MessageSquare,
  Bot,
  Puzzle,
  Database,
  type LucideIcon,
} from 'lucide-react';

// 3. Hooks
import { useAuth } from '@/hooks/use-auth';

// 4. Utils
import { cn } from '@/lib/utils';

/** 设置子页定义：供左侧导航渲染与 Settings 页 section 校验共用 */
export interface SettingsSection {
  value: string;
  labelKey: string;
  icon: LucideIcon;
  adminOnly: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { value: 'general', labelKey: 'general.tab', icon: SettingsIcon, adminOnly: false },
  { value: 'users', labelKey: 'users.tab', icon: Users, adminOnly: true },
  { value: 'models', labelKey: 'llm.tab', icon: Cpu, adminOnly: false },
  { value: 'threads', labelKey: 'threads.tab', icon: MessageSquare, adminOnly: true },
  { value: 'agents', labelKey: 'agents.tab', icon: Bot, adminOnly: true },
  { value: 'skills', labelKey: 'skills.tab', icon: Puzzle, adminOnly: true },
  { value: 'knowledge', labelKey: 'knowledge.tab', icon: Database, adminOnly: true },
];

interface SettingsLayoutProps {
  /** 当前高亮的 section 值 */
  activeSection: string;
  children: React.ReactNode;
}

/**
 * 设置页布局壳：左侧分组导航 + 右侧内容。
 *
 * 供 Settings 页及 Agent/Knowledge 详情页复用，保证详情页左侧也渲染设置菜单。
 */
export default function SettingsLayout({ activeSection, children }: SettingsLayoutProps) {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const navigate = useNavigate();

  // role 为自增列，不在 better-auth 的 User 类型里，此处做窄化断言
  const isAdmin = (user as { role?: string } | null)?.role === 'admin';

  const navItems = useMemo(
    () => SETTINGS_SECTIONS.filter((i) => !i.adminOnly || isAdmin),
    [isAdmin],
  );

  return (
    <div className="flex gap-6">
      <nav className="w-48 shrink-0 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => navigate(`/settings?section=${item.value}`)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              activeSection === item.value
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <item.icon size={14} />
            {t(item.labelKey)}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
