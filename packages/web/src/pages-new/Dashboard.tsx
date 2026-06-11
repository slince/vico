import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { MessageSquare, Zap, Bot, Puzzle, Database } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * 仪表盘统计数据接口
 *
 * 对应后端 /api/v1/dashboard/stats 接口返回的数据结构。
 */
interface DashboardStats {
  /** 历史总对话数 */
  totalConversations: number;
  /** 所有对话累计消耗的 Token 总量 */
  totalTokens: number;
  /** 当前处于活跃状态的 Agent 数量 */
  activeAgents: number;
  /** 系统中已创建的 Agent 总数 */
  totalAgents: number;
  /** 已安装的 Skill 插件数量 */
  installedSkills: number;
  /** 已创建的知识库数量 */
  totalKnowledgeBases: number;
  /** 最近对话列表 */
  recentConversations: Array<{
    id: string;
    agent_name: string;
    user_name: string;
    message_count: number;
    updated_at: string;
  }>;
  /** Token 消耗每日趋势（近30天） */
  tokenTrend: Array<{
    day: string;
    total: number;
  }>;
}

/**
 * 统计卡片配置项
 *
 * 定义每张统计卡片要展示的元数据，包括图标、标签、颜色等。
 */
interface StatCardConfig {
  /** 卡片显示标签 */
  label: string;
  /** 从 DashboardStats 提取值的函数 */
  getValue: (stats: DashboardStats) => string;
  /** lucide-react 图标组件 */
  icon: React.ComponentType<{ size?: number }>;
  /** 图标容器的 Tailwind 颜色类名 */
  iconColor: string;
}

/**
 * 统计卡片配置列表
 *
 * 每项定义了一张仪表盘统计卡片的内容与外观。
 * 使用 getValue 函数从原始数据中提取格式化后的显示值。
 */
