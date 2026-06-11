import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, streamChat } from '@/api/client';
import { useParams, useNavigate } from 'react-router-dom';
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ArrowLeft,
  Send,
  Bot,
  Settings,
  Puzzle,
  Database,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';

// ====================== 类型定义 ======================

/** Skill 数据形状 */
interface Skill {
  name: string;
  displayName: string;
  description: string;
}

/** 知识库数据形状 */
interface KnowledgeBase {
  id: string;
  name: string;
  chunk_count: number;
}

/** 模型配置数据形状 */
interface Model {
  id: string;
  provider: string;
  model_name: string;
}

/** Agent 完整数据形状 */
interface Agent {
  id: string;
  name: string;
  enabled: boolean;
  system_prompt?: string;
  model_id?: string;
  temperature?: number;
  max_tokens?: number;
  skills?: { skill_name: string }[];
  knowledge_bases?: { kb_id: string }[];
}

/** 聊天消息 */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

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
  // 删除确认 Sheet 开关
  const [deleteOpen, setDeleteOpen] = useState(false);

  // 聊天消息容器的 ref，用于自动滚动到底部
  const chatEndRef = useRef<HTMLDivElement>(null);

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
      // 删除成功后返回 Agent 列表页
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      navigate('/agents');
    },
  });

  // ====================== 聊天逻辑 ======================

  /**
   * 发送聊天消息并处理 SSE 流式响应
   *
   * 通过 streamChat 建立 SSE 连接，收到 text_delta 事件时
   * 实时更新助手消息内容，完成后设置 streaming 状态为 false。
   */
  const sendMessage = useCallback(() => {
    if (!input.trim() || streaming || !id) return;

    // 追加用户消息到列表
    setChatMessages((prev) => [...prev, { role: 'user', content: input }]);
    setStreaming(true);

    // 累积流式响应的完整文本
    let fullResponse = '';

    streamChat(
      { agentId: id, message: input },
      // onEvent：处理 SSE 事件
      (event) => {
        if (event.type === 'text_delta') {
          fullResponse += event.content;
          // 使用函数式更新以获取最新消息列表，避免闭包陈旧问题
          setChatMessages((prev) => {
            const last = prev[prev.length - 1];
            // 如果最后一条已是助手消息，则替换其内容；否则追加新消息
            if (last?.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { role: 'assistant', content: fullResponse },
              ];
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
    setInput('');
  }, [input, streaming, id]);

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
        ? boundSkills.filter((n) => n !== skillName) // 取消绑定
        : [...boundSkills, skillName]; // 新增绑定
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

  /**
   * 执行删除 Agent 并关闭确认 Sheet
   */
  const handleDelete = useCallback(() => {
    deleteMutation.mutate();
  }, [deleteMutation]);

  // ====================== 自动滚动 ======================

  /** 聊天消息更新后自动滚动到底部 */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, streaming]);

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
        {/* 配置骨架屏 */}
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
        {/* 返回按钮 */}
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
            {/* 启用 / 禁用状态 Badge */}
            <Badge variant={a.enabled ? 'default' : 'secondary'}>
              {a.enabled ? '启用中' : '已禁用'}
            </Badge>
          </div>
        </div>
        {/* 删除入口：通过 Sheet 二次确认 */}
        <Sheet open={deleteOpen} onOpenChange={setDeleteOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <Trash2 size={14} className="mr-1.5" />
              删除
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>确认删除</SheetTitle>
              <SheetDescription>
                确定要删除 Agent「{a.name}」吗？此操作不可撤销，所有关联的对话记录也将被清除。
              </SheetDescription>
            </SheetHeader>
            <SheetFooter className="mt-6">
              <SheetClose asChild>
                <Button variant="outline">取消</Button>
              </SheetClose>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? '删除中...' : '确认删除'}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      {/* 主体：Tab 切换区 */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Tab 导航栏 */}
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

        {/* ==================== 配置 Tab ==================== */}
        <TabsContent value="config" className="mt-4 space-y-4">
          {/* System Prompt 编辑 */}
          <Card>
            <CardHeader>
              <CardTitle>System Prompt</CardTitle>
              <CardDescription>
                定义 Agent 的角色、行为规范和回复风格。修改即时保存。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Label htmlFor="system-prompt" className="sr-only">
                System Prompt
              </Label>
              <Textarea
                id="system-prompt"
                value={a.system_prompt || ''}
                onChange={(e) =>
                  updateMutation.mutate({ system_prompt: e.target.value })
                }
                className="min-h-40 font-mono text-sm"
                placeholder="输入 System Prompt，定义 Agent 的行为准则..."
              />
            </CardContent>
          </Card>

          {/* 模型选择 */}
          <Card>
            <CardHeader>
              <CardTitle>模型选择</CardTitle>
              <CardDescription>
                选择 Agent 使用的大语言模型。不同模型在能力、速度和成本上有所差异。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={a.model_id || ''}
                onValueChange={(value) =>
                  updateMutation.mutate({ model_id: value })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="请选择模型..." />
                </SelectTrigger>
                <SelectContent>
                  {modelsList.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.provider} / {m.model_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {modelsList.length === 0 && (
                <p className="text-sm text-muted-foreground mt-2">
                  暂无可用模型，请先在设置中配置模型提供商
                </p>
              )}
            </CardContent>
          </Card>

          {/* 参数配置 */}
          <Card>
            <CardHeader>
              <CardTitle>参数配置</CardTitle>
              <CardDescription>
                调整生成参数以控制回复的创造性和长度。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Temperature 滑块 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Temperature</Label>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {a.temperature ?? 0.7}
                  </span>
                </div>
                {/* 使用 Slider 替代原生 range 输入 */}
                <Slider
                  value={[a.temperature ?? 0.7]}
                  // 仅在用户释放滑块时提交，避免拖动过程中频繁请求
                  onValueCommit={([v]) =>
                    updateMutation.mutate({ temperature: v })
                  }
                  min={0}
                  max={2}
                  step={0.1}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0 — 精确</span>
                  <span>2 — 创造</span>
                </div>
              </div>

              <Separator />

              {/* Max Tokens 数字输入 */}
              <div className="space-y-2">
                <Label htmlFor="max-tokens">Max Tokens</Label>
                <Input
                  id="max-tokens"
                  type="number"
                  value={a.max_tokens ?? 4096}
                  onChange={(e) =>
                    updateMutation.mutate({
                      max_tokens: parseInt(e.target.value) || 4096,
                    })
                  }
                  min={1}
                  max={128000}
                  className="max-w-48"
                />
                <p className="text-xs text-muted-foreground">
                  单次回复的最大 token 数，范围 1–128000
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== Skill 绑定 Tab ==================== */}
        <TabsContent value="skills" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>绑定 Skill 插件</CardTitle>
              <CardDescription>
                勾选需要为此 Agent 启用的 Skill。Skill 可扩展 Agent 的工具能力。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {skillsList.length === 0 ? (
                <Empty>
                  <EmptyMedia variant="icon">
                    <Puzzle size={24} />
                  </EmptyMedia>
                  <EmptyTitle>暂无可用 Skill</EmptyTitle>
                  <EmptyDescription>
                    请先到 Skill 管理页安装插件
                  </EmptyDescription>
                </Empty>
              ) : (
                <div className="space-y-1">
                  {skillsList.map((s) => {
                    const isBound = boundSkills.includes(s.name);
                    return (
                      <label
                        key={s.name}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent cursor-pointer transition-colors has-checked:bg-accent/50"
                      >
                        {/* shadcn Checkbox：受控组件 */}
                        <Checkbox
                          checked={isBound}
                          onCheckedChange={() =>
                            toggleSkill(s.name, boundSkills)
                          }
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-none">
                            {s.displayName}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {s.description}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== 知识库绑定 Tab ==================== */}
        <TabsContent value="knowledge" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>绑定知识库</CardTitle>
              <CardDescription>
                勾选要关联的知识库，Agent 将在对话中检索其中的文档内容作为上下文。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {kbsList.length === 0 ? (
                <Empty>
                  <EmptyMedia variant="icon">
                    <Database size={24} />
                  </EmptyMedia>
                  <EmptyTitle>暂无知识库</EmptyTitle>
                  <EmptyDescription>
                    请先到知识库页上传文档并创建知识库
                  </EmptyDescription>
                </Empty>
              ) : (
                <div className="space-y-1">
                  {kbsList.map((kb) => {
                    const isBound = boundKbs.includes(kb.id);
                    return (
                      <label
                        key={kb.id}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent cursor-pointer transition-colors has-checked:bg-accent/50"
                      >
                        <Checkbox
                          checked={isBound}
                          onCheckedChange={() => toggleKb(kb.id, boundKbs)}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-none">
                            {kb.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {kb.chunk_count} 个文档块
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ==================== 测试对话 Tab ==================== */}
        <TabsContent value="chat" className="mt-4">
          <Card className="flex flex-col h-[calc(100vh-14rem)]">
            <CardHeader className="pb-3">
              <CardTitle>预览 &amp; 测试对话</CardTitle>
              <CardDescription>
                在此测试当前配置下的 Agent 效果，所有对话均为临时会话
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
                        在下方输入消息，体验 Agent 的回复效果
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
                          : 'bg-accent'
                      }`}
                    >
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

                {/* 滚动锚点：新消息自动滚动到此 */}
                <div ref={chatEndRef} />
              </ScrollArea>
            </CardContent>

            <Separator />

            {/* 输入区域 */}
            <CardContent className="pt-3 pb-3">
              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  // 回车发送，Shift+Enter 换行
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="输入测试消息，Enter 发送..."
                  disabled={streaming}
                  className="flex-1"
                />
                <Button
                  onClick={sendMessage}
                  disabled={streaming || !input.trim()}
                  size="icon"
                >
                  {streaming ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Send size={16} />
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
