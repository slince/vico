# Mastra 依赖移除计划

## 目标
将 `vico/server` 所有 `@mastra/*` 依赖替换为 `@vico/agent` + `@vico/rag` + `ai` SDK。

## 影响范围

### 移除的 npm 包 (13个)
```
@mastra/agent-browser, @mastra/ai-sdk, @mastra/core, @mastra/duckdb,
@mastra/evals, @mastra/fastembed, @mastra/hono, @mastra/libsql,
@mastra/loggers, @mastra/memory, @mastra/observability, @mastra/rag, mastra
```

### 保留但可能调整的包
- `ai` (AI SDK) — 已用，保留
- `@ai-sdk/openai`, `@ai-sdk/anthropic` — 已用，保留
- `@libsql/client` — 保留用于向量存储

---

## 分步实施方案

### 第1步: 类型体系对齐 ✅ 关键基础

**问题**: 30+ 处引用 `MastraModelConfig`、`MastraModelOutput`、`MastraAgentNetworkStream`、`ChunkType` 等 Mastra 类型

**方案**:
- `MastraModelConfig` → `any` (实际上 `resolveModelProvider` 返回的是 AI SDK 的 LanguageModel，bridge 层返回类型改为 `any` 即可)
- `MastraModelOutput` → 自定义 `AgentStreamOutput` 接口 (含 textStream/toolCalls/toolResults/usage)
- `MastraAgentNetworkStream` → 自定义类型
- `ChunkType` → 自定义联合类型
- `OutputProcessor`/`ProcessOutputResultArgs` → 自定义接口
- `Tool` (from `@mastra/core/tools`) → 自定义 `Tool` 接口 (来自 `@vico/agent`)

**涉及文件**: `bridges/model-bridge.ts`, `services/model/model-manager.ts`, `config.ts`, `agent/sse-utils.ts`, `agent/ai-sdk-stream.ts`, `agent/processors/*.ts`, `agent/tools/*.ts`

### 第2步: Tool 系统替换

**问题**: `createTool()` from `@mastra/core/tools` 用于创建工具

**方案**: 统一使用 AI SDK 的 `tool()` 函数 (已在 `rag-tool.ts` 中使用)

**涉及文件**:
- `agent/tools/weather-tool.ts` — `createTool` → `tool()`
- `agent/tools/skill-tool-adapter.ts` — `createTool` → `tool()`
- `agent/tools/agent-tool.factory.ts` — `createTool` → `tool()`

### 第3步: Chat 管道重构 (核心)

**问题**: `chat/chat.ts` 依赖 Mastra 的 `agent.stream()` 返回 `MastraModelOutput`

**方案**: 用 Vico AgentLoop 替代:
1. 通过 Vico 创建 Agent 实例
2. 调用 `agent.getLoop().runTurn()` 获取事件流
3. 从 EventRecorder 事件转为 SSE/AI SDK 流

**状态**: 已有 `chat-v2.ts` 原型，需完善为正式 `/api/v1/chat` 端点

**涉及文件**: `chat/chat.ts`, `api/chat.ts`, `api/chat-v2.ts` (合并)

### 第4步: Agent 系统替换

**问题**: `main.agent.ts` / `agent-proxy.agent.ts` 使用 Mastra's `Agent` 类

**方案**: 使用 `@vico/agent` 的 `Agent` + `Vico` 容器:
- 在 `vico-bootstrap.ts` 中初始化 Vico 容器
- 每次请求动态创建 Agent (或缓存复用)
- 用 `agent.factory.ts` 中的逻辑加载 model/instructions/tools 注入

**核心改动**: Mastra Agent 的 `instructions/model/tools` 回调函数模式 → Vico 的 `AgentConfig` + request-time 注入

**涉及文件**: `agent/agents/main.agent.ts`, `agent/agents/agent-proxy.agent.ts`, `agent/agent.factory.ts`

### 第5步: Memory 系统替换

**问题**: `memory-setup.ts` 依赖 `@mastra/memory`、`@mastra/libsql`、`@mastra/duckdb`、`@mastra/fastembed`

**方案**:
- Conversation history → `MemoryStore` + `ConversationHistoryMemory` (from `@vico/agent`)
- Vector store → 直接用 `@libsql/client` + 自定义向量操作 (已有基础)
- Embedding → `@vico/rag` 的 `createEmbedder` (FastEmbed/OpenAI)
- Working memory → `@vico/agent` 的 `InMemoryWorkingMemory` / `FileWorkingMemory`
- Semantic recall → `@vico/agent` 的 `VectorSemanticRecall`

**涉及文件**: `agent/memory-setup.ts` (重写), `memory/rag.ts`

### 第6步: RAG 模块替换

**问题**: `memory/rag.ts` 使用 `@mastra/rag` 的 `MDocument`

**方案**: 使用 `@vico/rag` 的 `RecursiveChunker` 等 chunker 替代

**涉及文件**: `memory/rag.ts`

### 第7步: Observability 替换

**问题**: `agent/observability/config.ts` 依赖 `@mastra/observability`

**方案**: 使用 `@vico/agent` 的 `EventRecorder` + `SpanTracker` + 自定义日志

**涉及文件**: `agent/observability/config.ts` (简化或删除)

### 第8步: Evals 评分器替换

**问题**: `agent/evals/scorers.ts` 使用 `@mastra/evals` 预置评分器

**方案**: 用 LLM 直接调用实现自定义评分函数:
- `answer-relevancy`: LLM 判断回答是否切题
- `faithfulness`: LLM 判断回答是否忠实于输入
- `hallucination`: LLM 判断是否包含幻觉
- `tool-call-accuracy`: 直接比对工具调用列表

**涉及文件**: `agent/evals/scorers.ts`, `agent/evals/runner.ts`

### 第9步: mastra.ts 拆除 + 入口重写

**问题**: `mastra.ts` 是整个 Mastra 集成的入口

**方案**: 替换为 Vico 初始化:
```ts
import { Vico } from '@vico/agent';
export const vico = new Vico({ ... });
await vico.init();
```

**涉及文件**: `mastra.ts` (重写), `index.ts`

### 第10步: 清理 package.json

移除所有 `@mastra/*` 和 `mastra` 依赖

---

## 已确认决策

1. **Team 网络**: 暂时移除 team 聊天端点 (`team-network.ts` + `/api/v1/teams/:id/chat`)
2. **Workspace**: 暂时移除 workspace (`workspace-setup.ts`)
3. **Evals**: 完全替换为自定义 LLM scoring 实现，移除 `@mastra/evals`
