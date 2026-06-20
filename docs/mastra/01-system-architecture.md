# Mastra 系统架构文档

> 基于 `mastra` 项目 v1.45.0 源码深度分析，涵盖功能模块、实现机制和架构设计。

## 1. 项目概览

Mastra 是一个**模块化 AI Agent 框架**，采用 pnpm monorepo（Turborepo）管理，以 `@mastra/core` 为中心编排引擎，通过可插拔的存储、工具、记忆、工作流等组件构建完整的 Agent 系统。

### 1.1 核心设计哲学

- **中央编排**：`Mastra` 类是 IoC 容器，管理所有组件生命周期
- **可插拔架构**：存储、模型、向量、TTS、工具、处理器均可替换
- **Evented Workflow**：Agent 内部执行基于事件驱动的工作流引擎
- **版本管理**：Agent/Workflow/工具支持 draft/published/archived 生命周期
- **存储抽象**：22 个领域接口，26 种数据库后端实现

---

## 2. 项目结构

### 2.1 核心包（packages/）

| 包名 | npm 名称 | 版本 | 职责 |
|------|----------|------|------|
| `core` | `@mastra/core` | 1.45.0 | 核心框架：Agent、Workflow、Memory、Storage、Tools、DI |
| `cli` | `mastra` | 1.15.0 | CLI 工具：dev、build、deploy、init |
| `server` | `@mastra/server` | 1.45.0 | HTTP 服务器适配器（基于 Hono） |
| `deployer` | `@mastra/deployer` | 1.45.0 | 打包部署到云平台 |
| `create-mastra` | `create-mastra` | 1.15.0 | 项目脚手架 |
| `auth` | `@mastra/auth` | 1.1.0 | JWT/JWKS 认证 |
| `memory` | `@mastra/memory` | 1.21.0 | 对话记忆 + 向量搜索 |
| `mcp` | `@mastra/mcp` | 1.11.0 | MCP 客户端/服务端 |
| `evals` | `@mastra/evals` | 1.4.0 | 评估/打分工具 |
| `rag` | `@mastra/rag` | 2.3.0 | RAG：分块、嵌入、检索 |
| `fastembed` | `@mastra/fastembed` | 1.2.0 | 本地嵌入模型 |
| `loggers` | `@mastra/loggers` | 1.2.0 | Pino 结构化日志 |
| `editor` | `@mastra/editor` | 0.13.0 | Agent 配置编辑器 |
| `agent-builder` | `@mastra/agent-builder` | 1.1.0 | 可视化 Agent 构建器 |
| `schema-compat` | `@mastra/schema-compat` | 1.3.0 | Zod/JSON Schema 兼容层 |
| `playground-ui` | `@mastra/playground-ui` | 35.0.0 | Playground UI 组件 |

### 2.2 存储后端（stores/）— 26 个适配器

**SQL 类**：`libsql` (Turso)、`pg` (PostgreSQL)、`mysql`、`mssql`、`dsql` (AWS DSQL)、`clickhouse`、`duckdb`、`spanner`、`cloudflare-d1`、`convex`

**NoSQL 类**：`mongodb`、`dynamodb`、`couchbase`

**向量类**：`pinecone`、`chroma`、`qdrant`、`astra`、`upstash`、`turbopuffer`、`lance`、`elasticsearch`、`opensearch`、`redis`、`cloudflare`、`s3vectors`、`vectorize`

### 2.3 其他顶级目录

| 目录 | 用途 |
|------|------|
| `integrations/` | 第三方集成 |
| `channels/` | 消息通道（Slack、Discord 等） |
| `observability/` | 可观测性包（OTEL 导出器） |
| `voice/` | 语音/TTS 功能 |
| `deployers/` | 部署适配器 |
| `agent-sdks/` | Agent SDK |
| `client-sdks/` | 客户端 SDK |
| `browser/` | 浏览器自动化 |
| `mastracode/` | Mastra TUI（终端 Agent） |
| `docs/` | Docusaurus 文档站点 |

