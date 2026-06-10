import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit3, Bot } from 'lucide-react';
import { useState } from 'react';

export default function Agents() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');

  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api('/agents', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      setShowCreate(false);
      setName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>;

  const agentsList = (agents as any[]) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Agent 管理</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} /> 创建 Agent
        </button>
      </div>

      {showCreate && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <h3 className="font-medium">新建 Agent</h3>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent 名称"
            className="w-full px-3 py-2 border rounded-md text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => createMutation.mutate({ name })}
              disabled={!name}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50"
            >
              创建
            </button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-md text-sm">取消</button>
          </div>
          {createMutation.error && <p className="text-sm text-red-500">{(createMutation.error as any).message}</p>}
        </div>
      )}

      {agentsList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Bot size={48} className="mx-auto mb-3 opacity-30" />
          <p>暂无 Agent，点击上方按钮创建</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agentsList.map((agent: any) => (
            <div key={agent.id} className="bg-card border rounded-lg p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between">
                <div>
                  <Link to={`/agents/${agent.id}`} className="font-medium hover:text-primary transition-colors">
                    {agent.name}
                  </Link>
                  <p className="text-xs text-muted-foreground mt-1">
                    {agent.skill_names?.length || 0} 个 Skill · {agent.kb_ids?.length || 0} 个知识库
                  </p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${agent.enabled ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                  {agent.enabled ? '启用' : '禁用'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                {agent.system_prompt || '暂无 System Prompt'}
              </p>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                <Link to={`/agents/${agent.id}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                  <Edit3 size={14} /> 配置
                </Link>
                <button
                  onClick={() => { if (confirm('确认删除？')) deleteMutation.mutate(agent.id); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-500"
                >
                  <Trash2 size={14} /> 删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
