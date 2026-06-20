# Mastra AI Agent 核心依赖详细说明

> 基于 `mastra` 项目源码深度分析，涵盖 Vercel AI SDK 集成、工具系统、模型路由、可观测性、工作流引擎、嵌入系统、存储架构和语音能力。

## 1. Vercel AI SDK 集成

### 1.1 多版本并行支持

Mastra 同时支持 AI SDK v4、v5、v6 三个版本，通过 npm alias 实现：

```json
// packages/core/package.json
{
  "@ai-sdk/provider-utils-v5": "npm:@ai-sdk/provider-utils@3.0.25",
  "@ai-sdk/provider-utils-v6": "npm:@ai-sdk/provider-utils@4.0.27",
  "@ai-sdk/provider-v5": "npm:@ai-sdk/provider@2.0.3",
  "@ai-sdk/provider-v6": "npm:@ai-sdk/provider@3.0.10",
  "@ai-sdk/openai-v5": "npm:@ai-sdk/openai@2.x",
  "@ai-sdk/openai-v6": "npm:@ai-sdk/openai@3.x",
  "@ai-sdk/anthropic-v5": "npm:@ai-sdk/anthropic@2.x",
  "@ai-sdk/anthropic-v6": "npm:@ai-sdk/anthropic@3.x",
  "@ai-sdk/google-v5": "npm:@ai-sdk/google@2.x",
  "@ai-sdk/google-v6": "npm:@ai-sdk/google@3.x"
}
```

### 1.2 内部抽象层

三个内部包重新导出 AI SDK：

| 包 | 用途 |
|------|------|
| `@internal/ai-sdk-v4` | 重新导出 `ai`（Vercel AI SDK v4, 旧版） |
| `@internal/ai-sdk-v5` | 重新导出 `@ai-sdk/provider-utils` v5 |
| `@internal/ai-v6` | 重新导出 `@ai-sdk/provider-utils` v6 |

`@internal/external-types` (`packages/_external-types/src/index.ts`) 提供**结构类型** `ProviderDefinedTool`，接受任意版本的 tools，解决不同 `@ai-sdk/*` 包在不同 `node_modules` 路径下的交叉模块问题。

### 1.3 LLM 选项封装

文件：`packages/core/src/llm/index.ts`

```typescript
// Mastra 自定义选项（替换 AI SDK 原选项）
type MastraCustomLLMOptions<Z> = {
  threadId: string;
  resourceId: string;
  requestContext: RequestContext;
  observabilityContext: ObservabilityContext;
  runId: string;
  tracingContext: TracingContext;
  // ... 更多
};

// Mastra 拒绝并替换 AI SDK 的以下选项：
// messages, tools, model, onStepFinish,
// experimental_output, onFinish, output
type MastraCustomLLMOptionsKeys = 
  'messages' | 'tools' | 'model' | 'onStepFinish' | 
  'experimental_output' | 'onFinish' | 'output';
```

这样 Mastra 可以自动注入 `threadId`、`resourceId`、`requestContext`、`observabilityContext`、`runId`、`tracingContext`。

### 1.4 Provider 注册表

文件：`packages/core/src/llm/model/provider-registry.json`

映射 **100+ 模型**到网关（helicone、openrouter 等），每个条目包含：
- `url`：API 端点
- `apiKeyEnvVar`：环境变量名
- `apiKeyHeader`：认证头
- `name`：显示名称
- `models[]`：模型列表

### 1.5 网关系统

文件：`packages/core/src/llm/model/gateways/`

```typescript
interface MastraModelGatewayInterface {
  resolveLanguageModel(config): Promise<LanguageModel>;
  resolveAuth(config): Promise<AuthResult>;
  getApiKey(config): Promise<string>;
  buildUrl(config): string;
}
```

**四个内置网关**：

