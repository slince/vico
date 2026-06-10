import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';

export default function KnowledgeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: kb, isLoading } = useQuery({
    queryKey: ['knowledge-base', id],
    queryFn: () => api(`/knowledge-bases/${id}`),
    enabled: !!id,
  });

  const deleteChunkMutation = useMutation({
    mutationFn: (chunkId: string) => api(`/knowledge-bases/${id}/chunks/${chunkId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge-base', id] }),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>;
  if (!kb) return <div className="text-muted-foreground">知识库未找到</div>;

  const k = kb as any;
  const chunks = k.chunks || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/knowledge')} className="p-1.5 hover:bg-accent rounded-md">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{k.name}</h2>
          <p className="text-sm text-muted-foreground">{k.description} · {k.chunk_count} 个文档块 · 来源: {k.source}</p>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">文档块列表</h3>
        {chunks.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无文档块，请上传文档</p>
        ) : (
          chunks.map((chunk: any) => (
            <div key={chunk.id} className="bg-card border rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">
                    {chunk.metadata ? (() => { try { return JSON.parse(chunk.metadata).filename || '未知文件'; } catch { return '未知文件'; } })() : '未知文件'}
                  </p>
                  <p className="text-sm line-clamp-3">{chunk.content}</p>
                </div>
                <button
                  onClick={() => { if (confirm('删除此文档块？')) deleteChunkMutation.mutate(chunk.id); }}
                  className="p-1 text-muted-foreground hover:text-red-500 shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
