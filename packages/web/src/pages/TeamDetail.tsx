// 1. React
import { useState, useRef, useCallback, useEffect } from 'react';

// 2. 第三方
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Settings, UserPlus, MessageSquare, Trash2,
} from 'lucide-react';

// 3. API / Hooks / Utils
import { api } from '@/api/client';

// 4. UI 组件
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@/components/ui/empty';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. 页面子组件
import OverviewPanel from './team-detail/OverviewPanel';
import MembersPanel from './team-detail/MembersPanel';
import TeamChatPanel from './team-detail/TeamChatPanel';

// 6. 类型
import type { Member, TeamDetailData, AgentOption } from './team-detail/types';

/**
 * Agent 团队详情 / 配置页面
 *
 * 通过 Tabs 组织三个功能区：概览、成员管理、测试对话。
 * 概览页修改通过 500ms 防抖 PATCH 自动提交，无需保存按钮。
 */
export default function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation('teams');

  const [activeTab, setActiveTab] = useState('overview');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [localName, setLocalName] = useState<string | undefined>();
  const [localDescription, setLocalDescription] = useState<string | undefined>();
  const [localSupervisorId, setLocalSupervisorId] = useState<string | undefined>();

  const hasEdited = useRef(false);

  const { data: team, isLoading } = useQuery<TeamDetailData>({
    queryKey: ['team', id],
    queryFn: () => api(`/teams/${id}`),
    enabled: !!id,
  });

  const { data: allAgents } = useQuery<AgentOption[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api(`/teams/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team', id] }),
  });

  const membersMutation = useMutation({
    mutationFn: (members: { agent_id: string; role?: string }[]) =>
      api(`/teams/${id}/members`, {
        method: 'PUT',
        body: JSON.stringify({ members }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team', id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/teams/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      navigate('/teams');
    },
  });

  useEffect(() => {
    if (!hasEdited.current) return;
    const timer = setTimeout(() => {
      const data: Record<string, unknown> = {};
      if (localName !== undefined) data.name = localName;
      if (localDescription !== undefined) data.description = localDescription;
      if (localSupervisorId !== undefined) data.supervisor_agent_id = localSupervisorId || null;
      if (Object.keys(data).length > 0) updateMutation.mutate(data);
    }, 500);
    return () => clearTimeout(timer);
  }, [localName, localDescription, localSupervisorId]);

  useEffect(() => {
    if (team) {
      setLocalName(team.name);
      setLocalDescription(team.description);
      setLocalSupervisorId(team.supervisor_agent_id || '');
      hasEdited.current = false;
    }
  }, [team?.id]);

  const handleFieldChange = useCallback(
    (setter: (v: string) => void, value: string) => {
      hasEdited.current = true;
      setter(value);
    },
    [],
  );

  const handleAddMember = useCallback(
    (agentId: string) => {
      if (!team || !agentId) return;
      const current = team.members.map((m) => ({ agent_id: m.agent_id, role: m.role }));
      if (current.some((m) => m.agent_id === agentId)) return;
      membersMutation.mutate([...current, { agent_id: agentId, role: 'member' }]);
    },
    [team, membersMutation],
  );

  const handleRemoveMember = useCallback(
    (agentId: string) => {
      if (!team) return;
      membersMutation.mutate(
        team.members
          .filter((m) => m.agent_id !== agentId)
          .map((m) => ({ agent_id: m.agent_id, role: m.role })),
      );
    },
    [team, membersMutation],
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
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (!team) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <Users size={32} />
        </EmptyMedia>
        <EmptyTitle>{t('teamNotFound')}</EmptyTitle>
        <EmptyDescription>
          {t('teamNotFoundDesc')}
        </EmptyDescription>
        <Button variant="outline" onClick={() => navigate('/teams')}>
          {t('common:backToList')}
        </Button>
      </Empty>
    );
  }

  const tm = team;
  const agentsList: AgentOption[] = allAgents || [];
  const availableForAdd = agentsList.filter(
    (a) => !tm.members.some((m: Member) => m.agent_id === a.id),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/teams')}
          aria-label={t('common:backToList')}
        >
          <ArrowLeft size={20} />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">{tm.name}</h2>
            <Badge variant="default">
              {tm.routing_strategy === 'supervisor' ? t('routingSupervisor') : tm.routing_strategy}
            </Badge>
          </div>
        </div>
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
                {t('confirmDeleteDesc', { name: tm.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                {t('common:cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? t('common:deleting') : t('common:confirmDelete')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <Settings size={14} className="mr-1.5" />
            {t('tabOverview')}
          </TabsTrigger>
          <TabsTrigger value="members">
            <UserPlus size={14} className="mr-1.5" />
            {t('tabMembers')}
          </TabsTrigger>
          <TabsTrigger value="chat">
            <MessageSquare size={14} className="mr-1.5" />
            {t('tabChat')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewPanel
            localName={localName ?? ''}
            onNameChange={(v) => handleFieldChange(setLocalName, v)}
            localDescription={localDescription ?? ''}
            onDescriptionChange={(v) => handleFieldChange(setLocalDescription, v)}
            localSupervisorId={localSupervisorId ?? ''}
            onSupervisorChange={(v) => handleFieldChange(setLocalSupervisorId, v)}
            agentsList={agentsList}
          />
        </TabsContent>

        <TabsContent value="members">
          <MembersPanel
            availableForAdd={availableForAdd}
            members={tm.members}
            onAddMember={handleAddMember}
            onRemoveMember={handleRemoveMember}
          />
        </TabsContent>

        <TabsContent value="chat">
          <TeamChatPanel teamId={id!} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