| 网关 | 说明 |
|------|------|
| `MastraGateway` | Mastra 自有云网关 |
| `NetlifyGateway` | Netlify AI 网关 |
| `ModelsDevGateway` | models.dev 注册表，映射到 AI SDK provider 工厂 |
| `AzureOpenAIGateway` | Azure OpenAI |

---

## 2. 工具系统

### 2.1 Tool 类

文件：`packages/core/src/tools/tool.ts`

```typescript
class Tool<
  TSchemaIn,          // 输入 Schema
  TSchemaOut,         // 输出 Schema
  TSuspendSchema,     // 暂停操作 Schema
  TResumeSchema,      // 恢复操作 Schema
  TContext,           // 执行上下文
  TId,                // 工具 ID
  TRequestContext     // 请求上下文
> {
  id: string;
  description: string;
  inputSchema: ZodSchema;
  outputSchema: ZodSchema;
  suspendSchema?: ZodSchema;
  resumeSchema?: ZodSchema;
  requireApproval: boolean | ((ctx) => boolean);  // 条件审批
  strict: boolean;                    // 严格生成（OpenAI）
  providerOptions: Record<string, any>;  // 按提供商（如 Anthropic cacheControl）
  mcp?: { annotations, toolType };       // MCP 特定属性
  mcpMetadata?: { serverName, serverId }; // MCP 来源标识
}
```

### 2.2 执行管道

```typescript
class Tool {
  constructor(config) {
    this.execute = async (inputData, organizedContext) => {
      // 1. 输入验证
      validateToolInput(this.inputSchema, inputData, this.id);
      
      // 2. 请求上下文验证（可选）
      if (this.requestContextSchema) { /* ... */ }
      
      // 3. 恢复数据验证
      if (resumeData && this.resumeSchema) { /* ... */ }
      
      // 4. 执行用户逻辑
      const result = await userExecute(inputData, organizedContext);
      
      // 5. 暂停数据验证（如果调用了 suspend()）
      if (suspended && this.suspendSchema) { /* ... */ }
      
      // 6. 输出验证
      validateToolOutput(this.outputSchema, result, this.id);
      
      return result;
    };
  }
}
```

### 2.3 CoreToolBuilder — AI SDK 适配器

文件：`packages/core/src/tools/tool-builder/builder.ts`

**关键适配器**，连接 Mastra Tool 和 AI SDK：

```
Mastra Tool ──→ CoreToolBuilder ──→ AI SDK CoreTool
                                    ├── 映射 inputSchema → parameters
                                    ├── 应用 Schema 兼容层 (OpenAI/Anthropic/Google/DeepSeek/Meta)
                                    ├── 注入 _background/suspendedToolRunId/resumeData
                                    ├── 处理 provider-defined tools
                                    ├── 构建 ToolExecutionContext
                                    ├── 创建追踪 Span (TOOL_CALL/MCP_TOOL_CALL)
                                    └── 运行 FGA 权限检查
```

### 2.4 内置工具

| 工具 | 文件 | 功能 |
|------|------|------|
| `askUserTool` | `builtin/ask-user.ts` | 暂停执行向用户提问（自由文本/单选/多选），支持 suspend/resume |
| `submitPlanTool` | `builtin/submit-plan.ts` | Agent 提交执行计划供审批 |
| `taskWriteTool` | `builtin/task-tools.ts` | 任务管理（创建/更新/完成/检查） |

### 2.5 工具类型判断

文件：`packages/core/src/tools/toolchecks.ts`

```typescript
isMastraTool(tool)         // instanceof Tool 或 MASTRA_TOOL_MARKER Symbol
isVercelTool(tool)         // 有 parameters/inputSchema + execute，无 Mastra 标记
isProviderDefinedTool(tool) // type: 'provider-defined'|'provider' + 带点的 id
```

---

## 3. 模型路由系统

### 3.1 ModelRouterLanguageModel

文件：`packages/core/src/llm/model/router.ts`

支持两种配置方式：

