import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { MessageSquare, Zap, Bot, Puzzle, Database } from 'lucide-react';

interface DashboardStats {
  totalConversations: number;
  totalTokens: number;
  activeAgents: number;
  totalAgents: number;
  installedSkills: number;
  totalKnowledgeBases: number;
  recentConversations: any[];
  tokenTrend: any[];
}

export default function Dashboard() {
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: () => api('/dashboard/stats'),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>;
  }

  const stats = data!;

  const cards = [
    { label: '总对话数', value: stats.totalConversations.toLocaleString(), icon: MessageSquare, color: 'text-blue-600 bg-blue-50' },
    { label: 'Token 消耗', value: stats.totalTokens.toLocaleString(), icon: Zap, color: 'text-amber-600 bg-amber-50' },
    { label: '活跃 Agent', value: `${stats.activeAgents}/${stats.totalAgents}`, icon: Bot, color: 'text-green-600 bg-green-50' },
    { label: '已安装 Skill', value: stats.installedSkills, icon: Puzzle, color: 'text-purple-600 bg-purple-50' },
    { label: '知识库', value: stats.totalKnowledgeBases, icon: Database, color: 'text-indigo-600 bg-indigo-50' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">仪表盘</h2>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-md ${color}`}>
                <Icon size={20} />
              </div>
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Token Trend (simple bar chart) */}
        <div className="bg-card rounded-lg border p-4">
          <h3 className="font-medium mb-4">Token 消耗趋势 (近30天)</h3>
          {stats.tokenTrend.length > 0 ? (
            <div className="flex items-end gap-1 h-32">
              {stats.tokenTrend.map((d: any, i: number) => {
                const max = Math.max(...stats.tokenTrend.map((t: any) => t.total));
                const height = max > 0 ? (d.total / max) * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-primary/20 hover:bg-primary/40 rounded-t transition-colors"
                      style={{ height: `${Math.max(height, 2)}%` }}
                      title={`${d.day}: ${d.total} tokens`}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无数据</p>
          )}
        </div>

        {/* Recent Conversations */}
        <div className="bg-card rounded-lg border p-4">
          <h3 className="font-medium mb-4">最近对话</h3>
          {stats.recentConversations.length > 0 ? (
            <div className="space-y-2">
              {stats.recentConversations.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{c.agent_name || '未知 Agent'}</p>
                    <p className="text-xs text-muted-foreground">{c.user_name} · {c.message_count} 条消息</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(c.updated_at).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无对话记录</p>
          )}
        </div>
      </div>
    </div>
  );
}
