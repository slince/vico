// 1. React
import { useState, useRef, useCallback, useEffect } from 'react';

// 2. 第三方
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
 * 通过 Tabs 组织三个功能区：
 * 1. 概览 — 团队名称、描述、协调者 Agent 选择（500ms 防抖自动保存）
 * 2. 成员管理 — Select 下拉添加 / 删除成员，展示当前成员列表
 * 3. 测试对话 — SSE 流式团队聊天，展示委派事件和文本回复
 *
 * 概览页修改通过 500ms 防抖 PATCH 自动提交，无需保存按钮。
 */
export default function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 当前激活的 Tab
  const [activeTab, setActiveTab] = useState('overview');
  // 删除确认 AlertDialog 开关
  const [deleteOpen, setDeleteOpen] = useState(false);

  // 本地概览字段状态（防抖提交用）
  const [localName, setLocalName] = useState<string | undefined>();
  const [localDescription, setLocalDescription] = useState<string | undefined>();
  const [localSupervisorId, setLocalSupervisorId] = useState<string | undefined>();

  // 标记用户是否已编辑过概览字段
  const hasEdited = useRef(false);

  // ====================== 数据获取 ======================

  const { data: team, isLoading } = useQuery<TeamDetailData>({
    queryKey: ['team', id],
    queryFn: () => api(`/teams/${id}`),
    enabled: !!id,
  });

  const { data: allAgents } = useQuery<AgentOption[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  // ====================== Mutations ======================

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

  // ---- 防抖提交：概览字段（500ms 防抖） ----
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

  // ---- 初始化本地状态 ----
  useEffect(() => {
    if (team) {
      setLocalName(team.name);
      setLocalDescription(team.description);
      setLocalSupervisorId(team.supervisor_agent_id || '');
      hasEdited.current = false;
    }
  }, [team?.id]);

  // ====================== 事件处理 ======================

  /** 更新概览字段并标记用户已编辑 */
  const handleFieldChange = useCallback(
    (setter: (v: string) => void, value: string) => {
      hasEdited.current = true;
      setter(value);
    },
    [],
  );

  /** 处理成员添加 */
  const handleAddMember = useCallback(
    (agentId: string) => {
      if (!team || !agentId) return;
      const current = team.members.map((m) => ({ agent_id: m.agent_id, role: m.role }));
      if (current.some((m) => m.agent_id === agentId)) return;
      membersMutation.mutate([...current, { agent_id: agentId, role: 'member' }]);
    },
    [team, membersMutation],
  );

  /** 处理成员移除 */
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

  // ====================== 加载态 / 空态 ======================

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
        <EmptyTitle>团队未找到</EmptyTitle>
        <EmptyDescription>
          该团队可能已被删除，或 ID 无效
        </EmptyDescription>
        <Button variant="outline" onClick={() => navigate('/teams')}>
          返回列表
        </Button>
      </Empty>
    );
  }

  // ====================== 数据预处理 ======================

  const t = team;
  const agentsList: AgentOption[] = allAgents || [];
  const availableForAdd = agentsList.filter(
    (a) => !t.members.some((m: Member) => m.agent_id === a.id),
  );

  // ====================== 页面渲染 ======================

  return (
    <div className="space-y-6">
      {/* 顶部导航栏 */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/teams')}
          aria-label="返回列表"
        >
          <ArrowLeft size={20} />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">{t.name}</h2>
            <Badge variant="default">
              {t.routing_strategy === 'supervisor' ? '协调者模式' : t.routing_strategy}
            </Badge>
          </div>
        </div>
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Trash2 size={14} className="mr-1.5" />
              删除
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除团队「{t.name}」吗？此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteOpen(false)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? '删除中...' : '确认删除'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* 主体：Tab 切换区 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <Settings size={14} className="mr-1.5" />
            概览
          </TabsTrigger>
          <TabsTrigger value="members">
            <UserPlus size={14} className="mr-1.5" />
            成员管理
          </TabsTrigger>
          <TabsTrigger value="chat">
            <MessageSquare size={14} className="mr-1.5" />
            测试对话
          </TabsTrigger>
        </TabsList>

        {/* 概览 Tab */}
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

        {/* 成员管理 Tab */}
        <TabsContent value="members">
          <MembersPanel
            availableForAdd={availableForAdd}
            members={t.members}
            onAddMember={handleAddMember}
            onRemoveMember={handleRemoveMember}
          />
        </TabsContent>

        {/* 测试对话 Tab */}
        <TabsContent value="chat">
          <TeamChatPanel teamId={id!} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