```typescript
// 方式 1：魔法字符串
model: "openai/gpt-4o"

// 方式 2：完整配置对象
model: {
  id: "custom-model",
  url: "https://api.custom.com/v1",
  apiKey: "sk-...",
  headers: { "X-Custom": "value" }
}
```

### 3.2 模型解析流程

```
"openai/gpt-4o"
    │
    ▼
parseModelString()
    │
    ├── providerId: "openai"
    └── modelId: "gpt-4o"
    │
    ▼
getProviderConfig()
    │
    ▼
findGatewayForModel()
    ├── 用户配置的 gateways → 优先
    └── 默认 gateways → 回退
    │
    ▼
gateway.resolveLanguageModel()
    │
    ▼
AI SDK Language Model
```

### 3.3 模型缓存

使用 SHA-256(gatewayId + modelId + providerId + url + headers + transport) 作为缓存键，避免重复创建。

### 3.4 WebSocket 传输

当 `transport: 'websocket'` 且 provider 为 OpenAI 时，创建 WebSocket fetch 并使用 OpenAI 的 `responses()` 模型。

### 3.5 AI SDK 适配器

```typescript
// V5: 包装 LanguageModelV2
class AISDKV5LanguageModel {
  doGenerate() → 创建 stream 格式
  doStream()  → 直接传递
  // OpenAI 特殊处理: 移除 per-tool strict，注入全局 strictJsonSchema
}

// V6: 包装 LanguageModelV3
class AISDKV6LanguageModel {
  // 重映射 type: 'provider-defined' → type: 'provider'
}
```

---

## 4. 可观测性

### 4.1 目录结构

```
observability/
├── mastra/          -- 主可观测性实现
├── arize/           -- Arize 集成
├── arthur/          -- Arthur 集成  
├── braintrust/      -- Braintrust 集成
├── datadog/         -- Datadog 集成
├── laminar/         -- Laminar 集成
├── langfuse/        -- Langfuse 集成
├── langsmith/       -- LangSmith 集成
├── otel-bridge/     -- OpenTelemetry 桥接
├── otel-exporter/   -- OTLP 导出器
├── posthog/         -- PostHog 集成
└── sentry/          -- Sentry 集成
```

### 4.2 Span 类型（39 种）

```typescript
enum SpanType {
  // Agent
  AGENT_RUN = 'agent_run',
  
  // 模型
  MODEL_GENERATION = 'model_generation',
  MODEL_STEP = 'model_step',
  MODEL_INFERENCE = 'model_inference',
  MODEL_CHUNK = 'model_chunk',
  
  // 工具
  TOOL_CALL = 'tool_call',
  MCP_TOOL_CALL = 'mcp_tool_call',
  CLIENT_TOOL_CALL = 'client_tool_call',
  
  // 处理器
  PROCESSOR_RUN = 'processor_run',
  
  // 工作流
  WORKFLOW_RUN = 'workflow_run',
  WORKFLOW_STEP = 'workflow_step',
  WORKFLOW_CONDITIONAL = 'workflow_conditional',
  WORKFLOW_PARALLEL = 'workflow_parallel',
  WORKFLOW_SLEEP = 'workflow_sleep',
  
  // RAG
  RAG_INGESTION = 'rag_ingestion',
  RAG_EMBEDDING = 'rag_embedding',
  RAG_VECTOR_OPERATION = 'rag_vector_operation',
  
  // 评分
  SCORER_RUN = 'scorer_run',
  
  // 其他
  MEMORY_OPERATION = 'memory_operation',
  WORKSPACE_ACTION = 'workspace_action',
  GENERIC = 'generic',
}
```

### 4.3 自动追踪注入