---

## 3. 核心架构：Mastra 类

### 3.1 文件位置

`packages/core/src/mastra/index.ts`

### 3.2 泛型参数（11 个类型参数）

```typescript
export class Mastra<
  TAgents extends Record<string, Agent<any>>,
  TWorkflows extends Record<string, AnyWorkflow>,
  TVectors extends Record<string, MastraVector<any>>,
  TTTS extends Record<string, MastraTTS>,
  TLogger extends IMastraLogger,
  TMCPServers extends Record<string, MCPServerBase<any>>,
  TScorers extends Record<string, MastraScorer<any, any, any, any>>,
  TTools extends Record<string, ToolAction<...>>,
  TProcessors extends Record<string, Processor<any>>,
  TMemory extends Record<string, MastraMemory>,
  TChannels extends Record<string, ChannelProvider>,
>
```

### 3.3 Config 接口

```typescript
interface Config {
  agents?: TAgents;
  workflows?: TWorkflows;
  vectors?: TVectors;
  tts?: TTTS;
  logger?: TLogger | false;
  mcpServers?: TMCPServers;
  scorers?: TScorers;
  tools?: TTools;
  processors?: TProcessors;
  memory?: TMemory;
  channels?: TChannels;
  
  // 基础设施
  storage?: MastraCompositeStore;
  observability?: ObservabilityEntrypoint;
  idGenerator?: MastraIdGenerator;
  deployer?: MastraDeployer;
  server?: ServerConfig;
  bundler?: BundlerConfig;
  pubsub?: PubSub;
  cache?: MastraServerCache;
  events?: Record<string, Array<EventHandler>>;
  
  // 高级功能
  editor?: IMastraEditor;
  versions?: VersionOverrides;
  backgroundTasks?: BackgroundTaskManagerConfig;
  scheduler?: WorkflowSchedulerConfig;
  notifications?: { dispatch?: NotificationDispatchConfig };
  workers?: MastraWorker[] | false;
  
  // 运行时
  environment?: string;
  transform?: ToolPayloadTransformPolicy;
}
```

### 3.4 构造函数初始化流程

```
1. initContextStorage()  → 初始化 AsyncLocalStorage 追踪上下文
2. 设置 serverCache → InMemoryServerCache（默认）
3. 设置 editor / versions
4. 解析 environment（config 或 NODE_ENV）
5. 标准化工具负载转换策略
6. 设置 pubsub（自定义 或 EventEmitterPubSub）
7. 注册事件处理器
8. 创建 Workers（OrchestrationWorker + SchedulerWorker + BackgroundTaskWorker）
9. 创建 Logger（自定义 > ConsoleLogger > noop）
10. 设置 idGenerator
11. 设置 Storage（InMemoryStore 作为回退）
12. 自动注入 workflows + backgroundTasks 存储域
13. 注册所有 agents, workflows, vectors, TTS, MCP servers,
    scorers, tools, processors, memory, gateways, channels, workspace
```

---

## 4. Core 包详细结构

### 4.1 目录拓扑

`packages/core/src/` 包含 40+ 子目录：

