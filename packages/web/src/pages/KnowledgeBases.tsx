import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Database, Plus, Trash2, Upload } from 'lucide-react';

export default function KnowledgeBases() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  const { data: kbs, isLoading } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: () => api('/knowledge-bases'),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api('/knowledge-bases', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] }); setShowCreate(false); setName(''); setDesc(''); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/knowledge-bases/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] }),
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ kbId, file }: { kbId: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/v1/knowledge-bases/${kbId}/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledge-bases'] }),
  });

  const handleUpload = (kbId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.txt,.md,.csv';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        uploadMutation.mutate({ kbId, file });
      }
    };
    input.click();
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>;
  const kbList = (kbs as any[]) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">知识库</h2>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium">
          <Plus size={16} /> 新建知识库
        </button>
      </div>

      {showCreate && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <h3 className="font-medium">新建知识库</h3>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="名称" className="w-full px-3 py-2 border rounded-md text-sm" />
          <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="描述（可选）" className="w-full px-3 py-2 border rounded-md text-sm" />
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate({ name, description: desc })} disabled={!name} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm disabled:opacity-50">创建</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-md text-sm">取消</button>
          </div>
        </div>
      )}

      {kbList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Database size={48} className="mx-auto mb-3 opacity-30" />
          <p>暂无知识库，点击上方按钮创建</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kbList.map((kb: any) => (
            <div key={kb.id} className="bg-card border rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <Link to={`/knowledge/${kb.id}`} className="font-medium hover:text-primary">
                  {kb.name}
                </Link>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                  {kb.source === 'skill_resource' ? 'Skill内置' : '手动上传'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">{kb.description || '无描述'}</p>
              <p className="text-xs text-muted-foreground mb-3">{kb.chunk_count} 个文档块</p>
              <div className="flex items-center gap-2 pt-3 border-t">
                <button onClick={() => handleUpload(kb.id)} disabled={uploadMutation.isPending} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:opacity-90">
                  <Upload size={14} /> 上传文档
                </button>
                <button onClick={() => { if (confirm('确认删除？')) deleteMutation.mutate(kb.id); }} className="flex items-center gap-1 text-xs px-3 py-1.5 text-red-500 hover:bg-red-50 rounded-md border">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
