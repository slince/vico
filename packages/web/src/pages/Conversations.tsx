import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Link } from 'react-router-dom';
import { MessageSquare, Search } from 'lucide-react';
import { useState } from 'react';

export default function Conversations() {
  const [search, setSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState('');

  const { data: conversations, isLoading } = useQuery({
    queryKey: ['conversations', search, agentFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (agentFilter) params.set('agent_id', agentFilter);
      return api(`/conversations?${params.toString()}`);
    },
  });

  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>;

  const convs = (conversations as any[]) || [];
  const agentsList = (agents as any[]) || [];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold tracking-tight">对话记录</h2>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索对话..."
            className="w-full pl-9 pr-3 py-2 border rounded-md text-sm"
          />
        </div>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="px-3 py-2 border rounded-md text-sm"
        >
          <option value="">全部 Agent</option>
          {agentsList.map((a: any) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {convs.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
          <p>暂无对话记录</p>
        </div>
      ) : (
        <div className="bg-card border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 text-sm font-medium">用户</th>
                <th className="text-left px-4 py-3 text-sm font-medium">Agent</th>
                <th className="text-left px-4 py-3 text-sm font-medium">消息数</th>
                <th className="text-left px-4 py-3 text-sm font-medium">模型</th>
                <th className="text-left px-4 py-3 text-sm font-medium">时间</th>
                <th className="text-left px-4 py-3 text-sm font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {convs.map((c: any) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 text-sm">{c.user_id?.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm">{c.agent_name || c.agent_id?.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm">{c.message_count}</td>
                  <td className="px-4 py-3 text-sm text-xs text-muted-foreground">{c.model_name}</td>
                  <td className="px-4 py-3 text-sm text-xs text-muted-foreground">
                    {new Date(c.updated_at).toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-3">
                    <Link to={`/conversations/${c.id}`} className="text-sm text-primary hover:underline">
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