```
a2a/              # Agent-to-Agent 通信
agent/            # Agent 类 + 执行引擎
agent-builder/    # Agent 构建器抽象
auth/             # 细粒度授权 (FGA)
background-tasks/ # 后台任务管理
browser/          # 浏览器集成
bundler/          # 打包器
cache/            # 缓存层
channels/         # 消息通道
datasets/         # 数据集管理
deployer/         # 部署器
di/               # 依赖注入
editor/           # 编辑器类型
error/            # 错误类型
evals/            # 评估打分
events/           # PubSub 事件系统
features/         # 特性开关
harness/          # 测试夹具
hooks/            # 事件钩子 (mitt)
integration/      # 集成适配器
license/          # 许可证管理
llm/              # LLM 模型路由 + 网关
logger/           # 日志接口
loop/             # Agent 循环
mastra/           # Mastra 主类
mcp/              # MCP 基类
memory/           # 记忆抽象
notifications/    # 通知系统
observability/    # 追踪/跨度
processor-provider/ # 处理器提供商
processors/       # 输入/输出/错误处理器
relevance/        # 相关性评分
request-context/  # 请求上下文 (AsyncLocalStorage)
run/              # 运行管理
schema/           # Schema 工具
server/           # 服务器适配器基类
signals/          # 跨进程信号
storage/          # 存储抽象层 (92KB types)
stream/           # 流类型
telemetry/        # 遥测
test-utils/       # 测试工具
tool-loop-agent/  # AI SDK v6 ToolLoopAgent 兼容
tool-provider/    # 工具提供商
tools/            # 工具系统
tts/              # TTS 抽象
types/            # 全局类型
utils/            # 工具函数
vector/           # 向量存储抽象
voice/            # 语音抽象
worker/           # Worker 线程
workflows/        # 工作流引擎 (157KB)
workspace/        # 工作区 (文件系统+沙箱+技能)
```

### 4.2 子路径导出

Core 包通过 package.json exports 暴露 60+ 子路径：

```json
{
  "@mastra/core": "./src/index.ts",
  "@mastra/core/agent": "./src/agent/index.ts",
  "@mastra/core/memory": "./src/memory/index.ts",
  "@mastra/core/tools": "./src/tools/index.ts",
  "@mastra/core/workflows": "./src/workflows/index.ts",
  "@mastra/core/storage": "./src/storage/index.ts",
  "@mastra/core/llm": "./src/llm/index.ts",
  "@mastra/core/mcp": "./src/mcp/index.ts",
  "@mastra/core/observability": "./src/observability/index.ts",
  "@mastra/core/di": "./src/di/index.ts",
  "@mastra/core/processors": "./src/processors/index.ts",
  "@mastra/core/stream": "./src/stream/index.ts",
  "@mastra/core/voice": "./src/voice/index.ts",
  "@mastra/core/events": "./src/events/index.ts",
  "@mastra/core/workspace": "./src/workspace/index.ts",
  // ... 50+ more
}
```

---

## 5. 模块集成机制

### 5.1 MastraBase 基类

文件：`packages/core/src/base.ts`

所有核心组件继承的基类：

```typescript
abstract class MastraBase {
  protected logger: IMastraLogger;
  abstract component: string;  // 组件标识符
  
  __registerMastra(mastra: Mastra): void;       // 注入 Mastra 实例
  __registerPrimitives(primitives): void;        // 注入基础组件
  __setLogger(logger: IMastraLogger): void;     // 注入 Logger
}
```

### 5.2 注册模式

```typescript
const mastra = new Mastra({
  agents: { myAgent: new Agent({...}) },
  workflows: { myWorkflow: new Workflow({...}) },
  tools: { myTool: createTool({...}) },
  memory: { default: new MastraMemory({...}) },
  storage: new LibSQLStore({...}),
  logger: new PinoLogger(),
});

// 运行时注册
mastra.addAgent('newAgent', agent);
mastra.addTool('newTool', tool);
mastra.addProcessor('newProc', processor);
```

### 5.3 组件依赖注入流程

```
Mastra 构造函数
  │
  ├─ 1. 创建基础组件（logger, storage, pubsub, cache）
  │
  ├─ 2. 注册 Agents → agent.__registerMastra(this)
  │                       → agent.__registerPrimitives({ logger, storage, ... })
  │
  ├─ 3. 注册 Workflows → workflow.__registerMastra(this)
  │
  ├─ 4. 注册 Memory → memory.__registerMastra(this)
  │                     → memory.__registerPrimitives({ vector, embedder, ... })
  │
  ├─ 5. 注册 MCP Servers → mcpServer.__registerMastra(this)
  │
  └─ 6. 注册其他（vectors, TTS, scorers, tools, processors, channels, gateway, workspace）
```