```typescript
// observability/context.ts
function wrapMastra(mastra: Mastra): Mastra {
  return new Proxy(mastra, {
    get(target, prop) {
      if (prop === 'getAgent') {
        return (...args) => {
          const agent = target.getAgent(...args);
          return new Proxy(agent, {
            get(agentTarget, method) {
              if (method === 'generate' || method === 'stream') {
                return (opts) => {
                  // 自动注入 ObservabilityContext
                  opts.tracingContext = currentContext;
                  return agentTarget[method](opts);
                };
              }
              return agentTarget[method];
            }
          });
        };
      }
      // getWorkflow() 同理
    }
  });
}
```

### 4.4 导出器

| 导出器 | 说明 |
|--------|------|
| `MastraPlatformExporter` | 发送到 Mastra 云平台 |
| `MastraStorageExporter` | 持久化到数据库 |
| `ConsoleExporter` | 控制台格式化输出 |
| `CloudExporter` | 批量上传到云端点 |
| `TestExporter` | 内存存储（测试用） |

### 4.5 模型自动追踪

`MODEL_GENERATION` Span 通过 Proxy 在 `doGenerate`/`doStream` 周围自动创建，Token 使用量（`inputTokens`、`outputTokens`、`cachedInputTokens`）自动从模型响应中提取。

---

## 5. 工作流执行引擎

### 5.1 Step 系统

```typescript
interface Step<TSchemaIn, TSchemaOut, TSuspend, TResume> {
  id: string;
  inputSchema: Schema;
  outputSchema: Schema;
  execute: (params: ExecuteFunctionParams) => Promise<Output>;
  when?: (params) => boolean;     // 条件执行
  loop?: LoopConfig;              // 循环
  foreach?: ForeachConfig;        // 并行
  suspendSchema?: Schema;
  resumeSchema?: Schema;
}

interface ExecuteFunctionParams {
  runId: string;
  workflowId: string;
  mastra: Mastra;
  requestContext: RequestContext;
  inputData: unknown;
  state: State;
  setState: (state: State) => void;
  resumeData?: unknown;
  suspend: (payload) => void;
  bail: (reason) => void;
  abort: () => void;
  getInitData(): unknown;
  getStepResult(stepId: string): StepResult;
  writer: ToolStream;
  abortSignal: AbortSignal;
}
```

### 5.2 Suspend/Resume 机制

```
Step N 调用 suspend(payload)
  │
  ├─ 抛出 branded InternalOutput（带唯一 Symbol）
  │
  ├─ 执行引擎拦截
  │    ├─ 持久化工作流快照
  │    ├─ 设置 StepSuspended 状态
  │    └─ 等待外部恢复
  │
  ▼
  resume(resumeData)
  │    ├─ 从存储加载快照
  │    ├─ 恢复所有 Step 结果
  │    ├─ 以 resumeData 重新执行 Step N
  │    └─ 继续后续步骤
```

### 5.3 执行引擎类型

| 引擎 | 文件 | 特点 |
|------|------|------|
| `DefaultExecutionEngine` | `default.ts` | 进程内执行，setTimeout sleep |
| `EventedExecutionEngine` | `evented/execution-engine.ts` | 持久执行，通过事件调度 |
| `EventedWorkflow` | `evented/workflow.ts` | 需要 `WorkflowEventProcessor` |

### 5.4 工作流流式输出

```typescript
type WorkflowStreamEvent = 
  | { type: 'step-start'; stepId: string }
  | { type: 'step-finish'; stepId: string; result: unknown }
  | { type: 'step-output'; stepId: string; output: unknown }
  | { type: 'workflow-finish'; result: unknown }
  | { type: 'tool-call'; toolId: string; args: unknown }
  | { type: 'tool-result'; toolId: string; result: unknown }
  | { type: 'suspend'; stepId: string }
  | { type: 'resume'; stepId: string }
  | { type: 'error'; error: Error };
```

---

## 6. 嵌入系统

### 6.1 FastEmbed（本地嵌入）

文件：`packages/fastembed/src/`

基于 ONNX Runtime 的本地嵌入引擎：

