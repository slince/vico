// 1. React
import { useState, useCallback } from 'react';

// 2. Third-party
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit3, Users } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@/components/ui/empty';
import { Dialog, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. Sub-components
import CreateTeamDialog from './teams/CreateTeamDialog';

/** 团队数据形状（来自 API 返回） */
interface Team {
  id: string;
  name: string;
  description: string;
  routing_strategy: string;
  member_count: number;
}

/**
 * Agent 团队管理页面
 *
 * 以卡片网格展示所有团队，支持创建、删除操作。
 * 使用 Dialog 弹窗创建新团队，使用 AlertDialog 二次确认删除。
 * 加载时展示 Skeleton 骨架屏，无数据时展示 Empty 空状态。
 */
export default function Teams() {
  const queryClient = useQueryClient();

  // 控制创建 Dialog 的开关状态
  const [createOpen, setCreateOpen] = useState(false);
  // 创建表单的团队名称
  const [newName, setNewName] = useState('');
  // 创建表单的团队描述
  const [newDescription, setNewDescription] = useState('');
  /** 待删除的团队（用于 AlertDialog 确认） */
  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);

  // 获取团队列表
  const { data: teams, isLoading } = useQuery<Team[]>({
    queryKey: ['teams'],
    queryFn: () => api('/teams'),
  });

  /** 创建团队的 mutation */
  const createMutation = useMutation({
    mutationFn: (data: { name: string; description: string }) =>
      api('/teams', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      // 刷新列表并重置表单状态
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      setCreateOpen(false);
      setNewName('');
      setNewDescription('');
    },
  });

  /** 删除团队的 mutation */
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/teams/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams'] }),
  });

  /**
   * 处理创建表单提交
   * 校验名称非空后触发创建 mutation
   */
  const handleCreate = useCallback(() => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim(), description: newDescription.trim() });
  }, [newName, newDescription, createMutation]);

  /**
   * 处理删除确认
   * 通过 AlertDialog 二次确认后执行删除
   */
  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id, { onSettled: () => setDeleteTarget(null) });
    }
  }, [deleteTarget, deleteMutation]);

  // 规范化团队列表
  const teamList: Team[] = teams || [];

  // ====================== 加载态（骨架屏） ======================
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Agent 团队</h2>
          {/* 加载态占位按钮 */}
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        {/* 骨架卡片网格：渲染 6 个占位卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-20 mt-1" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4 mt-2" />
              </CardContent>
              <CardFooter><Skeleton className="h-8 w-full rounded-md" /></CardFooter>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ====================== 空状态 ======================
  if (teamList.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Agent 团队</h2>
          {/* 空状态下的创建入口 */}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button><Plus size={16} className="mr-2" />创建团队</Button>
            </DialogTrigger>
            <CreateTeamDialog
              name={newName} onNameChange={setNewName}
              description={newDescription} onDescriptionChange={setNewDescription}
              onSubmit={handleCreate}
              mutation={{ error: createMutation.error as Error | null, isPending: createMutation.isPending }}
            />
          </Dialog>
        </div>
        {/* 空状态提示 */}
        <Empty>
          <EmptyMedia variant="icon"><Users size={32} /></EmptyMedia>
          <EmptyTitle>暂无 Agent 团队</EmptyTitle>
          <EmptyDescription>创建团队将多个 Agent 组合在一起，通过协调者自动分配任务</EmptyDescription>
        </Empty>
      </div>
    );
  }

  // ====================== 正常数据态 ======================
  return (
    <div className="space-y-6">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Agent 团队</h2>
        {/* 创建团队按钮（Dialog 入口） */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus size={16} className="mr-2" />创建团队</Button>
          </DialogTrigger>
          <CreateTeamDialog
            name={newName} onNameChange={setNewName}
            description={newDescription} onDescriptionChange={setNewDescription}
            onSubmit={handleCreate}
            mutation={{ error: createMutation.error as Error | null, isPending: createMutation.isPending }}
          />
        </Dialog>
      </div>

      {/* 团队卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {teamList.map((team) => (
          <Card key={team.id} className="hover:shadow-md transition-shadow">
            {/* 卡片头部：团队名称 + 路由策略徽章 */}
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Link to={`/teams/${team.id}`} className="hover:text-primary transition-colors">
                    <CardTitle className="text-base truncate">{team.name}</CardTitle>
                  </Link>
                  <CardDescription className="mt-1">{team.member_count || 0} 个成员</CardDescription>
                </div>
                <Badge variant={team.routing_strategy === 'supervisor' ? 'default' : 'secondary'}>
                  {team.routing_strategy === 'supervisor' ? '协调者模式' : team.routing_strategy}
                </Badge>
              </div>
            </CardHeader>

            {/* 卡片内容：团队描述预览 */}
            <CardContent className="pb-2">
              <p className="text-xs text-muted-foreground line-clamp-2">
                {team.description || '暂无描述'}
              </p>
            </CardContent>

            <Separator />

            {/* 卡片底部：操作区 */}
            <CardFooter className="pt-3 pb-3 flex items-center justify-between">
              {/* 配置按钮 */}
              <Button variant="outline" size="sm" asChild>
                <Link to={`/teams/${team.id}`}><Edit3 size={14} className="mr-1.5" />配置</Link>
              </Button>
              {/* 删除按钮：使用 AlertDialog 二次确认 */}
              <AlertDialog
                open={deleteTarget?.id === team.id}
                onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
              >
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(team)}>
                    <Trash2 size={14} className="mr-1.5" />删除
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认删除</AlertDialogTitle>
                    <AlertDialogDescription>确定要删除团队「{team.name}」吗？此操作不可撤销。</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
                    <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleteMutation.isPending}>
                      {deleteMutation.isPending ? '删除中...' : '确认删除'}
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
