// 1. 第三方
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Settings as SettingsIcon, Users, Cpu } from 'lucide-react';

// 2. Hooks
import { useAuth } from '@/hooks/use-auth';

// 3. 工具
import { cn } from '@/lib/utils';

// 4. 页面子组件
import GeneralSettings from './settings/GeneralSettings';
import UserManagement from './settings/UserManagement';
import ModelManagement from './settings/ModelManagement';

/**
 * 设置页面壳
 *
 * 左侧分组导航 + 右侧内容，`?section=` deep-link。
 * 角色门控：非 admin 隐藏「用户管理」nav 项。
 */
export default function Settings() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // role 为自增列，不在 better-auth 的 User 类型里，此处做窄化断言
  const isAdmin = (user as { role?: string } | null)?.role === 'admin';

  const navItems = [
    { value: 'general', label: t('general.tab'), icon: SettingsIcon, adminOnly: false },
    { value: 'users', label: t('users.tab'), icon: Users, adminOnly: true },
    { value: 'models', label: t('llm.tab'), icon: Cpu, adminOnly: false },
  ].filter((i) => !i.adminOnly || isAdmin);

  const rawSection = searchParams.get('section') ?? 'general';
  const section = navItems.some((i) => i.value === rawSection) ? rawSection : 'general';

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">{t('title')}</h2>

      <div className="flex gap-6">
        <nav className="w-48 shrink-0 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setSearchParams({ section: item.value })}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                section === item.value
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {section === 'general' && <GeneralSettings />}
          {section === 'users' && <UserManagement />}
          {section === 'models' && <ModelManagement isAdmin={isAdmin} />}
        </div>
      </div>
    </div>
  );
}
