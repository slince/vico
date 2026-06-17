# Assistant UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `@assistant-ui/react` 全家桶替换现有自定义聊天 UI，通过服务端 AI SDK 协议适配使 Mastra 后端与 Assistant UI 无缝对接。

**Architecture:** 服务端新增 `createAISDKStream` 将 Mastra 输出转为 AI SDK v6 `UIMessageStream` 格式；前端用 `@assistant-ui/react-ai-sdk` 的 `useChatRuntime` 桥接 `useChat` → Assistant UI 的 `Thread`/`Composer` 组件；每个工具用 `makeAssistantToolUI` 定义专属渲染卡片。

**Tech Stack:** `@assistant-ui/react` v0.x + `@assistant-ui/react-ai-sdk` + `@assistant-ui/react-markdown`; 服务端复用 `ai` v6 `createUIMessageStream`; 客户端复用 `@ai-sdk/react` 或升级到最新。

## Global Constraints

- 服务端 `ai` >= 6.0.204 (已安装)
- 客户端 `@ai-sdk/react` 需升级到兼容 `ai` v6 wire format 的版本（当前 v1.2.12）
- 不修改 Mastra agent 管道核心逻辑
- 审批流程（`approval_required`）通过 ToolUI 交互实现，不动后端审批 API
- 所有工具未定义 ToolUI 时回退到 Assistant UI 内置默认卡片

---

### Task 1: 依赖安装与版本兼容性验证

**Files:**
- Modify: `packages/web/package.json`
- Modify: `pnpm-lock.yaml` (auto)

**Interfaces:**
- Produces: 确认 `@assistant-ui/react`、`@assistant-ui/react-ai-sdk`、`@assistant-ui/react-markdown` 可用；`@ai-sdk/react` 升级到兼容版本（预期 v2.x）

- [ ] **Step 1: 安装 Assistant UI 包**

```bash
cd packages/web && pnpm add @assistant-ui/react @assistant-ui/react-ai-sdk @assistant-ui/react-markdown
```

- [ ] **Step 2: 检查 `@ai-sdk/react` 版本**

```bash
cat packages/web/node_modules/@ai-sdk/react/package.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['version'])"
```

如果版本 < 2.0，则 `pnpm add @ai-sdk/react@latest` 升级。

- [ ] **Step 3: 验证 `ai` v6 服务端 API 可用性**

在 `packages/server/` 下临时创建一个测试脚本来验证导入：

```bash
cd packages/server && node -e "
const { createUIMessageStream } = require('ai');
console.log('createUIMessageStream:', typeof createUIMessageStream);
"
```

或使用 tsx：
```bash
cd packages/server && npx tsx -e "
import { createUIMessageStream } from 'ai';
console.log('createUIMessageStream:', typeof createUIMessageStream);
"
```

预期：打印 `createUIMessageStream: function`

- [ ] **Step 4: 验证客户端导入**

```bash
cd packages/web && npx tsc --noEmit -p tsconfig.json 2>&1 | head -5
# 应该不报 @assistant-ui 相关的解析错误
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/package.json pnpm-lock.yaml
git commit -m "deps: add @assistant-ui/react + ai-sdk + markdown"
```

---

### Task 2: 服务端 — AI SDK 流适配器

**Files:**
- Create: `packages/server/src/agent/ai-sdk-stream.ts`

**Interfaces:**
- Produces: `createAISDKStream(output: MastraModelOutput): Promise<Response>`
- Consumes: `MastraModelOutput.textStream`, `output.toolCalls`, `output.toolResults` (同现有 `createSSEStream` 模式)

- [ ] **Step 1: 创建适配器模块**