---

## 6. 请求数据流

### 6.1 从用户请求到 Agent 响应的完整流程

```
HTTP Request → mastra.getServerApp().fetch()
                │
                ▼
           @mastra/server (Hono)
                │
                ▼ 解析路由 → API Handler
                │
                ▼
          agent.stream(messages) 或 agent.generate(messages)
                │
                ▼
    ┌──────────────────────────────────────────┐
    │  1. Agent.stream()                       │
    │     - 合并默认 options                    │
    │     - FGA 权限检查                        │
    │     - 解析 LLM 模型 (ModelRouter)          │
    │     - 验证模型版本 (v1/v2/v3 spec)         │
    │     - 生成 runId                          │
    │     - 准备结构化输出 schema                │
    └──────────────┬───────────────────────────┘
                   ▼
    ┌──────────────────────────────────────────┐
    │  2. Agent.#execute()                     │
    │     - 创建 RequestContext                 │
    │     - 解析 workspace / browser context    │
    │     - 解析 threadId / resourceId          │
    │     - 创建 Trace Span (AGENT_RUN)         │
    │     - 构建 Capabilities 对象              │
    │     - 委托到 Agentic-Loop Workflow         │
    └──────────────┬───────────────────────────┘
                   ▼
    ┌──────────────────────────────────────────┐
    │  3. Agentic-Loop Workflow (事件驱动)       │
    │     ┌──────────────────────────┐          │
    │     │ Input Processors          │          │
    │     │ ├─ Memory Recall          │          │
    │     │ ├─ Skills Injection       │          │
    │     │ ├─ Working Memory         │          │
    │     │ └─ Semantic Recall        │          │
    │     ├──────────────────────────┤          │
    │     │ LLM Call (streamText)     │          │
    │     │ ├─ System Prompt          │          │
    │     │ ├─ Messages History       │          │
    │     │ └─ Available Tools        │          │
    │     ├──────────────────────────┤          │
    │     │ Output Processors         │          │
    │     │ ├─ Tool Call Detection    │          │
    │     │ └─ Response Processing    │          │
    │     ├──────────────────────────┤          │
    │     │ Tool Execution            │          │
    │     │ ├─ Make Core Tool         │          │
    │     │ ├─ Call Hooks             │          │
    │     │ └─ Return Result          │          │
    │     └──────────────────────────┘          │
    │     ↻ Loop until finishReason              │
    └──────────────┬───────────────────────────┘
                   ▼
    ┌──────────────────────────────────────────┐
    │  4. Response                             │
    │     - MastraModelOutput                   │
    │     - fullStream: ReadableStream          │
    │     - text: 聚合文本                      │
    │     - toolCalls / toolResults             │
    │     - finishReason                        │
    │     - messageList                         │
    └──────────────┬───────────────────────────┘
                   ▼
    ┌──────────────────────────────────────────┐
    │  5. Memory Persistence                   │
    │     - SaveQueueManager 批量保存            │
    │     - Thread-based 对话组织                │
    │     - 向量嵌入 + 语义索引                  │
    └──────────────────────────────────────────┘
```

---

## 7. 存储抽象层

### 7.1 层次结构

```
Layer 1: Types (storage/types.ts, 92KB)
  └─ 22 个领域接口定义
     ├── workflows, scores, memory, channels, notifications
     ├── observability, agents, datasets, experiments
     ├── promptBlocks, scorerDefinitions
     ├── mcpClients, mcpServers, workspaces
     ├── skills, favorites, blobs, backgroundTasks
     ├── schedules, harness, toolProviderConnections, threadState

Layer 2: Constants (storage/constants.ts)
  └─ 27 个表名常量 + 列 schema 定义

Layer 3: Base (storage/base.ts)
  └─ MastraCompositeStore 类
     └─ 组合模式：default | editor | domains

Layer 4: Domains (storage/domains/)
  └─ 每个领域：base interface + in-memory 实现 + versioned 变体

Layer 5: Providers (storage/providers/)
  └─ github.ts (source control provider)

Layer 6: Store Packages (stores/ 26 个包)
  └─ 各数据库后端实现
```

