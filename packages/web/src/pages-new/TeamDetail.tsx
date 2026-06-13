// 1. React
import { useState, useRef, useCallback, useEffect } from 'react';

// 2. 第三方
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Settings, UserPlus, MessageSquare, Trash2, X,
} from 'lucide-react';

// 3. API / Hooks / Utils
import { api, streamTeamChat } from '@/api/client';

// 4. UI 组件
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyMedia, EmptyTitle, EmptyDescription,
} from '@/components/ui/empty';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent,
  AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. 类型

/** 团队成员 */
interface Member {
  id: string;
  agent_id: string;
  role: string;
  agent_name: string;
}

/** 团队详情数据（来自 GET /api/v1/teams/:id） */
interface TeamDetailData {
  id: string;
  name: string;
  description: string;
  routing_strategy: string;
  supervisor_agent_id: string | null;
  members: Member[];
}

/** Agent 选项（下拉选择用） */
interface AgentOption {
  id: string;
  name: string;
}

/** 聊天消息 */
interface ChatMessage {
  role: 'user' | 'assistant' | 'delegation';
  content: string;
  agentName?: string;
}

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

  // 标记用户是否已编辑过概览字段（用于区分初始值 vs 用户输入）
  const hasEdited = useRef(false);

  // 测试对话消息列表
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // 输入框内容
  const [chatInput, setChatInput] = useState('');
  // 是否正在流式响应中
  const [streaming, setStreaming] = useState(false);

  // ====================== 数据获取 ======================

  /** 获取团队详情（含成员列表） */
  const { data: team, isLoading } = useQuery<TeamDetailData>({
    queryKey: ['team', id],
    queryFn: () => api(`/teams/${id}`),
    enabled: !!id,
  });

  /** 获取全部 Agent 列表（用于协调者选择和成员添加） */
  const { data: allAgents } = useQuery<AgentOption[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  // ====================== Mutations ======================

  /** 更新团队概览配置（名称、描述、协调者） */
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api(`/teams/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team', id] }),
  });

  /** 替换团队成员列表（全量提交） */
  const membersMutation = useMutation({
    mutationFn: (members: { agent_id: string; role?: string }[]) =>
      api(`/teams/${id}/members`, {
        method: 'PUT',
        body: JSON.stringify({ members }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team', id] }),
  });

  /** 删除团队 */
  const deleteMutation = useMutation({
    mutationFn: () => api(`/teams/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      navigate('/teams');
    },
  });

  // ---- 防抖提交：概览字段（仅用户编辑后触发，500ms 防抖） ----
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

  // ---- 初始化本地状态（数据加载完成后同步） ----
  useEffect(() => {
    if (team) {
      setLocalName(team.name);
      setLocalDescription(team.description);
      setLocalSupervisorId(team.supervisor_agent_id || '');
      hasEdited.current = false;
    }
  }, [team?.id]);

  // ====================== 事件处理 ======================

  /**
   * 更新概览字段并标记用户已编辑
   *
   * 通过 setter 更新对应的本地状态，同时将 hasEdited 置为 true，
   * 确保防抖 effect 会在下一个 tick 触发 PATCH 请求。
   */
  const handleFieldChange = useCallback(
    (setter: (v: string) => void, value: string) => {
      hasEdited.current = true;
      setter(value);
    },
    [],
  );

  /**
   * 处理成员添加
   *
   * 从 Select 下拉选中 Agent ID 后，追加到当前成员列表并全量提交。
   * 已存在的成员不会重复添加。
   */
  const handleAddMember = useCallback(
    (agentId: string) => {
      if (!team || !agentId) return;
      const current = team.members.map((m) => ({ agent_id: m.agent_id, role: m.role }));
      if (current.some((m) => m.agent_id === agentId)) return;
      membersMutation.mutate([...current, { agent_id: agentId, role: 'member' }]);
    },
    [team, membersMutation],
  );

  /**
   * 处理成员移除
   *
   * 从当前成员列表中移除指定的 Agent，然后全量提交剩余成员。
   */
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

  /**
   * 发送团队聊天消息并处理 SSE 流式响应
   *
   * 通过 streamTeamChat 建立 SSE 连接：
   * - text_delta 事件：实时拼接助手回复文本
   * - delegation_end 事件：展示委派结果（蓝色气泡 + Agent 名称）
   * - done 事件：结束流式状态
   * - error 事件：显示错误消息
   */
  const sendTeamMessage = useCallback(() => {
    if (!chatInput.trim() || streaming || !id) return;

    // 追加用户消息到列表
    setChatMessages((prev) => [...prev, { role: 'user', content: chatInput }]);
    setStreaming(true);

    // 累积流式响应的完整文本
    let fullResponse = '';

    streamTeamChat(
      { teamId: id, message: chatInput },
      // onEvent：处理 SSE 事件
      (event) => {
        if (event.type === 'delegation_end') {
          // 委派结束事件：插入蓝色委派气泡
          setChatMessages((prev) => [
            ...prev,
            {
              role: 'delegation',
              content: `委派结果: ${event.summary || ''}`,
              agentName: event.agentName,
            },
          ]);
        } else if (event.type === 'text_delta') {
          // 文本增量：实时更新助手消息
          fullResponse += event.content;
          setChatMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { role: 'assistant', content: fullResponse }];
            }
            return [...prev, { role: 'assistant', content: fullResponse }];
          });
        }
      },
      // onError：处理错误
      (err) => {
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `错误: ${err.message}` },
        ]);
        setStreaming(false);
      },
      // onDone：流结束
      () => setStreaming(false),
    );

    // 清空输入框
    setChatInput('');
  }, [chatInput, streaming, id]);

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
  // 过滤出尚未加入团队的 Agent，用于添加成员下拉
  const availableForAdd = agentsList.filter(
    (a) => !t.members.some((m) => m.agent_id === a.id),
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
        {/* 删除入口：使用 AlertDialog 二次确认 */}
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
          <Card>
            <CardHeader>
              <CardTitle>团队配置</CardTitle>
              <CardDescription>
                编辑团队基本信息和协调策略
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="team-name">团队名称</Label>
                <Input
                  id="team-name"
                  value={localName ?? ''}
                  onChange={(e) => handleFieldChange(setLocalName, e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-desc">描述</Label>
                <Input
                  id="team-desc"
                  value={localDescription ?? ''}
                  onChange={(e) => handleFieldChange(setLocalDescription, e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-supervisor">协调者 Agent</Label>
                <Select
                  value={localSupervisorId || ''}
                  onValueChange={(v) => handleFieldChange(setLocalSupervisorId, v)}
                >
                  <SelectTrigger id="team-supervisor">
                    <SelectValue placeholder="选择协调者 Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agentsList.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 成员管理 Tab */}
        <TabsContent value="members">
          <div className="space-y-4">
            {/* 添加成员 */}
            <Card>
              <CardHeader>
                <CardTitle>添加成员</CardTitle>
                <CardDescription>
                  选择要加入团队的 Agent
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Select onValueChange={handleAddMember}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择 Agent..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableForAdd.length === 0 ? (
                      <div className="px-2 py-4 text-sm text-muted-foreground text-center">
                        所有 Agent 已在团队中
                      </div>
                    ) : (
                      availableForAdd.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>

            {/* 当前成员列表 */}
            <Card>
              <CardHeader>
                <CardTitle>当前成员 ({t.members.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {t.members.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无成员</p>
                ) : (
                  t.members.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between py-2 px-3 bg-accent rounded-md"
                    >
                      <div>
                        <p className="text-sm font-medium">{m.agent_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.role || '成员'}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemoveMember(m.agent_id)}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 测试对话 Tab */}
        <TabsContent value="chat">
          <Card className="flex flex-col h-[calc(100vh-14rem)]">
            <CardHeader className="pb-3">
              <CardTitle>团队对话测试</CardTitle>
              <CardDescription>
                向团队发送消息，观察协调者如何分配任务
              </CardDescription>
            </CardHeader>

            <Separator />

            {/* 消息列表区域 */}
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full px-4 py-3">
                {/* 空消息提示 */}
                {chatMessages.length === 0 && (
                  <div className="flex items-center justify-center h-full py-20">
                    <Empty>
                      <EmptyMedia variant="icon">
                        <MessageSquare size={24} />
                      </EmptyMedia>
                      <EmptyTitle>开始测试</EmptyTitle>
                      <EmptyDescription>
                        在下方输入消息，测试团队协作效果
                      </EmptyDescription>
                    </Empty>
                  </div>
                )}

                {/* 消息列表 */}
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex mb-3 ${
                      msg.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : msg.role === 'delegation'
                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                            : 'bg-accent'
                      }`}
                    >
                      {msg.role === 'delegation' && msg.agentName && (
                        <p className="text-xs font-semibold mb-1">
                          {msg.agentName}
                        </p>
                      )}
                      <p className="whitespace-pre-wrap break-words">
                        {msg.content || '...'}
                      </p>
                    </div>
                  </div>
                ))}

                {/* 流式响应指示器 */}
                {streaming && (
                  <div className="flex justify-start mb-3">
                    <div className="flex items-center gap-2 bg-accent rounded-lg px-3 py-2">
                      <Spinner className="size-3.5" />
                      <span className="text-xs text-muted-foreground">
                        正在生成...
                      </span>
                    </div>
                  </div>
                )}
              </ScrollArea>
            </CardContent>

            <Separator />

            {/* 输入区域 */}
            <CardContent className="pt-3 pb-3">
              <div className="flex gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  // 回车发送，Shift+Enter 换行
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendTeamMessage();
                    }
                  }}
                  placeholder="输入测试消息，Enter 发送..."
                  disabled={streaming}
                  className="flex-1"
                />
                <Button
                  onClick={sendTeamMessage}
                  disabled={streaming || !chatInput.trim()}
                  size="icon"
                >
                  {streaming ? (
                    <Spinner className="size-4" />
                  ) : (
                    <span>→</span>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
