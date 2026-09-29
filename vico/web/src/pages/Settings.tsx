// 1. 第三方
import {useTranslation} from 'react-i18next';
import {useSearchParams} from 'react-router-dom';

// 2. Hooks
import {useAuth} from '@/hooks/use-auth';

// 3. 页面
import Threads from './Threads';
import Agents from './Agents';
import Skills from './Skills';
import KnowledgeBases from './KnowledgeBases';

// 4. 页面子组件
import GeneralSettings from './settings/GeneralSettings';
import UserManagement from './settings/UserManagement';
import ModelManagement from './settings/ModelManagement';
import SettingsLayout, {SETTINGS_SECTIONS} from './settings/SettingsLayout';

/**
 * 设置页面壳
 *
 * 复用 SettingsLayout 渲染左侧分组导航 + 右侧内容，`?section=` deep-link。
 * 角色门控：非 admin 隐藏「用户管理」nav 项。
 */
export default function Settings() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  // role 为自增列，不在 better-auth 的 User 类型里，此处做窄化断言
  const isAdmin = (user as { role?: string } | null)?.role === 'admin';

  const rawSection = searchParams.get('section') ?? 'general';
  // 校验 section 合法性并做角色门控，非法时回退到 general
  const section = SETTINGS_SECTIONS.some(
    (i) => i.value === rawSection && (!i.adminOnly || isAdmin),
  )
    ? rawSection
    : 'general';

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">{t('title')}</h2>

      <SettingsLayout activeSection={section}>
        {section === 'general' && <GeneralSettings />}
        {section === 'users' && <UserManagement />}
        {section === 'models' && <ModelManagement isAdmin={isAdmin} />}
        {section === 'threads' && <Threads />}
        {section === 'agents' && <Agents />}
        {section === 'skills' && <Skills />}
        {section === 'knowledge' && <KnowledgeBases />}
      </SettingsLayout>
    </div>
  );
}
