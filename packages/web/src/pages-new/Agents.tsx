import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit3, Bot } from 'lucide-react';
import { useState, useCallback } from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  DialogTrigger,
} from '@/components/ui/dialog';

/** Agent 数据形状（来自 API 返回） */
interface Agent {
  id: string;
  name: string;
  enabled: boolean;
  system_prompt?: string;
  skill_names?: string[];
  kb_ids?: string[];
}

/**
 * Agent 管理页面
 *
 * 以卡片网格展示所有 Agent，支持创建、删除操作。
 * 使用 Dialog 弹窗创建新 Agent，使用 DropdownMenu 提供快捷操作入口。
 * 加载时展示 Skeleton 骨架屏，无数据时展示 Empty 空状态。
 */
export default function Agents() {
  const queryClient = useQueryClient();

  // 控制创建 Dialog 的开关状态
  const [createOpen, setCreateOpen] = useState(false);
  // 创建表单的 Agent 名称
  const [newName, setNewName] = useState('');

  // 获取 Agent 列表
  const { data: agents, isLoading } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  /** 创建 Agent 的 mutation */
  const createMutation = useMutation({
    mutationFn: (data: { name: string }) =>
      api('/agents', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      // 刷新列表并重置表单状态
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      setCreateOpen(false);
      setNewName('');
    },
  });

  /** 删除 Agent 的 mutation */
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  /**
   * 处理创建表单提交
   * 校验名称非空后触发创建 mutation
   */
  const handleCreate = useCallback(() => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim() });
  }, [newName, createMutation]);

  /**
   * 处理删除确认
   * 通过 window.confirm 二次确认后执行删除
   */
  const handleDelete = useCallback(
    (agent: Agent) => {
      // 二次确认防止误删
      if (confirm(`确认删除 Agent「${agent.name}」？此操作不可撤销。`)) {
        deleteMutation.mutate(agent.id);
      }
    },
    [deleteMutation],
  );

  // 规范化 agent 列表
  const agentList: Agent[] = agents || [];

  // ====================== 加载态（骨架屏） ======================
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Agent 管理</h2>
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
              <CardFooter>
                <Skeleton className="h-8 w-full rounded-md" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ====================== 空状态 ======================
  if (agentList.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Agent 管理</h2>
          {/* 空状态下的创建入口 */}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus size={16} className="mr-2" />
                创建 Agent
              </Button>
            </DialogTrigger>
            {renderCreateDialog(newName, setNewName, handleCreate, createMutation)}
          </Dialog>
        </div>
        {/* 空状态提示 */}
        <Empty>
          <EmptyMedia variant="icon">
            <Bot size={32} />
          </EmptyMedia>
          <EmptyTitle>暂无 Agent</EmptyTitle>
          <EmptyDescription>
            点击上方「创建 Agent」按钮，开始构建您的第一个 AI Agent
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // ====================== 正常数据态 ======================
  return (
    <div className="space-y-6">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Agent 管理</h2>
        {/* 创建 Agent 按钮（Dialog 入口） */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus size={16} className="mr-2" />
              创建 Agent
            </Button>
          </DialogTrigger>
          {renderCreateDialog(newName, setNewName, handleCreate, createMutation)}
        </Dialog>
      </div>

      {/* Agent 卡片网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agentList.map((agent) => (
          <Card
            key={agent.id}
            className="hover:shadow-md transition-shadow group/card"
          >
            {/* 卡片头部：Agent 名称 + 状态徽章 */}
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/agents/${agent.id}`}
                    className="hover:text-primary transition-colors"
                  >
                    <CardTitle className="text-base truncate">
                      {agent.name}
                    </CardTitle>
                  </Link>
                  <CardDescription className="mt-1">
                    {/* 统计信息：已绑定的 Skill 和知识库数量 */}
                    {agent.skill_names?.length || 0} 个 Skill &middot;{' '}
                    {agent.kb_ids?.length || 0} 个知识库
                  </CardDescription>
                </div>
                {/* 启用/禁用状态 Badge */}
                <Badge variant={agent.enabled ? 'default' : 'secondary'}>
                  {agent.enabled ? '启用' : '禁用'}
                </Badge>
              </div>
            </CardHeader>

            {/* 卡片内容：System Prompt 预览 */}
            <CardContent className="pb-2">
              <p className="text-xs text-muted-foreground line-clamp-2">
                {agent.system_prompt || '暂无 System Prompt'}
              </p>
            </CardContent>

            <Separator />

            {/* 卡片底部：操作区 */}
            <CardFooter className="pt-3 pb-3 flex items-center justify-between">
              {/* 配置按钮 */}
              <Button variant="outline" size="sm" asChild>
                <Link to={`/agents/${agent.id}`}>
                  <Edit3 size={14} className="mr-1.5" />
                  配置
                </Link>
              </Button>
              {/* 删除按钮 */}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(agent)}
              >
                <Trash2 size={14} className="mr-1.5" />
                删除
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * 渲染创建 Agent 的 Dialog 内容
 *
 * @param name - 当前输入的名称值
 * @param setName - 更新名称的 setter
 * @param onSubmit - 提交回调
 * @param mutation - 创建 mutation 对象，用于展示错误信息
 */
function renderCreateDialog(
  name: string,
  setName: (v: string) => void,
  onSubmit: () => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: { error: any; isPending: boolean },
) {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>创建 Agent</DialogTitle>
        <DialogDescription>
          输入 Agent 名称以创建新的智能代理。后续可在详情页配置模型、系统提示词、Skill 绑定等。
        </DialogDescription>
      </DialogHeader>

      {/* 表单主体 */}
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="agent-name">Agent 名称</Label>
          <Input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：客服助手、数据分析师"
            // 支持回车快速提交
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
            }}
          />
        </div>

        {/* 错误信息展示 */}
        {mutation.error && (
          <p className="text-sm text-destructive">
            {(mutation.error as Error).message}
          </p>
        )}
      </div>

      <DialogFooter>
        {/* 取消按钮：关闭 Dialog */}
        <DialogClose asChild>
          <Button variant="outline">取消</Button>
        </DialogClose>
        {/* 确认创建：名称非空时可用 */}
        <Button onClick={onSubmit} disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? '创建中...' : '创建'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