```typescript
/**
 * AI SDK 协议流适配器
 *
 * 将 Mastra agent.stream() 返回的 MastraModelOutput 转换为 AI SDK UIMessageStream 格式，
 * 使前端 @assistant-ui/react-ai-sdk 的 useChat 可以直接消费。
 *
 * 与 sse-utils.ts 的 createSSEStream 功能对等，但输出格式不同：
 * - createSSEStream: 自定义 SSE JSON 事件流 (type: text_delta/tool_call/tool_result/done)
 * - createAISDKStream: AI SDK v6 UIMessageStream 格式 (createUIMessageStreamResponse)
 */
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import type { MastraModelOutput } from '@mastra/core/stream';

/** createAISDKStream 的可选参数 */
export interface AISDKStreamOptions {
  /** 合并到 finish 事件中的额外字段（如 threadId） */
  doneMetadata?: Record<string, unknown>;
  /** 流结束后调用的回调，用于异步后处理 */
  onComplete?: (fullText: string) => void | Promise<void>;
}

/**
 * 将 MastraModelOutput 转换为 AI SDK UI stream Response。
 *
 * 流程：消费 textStream → 消费 toolCalls/toolResults → 写入 UIMessageStream → 包装为 Response
 *
 * @param output - Mastra agent.stream() 返回值
 * @param options - 可选配置
 * @returns 可直接作为 Hono 响应体的 Response
 */
export async function createAISDKStream(
  output: MastraModelOutput<unknown>,
  options?: AISDKStreamOptions,
): Promise<Response> {
  const stream = createUIMessageStream({
    async execute({ writer }) {
      let fullText = '';

      // 1. 流式文本增量
      for await (const chunk of output.textStream) {
        fullText += chunk;
        writer.write({
          type: 'text-delta',
          textDelta: chunk,
        } as any);
      }

      // 2. 工具调用 & 结果（Promise.all + catch 保证任一失败不影响其余）
      const [toolCalls, toolResults, usage] = await Promise.all([
        output.toolCalls.catch(() => []),
        output.toolResults.catch(() => []),
        output.usage.catch(() => undefined),
      ]);

      // 3. 写入工具调用
      for (const tc of toolCalls) {
        const p = tc.payload;
        writer.write({
          type: 'tool-call',
          toolCallId: (p as any).toolCallId || crypto.randomUUID(),
          toolName: p.toolName as string,
          args: p.args as Record<string, unknown>,
        } as any);
      }

      // 4. 写入工具结果（用 toolCallId 匹配对应的调用）
      for (const tr of toolResults) {
        const p = tr.payload;
        writer.write({
          type: 'tool-result',
          toolCallId: (p as any).toolCallId || '',
          toolName: p.toolName as string,
          result: typeof p.result === 'string' ? p.result : JSON.stringify(p.result),
        } as any);
      }

      // 5. 结束事件（含 usage）
      writer.write({
        type: 'finish',
        finishReason: 'stop',
        usage: usage
          ? { promptTokens: usage.inputTokens ?? 0, completionTokens: usage.outputTokens ?? 0 }
          : undefined,
        ...options?.doneMetadata,
      } as any);

      // 6. onComplete 回调（fire-and-forget）
      if (options?.onComplete) {
        Promise.resolve(options.onComplete(fullText)).catch(() => {});
      }
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd packages/server && npx tsc --noEmit src/agent/ai-sdk-stream.ts 2>&1
```

注：这一步是为了及早发现类型错误。`writer.write()` 接受的 UIMessageChunk 类型联合在 ai v6 中可能较复杂，需要 `as any` 断言或需要精确匹配类型。如果 `UIMessageStreamWriter.write()` 的类型签名与上面不兼容，调整为：

```typescript
// 备选方案：如果 write() 不接受复杂的联合类型，直接构造 chunk
writer.write({ type: 'text-delta', textDelta: chunk } as InferUIMessageChunk<UIMessage>);
```

尝试编译，修复任何类型错误后再继续。

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/agent/ai-sdk-stream.ts
git commit -m "feat: add AI SDK stream adapter for Mastra output"
```

---

### Task 3: 服务端 — 新增 AI SDK 聊天端点

**Files:**
- Modify: `packages/server/src/api/chat.ts`

**Interfaces:**
- Produces: `POST /api/v1/chat/ai-sdk` — 行为同 `/api/v1/chat`，但返回 AI SDK 格式流
- Produces: `POST /api/v1/teams/:id/chat/ai-sdk` — 团队聊天 AI SDK 格式
- Consumes: `executeAgentChat` (内部逻辑复用)、`createAISDKStream`

- [ ] **Step 1: 在 chat.ts 中添加 AI SDK 端点**

注意：不能直接复用 `executeAgentChat`，因为它内部调用 `createSSEStream` 返回旧格式 Response。需要一个新的执行函数或重构 `executeAgentChat` 使其格式可插拔。

在 `packages/server/src/api/chat.ts` 的 `chatRoutes` 函数中新增两个路由：

```typescript
import { createAISDKStream } from '../agent/ai-sdk-stream.js';
import { mastra } from '../mastra.js';
import { getMemory } from '../agent/memory-setup.js';
import { prepareAgentContext, prepareMainAgentContext } from '../agent/agent.factory.js';
import { resourceId } from '../lib/resource.js';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraModelOutput } from '@mastra/core/stream';
import { v4 as uuidv4 } from 'uuid';

