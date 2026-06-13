// 1. Third-party
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare, Zap, Bot, Puzzle, Database } from 'lucide-react';

// 2. API / Hooks / Utils
import { api } from '@/api/client';

// 3. Sub-components
import { StatCard } from './dashboard/StatCard';
import { TokenTrendChart } from './dashboard/TokenTrendChart';
import { RecentConversations } from './dashboard/RecentConversations';
import { DashboardSkeleton } from './dashboard/DashboardSkeleton';

// 4. Types
import type { DashboardStats, StatCardConfig } from './dashboard/types';

/**
 * 仪表盘页面组件
 *
 * 展示系统概览数据，包括：
 * - 5 张核心统计卡片（对话数、Token、Agent、Skill、知识库）
 * - Token 消耗趋势简易柱状图
 * - 最近对话列表
 *
 * 数据通过 TanStack Query 的 useQuery 获取，每 30 秒自动刷新。
 * 加载时展示 5 张骨架屏卡片，各区域均有空数据友好提示。
 *
 * @returns 仪表盘页面 JSX 元素
 */
export default function Dashboard() {
  const { t } = useTranslation('dashboard');

  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: () => api('/dashboard/stats'),
    refetchInterval: 30_000,
  });

  const statCards: StatCardConfig[] = useMemo(() => [
    {
      label: t('totalConversations'),
      getValue: (s) => s.totalConversations.toLocaleString(),
      icon: MessageSquare,
      iconColor: 'text-blue-600 bg-blue-50',
    },
    {
      label: t('tokenUsage'),
      getValue: (s) => s.totalTokens.toLocaleString(),
      icon: Zap,
      iconColor: 'text-amber-600 bg-amber-50',
    },
    {
      label: t('agentStatus'),
      getValue: (s) => `${s.activeAgents}/${s.totalAgents}`,
      icon: Bot,
      iconColor: 'text-green-600 bg-green-50',
    },
    {
      label: t('installedSkills'),
      getValue: (s) => String(s.installedSkills),
      icon: Puzzle,
      iconColor: 'text-purple-600 bg-purple-50',
    },
    {
      label: t('knowledgeBases'),
      getValue: (s) => String(s.totalKnowledgeBases),
      icon: Database,
      iconColor: 'text-indigo-600 bg-indigo-50',
    },
  ], [t]);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {t('loadError')}
      </div>
    );
  }

  const stats = data;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">{t('title')}</h2>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map(({ label, getValue, icon: Icon, iconColor }) => {
          const value = getValue(stats);
          return (
            <StatCard
              key={label}
              label={label}
              value={value}
              icon={Icon}
              iconColor={iconColor}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TokenTrendChart data={stats.tokenTrend} />
        <RecentConversations conversations={stats.recentConversations} />
      </div>
    </div>
  );
}
