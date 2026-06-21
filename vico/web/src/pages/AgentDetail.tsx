// 1. React
import { useState, useCallback, useEffect } from 'react';

// 2. 第三方
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bot, Settings, Puzzle, Database, MessageSquare, Trash2,
} from 'lucide-react';

// 3. API / Hooks / Utils
import { api } from '@/api/client';

// 4. UI 组件
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Empty, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@/components/ui/empty';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. 页面子组件
import ConfigPanel from './agent-detail/ConfigPanel';
import SkillPanel from './agent-detail/SkillPanel';
import KnowledgePanel from './agent-detail/KnowledgePanel';
import ChatPanel from './agent-detail/ChatPanel';

// 6. 类型
import type { Agent, Skill, KnowledgeBase, Model } from './agent-detail/types';

/**
 * Agent 详情 / 配置页面
 *
 * 通过 Tabs 组织四个功能区：配置、Skill 绑定、知识库绑定、测试对话。
 * 所有修改即时通过 PATCH/PUT mutation 提交，无需保存按钮。
 */
export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation('agents');

  const [activeTab, setActiveTab] = useState('config');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: agent, isLoading } = useQuery<Agent>({
    queryKey: ['agent', id],
    queryFn: () => api(`/agents/${id}`),
    enabled: !!id,
  });

  const { register, watch, formState: { dirtyFields } } = useForm({
    values: {
      system_prompt: agent?.system_prompt ?? '',
      max_tokens: agent?.max_tokens ?? 4096,
    },
  });

  const { data: allSkills } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: () => api('/skills'),
  });

  const { data: allKbs } = useQuery<KnowledgeBase[]>({
    queryKey: ['knowledge-bases'],
    queryFn: () => api('/knowledge-bases'),
  });

  const { data: models } = useQuery<Model[]>({
    queryKey: ['models'],
    queryFn: () => api('/models'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  const skillsMutation = useMutation({
    mutationFn: (skills: { skill_name: string }[]) =>
      api(`/agents/${id}/skills`, {
        method: 'PUT',
        body: JSON.stringify({ skills }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  const kbMutation = useMutation({
    mutationFn: (data: { kb_id: string | null; mode: string }) =>
      api(`/agents/${id}/knowledge`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      api(`/agents/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: enabled ? 1 : 0 }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      navigate('/agents');
    },
  });

  const watchedPrompt = watch('system_prompt');
  const watchedMaxTokens = watch('max_tokens');

  useEffect(() => {
    const data: Record<string, unknown> = {};
    if (dirtyFields.system_prompt && agent?.is_default !== 1) data.system_prompt = watchedPrompt;
    if (dirtyFields.max_tokens) data.max_tokens = watchedMaxTokens;
    if (Object.keys(data).length === 0) return;

    const timer = setTimeout(() => {
      updateMutation.mutate(data);
    }, 300);
    return () => clearTimeout(timer);
  }, [watchedPrompt, watchedMaxTokens, agent?.is_default]);

  const toggleSkill = useCallback(
    (skillName: string, boundSkills: string[]) => {
      const isBound = boundSkills.includes(skillName);
      const next = isBound
        ? boundSkills.filter((n) => n !== skillName)
        : [...boundSkills, skillName];
      skillsMutation.mutate(next.map((n) => ({ skill_name: n })));
    },
    [skillsMutation],
  );

  const selectKb = useCallback(
    (kbId: string | null) => {
      kbMutation.mutate({ kb_id: kbId, mode: 'auto' });
    },
    [kbMutation],
  );

  const handleDelete = useCallback(() => {
    deleteMutation.mutate();
  }, [deleteMutation]);

  const handleUpdate = useCallback(
    (data: Record<string, unknown>) => {
      updateMutation.mutate(data);
    },
    [updateMutation],
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <Bot size={32} />
        </EmptyMedia>
        <EmptyTitle>{t('agentNotFound')}</EmptyTitle>
        <EmptyDescription>
          {t('agentNotFoundDesc')}
        </EmptyDescription>
        <Button variant="outline" onClick={() => navigate('/agents')}>
          {t('backToList')}
        </Button>
      </Empty>
    );
  }

  const a = agent;

  const boundSkills: string[] = (a.skills || []).map(
    (s: { skill_name: string }) => s.skill_name,
  );

  const skillsList = allSkills || [];
  const kbsList = allKbs || [];
  const modelsList = models || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/agents')}
          aria-label={t('backToList')}
        >
          <ArrowLeft size={20} />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">{a.name}</h2>
            {a.is_default === 1 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Switch size="sm" checked={a.enabled} disabled />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t('defaultAgentCannotDisable')}</TooltipContent>
              </Tooltip>
            ) : (
              <Switch
                size="sm"
                checked={a.enabled}
                onCheckedChange={(checked) => toggleMutation.mutate(checked)}
              />
            )}
            <Badge variant={a.enabled ? 'default' : 'secondary'}>
              {a.enabled ? t('statusEnabledDetail') : t('statusDisabledDetail')}
            </Badge>
          </div>
        </div>
        {a.is_default !== 1 && (
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Trash2 size={14} className="mr-1.5" />
                {t('deleteButton')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('confirmDeleteTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('confirmDeleteDesc', { name: a.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                  {t('common:cancel')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? t('common:deleting') : t('common:confirmDelete')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="config">
            <Settings size={14} className="mr-1.5" />
            {t('tabConfig')}
          </TabsTrigger>
          <TabsTrigger value="skills">
            <Puzzle size={14} className="mr-1.5" />
            {t('tabSkills')}
          </TabsTrigger>
          <TabsTrigger value="knowledge">
            <Database size={14} className="mr-1.5" />
            {t('tabKnowledge')}
          </TabsTrigger>
          <TabsTrigger value="chat">
            <MessageSquare size={14} className="mr-1.5" />
            {t('tabChat')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config">
          <ConfigPanel
            agent={a}
            modelsList={modelsList}
            register={register}
            onUpdate={handleUpdate}
          />
        </TabsContent>

        <TabsContent value="skills">
          <SkillPanel
            skillsList={skillsList}
            boundSkills={boundSkills}
            onToggleSkill={toggleSkill}
          />
        </TabsContent>

        <TabsContent value="knowledge">
          <KnowledgePanel
            kbsList={kbsList}
            selectedKbId={a.kb_id ?? null}
            onSelectKb={selectKb}
          />
        </TabsContent>

        <TabsContent value="chat">
          <ChatPanel agentId={id!} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