/** 单 Agent 对话 — AI SDK 协议 */
app.post('/api/v1/chat/ai-sdk', async (c) => {
  const auth = await getAuthContext(c);
  if (auth instanceof Response) return auth;

  const body = await c.req.json();
  const { agentId, message, threadId } = body;
  if (!agentId || !message) {
    return c.json({ error: 'agentId and message are required' }, 400);
  }

  try {
    const thread = threadId || `${agentId}::${auth.userId}::${uuidv4()}`;
    const requestContext = new RequestContext();

    const ctx = agentId === 'main'
      ? await prepareMainAgentContext(auth.tenantId, requestContext)
      : await prepareAgentContext(auth.tenantId, agentId, requestContext);

    // 保存 thread
    const memory = await getMemory();
    await memory.saveThread({
      thread: {
        id: thread,
        resourceId: resourceId(auth.tenantId, auth.userId),
        title: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: { agent_id: agentId, user_id: auth.userId },
      },
    });

    const mastraAgentId = agentId === 'main' ? 'mainAgent' : 'agentProxy';
    const output: MastraModelOutput<unknown> = await mastra.getAgent(mastraAgentId).stream(
      [{ role: 'user', content: message }],
      {
        instructions: ctx.instructions,
        memory: { thread, resource: resourceId(auth.tenantId, auth.userId) },
        maxSteps: ctx.agent.max_steps || 10,
        requestContext,
      },
    );

    return createAISDKStream(output, {
      doneMetadata: { threadId: thread },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'An internal error occurred';
    import('../lib/logger.js').then(({ default: logger }) =>
      logger.error({ err: error, agentId, tenantId: auth.tenantId }, 'Chat AI SDK stream error'),
    );
    return c.json({ error: msg }, 500);
  }
});
```

团队聊天的 AI SDK 端点：

```typescript
/** 团队对话 — AI SDK 协议 */
app.post('/api/v1/teams/:id/chat/ai-sdk', async (c) => {
  const auth = await getAuthContext(c);
  if (auth instanceof Response) return auth;
  const teamId = c.req.param('id');
  const body = await c.req.json();
  const { message } = body;
  if (!message) return c.json({ error: 'message is required' }, 400);

  try {
    const { createTeamNetwork } = await import('../agent/team-network.js');
    const { stream } = await createTeamNetwork(teamId, message, {
      tenantId: auth.tenantId,
      userId: auth.userId,
    });

    // 团队网络流的格式不同（MastraAgentNetworkStream），需要特殊处理
    // 参见 Task 10 "团队聊天 AI SDK 适配"
    const { createNetworkAISDKStream } = await import('../agent/ai-sdk-stream.js');
    return createNetworkAISDKStream(stream);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'An internal error occurred';
    import('../lib/logger.js').then(({ default: logger }) =>
      logger.error({ err: error, teamId }, 'Team chat AI SDK stream error'),
    );
    return c.json({ error: msg }, 500);
  }
});
```

注意：团队聊天端点在 Step 1 中先占位，实际 `createNetworkAISDKStream` 在 Task 10 中实现。

- [ ] **Step 2: 提取重复的 thread 保存 + Mastra 调用逻辑（可选重构）**

当前 `executeAgentChat` 和新增的 AI SDK 端点之间有大量重复代码。在 `packages/server/src/chat/chat.ts` 中提取核心逻辑：

```typescript
/**
 * 执行 Mastra agent.stream() 调用的公共逻辑。
 * 返回 raw MastraModelOutput + threadId，由调用方决定如何格式化。
 */
export async function executeAgentChatRaw(params: ExecuteChatParams): Promise<{
  thread: string;
  output: MastraModelOutput<unknown>;
}> {
  const { agentId, message, threadId, tenantId, userId } = params;

  if (!message?.trim()) {
    throw new Error('Message is required');
  }

  const thread = threadId || `${agentId}::${userId}::${uuidv4()}`;
  const requestContext = new RequestContext();

  const ctx = agentId === 'main'
    ? await prepareMainAgentContext(tenantId, requestContext)
    : await prepareAgentContext(tenantId, agentId, requestContext);

  await saveThread(thread, tenantId, userId, {
    agent_id: agentId,
    user_id: userId,
    model_name: ctx.agent.model_id,
  });

  const mastraAgentId = agentId === 'main' ? 'mainAgent' : 'agentProxy';
  const output: MastraModelOutput<unknown> = await mastra.getAgent(mastraAgentId).stream(
    [{ role: 'user', content: message }],
    {
      instructions: ctx.instructions,
      memory: { thread, resource: resourceId(tenantId, userId) },
      maxSteps: ctx.agent.max_steps || 10,
      requestContext,
    },
  );

  return { thread, output };
}
```

然后 `executeAgentChat` 简化为调用 `executeAgentChatRaw` + 包装 `createSSEStream`。

- [ ] **Step 3: 验证端点可用性**

```bash
# 启动服务端
cd packages/server && pnpm dev &
sleep 3

# 用 curl 测试 AI SDK 端点（注意使用正确的 cookie 认证或用 admin 登录后抓取 cookie）
curl -X POST http://localhost:3001/api/v1/chat/ai-sdk \
  -H "Content-Type: application/json" \
  -H "Cookie: <valid-session-cookie>" \
  -d '{"agentId":"main","message":"hello"}' \
  --no-buffer 2>&1 | head -20
```

预期：返回 `text/event-stream` 内容，第一行格式类似 `data: {"type":"text-delta","textDelta":"..."}`

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/chat.ts packages/server/src/chat/chat.ts
git commit -m "feat: add AI SDK protocol chat endpoints"
```

---

### Task 4: 客户端 — useChat 运行时 + RuntimeProvider 布局

**Files:**
- Create: `packages/web/src/hooks/useAssistantRuntime.ts`
- Modify: `packages/web/src/pages/Chat.tsx`

**Interfaces:**
- Produces: `useAssistantRuntime()` hook — 返回 `{ runtime, chat, threadList }`
- Consumes: `useChat` from `@ai-sdk/react`; `useChatRuntime` from `@assistant-ui/react-ai-sdk`
- Replaces: 手写 `streamChat` + `useState(messages)` + `AbortController`

- [ ] **Step 1: 创建 `useAssistantRuntime` hook**

```typescript
/**
 * Assistant UI Runtime hook — 封装 AI SDK useChat + useChatRuntime。
 *
 * 连接 `/api/v1/chat/ai-sdk` 端点，提供完整的聊天运行时：
 * - runtime: 传给 AssistantRuntimeProvider
 * - chat: useChat 原始返回值，用于侧边栏 thread 切换等额外操作
 * - sendMessage: 由 Composer 通过 runtime 自动处理
 *
 * 历史消息通过 useChat 的 initialMessages + api 自动加载。
 */
import { useChat } from '@ai-sdk/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { useMemo } from 'react';

interface UseAssistantRuntimeOptions {
  agentId: string;
  threadId?: string;
}

export function useAssistantRuntime({ agentId, threadId }: UseAssistantRuntimeOptions) {
  const chat = useChat({
    api: '/api/v1/chat/ai-sdk',
    id: threadId, // AI SDK 支持 thread ID 用于历史加载
    body: { agentId },
    credentials: 'include',
    onError: (err) => {
      if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
        window.location.href = '/login';
      }
    },
  });

  const runtime = useChatRuntime(chat);

  return useMemo(() => ({ runtime, chat }), [runtime, chat]);
}
```

- [ ] **Step 2: 重写 `Chat.tsx` 布局为 Assistant UI 结构**

```typescript
// 1. React
import { useState, useCallback } from 'react';

// 2. Third-party
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { Thread, Composer, AssistantRuntimeProvider } from '@assistant-ui/react';
import { MessageCircle } from 'lucide-react';

// 3. API
import { api } from '@/api/client';

// 4. UI components
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';

// 5. Sub-components
import { ChatSidebar } from './chat/ChatSidebar';
import { ChatSkeleton } from './chat/ChatSkeleton';
import { useAssistantRuntime } from '@/hooks/useAssistantRuntime';

// 6. Types
interface Agent {
  id: string;
  name: string;
}

/**
 * Chat — 聊天页面。
 *
 * 左侧 ChatSidebar（Agent 选择 + 对话列表），右侧 Assistant UI Thread + Composer。
 * URL 路由：/chat 或 /chat/:threadId
 */
export default function Chat() {
  const { threadId } = useParams<{ threadId?: string }>();
  const navigate = useNavigate();
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [activeThreadId, setActiveThreadId] = useState<string>(threadId || '');

  const { runtime, chat } = useAssistantRuntime({
    agentId: selectedAgentId,
    threadId: activeThreadId || undefined,
  });

  const queryClient = useQueryClient();

  const { data: agents, isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: () => api('/agents'),
  });

  const handleSelectThread = useCallback(
    (tid: string) => {
      setActiveThreadId(tid);
      navigate(`/chat/${tid}`, { replace: true });
    },
    [navigate],
  );

  const handleNewChat = useCallback(() => {
    setActiveThreadId('');
    navigate('/chat', { replace: true });
  }, [navigate]);

  const handleSelectAgent = useCallback(
    (agentId: string) => {
      setSelectedAgentId(agentId);
      handleNewChat();
    },
    [handleNewChat],
  );

  // 监听 chat 事件：首次对话完成后更新 URL
  // 由 useChat 的 onFinish 驱动
  // （注：需要通过 chat 的底层事件或自定义方式获取 threadId）

  if (agentsLoading) return <ChatSkeleton />;

  const agentList: Agent[] = agents ?? [];
  const selectedAgent = agentList.find((a) => a.id === selectedAgentId);

  return (
    <div className="flex h-[calc(100vh-0px)] -m-6">
      <ChatSidebar
        agents={agentList}
        selectedAgentId={selectedAgentId}
        onSelectAgent={handleSelectAgent}
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onNewChat={handleNewChat}
      />

      {selectedAgentId ? (
        <AssistantRuntimeProvider runtime={runtime}>
          <div className="flex-1 flex flex-col bg-background min-w-0">
            {/* 顶部标题栏 */}
            <div className="h-12 flex items-center px-4 border-b shrink-0">
              <span className="text-sm font-medium">
                {selectedAgent?.name || selectedAgentId}
              </span>
            </div>

            {/* Assistant UI Thread */}
            <Thread
              empty={
                <Empty>
                  <EmptyMedia variant="icon">
                    <MessageCircle size={32} className="text-muted-foreground" />
                  </EmptyMedia>
                  <EmptyTitle>开始对话</EmptyTitle>
                  <EmptyDescription>发送消息开始与 Agent 对话</EmptyDescription>
                </Empty>
              }
            />

            {/* Assistant UI Composer */}
            <div className="border-t shrink-0">
              <Composer />
            </div>
          </div>
        </AssistantRuntimeProvider>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-background">
          <Empty>
            <EmptyMedia variant="icon">
              <MessageCircle size={32} className="text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>开始对话</EmptyTitle>
            <EmptyDescription>选择一个 Agent 开始对话</EmptyDescription>
            {agentList.length > 0 && (
              <Button variant="outline" onClick={() => setSelectedAgentId(agentList[0].id)}>
                选择 Agent
              </Button>
            )}
          </Empty>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 处理首次对话 threadId 回写**

`useChat` 完成首次对话后，需要将服务端返回的 threadId 更新到 URL。在 `useAssistantRuntime` 中扩展：

在 `useChat` 的 `onFinish` 回调中获取 metadata 中的 threadId：

```typescript
// 在 useAssistantRuntime 中给 useChat 添加 onFinish
const chat = useChat({
  // ... 其他配置
  onFinish: (message) => {
    // AI SDK v6: threadId 可能在 message.metadata 或 annotation 中
    // 如果服务端在 doneMetadata 中传了 threadId，它会出现在 message 的对应字段
    const meta = (message as any).metadata;
    if (meta?.threadId && typeof meta.threadId === 'string') {
      onThreadCreated?.(meta.threadId);
    }
  },
});
```

但由于 `useAssistantRuntime` 需要知道 `onThreadCreated` 回调，在 hook 签名中添加：

```typescript
interface UseAssistantRuntimeOptions {
  agentId: string;
  threadId?: string;
  onThreadCreated?: (threadId: string) => void;
}
```

- [ ] **Step 4: 验证前端启动**

```bash
cd packages/web && pnpm dev 2>&1 | head -10
# 确保没有 import 错误，Vite 启动成功
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/hooks/useAssistantRuntime.ts packages/web/src/pages/Chat.tsx
git commit -m "feat: replace chat data flow with Assistant UI runtime"
```

---

### Task 5: 天气工具 UI

**Files:**
- Create: `packages/web/src/pages/chat/ToolUIs/weather-ui.tsx`

**Interfaces:**
- Produces: `<WeatherToolUI />` — 注册到 Assistant Runtime 的天气卡片
- Consumes: `makeAssistantToolUI` from `@assistant-ui/react`

- [ ] **Step 1: 创建天气工具 UI 组件**

```typescript
/**
 * 天气工具 UI — 将 get-weather 工具调用渲染为天气信息卡片。
 *
 * 对应服务端 weatherTool (id: 'get-weather')，
 * 展示温度、体感温度、湿度、风速、天气状况和位置。
 * toolInvocation.state: 'running' 时显示骨架；'complete' 时显示结果。
 */
import { makeAssistantToolUI } from '@assistant-ui/react';
import { Cloud, Droplets, Thermometer, Wind, MapPin } from 'lucide-react';

interface WeatherResult {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windGust: number;
  conditions: string;
  location: string;
}

export const WeatherToolUI = makeAssistantToolUI({
  toolName: 'get-weather',
  render: ({ toolInvocation }) => {
    if (toolInvocation.state === 'running') {
      return (
        <div className="border rounded-lg p-4 my-2 bg-muted/30 animate-pulse">
          <div className="flex items-center gap-2">
            <Cloud size={18} className="text-muted-foreground" />
            <span className="text-sm text-muted-foreground">正在查询天气...</span>
          </div>
        </div>
      );
    }

    if (toolInvocation.state === 'error') {
      return (
        <div className="border border-destructive/30 rounded-lg p-4 my-2 bg-destructive/5">
          <span className="text-sm text-destructive">天气查询失败</span>
        </div>
      );
    }

    const data = toolInvocation.result as WeatherResult;
    if (!data) return null;

    return (
      <div className="border rounded-lg p-4 my-2 bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-950/30 dark:to-sky-950/20">
        {/* 位置 + 天气状况 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <MapPin size={14} className="text-muted-foreground" />
            <span className="text-sm font-medium">{data.location}</span>
          </div>
          <span className="text-sm text-muted-foreground">{data.conditions}</span>
        </div>

        {/* 温度 — 大字展示 */}
        <div className="flex items-baseline gap-2 mb-3">
          <Thermometer size={18} className="text-orange-500" />
          <span className="text-3xl font-bold">{Math.round(data.temperature)}°C</span>
          <span className="text-sm text-muted-foreground">
            体感 {Math.round(data.feelsLike)}°C
          </span>
        </div>

        {/* 详细信息 */}
        <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Droplets size={12} />
            <span>{data.humidity}% 湿度</span>
          </div>
          <div className="flex items-center gap-1">
            <Wind size={12} />
            <span>{data.windSpeed} km/h</span>
          </div>
          <div className="flex items-center gap-1">
            <Wind size={12} />
            <span>阵风 {data.windGust} km/h</span>
          </div>
        </div>
      </div>
    );
  },
});
```

- [ ] **Step 2: 注册 ToolUI 到 Runtime**

在 `App.tsx` 或 `Chat.tsx` 中将 ToolUI 注入 Runtime。Assistant UI 通过在组件树中渲染 `<WeatherToolUI />` 来注册：

在 `Chat.tsx` 中，`<AssistantRuntimeProvider>` 内部添加：

```typescript
import { WeatherToolUI } from './chat/ToolUIs/weather-ui';

// 在 AssistantRuntimeProvider 的 children 中：
<AssistantRuntimeProvider runtime={runtime}>
  <WeatherToolUI />
  {/* ... Thread + Composer */}
</AssistantRuntimeProvider>
```

`makeAssistantToolUI` 返回的组件本身就是注册器 + 渲染器，放在 RuntimeProvider 子树中即可自动生效。

- [ ] **Step 3: 验证工具 UI 渲染**

启动服务端和前端，发送一条查询天气的消息（如 "北京天气怎么样"），观察：
- 工具调用开始时显示 pulsating "正在查询天气..." 骨架
- 完成后展示天气卡片（温度、湿度、风速等）
- 如果查询失败（比如输入无效地点），显示错误态

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/chat/ToolUIs/weather-ui.tsx packages/web/src/pages/Chat.tsx
git commit -m "feat: add weather tool UI card"
```

---

### Task 6: 命令执行审批工具 UI

**Files:**
- Create: `packages/web/src/pages/chat/ToolUIs/exec-ui.tsx`

**Interfaces:**
- Produces: `<ExecToolUI />` — 命令执行工具卡片（含审批按钮）
- Consumes: `makeAssistantToolUI`; 审批 API `GET /api/v1/exec-approvals/pending` + `POST /api/v1/exec-approvals/:id/resolve`

- [ ] **Step 1: 创建命令执行工具 UI**

```typescript
/**
 * 命令执行工具 UI — 展示待审批命令并提供批准/拒绝按钮。
 *
 * 对应服务端 mastra_workspace_execute_command 工具。
 * toolInvocation.state === 'running' 时展示审批卡片；
 * 用户批准/拒绝后调用 API 提交决定，然后卡片更新状态。
 *
 * 复用现有 ExecApprovalCard 的审批 API 逻辑。
 */
import { makeAssistantToolUI } from '@assistant-ui/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Terminal, Check, X } from 'lucide-react';

export const ExecToolUI = makeAssistantToolUI({
  toolName: 'mastra_workspace_execute_command',
  render: ({ toolInvocation }) => {
    // 仅 running 状态需要审批交互；其他状态用默认渲染
    if (toolInvocation.state !== 'running') return null;

    return <ExecApprovalInline toolInvocation={toolInvocation} />;
  },
});

/** 内联审批卡片 — 展示命令 + 批准/拒绝按钮 */
function ExecApprovalInline({ toolInvocation }: { toolInvocation: any }) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [loading, setLoading] = useState(false);

  const command = typeof toolInvocation.args?.command === 'string'
    ? toolInvocation.args.command
    : JSON.stringify(toolInvocation.args || {});

  const handleAction = async (action: 'approve' | 'reject') => {
    setLoading(true);
    try {
      const pendingRes = await fetch('/api/v1/exec-approvals/pending');
      const pendingList = await pendingRes.json();
      const latest = pendingList[0];

      if (!latest) {
        setStatus('rejected');
        return;
      }

      const res = await fetch(`/api/v1/exec-approvals/${latest.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (res.ok) {
        setStatus(action === 'approve' ? 'approved' : 'rejected');
      }
    } catch {
      // 静默处理
    } finally {
      setLoading(false);
    }
  };

  if (status !== 'pending') {
    return (
      <div className="border rounded-lg p-3 my-2 bg-muted/30">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {status === 'approved' ? (
            <Check size={16} className="text-green-500" />
          ) : (
            <X size={16} className="text-destructive" />
          )}
          {status === 'approved' ? 'Command approved.' : 'Command rejected.'}
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-3 my-2 bg-muted/30 space-y-2">
      <div className="flex items-center gap-2">
        <Terminal size={14} className="text-muted-foreground" />
        <span className="text-sm font-medium">Exec Approval Required</span>
      </div>
      <pre className="text-xs bg-background p-2 rounded border overflow-x-auto whitespace-pre-wrap break-all max-h-32">
        {command}
      </pre>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={loading}
          onClick={() => handleAction('approve')}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => handleAction('reject')}
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 注册到 Runtime**

在 `Chat.tsx` 中添加：

```typescript
import { ExecToolUI } from './chat/ToolUIs/exec-ui';

// 在 RuntimeProvider 子树中：
<ExecToolUI />
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/chat/ToolUIs/exec-ui.tsx packages/web/src/pages/Chat.tsx
git commit -m "feat: add exec approval tool UI"
```

---

### Task 7: 删除旧组件

**Files:**
- Delete: `packages/web/src/pages/chat/ChatWindow.tsx`
- Delete: `packages/web/src/pages/chat/ChatInput.tsx`
- Delete: `packages/web/src/pages/chat/MessageBubble.tsx`
- Delete: `packages/web/src/hooks/useAgentChat.ts`
- Delete: `packages/web/src/components/ExecApprovalCard.tsx`
- Delete: `packages/web/src/pages/chat/ChatSkeleton.tsx`（如果 Thread 内置 loading 够用）

**Interfaces:**
- 无新增接口，仅删除旧代码
- 确保 `Chat.tsx` 不再引用被删文件

- [ ] **Step 1: 确认无引用后删除**

```bash
# 检查是否还有文件引用这些旧组件
cd packages/web && grep -r "ChatWindow" src/ --include="*.tsx" --include="*.ts"
cd packages/web && grep -r "ChatInput" src/ --include="*.tsx" --include="*.ts"
cd packages/web && grep -r "MessageBubble" src/ --include="*.tsx" --include="*.ts"
cd packages/web && grep -r "useAgentChat" src/ --include="*.tsx" --include="*.ts"
cd packages/web && grep -r "ExecApprovalCard" src/ --include="*.tsx" --include="*.ts"
cd packages/web && grep -r "ChatSkeleton" src/ --include="*.tsx" --include="*.ts"
```

如果只有待删文件自身引用（或 Chat.tsx 中还有 import 但已注释），确认安全后删除。

````

- [ ] **Step 2: 删除文件**

```bash
rm packages/web/src/pages/chat/ChatWindow.tsx
rm packages/web/src/pages/chat/ChatInput.tsx
rm packages/web/src/pages/chat/MessageBubble.tsx
rm packages/web/src/hooks/useAgentChat.ts
rm packages/web/src/components/ExecApprovalCard.tsx
# ChatSkeleton 如果 Thread 的 loading 够用则删除
rm packages/web/src/pages/chat/ChatSkeleton.tsx
```

- [ ] **Step 3: 修复其他文件中的残留引用**

检查 `packages/web/src/pages/agent-detail/ChatPanel.tsx` 是否引用了被删组件，如果是则一并更新：

```bash
grep -r "ChatWindow\|MessageBubble\|useAgentChat\|ExecApprovalCard\|ChatInput\|ChatSkeleton" packages/web/src/ --include="*.tsx" --include="*.ts"
```

修复任何引用错误。

- [ ] **Step 4: 验证编译**

```bash
cd packages/web && npx tsc --noEmit 2>&1 | head -20
# 预期无错误（或仅有无关的 existing errors）
```

- [ ] **Step 5: Commit**

```bash
git add -A packages/web/src/
git commit -m "refactor: remove old chat components replaced by Assistant UI"
```

---

### Task 8: 历史消息加载与 threadId 回写

**Files:**
- Modify: `packages/web/src/hooks/useAssistantRuntime.ts`
- Modify: `packages/web/src/pages/Chat.tsx`

**Interfaces:**
- Consumes: `useChat` 的 `id` + `initialMessages` 选项
- Produces: threadId 变化时自动切换历史消息；首次对话完成时 URL 更新

- [ ] **Step 1: 增强 useAssistantRuntime 支持历史加载**

`useChat` 的 `id` 参数在 AI SDK 中用于标识 conversation。当 `id` 变化时，`useChat` 自动触发一次 `GET /api/v1/chat/ai-sdk?id={threadId}` 来加载历史。

但这需要服务端支持 GET 请求返回历史消息。替代方案：手动加载历史并作为 `initialMessages` 传入。

```typescript
import { useChat } from '@ai-sdk/react';
import { useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/api/client';

interface MessageItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface UseAssistantRuntimeOptions {
  agentId: string;
  threadId?: string;
  onThreadCreated?: (threadId: string) => void;
}

export function useAssistantRuntime({
  agentId,
  threadId,
  onThreadCreated,
}: UseAssistantRuntimeOptions) {
  // 加载历史消息
  const { data: history } = useQuery<{ messages: MessageItem[] }>({
    queryKey: ['conversation', threadId],
    queryFn: () => api(`/conversations/${threadId}`),
    enabled: !!threadId,
  });

  const initialMessages = useMemo(
    () =>
      (history?.messages || []).map((msg) => ({
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
    [history],
  );

  const chat = useChat({
    api: '/api/v1/chat/ai-sdk',
    id: threadId,
    initialMessages,
    body: { agentId },
    credentials: 'include',
    onFinish: (message) => {
      const meta = (message as any).metadata;
      if (!threadId && meta?.threadId && typeof meta.threadId === 'string') {
        onThreadCreated?.(meta.threadId);
      }
    },
    onError: (err) => {
      if (err.message?.includes('401') || err.message?.includes('Unauthorized')) {
        window.location.href = '/login';
      }
    },
  });

  const runtime = useChatRuntime(chat);

  return useMemo(() => ({ runtime, chat }), [runtime, chat]);
}
```

- [ ] **Step 2: 在 Chat.tsx 中连接 threadId 回写**

```typescript
// 在 Chat 组件中：
const handleThreadCreated = useCallback(
  (newThreadId: string) => {
    setActiveThreadId(newThreadId);
    navigate(`/chat/${newThreadId}`, { replace: true });
    queryClient.invalidateQueries({ queryKey: ['conversations', selectedAgentId] });
  },
  [navigate, queryClient, selectedAgentId],
);

const { runtime, chat } = useAssistantRuntime({
  agentId: selectedAgentId,
  threadId: activeThreadId || undefined,
  onThreadCreated: handleThreadCreated,
});
```

- [ ] **Step 3: 验证历史消息加载**

1. 通过旧 UI 或用 API 创建一个已有消息的对话
2. 在 Assistant UI 中点击该对话
3. 预期：历史消息正确显示在 Thread 中

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/hooks/useAssistantRuntime.ts packages/web/src/pages/Chat.tsx
git commit -m "feat: support history loading and threadId sync"
```

---

### Task 9: ChatSidebar 适配

**Files:**
- Modify: `packages/web/src/pages/chat/ChatSidebar.tsx`

**Interfaces:**
- 保持现有接口 `ChatSidebarProps` 不变
- 内部实现不变，但确保与新的 Chat.tsx 的 thread 管理方式兼容

- [ ] **Step 1: 确认 Sidebar 接口兼容**

现有 `ChatSidebarProps` 接口：
- `agents`, `selectedAgentId`, `onSelectAgent` ✓ 无需改动
- `activeThreadId`, `onSelectThread`, `onNewChat` ✓ 与新的 Chat.tsx 兼容

Sidebar 内部通过 `useQuery(['conversations', selectedAgentId])` 加载对话列表，通过 `api(/conversations/:id)` 的 DELETE 删除对话。这些逻辑与 Mastra Memory 后端对应，不受前端 UI 框架变更影响。

**无需修改 ChatSidebar.tsx 的业务逻辑。** 仅在以下微调：

- [ ] **Step 2: 微调样式（如需要）**

如果 Assistant UI 的默认样式与 Sidebar 不协调，调整 Sidebar 的 border/background：

```typescript
// ChatSidebar.tsx 中 aside 的 className：
<aside className="w-72 border-r bg-background flex flex-col">
// 保持不变，与 Assistant UI 的 Thread 默认背景兼容
```

- [ ] **Step 3: Commit**（如果有改动）

```bash
git add packages/web/src/pages/chat/ChatSidebar.tsx
git commit -m "style: minor sidebar adjustments for Assistant UI"
```

如果无改动则跳过。

---

### Task 10: 团队聊天 AI SDK 适配

**Files:**
- Modify: `packages/server/src/agent/ai-sdk-stream.ts`
- Modify: `packages/server/src/api/chat.ts`（已在 Task 3 中占位）

**Interfaces:**
- Produces: `createNetworkAISDKStream(stream: MastraAgentNetworkStream): Promise<Response>`
- Consumes: `MastraAgentNetworkStream` (chunk type: `text-delta` / `tool-call` / `tool-result`)

- [ ] **Step 1: 实现 createNetworkAISDKStream**

团队网络流 `MastraAgentNetworkStream` 是底层 `ReadableStream<ChunkType>`，不含 `textStream` 等高级 getter。需要直接迭代原始 chunk。

```typescript
/**
 * 将 MastraAgentNetworkStream 转换为 AI SDK UI stream Response。
 *
 * 与 createNetworkSSEStream 模式对等，迭代原始 chunk 并映射为 UIMessageChunk。
 *
 * @param networkStream - supervisor.network() 返回值
 * @returns Hono SSE 响应体（AI SDK 格式）
 */
import type { MastraAgentNetworkStream, ChunkType } from '@mastra/core/stream';

export async function createNetworkAISDKStream(
  networkStream: MastraAgentNetworkStream,
): Promise<Response> {
  const stream = createUIMessageStream({
    async execute({ writer }) {
      const reader = (networkStream as unknown as ReadableStream<ChunkType>).getReader();
      let inputTokens = 0;
      let outputTokens = 0;

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;

        if (!chunk || typeof chunk !== 'object' || !('type' in chunk)) continue;

        const c = chunk as { type: string; payload?: Record<string, unknown> };

        switch (c.type) {
          case 'text-delta':
          case 'routing-agent-text-delta':
            if (c.payload?.text && typeof c.payload.text === 'string') {
              writer.write({
                type: 'text-delta',
                textDelta: c.payload.text,
              } as any);
            }
            break;
          case 'tool-call':
            if (c.payload) {
              writer.write({
                type: 'tool-call',
                toolCallId: (c.payload as any).toolCallId || crypto.randomUUID(),
                toolName: c.payload.toolName as string,
                args: c.payload.args as Record<string, unknown>,
              } as any);
            }
            break;
          case 'tool-result':
            if (c.payload) {
              writer.write({
                type: 'tool-result',
                toolCallId: (c.payload as any).toolCallId || '',
                toolName: c.payload.toolName as string,
                result: typeof c.payload.result === 'string'
                  ? c.payload.result
                  : JSON.stringify(c.payload.result),
              } as any);
            }
            break;
        }
      }

      // 读取顶层 usage（MastraAgentNetworkStream 同样有 .usage getter）
      try {
        const netUsage = await networkStream.usage;
        inputTokens = netUsage.inputTokens;
        outputTokens = netUsage.outputTokens;
      } catch { /* 忽略 */ }

      writer.write({
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: inputTokens, completionTokens: outputTokens },
      } as any);
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

- [ ] **Step 2: 连接前端团队聊天端点**

在 `packages/web/src/pages/team-detail/TeamChatPanel.tsx` 中同样接入 Assistant UI（模式同 Chat.tsx）。

如果前端尚未使用 Assistant UI Runtime（即仅迁移了 Chat 页面），则先确保 AI SDK 端点可被团队的 chat 页面使用。

- [ ] **Step 3: 验证**

启动后测试团队聊天场景，确认多 Agent 协作的文本流和工具调用都能在 AI SDK 格式下正确呈现。

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/agent/ai-sdk-stream.ts packages/server/src/api/chat.ts
git commit -m "feat: add team network AI SDK stream adapter"
```

---

### Task 11: 端到端验证

- [ ] **Step 1: 启动全栈**

```bash
pnpm dev
```

- [ ] **Step 2: 测试单 Agent 对话**

1. 浏览器打开 `http://localhost:5173/chat`
2. 登录 `admin/admin123`
3. 选择一个 Agent
4. 发送 "你好"，验证文本流式输出正常
5. 发送 "北京今天天气怎么样"，验证天气卡片渲染正常
6. 如果触发了命令执行，验证审批卡片正常

- [ ] **Step 3: 测试历史消息**

1. 刷新页面
2. 从左侧对话列表选择一个已有对话
3. 验证历史消息正确加载和显示
4. 验证之前的工具调用卡片在历史中正确展示

- [ ] **Step 4: 测试新建/切换对话**

1. 点击"新建对话"
2. 发送新消息
3. 验证左侧对话列表出现新条目
4. 切换回之前的对话，验证消息不变

- [ ] **Step 5: 测试错误恢复**

1. 断开网络后发送消息
2. 验证 Thread 显示错误态
3. 恢复网络，点击重试
4. 验证恢复正常

- [ ] **Step 6: 测试团队聊天**（如有前端页面）

1. 打开团队聊天页面
2. 发送需要多 Agent 协作的消息
3. 验证团队模式下文本流和工具 UI 正常

- [ ] **Step 7: 修复发现的问题并 commit**

```bash
git add -A && git commit -m "fix: e2e verification fixes"
```
```

