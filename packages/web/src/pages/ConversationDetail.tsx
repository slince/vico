import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Wrench } from 'lucide-react';

export default function ConversationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: conv, isLoading } = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api(`/conversations/${id}`),
    enabled: !!id,
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>;
  if (!conv) return <div className="text-muted-foreground">对话未找到</div>;

  const c = conv as any;
  const messages = c.messages || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/conversations')} className="p-1.5 hover:bg-accent rounded-md">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">对话详情</h2>
          <p className="text-sm text-muted-foreground">
            Agent: {c.agent_name || c.agent_id} · 模型: {c.model_name} · {c.message_count} 条消息
          </p>
        </div>
      </div>

      <div className="max-w-3xl space-y-4">
        {messages.map((msg: any) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : msg.role === 'system'
                  ? 'bg-muted border'
                  : 'bg-accent'
            }`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium opacity-70">
                  {msg.role === 'user' ? '用户' : msg.role === 'system' ? '系统' : 'AI'}
                </span>
                <span className="text-xs opacity-50">
                  {new Date(msg.created_at).toLocaleTimeString('zh-CN')}
                </span>
              </div>
              <div className="text-sm whitespace-pre-wrap">{msg.content}</div>

              {msg.tool_calls && msg.tool_calls !== '[]' && msg.tool_calls !== 'null' && (
                <details className="mt-2">
                  <summary className="flex items-center gap-1 text-xs cursor-pointer opacity-70 hover:opacity-100">
                    <Wrench size={12} /> Tool Calls
                  </summary>
                  <pre className="mt-1 p-2 bg-background rounded text-xs overflow-x-auto">
                    {JSON.stringify(JSON.parse(msg.tool_calls), null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