const statCards: StatCardConfig[] = [
  {
    label: '总对话数',
    getValue: (s) => s.totalConversations.toLocaleString(),
    icon: MessageSquare,
    iconColor: 'text-blue-600 bg-blue-50',
  },
  {
    label: 'Token 消耗',
    getValue: (s) => s.totalTokens.toLocaleString(),
    icon: Zap,
    iconColor: 'text-amber-600 bg-amber-50',
  },
  {
    label: 'Agent 状态',
    getValue: (s) => `${s.activeAgents}/${s.totalAgents}`,
    icon: Bot,
    iconColor: 'text-green-600 bg-green-50',
  },
  {
    label: '已安装 Skill',
    getValue: (s) => String(s.installedSkills),
    icon: Puzzle,
    iconColor: 'text-purple-600 bg-purple-50',
  },
  {
    label: '知识库',
    getValue: (s) => String(s.totalKnowledgeBases),
    icon: Database,
    iconColor: 'text-indigo-600 bg-indigo-50',
  },
];

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
  // 使用 TanStack Query 获取仪表盘数据，每 30 秒自动刷新
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: () => api('/dashboard/stats'),
    refetchInterval: 30_000, // 30 秒轮询
  });

  // 加载态：展示骨架屏网格
  if (isLoading) {
    return <DashboardSkeleton />;
  }

  // 数据未就绪的边界保护
  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        无法加载仪表盘数据，请稍后重试
      </div>
    );
  }

  const stats = data;

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <h2 className="text-2xl font-bold tracking-tight">仪表盘</h2>

      {/* 统计卡片网格：响应式布局，2 列到 5 列 */}
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

      {/* 双列区域：Token 趋势 + 最近对话 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TokenTrendChart data={stats.tokenTrend} />
        <RecentConversations conversations={stats.recentConversations} />
      </div>
    </div>
  );
}

/**
 * 单张统计卡片子组件
 *
 * 使用 shadcn/ui Card 包裹，展示图标、数值和标签。
 * Agent 状态卡片额外使用 Badge 标注活跃数量。
 *
 * @param props - 卡片配置
 * @param props.label - 卡片标签
 * @param props.value - 格式化后的展示值
 * @param props.icon - lucide-react 图标组件
 * @param props.iconColor - 图标容器颜色类名
 * @returns 统计卡片 JSX 元素
 */
function StatCard({
  label,
  value,
  icon: Icon,
  iconColor,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number }>;
  iconColor: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        {/* 图标容器 */}
        <div className={cn('p-2 rounded-md shrink-0', iconColor)}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          {/* 数值展示 */}
          <p className="text-2xl font-bold truncate">{value}</p>
          {/* 标签文字 */}
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Token 消耗趋势简易柱状图子组件
 *
 * 使用纯 CSS 柱形图展示近 30 天 Token 消耗趋势。
 * 每根柱子的高度相对于最大值按比例缩放，最小高度 2% 以保证可见性。
 * 空数据时展示友好提示。
 *
 * @param props - 组件属性
 * @param props.data - token 趋势数据数组
 * @returns 趋势图表 JSX 元素
 */
function TokenTrendChart({ data }: { data: DashboardStats['tokenTrend'] }) {
  // 计算所有天中的最大值，用于柱子高度的比例缩放
  const max = Math.max(...data.map((d: { total: number }) => d.total), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Token 消耗趋势 (近30天)</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="flex items-end gap-1 h-32">
            {data.map((d: { day: string; total: number }, i: number) => {
              // 按最大值比例计算柱高百分比，最小值不低于 2% 确保可见
              const height = max > 0 ? Math.max((d.total / max) * 100, 2) : 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-primary/20 hover:bg-primary/40 rounded-t transition-colors"
                    style={{ height: `${height}%` }}
                    title={`${d.day}: ${d.total.toLocaleString()} tokens`}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          // 空数据友好提示
          <p className="text-sm text-muted-foreground py-6 text-center">
            暂无 Token 消耗数据，开始使用 Agent 后将在此展示趋势
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 最近对话列表子组件
 *
 * 展示最近的对话记录，包含 Agent 名称、用户名、
 * 消息数量和最后更新时间。空数据时展示友好引导提示。
 *
 * @param props - 组件属性
 * @param props.conversations - 最近对话数组
 * @returns 最近对话列表 JSX 元素
 */
function RecentConversations({
  conversations,
}: {
  conversations: DashboardStats['recentConversations'];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">最近对话</CardTitle>
      </CardHeader>
      <CardContent>
        {conversations.length > 0 ? (
          <div className="space-y-2">
            {conversations.map((c: DashboardStats['recentConversations'][number]) => (
              <div
                key={c.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                {/* 左侧：Agent 名称与用户信息 */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {c.agent_name || '未知 Agent'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.user_name} &middot; {c.message_count} 条消息
                  </p>
                </div>
                {/* 右侧：更新日期 Badge */}
                <Badge variant="secondary" className="shrink-0 ml-3">
                  {new Date(c.updated_at).toLocaleDateString('zh-CN')}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          // 空数据友好提示
          <p className="text-sm text-muted-foreground py-6 text-center">
            暂无对话记录，创建 Agent 并开始聊天后将在此展示
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 仪表盘加载骨架屏组件
 *
 * 在数据加载期间展示 5 张带骨架效果的卡片占位，
 * 以及下方趋势图和对话列表区域的骨架占位，
 * 提供良好的感知性能体验。
 *
 * @returns 骨架屏 JSX 元素
 */
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* 标题骨架 */}
      <Skeleton className="h-8 w-28" />

      {/* 5 张统计卡片骨架 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-3">
              {/* 图标骨架 */}
              <Skeleton className="h-9 w-9 rounded-md shrink-0" />
              <div className="space-y-2 flex-1">
                {/* 数值骨架 */}
                <Skeleton className="h-7 w-16" />
                {/* 标签骨架 */}
                <Skeleton className="h-3 w-12" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 趋势图 + 对话列表骨架 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Token 趋势图骨架 */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>

        {/* 最近对话列表骨架 */}
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
