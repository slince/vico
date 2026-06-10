import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useState } from 'react';
import { Puzzle, Download, Trash2, Power } from 'lucide-react';

export default function Skills() {
  const queryClient = useQueryClient();

  const { data: skills, isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: () => api('/skills'),
  });

  const installMutation = useMutation({
    mutationFn: (data: any) => api('/skills/install', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  const uninstallMutation = useMutation({
    mutationFn: (name: string) => api(`/skills/${name}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api(`/skills/${name}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground">加载中...</div>;

  const skillsList = (skills as any[]) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Skill 管理</h2>
      </div>

      {skillsList.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Puzzle size={48} className="mx-auto mb-3 opacity-30" />
          <p>暂无 Skill，请确保 skills 目录下有可用 Skill 包</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {skillsList.map((skill: any) => {
            const installed = skill.installed;
            const enabled = skill.installed_enabled;

            return (
              <div key={skill.name} className={`bg-card border rounded-lg p-4 ${!installed ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Puzzle size={18} className="text-primary" />
                    <h3 className="font-medium">{skill.displayName}</h3>
                  </div>
                  <div className="flex gap-1">
                    {installed ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${enabled ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'}`}>
                        {enabled ? '已启用' : '已禁用'}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">
                        未安装
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-xs text-muted-foreground mb-2">{skill.description}</p>
                <p className="text-xs text-muted-foreground">
                  v{skill.version} · {skill.category}
                </p>

                {skill.parameters && Object.keys(skill.parameters).length > 0 && (
                  <div className="mt-2 pt-2 border-t">
                    <p className="text-xs font-medium mb-1">参数配置:</p>
                    {Object.entries(skill.parameters as Record<string, any>).map(([key, param]) => (
                      <p key={key} className="text-xs text-muted-foreground">{param.label}: {param.default}</p>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                  {!installed ? (
                    <button
                      onClick={() => installMutation.mutate({ skill_name: skill.name })}
                      disabled={installMutation.isPending}
                      className="flex items-center gap-1 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:opacity-90"
                    >
                      <Download size={14} /> 安装
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => toggleMutation.mutate({ name: skill.name, enabled: !enabled })}
                        className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border ${enabled ? 'hover:bg-accent' : 'bg-primary text-primary-foreground hover:opacity-90'}`}
                      >
                        <Power size={14} /> {enabled ? '禁用' : '启用'}
                      </button>
                      <button
                        onClick={() => { if (confirm('确认卸载？')) uninstallMutation.mutate(skill.name); }}
                        className="flex items-center gap-1 text-xs px-3 py-1.5 text-red-500 hover:bg-red-50 rounded-md border"
                      >
                        <Trash2 size={14} /> 卸载
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