### 7.2 组合存储模式

```typescript
interface MastraCompositeStoreConfig {
  default?: StorageDomains;     // 默认存储后端
  editor?: StorageDomains;      // 编辑器专用存储
  domains?: {                   // 按领域分派
    [K in keyof StorageDomains]?: StorageDomain;
  };
}

// 示例：不同领域使用不同后端
const storage = new MastraCompositeStore({
  default: new LibSQLStore({ url: ':memory:' }),
  domains: {
    memory: new PGVectorStore({ ... }),   // 记忆用 PGVector
    observability: new ClickHouse({ ... }), // 可观测性用 ClickHouse
  }
});
```

### 7.3 表 Schema 定义

```typescript
// 使用 buildStorageSchema() 定义表结构
const MESSAGES_TABLE = buildStorageSchema({
  id: { type: 'uuid', primaryKey: true },
  thread_id: { type: 'uuid', indexed: true },
  content: { type: 'jsonb' },
  role: { type: 'text' },
  created_at: { type: 'timestamp', default: 'now()' },
});

// 支持的类型：text, timestamp, uuid, jsonb, integer, float, bigint, boolean
```

---

## 8. 工作流引擎

### 8.1 文件结构

| 文件 | 大小 | 职责 |
|------|------|------|
| `workflows/workflow.ts` | 157KB | Workflow 主类 |
| `workflows/execution-engine.ts` | - | 抽象执行引擎 |
| `workflows/default.ts` | - | 默认进程内执行引擎 |
| `workflows/evented/` | - | 事件驱动执行引擎（Agent 内部使用） |
| `workflows/create.ts` | - | 工厂函数 |
| `workflows/step.ts` | - | Step 类 |
| `workflows/scheduler/` | - | Cron 调度器 |

### 8.2 步骤状态机

```typescript
type StepStatus = 
  | 'success'    // 步骤成功完成
  | 'failed'     // 步骤失败
  | 'suspended'  // 步骤暂停（等待外部输入）
  | 'running'    // 步骤运行中
  | 'waiting'    // 步骤等待
  | 'paused';    // 步骤暂停

type StepResult<P, R, S, T> = {
  status: StepStatus;
  output?: R;
  error?: Error;
  suspendPayload?: S;  // 暂停时的数据
  resumeData?: T;      // 恢复时的数据
};
```

### 8.3 Suspend/Resume 机制

```
Step N 执行
  │
  ├─ return suspend(payload)
  │     ├─ 持久化工作流快照到 Storage
  │     ├─ Span 状态更新为 suspended
  │     └─ 等待外部事件
  │
  ▼
  [时间流逝... 外部事件触发]
  │
  ▼
  resume(resumeData)
  │     ├─ 从 Storage 加载快照
  │     ├─ 恢复 resumeSpan（链接到原 suspended span）
  │     ├─ 继续从 Step N 执行
  │     └─ → 正常流程继续
```

### 8.4 工作流特性

- **顺序步骤**：按定义顺序执行
- **条件分支**：运行时决定执行路径
- **并行执行**：`foreach` 并行处理
- **嵌套工作流**：Step 内启动子工作流
- **Sleep/Sleep-until**：定时等待
- **时间旅行**：重启到历史快照
- **Tripwire**：处理器触发的步骤失败

---

## 9. 可观测性

### 9.1 Span 类型

```typescript
enum SpanType {
  AGENT_RUN = 'agent_run',
  WORKFLOW_RUN = 'workflow_run',
  WORKFLOW_STEP = 'workflow_step',
  TOOL_RUN = 'tool_run',
  // ... 更多
}

enum EntityType {
  AGENT = 'agent',
  WORKFLOW_RUN = 'workflow_run',
  TOOL = 'tool',
  PROCESSOR = 'processor',
  // ... 更多
}
```

