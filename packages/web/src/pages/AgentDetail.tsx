import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, streamChat } from '@/api/client';
import { useParams, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, Send, X } from 'lucide-react';

export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api(`/agents/${id}`),
    enabled: !!id,
  });

  const { data: allSkills } = useQuery({
    queryKey: ['skills'],
    queryFn: () => api('/skills'),
  });

  const { data: allKbs } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: () => api('/knowledge-bases'),
  });

  const { data: models } = useQuery({
    queryKey: ['models'],
    queryFn: () => api('/models'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => api(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  const skillsMutation = useMutation({
    mutationFn: (skills: { skill_name: string }[]) =>
      api(`/agents/${id}/skills`, { method: 'PUT', body: JSON.stringify({ skills }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  const kbMutation = useMutation({
    mutationFn: (kbs: { kb_id: string }[]) =>
      api(`/agents/${id}/knowledge`, { method: 'PUT', body: JSON.stringify({ knowledge_bases: kbs }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  const sendMessage = () => {
    if (!input.trim() || streaming || !id) return;
    setChatMessages((prev) => [...prev, { role: 'user', content: input }]);
    setStreaming(true);
    let fullResponse = '';

    streamChat(
      { agentId: id, message: input },
      (event) => {
        if (event.type === 'text_delta') {
          fullResponse += event.content;
          setChatMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { role: 'assistant', content: fullResponse }];
            }
            return [...prev, { role: 'assistant', content: fullResponse }];
          });
        }
      },
      (err) => {
        setChatMessages((prev) => [...prev, { role: 'assistant', content: `错误: ${err.message}` }]);
        setStreaming(false);
      },
      () => setStreaming(false)
    );

    setInput('');
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>;
  if (!agent) return <div className="text-muted-foreground">Agent 未找到</div>;

  const a = agent as any;
  const boundSkills: string[] = (a.skills || []).map((s: any) => s.skill_name);
  const boundKbs: string[] = (a.knowledge_bases || []).map((k: any) => k.kb_id);
  const skillsList = (allSkills as any[]) || [];
  const kbsList = (allKbs as any[]) || [];
  const modelsList = (models as any[]) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/agents')} className="p-1.5 hover:bg-accent rounded-md">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{a.name}</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${a.enabled ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
            {a.enabled ? '启用' : '禁用'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration Panel */}
        <div className="space-y-4">
          {/* System Prompt */}
          <div className="bg-card border rounded-lg p-4">
            <h3 className="font-medium mb-3">System Prompt</h3>
            <textarea
              value={a.system_prompt || ''}
              onChange={(e) => updateMutation.mutate({ system_prompt: e.target.value })}
              className="w-full h-40 px-3 py-2 border rounded-md text-sm resize-none font-mono"
              placeholder="输入 System Prompt..."
            />
          </div>

          {/* Model & Parameters */}
          <div className="bg-card border rounded-lg p-4">
            <h3 className="font-medium mb-3">模型与参数</h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm">模型</label>
                <select
                  value={a.model_id || ''}
                  onChange={(e) => updateMutation.mutate({ model_id: e.target.value })}
                  className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                >
                  <option value="">选择模型...</option>
                  {modelsList.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.provider} / {m.model_name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm">Temperature: {a.temperature}</label>
                  <input
                    type="range" min="0" max="2" step="0.1"
                    value={a.temperature || 0.7}
                    onChange={(e) => updateMutation.mutate({ temperature: parseFloat(e.target.value) })}
                    className="w-full mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm">Max Tokens</label>
                  <input
                    type="number"
                    value={a.max_tokens || 4096}
                    onChange={(e) => updateMutation.mutate({ max_tokens: parseInt(e.target.value) })}
                    className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Skills Binding */}
          <div className="bg-card border rounded-lg p-4">
            <h3 className="font-medium mb-3">绑定 Skill</h3>
            <div className="space-y-2">
              {skillsList.map((s: any) => {
                const isBound = boundSkills.includes(s.name);
                return (
                  <label key={s.name} className="flex items-center gap-3 p-2 rounded-md hover:bg-accent cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isBound}
                      onChange={() => {
                        const next = isBound
                          ? boundSkills.filter((n) => n !== s.name)
                          : [...boundSkills, s.name];
                        skillsMutation.mutate(next.map((n) => ({ skill_name: n })));
                      }}
                      className="rounded"
                    />
                    <div>
                      <p className="text-sm font-medium">{s.displayName}</p>
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    </div>
                  </label>
                );
              })}
              {skillsList.length === 0 && <p className="text-sm text-muted-foreground">暂无可用 Skill，请先到 Skill 管理页安装</p>}
            </div>
          </div>

          {/* Knowledge Bases Binding */}
          <div className="bg-card border rounded-lg p-4">
            <h3 className="font-medium mb-3">绑定知识库</h3>
            <div className="space-y-2">
              {kbsList.map((kb: any) => {
                const isBound = boundKbs.includes(kb.id);
                return (
                  <label key={kb.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-accent cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isBound}
                      onChange={() => {
                        const next = isBound
                          ? boundKbs.filter((n) => n !== kb.id)
                          : [...boundKbs, kb.id];
                        kbMutation.mutate(next.map((n) => ({ kb_id: n })));
                      }}
                      className="rounded"
                    />
                    <div>
                      <p className="text-sm font-medium">{kb.name}</p>
                      <p className="text-xs text-muted-foreground">{kb.chunk_count} 个文档块</p>
                    </div>
                  </label>
                );
              })}
              {kbsList.length === 0 && <p className="text-sm text-muted-foreground">暂无知识库，请先到知识库页上传</p>}
            </div>
          </div>
        </div>

        {/* Test Chat Panel */}
        <div className="bg-card border rounded-lg flex flex-col h-[calc(100vh-8rem)] sticky top-6">
          <div className="p-4 border-b">
            <h3 className="font-medium">预览 & 测试对话</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center pt-8">在下方输入消息测试 Agent 效果</p>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-accent'
                }`}>
                  <div className="whitespace-pre-wrap">{msg.content || '...'}</div>
                </div>
              </div>
            ))}
            {streaming && (
              <div className="flex justify-start">
                <div className="bg-accent rounded-lg px-3 py-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="p-4 border-t">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="输入测试消息..."
                disabled={streaming}
                className="flex-1 px-3 py-2 border rounded-md text-sm disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={streaming || !input.trim()}
                className="px-3 py-2 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
