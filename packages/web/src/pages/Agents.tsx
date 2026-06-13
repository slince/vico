// 1. React
import { useState, useCallback } from 'react';

// 2. Third-party
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Edit3, Bot } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. Sub-components
import CreateAgentDialog from './agents/CreateAgentDialog';

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
 * 加载时展示 Skeleton 骨架屏，无数据时展示 Empty 空状态。
 */
export default function Agents() {
  const { t } = useTranslation('agents');
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);

  const { data: agents, isLoading } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string }) =>
      api('/agents', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      setCreateOpen(false);
      setNewName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api(`/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });

  const handleCreate = useCallback(() => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim() });
  }, [newName, createMutation]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id, {
        onSettled: () => setDeleteTarget(null),
      });
    }
  }, [deleteTarget, deleteMutation]);

  const agentList: Agent[] = agents || [];

  // ====================== 加载态 ======================
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h2>
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
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
          <h2 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h2>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus size={16} className="mr-2" />
                {t('createButton')}
              </Button>
            </DialogTrigger>
            <CreateAgentDialog
              name={newName}
              onNameChange={setNewName}
              onSubmit={handleCreate}
              mutation={{ error: createMutation.error as Error | null, isPending: createMutation.isPending }}
            />
          </Dialog>
        </div>
        <Empty>
          <EmptyMedia variant="icon">
            <Bot size={32} />
          </EmptyMedia>
          <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
          <EmptyDescription>
            {t('emptyDescription')}
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // ====================== 正常数据态 ======================
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus size={16} className="mr-2" />
              {t('createButton')}
            </Button>
          </DialogTrigger>
          <CreateAgentDialog
            name={newName}
            onNameChange={setNewName}
            onSubmit={handleCreate}
            mutation={{ error: createMutation.error as Error | null, isPending: createMutation.isPending }}
          />
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agentList.map((agent) => (
          <Card
            key={agent.id}
            className="hover:shadow-md transition-shadow group/card"
          >
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
                    {t('skillsCount', { count: agent.skill_names?.length || 0 })} &middot;{' '}
                    {t('knowledgeCount', { count: agent.kb_ids?.length || 0 })}
                  </CardDescription>
                </div>
                <Badge variant={agent.enabled ? 'default' : 'secondary'}>
                  {agent.enabled ? t('statusEnabled') : t('statusDisabled')}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="pb-2">
              <p className="text-xs text-muted-foreground line-clamp-2">
                {agent.system_prompt || t('noSystemPrompt')}
              </p>
            </CardContent>

            <Separator />

            <CardFooter className="pt-3 pb-3 flex items-center justify-between">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/agents/${agent.id}`}>
                  <Edit3 size={14} className="mr-1.5" />
                  {t('tabConfig')}
                </Link>
              </Button>
              <AlertDialog
                open={deleteTarget?.id === agent.id}
                onOpenChange={(open) => {
                  if (!open) setDeleteTarget(null);
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(agent)}
                  >
                    <Trash2 size={14} className="mr-1.5" />
                    {t('deleteButton')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('confirmDeleteTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('confirmDeleteDesc', { name: agent.name })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setDeleteTarget(null)}
                    >
                      {t('common:cancel')}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={handleDeleteConfirm}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? t('common:deleting') : t('common:confirmDelete')}
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