```
FastEmbed 架构
  ├── ONNX Runtime (onnxruntime-node)     → 模型推理
  ├── Tokenizer (@anush008/tokenizers)     → 文本分词
  ├── HuggingFace Hub (@huggingface/hub)   → 模型下载
  └── tar                                   → 解压模型档案
```

**支持的模型**：

| 模型 | 维度 | 语言 |
|------|------|------|
| AllMiniLML6V2 | 384 | EN |
| BGESmallEN / BGESmallENV15 | 384 | EN |
| BGEBaseEN / BGEBaseENV15 | 768 | EN |
| BGESmallZH | 512 | ZH |
| MLE5Large | 1024 | 多语言 |
| SpladePPEnV1 | 稀疏 | EN |

**AI SDK 集成**：暴露为三种规范版本的 embedder provider（v1/v2/v3）

```typescript
import { fastembed } from '@mastra/fastembed';

const embedder = fastembed.small;   // 384d
const base = fastembed.base;        // 768d
```

**模型缓存**：`~/.cache/mastra/fastembed-models/`，使用 `Map<FastEmbedModelType, Promise<FlagEmbedding>>` 确保单次加载。

### 6.2 API 嵌入

通过 AI SDK 兼容层支持：
- **OpenAI**：text-embedding-3-small/large、ada-002
- **Google**：Generative AI embeddings
- **Anthropic**：Voyage AI
- **Cohere**：embed-v3 等

维度自动探测：`getEmbeddingDimension()` 调用 embedding model → 缓存结果。

---

## 7. 存储架构

### 7.1 组合存储模式

```typescript
class MastraCompositeStore {
  default?: StorageDomains;       // 默认存储
  domains?: {                      // 按领域分派
    memory?: MemoryStorage;
    observability?: ObservabilityStorage;
    agents?: AgentsStorage;
    // ... 24 个领域
  };
  editor?: StorageDomains;        // 编辑器专用
}
```

### 7.2 24 个存储领域接口

```
workflows, scores, memory, channels, notifications
observability, agents, datasets, experiments
promptBlocks, scorerDefinitions, mcpClients, mcpServers
workspaces, skills, favorites, blobs
backgroundTasks, schedules, harness
toolProviderConnections, threadState
```

### 7.3 存储后端（27 个）

| 类别 | 包名 |
|------|------|
| SQL | libsql, pg, mysql, mssql, dsql, clickhouse, duckdb, spanner, cloudflare-d1, convex |
| NoSQL | mongodb, dynamodb, couchbase |
| 向量 | pinecone, chroma, qdrant, astra, upstash, turbopuffer, lance, elasticsearch, opensearch, redis, cloudflare, s3vectors, vectorize |

### 7.4 直接 SQL（无 ORM）

存储后端使用**原始 SQL**，不用 Drizzle ORM：
- PostgreSQL → `pg` (node-postgres)，连接池最大 20
- LibSQL → `@libsql/client`，含 busy-timeout + 重试逻辑
- 手动构建参数化 SQL 语句

### 7.5 FilesystemStore

```typescript
class FilesystemStore {
  // 将 7 个编辑器领域存储为 JSON 文件
  // 默认路径：.mastra-storage/
  // 支持 Git 版本追踪
  // 基于 FilesystemDB（JSON 文件 CRUD）
}
```

---

## 8. Voice 系统

### 8.1 抽象接口

```typescript
interface IMastraVoice {
  speak(input: string | Stream, options?): Promise<Stream>;
  listen(audioStream: Stream, options?): Promise<string>;
  connect(options?): Promise<void>;
  send(audioData: Buffer): Promise<void>;
  answer(options?): Promise<void>;
  addInstructions(text: string): void;
  addTools(tools: Record<string, Tool>): void;
  on(event: string, callback: Function): void;
  getSpeakers(): Promise<Voice[]>;
  getListener(): boolean;
  close(): Promise<void>;
}
```

### 8.2 Voice 提供商（16 个）

