// 1. React
import { useState, useRef, useCallback, useEffect } from 'react';

// 2. 第三方
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  Settings,
  Puzzle,
  Database,
  MessageSquare,
  Trash2,
} from 'lucide-react';

// 3. API / Hooks / Utils
import { api } from '@/api/client';

// 4. UI 组件
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

// 5. 页面子组件
import ConfigPanel from './agent-detail/ConfigPanel';
import SkillPanel from './agent-detail/SkillPanel';
import KnowledgePanel from './agent-detail/KnowledgePanel';
import ChatPanel from './agent-detail/ChatPanel';

// 6. 类型
import type { Agent, ChatMessage, Skill, KnowledgeBase, Model } from './agent-detail/types';

/**
 * Agent 详情 / 配置页面
 *
 * 通过 Tabs 组织四个功能区：
 * 1. 配置 — System Prompt、模型选择、温度 / MaxTokens
 * 2. Skill 绑定 — 复选框列表
 * 3. 知识库绑定 — 复选框列表
 * 4. 测试对话 — SSE 流式聊天
 *
 * 所有修改即时通过 PATCH/PUT mutation 提交，无需保存按钮。
 */
export default function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 当前激活的 Tab
  const [activeTab, setActiveTab] = useState('config');
  // 测试对话消息列表
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  // 输入框内容
  const [input, setInput] = useState('');
  // 是否正在流式响应中
  const [streaming, setStreaming] = useState(false);
  // 删除确认 AlertDialog 开关
  const [deleteOpen, setDeleteOpen] = useState(false);

  // 本地 System Prompt 状态（防抖提交用）
  const [localSystemPrompt, setLocalSystemPrompt] = useState<string | undefined>();
  // 本地 Max Tokens 状态（防抖提交用）
  const [localMaxTokens, setLocalMaxTokens] = useState<number | undefined>();

  // ---- 标记用户是否已编辑过对应字段（用于区分初始值 vs 用户输入） ----
  const hasEditedPrompt = useRef(false);
  const hasEditedMaxTokens = useRef(false);

  // ====================== 数据获取 ======================

  /** 获取当前 Agent 详情 */
  const { data: agent, isLoading } = useQuery<Agent>({
    queryKey: ['agent', id],
    queryFn: () => api(`/agents/${id}`),
    enabled: !!id,
  });

  /** 获取全部 Skill 列表，用于绑定面板 */
  const { data: allSkills } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: () => api('/skills'),
  });

  /** 获取全部知识库列表，用于绑定面板 */
  const { data: allKbs } = useQuery<KnowledgeBase[]>({
    queryKey: ['knowledge-bases'],
    queryFn: () => api('/knowledge-bases'),
  });

  /** 获取可用模型列表 */
  const { data: models } = useQuery<Model[]>({
    queryKey: ['models'],
    queryFn: () => api('/models'),
  });

  // ====================== Mutations ======================

  /** 通用更新 Agent 配置（System Prompt、模型、温度等） */
  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  /** 更新 Skill 绑定关系 */
  const skillsMutation = useMutation({
    mutationFn: (skills: { skill_name: string }[]) =>
      api(`/agents/${id}/skills`, {
        method: 'PUT',
        body: JSON.stringify({ skills }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  /** 更新知识库绑定关系 */
  const kbMutation = useMutation({
    mutationFn: (kbs: { kb_id: string }[]) =>
      api(`/agents/${id}/knowledge`, {
        method: 'PUT',
        body: JSON.stringify({ knowledge_bases: kbs }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent', id] }),
  });

  /** 删除 Agent */
  const deleteMutation = useMutation({
    mutationFn: () => api(`/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      navigate('/agents');
    },
  });

  // ---- 防抖提交：System Prompt（仅用户编辑后触发，300ms 防抖） ----
  useEffect(() => {
    if (!hasEditedPrompt.current || localSystemPrompt === undefined) return;
    const timer = setTimeout(() => {
      updateMutation.mutate({ system_prompt: localSystemPrompt });
    }, 300);
    return () => clearTimeout(timer);
  }, [localSystemPrompt]);

  // ---- 防抖提交：Max Tokens（仅用户编辑后触发，300ms 防抖） ----
  useEffect(() => {
    if (!hasEditedMaxTokens.current || localMaxTokens === undefined) return;
    const timer = setTimeout(() => {
      updateMutation.mutate({ max_tokens: localMaxTokens });
    }, 300);
    return () => clearTimeout(timer);
  }, [localMaxTokens]);

  // ====================== 事件处理 ======================

  /** 更新 System Prompt 并标记用户已编辑 */
  const handleSystemPromptChange = useCallback((value: string) => {
    hasEditedPrompt.current = true;
    setLocalSystemPrompt(value);
  }, []);

  /** 更新 Max Tokens 并标记用户已编辑 */
  const handleMaxTokensChange = useCallback((value: string) => {
    hasEditedMaxTokens.current = true;
    if (value === '') {
      setLocalMaxTokens(undefined);
      return;
    }
    const num = parseInt(value, 10);
    if (!isNaN(num) && num >= 1 && num <= 128000) {
      setLocalMaxTokens(num);
    }
  }, []);

  /**
   * 处理 Skill 复选框切换
   *
   * 根据当前选中状态，在绑定列表中添加或移除指定 Skill，
   * 然后通过 skillsMutation 提交新的完整绑定列表。
   */
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

  /**
   * 处理知识库复选框切换
   *
   * 逻辑同 toggleSkill，操作对象为知识库 ID 列表。
   */
  const toggleKb = useCallback(
    (kbId: string, boundKbs: string[]) => {
      const isBound = boundKbs.includes(kbId);
      const next = isBound
        ? boundKbs.filter((n) => n !== kbId)
        : [...boundKbs, kbId];
      kbMutation.mutate(next.map((n) => ({ kb_id: n })));
    },
    [kbMutation],
  );

  /** 删除确认提交 */
  const handleDelete = useCallback(() => {
    deleteMutation.mutate();
  }, [deleteMutation]);

  /** 通用更新回调（用于 ConfigPanel） */
  const handleUpdate = useCallback(
    (data: Record<string, unknown>) => {
      updateMutation.mutate(data);
    },
    [updateMutation],
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
        <EmptyTitle>Agent 未找到</EmptyTitle>
        <EmptyDescription>
          该 Agent 可能已被删除，或 ID 无效
        </EmptyDescription>
        <Button variant="outline" onClick={() => navigate('/agents')}>
          返回列表
        </Button>
      </Empty>
    );
  }

  // ====================== 数据预处理 ======================

  const a = agent;

  // 已绑定的 Skill 名称列表
  const boundSkills: string[] = (a.skills || []).map(
    (s: { skill_name: string }) => s.skill_name,
  );
  // 已绑定的知识库 ID 列表
  const boundKbs: string[] = (a.knowledge_bases || []).map(
    (k: { kb_id: string }) => k.kb_id,
  );

  const skillsList = allSkills || [];
  const kbsList = allKbs || [];
  const modelsList = models || [];

  // ====================== 页面渲染 ======================

  return (
    <div className="space-y-6">
      {/* 顶部导航栏 */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/agents')}
          aria-label="返回列表"
        >
          <ArrowLeft size={20} />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">{a.name}</h2>
            <Badge variant={a.enabled ? 'default' : 'secondary'}>
              {a.enabled ? '启用中' : '已禁用'}
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
                确定要删除 Agent「{a.name}」吗？此操作不可撤销，所有关联的对话记录也将被清除。
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
                onClick={handleDelete}
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
          <TabsTrigger value="config">
            <Settings size={14} className="mr-1.5" />
            配置
          </TabsTrigger>
          <TabsTrigger value="skills">
            <Puzzle size={14} className="mr-1.5" />
            Skill 绑定
          </TabsTrigger>
          <TabsTrigger value="knowledge">
            <Database size={14} className="mr-1.5" />
            知识库绑定
          </TabsTrigger>
          <TabsTrigger value="chat">
            <MessageSquare size={14} className="mr-1.5" />
            测试对话
          </TabsTrigger>
        </TabsList>

        {/* 配置 Tab */}
        <TabsContent value="config">
          <ConfigPanel
            agent={a}
            modelsList={modelsList}
            localSystemPrompt={localSystemPrompt}
            onSystemPromptChange={handleSystemPromptChange}
            localMaxTokens={localMaxTokens}
            onMaxTokensChange={handleMaxTokensChange}
            onUpdate={handleUpdate}
          />
        </TabsContent>

        {/* Skill 绑定 Tab */}
        <TabsContent value="skills">
          <SkillPanel
            skillsList={skillsList}
            boundSkills={boundSkills}
            onToggleSkill={toggleSkill}
          />
        </TabsContent>

        {/* 知识库绑定 Tab */}
        <TabsContent value="knowledge">
          <KnowledgePanel
            kbsList={kbsList}
            boundKbs={boundKbs}
            onToggleKb={toggleKb}
          />
        </TabsContent>

        {/* 测试对话 Tab */}
        <TabsContent value="chat">
          <ChatPanel
            agentId={id!}
            messages={chatMessages}
            onMessagesChange={setChatMessages}
            input={input}
            onInputChange={setInput}
            streaming={streaming}
            onStreamingChange={setStreaming}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