### 9.2 自动追踪注入

```typescript
// observability/context.ts
function wrapMastra(mastra: Mastra) {
  // 使用 JS Proxy 自动注入追踪上下文
  // getAgent() → 包装的 Agent
  //   generate()  → 自动创建 trace span
  //   stream()    → 自动创建 trace span
  // getWorkflow() → 包装的 Workflow
  //   execute()   → 自动创建 trace span
  //   createRun() → 自动创建 trace span
}
```

---

## 10. 事件系统 (PubSub)

```typescript
interface PubSub {
  publish(topic: string, message: unknown): Promise<void>;
  subscribe(topic: string, handler: (msg: unknown) => void): Promise<void>;
  unsubscribe(topic: string, handler: (msg: unknown) => void): Promise<void>;
  supportedModes?: PubSubMode[];
}

// 默认实现
class EventEmitterPubSub implements PubSub { ... }
```

用法：跨进程工作流事件分发、Agent 间通信、通知系统。

---

## 11. 关键设计模式总结

| 模式 | 应用场景 | 实现方式 |
|------|----------|----------|
| **IoC 容器** | 组件管理 | `Mastra` 类集中注册和注入 |
| **组合优于继承** | 存储后端 | `MastraCompositeStore` 按领域分派 |
| **抽象基类** | 核心组件 | `MastraBase` 提供日志/注入 |
| **Provider 接口** | 文件系统/沙箱/浏览器 | 运行时注册 + 解析 |
| **事件驱动** | Agent 循环/工作流 | Evented Workflow Engine |
| **AsyncLocalStorage** | 请求上下文传播 | `RequestContext` |
| **JS Proxy** | 可观测性自动注入 | `wrapMastra()` |
| **工厂函数** | Workflow/工具创建 | `createWorkflow()` / `createTool()` |
| **版本管理** | Agent/Workflow 发布 | draft/published/archived + VersionOverrides |
| **注册表** | 技能/工具提供商 | skills.sh + Composio/Arcade |

---

## 12. 关键文件索引

| 组件 | 文件路径 |
|------|----------|
| Mastra 主类 | `packages/core/src/mastra/index.ts` |
| MastraBase | `packages/core/src/base.ts` |
| Agent 类 | `packages/core/src/agent/agent.ts` |
| Agent 类型 | `packages/core/src/agent/types.ts` |
| Agent 执行选项 | `packages/core/src/agent/agent.types.ts` |
| Workflow 类 | `packages/core/src/workflows/workflow.ts` |
| 执行引擎抽象 | `packages/core/src/workflows/execution-engine.ts` |
| 默认执行引擎 | `packages/core/src/workflows/default.ts` |
| 事件工作流引擎 | `packages/core/src/workflows/evented/` |
| 存储类型 | `packages/core/src/storage/types.ts` (92KB) |
| 存储常量 | `packages/core/src/storage/constants.ts` |
| 组合存储 | `packages/core/src/storage/base.ts` |
| 记忆抽象 | `packages/core/src/memory/memory.ts` |
| 工具系统 | `packages/core/src/tools/` |
| 处理器系统 | `packages/core/src/processors/` |
| 模型路由 | `packages/core/src/llm/model/router.ts` |
| 可观测性上下文 | `packages/core/src/observability/context.ts` |
| 请求上下文 | `packages/core/src/request-context/` |
| PubSub 接口 | `packages/core/src/events/pubsub.ts` |
| 钩子系统 | `packages/core/src/hooks/index.ts` |
| MCP 基类 | `packages/core/src/mcp/index.ts` |
| 服务器基类 | `packages/core/src/server/index.ts` |
| 工作区抽象 | `packages/core/src/workspace/` |