| 提供商 | 类型 |
|---------|------|
| OpenAI | TTS: tts-1/tts-1-hd (9 voices), STT: whisper-1 |
| OpenAI Realtime API | WebRTC 实时语音 |
| Google Cloud | TTS + STT |
| Google Gemini Live API | 实时多模态 |
| Azure | TTS + STT |
| ElevenLabs | TTS (高质量) |
| Deepgram | STT (快速) |
| PlayAI | TTS |
| AWS Nova Sonic | 实时语音 |
| Cloudflare | TTS |
| xAI Realtime API | 实时 |
| Murf, Speechify, Sarvam, Gladia, Inworld, ModelsLab | 专项 |

### 8.3 CompositeVoice

```typescript
class CompositeVoice implements IMastraVoice {
  speechProvider: IMastraVoice;
  listeningProvider: IMastraVoice;
  // 将语音和听觉路由到不同提供商
}
```

---

## 9. 关键架构模式

| 模式 | 说明 | 示例 |
|------|------|------|
| **多版本并行** | 同时支持 AI SDK v4/v5/v6 | npm alias + 内部重导出包 |
| **适配器模式** | Mastra 组件映射到 AI SDK | `CoreToolBuilder`、`AISDKV5LanguageModel` |
| **网关抽象** | 模型解析通过可配置网关 | `MastraGateway`、`NetlifyGateway` |
| **组合存储** | 按领域分派存储后端 | `default`/`domains`/`editor` |
| **持久执行** | 事件驱动工作流引擎 | suspend/resume、时间旅行 |
| **透明可观测性** | Proxy 自动注入追踪上下文 | `wrapMastra()` |
| **Standard Schema** | 支持 Zod v3/v4 | `toStandardSchema()` |
| **结构类型适配** | 跨版本工具类型 | `ProviderDefinedTool` |
| **条件审批** | 工具按需审批 | `requireApproval: boolean | (ctx) => boolean` |

---

## 10. 关键文件索引

### AI SDK 集成
- `packages/core/src/llm/index.ts` — LLM 类型封装
- `packages/core/src/llm/model/router.ts` — 模型路由
- `packages/core/src/llm/model/gateways/` — 网关系统
- `packages/core/src/llm/model/aisdk/v5/model.ts` — V5 适配器
- `packages/core/src/llm/model/aisdk/v6/model.ts` — V6 适配器
- `packages/core/src/llm/model/provider-registry.json` — Provider 注册表

### 工具系统
- `packages/core/src/tools/tool.ts` — Tool 类
- `packages/core/src/tools/tool-builder/builder.ts` — AI SDK 适配
- `packages/core/src/tools/toolchecks.ts` — 类型判断
- `packages/core/src/tools/builtin/` — 内置工具

### 可观测性
- `packages/core/src/observability/context.ts` — 追踪上下文
- `packages/core/src/observability/types/tracing.ts` — Span 类型定义
- `observability/mastra/src/default.ts` — 主实现
- `observability/mastra/src/spans/default.ts` — Span 实现

### 工作流
- `packages/core/src/workflows/workflow.ts` — Workflow 类 (157KB)
- `packages/core/src/workflows/execution-engine.ts` — 抽象执行引擎
- `packages/core/src/workflows/evented/` — 事件驱动引擎
- `packages/core/src/workflows/step.ts` — Step 类

### 嵌入
- `packages/fastembed/src/fastembed.ts` — FastEmbed 实现
- `packages/fastembed/src/index.ts` — AI SDK 兼容层

### 存储
- `packages/core/src/storage/base.ts` — MastraCompositeStore
- `packages/core/src/storage/filesystem.ts` — FilesystemStore
- `stores/pg/src/storage/index.ts` — PostgresStore
- `stores/libsql/src/storage/` — LibSQLStore

### Voice
- `packages/_internals/voice/src/voice.ts` — IMastraVoice 接口
- `voice/openai/src/index.ts` — OpenAI Voice
