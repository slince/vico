# Mastra AI Agent 底层实现机制

> 基于 `mastra` 项目 `packages/core/src/agent/agent.ts`（~302KB）源码深度分析，涵盖 Agent 定义、Agentic Loop、工具集成、信号系统和持久执行。

## 1. Agent 类定义

### 1.1 基本结构

文件：`packages/core/src/agent/agent.ts`

```typescript
class Agent<
  TAgentId extends string = string,
  TTools extends ToolsInput = ToolsInput,
  TOutput extends ZodType | JSONSchema7 | StandardSchemaV1 = undefined,
  TRequestContext extends RequestContext = RequestContext,
  TEditor extends MastraBase = MastraBase,
> extends MastraBase implements SubAgent {
```

**7 个泛型参数**：
| 参数 | 说明 |
|------|------|
| `TAgentId` | Agent 标识符 |
| `TTools` | 已注册的工具集合 |
| `TOutput` | 结构化输出 Schema |
| `TRequestContext` | 请求上下文类型 |
| `TEditor` | 编辑器实例类型 |

### 1.2 构造器初始化（40+ 私有字段）

```typescript
constructor(config: AgentConfig) {
  // 核心配置
  this.#id = config.id;
  this.#instructions = config.instructions;  // string | SystemMessage | (runtime) => string
  this.#model = config.model;                // 必需：MastraModelConfig | ModelWithRetries[]
  this.#tools = config.tools;
  this.#memory = config.memory;
  
  // 子组件
  this.#agents = config.agents;             // 子 Agent 注册表
  this.#workflows = config.workflows;       // 子 Workflow 注册表
  this.#scorers = config.scorers;           // 评估打分器
  this.#voice = config.voice;              // 语音提供者
  
  // 处理器管道
  this.#inputProcessors = config.inputProcessors;
  this.#outputProcessors = config.outputProcessors;
  this.#errorProcessors = config.errorProcessors;
  
  // 高级功能
  this.#backgroundTasks = config.backgroundTasks;   // 后台任务
  this.#notifications = config.notifications;       // 通知
  this.#goal = config.goal;                         // 目标管理
  this.#signals = config.signals;                   // 信号系统
  this.#hooks = config.hooks;                       // 工具钩子
  
  // 运行时选项
  this.#maxRetries = config.maxRetries;
  this.#defaultOptions = config.defaultOptions;
  
  // Mastra 实例引用（通过 __setMastra 设置）
  this.#mastra = config.mastra;
}
```

### 1.3 AgentConfig 完整配置

```typescript
interface AgentConfig {
  // 必需
  id?: string;
  name?: string;
  instructions: string | SystemMessage | ((runtime: RuntimeContext) => string | Promise<string>);
  model: MastraModelConfig | ModelWithRetries[];
  
  // 可选
  description?: string;
  metadata?: Record<string, any>;
  tools?: ToolsInput;
  memory?: MastraMemory;
  agents?: Record<string, SubAgent>;
  workflows?: Record<string, AnyWorkflow>;
  scorers?: MastraScorers;
  voice?: MastraVoice;
  workspace?: AnyWorkspace;
  channels?: ChannelConfig[];
  
  // 处理器
  inputProcessors?: (InputProcessor | Workflow)[];
  outputProcessors?: (OutputProcessor | Workflow)[];
  errorProcessors?: (ErrorProcessor | Workflow)[];
  
  // 高级
  maxRetries?: number;
  defaultOptions?: AgentExecutionOptions;
  defaultGenerateOptionsLegacy?: ...;
  defaultStreamOptionsLegacy?: ...;
  backgroundTasks?: AgentBackgroundConfig;
  notifications?: AgentNotificationConfig;
  signals?: SignalProvider[];
  goal?: GoalConfig;
  hooks?: ToolHooks;
  mastra?: Mastra;
  pubsub?: PubSub;
  skillsFormat?: 'xml' | 'json' | 'markdown';
}
```

### 1.4 关键公共方法

```typescript
class Agent {
  // 主要执行方法
  generate(messages, options?): Promise<FullOutput<TOutput>>;     // 非流式（v2+）
  stream(messages, options?): Promise<MastraModelOutput<TOutput>>;  // 流式（v2+）
  
  // 旧版兼容
  generateLegacy(messages, options?): Promise<FullOutput>;  // v1 模型
  streamLegacy(messages, options?): Promise<MastraModelOutput>;  // v1 模型
  
  // 高级功能
  network(options?): Promise<NetworkResult>;        // 多 Agent 网络
  sendMessage(message): Promise<void>;              // 跨进程消息
  sendSignal(signal): Promise<void>;                // 发送信号
  sendStateSignal(state): Promise<void>;            // 发送状态信号
  
  // 恢复执行
  resumeGenerate(runId, resumeData): Promise<FullOutput>;
  resumeStream(runId, resumeData): Promise<MastraModelOutput>;
  
  // 线程管理
  subscribeToThread(threadId): Promise<void>;
  abortThreadStream(threadId): Promise<void>;
  abortRunStream(runId): Promise<void>;
  
  // 空闲执行
  untilIdle(): Promise<UntilIdleResult>;
  streamUntilIdle(): Promise<MastraModelOutput>;
  
  // 配置访问器
  getModel(): MastraModelConfig;
  getLLM(): Promise<MastraLLM>;
  getInstructions(runtime?): Promise<string>;
  getMemory(): MastraMemory | undefined;
  getVoice(): MastraVoice | undefined;
  getWorkspace(): AnyWorkspace | undefined;
  
  // 工具/打分器解析
  listTools(): Promise<Record<string, Tool>>;
  listScorers(): Promise<Record<string, Scorer>>;
}
```

---

## 2. 执行架构（Agentic Loop）

### 2.1 执行入口

```
generate() / stream()
      │
      ▼
  #execute(options)
      │
      ├── 1. 构建 RequestContext（含 VersionOverrides）
      ├── 2. 注入 Browser Context
      ├── 3. 解析 threadId / resourceId
      ├── 4. 获取 LLM 模型
      ├── 5. 解析结构化输出 Schema
      ├── 6. 创建 Trace Span (AGENT_RUN)
      ├── 7. 创建 SaveQueueManager（记忆持久化队列）
      ├── 8. 构建 Capabilities 对象
      │
      ▼
  createPrepareStreamWorkflow()
      │
      ├── prepareTools (并行)
      │   └── 从 10+ 来源组装工具
      │
      ├── prepareMemory (并行)
      │   └── 加载消息历史、工作记忆、语义召回
      │
      ▼
  agenticLoop (dowhile 工作流)
      │
      ▼
  agenticExecution (sequential 工作流)
      │
      ├── llmExecutionStep       → LLM 调用
      ├── map(toolCalls)         → 展开工具调用
      ├── foreach(toolCallStep)  → 逐个执行工具
      ├── llmMappingStep         → 映射结果回 LLM
      ├── backgroundTaskCheckStep → 后台任务检查
      ├── signalDrainStep        → 信号处理
      ├── isTaskCompleteStep     → 任务完成检查
      └── goalStep               → 目标评估
      │
      ▼
  循环直到 stopWhen 条件满足
```

### 2.2 核心工作流文件

| 组件 | 文件 | 功能 |
|------|------|------|
| 循环入口 | `loop/loop.ts` | `loop()` 创建 `MastraModelOutput` |
| 流式循环 | `loop/workflows/stream.ts` | `workflowLoopStream()` 创建 `ReadableStream` |
| Agentic Loop | `loop/workflows/agentic-loop/index.ts` | dowhile 循环创建 |
| Agentic Execution | `loop/workflows/agentic-execution/index.ts` | sequential 步骤链 |
| Prepare Stream | `agent/workflows/prepare-stream/index.ts` | 并行准备工具 + 记忆 |

### 2.3 Agentic Loop 详细步骤

```
agenticLoop (dowhile)
  │
  ├── onIterationStart: signalDrain (处理待处理信号)
  │
  ├── body: agenticExecution (sequential)
  │   │
  │   ├── Step 1: llmExecutionStep
  │   │   ├── 应用 Input Processors
  │   │   │   ├── MessageHistory (注入最近消息)
  │   │   │   ├── SemanticRecall (语义召回)
  │   │   │   ├── SkillsProcessor (注入 Skill)
  │   │   │   ├── WorkingMemory (工作记忆)
  │   │   │   └── 用户自定义 Processors
  │   │   ├── 构建 System Prompt
  │   │   │   ├── Agent Instructions
  │   │   │   ├── Memory Context (OM observations)
  │   │   │   ├── Working Memory
  │   │   │   ├── Skills Metadata
  │   │   │   ├── Available Tools
  │   │   │   └── Date/Time Context
  │   │   ├── 调用 LLM (streamText / generateText)
  │   │   │   ├── model (解析后的 LLM)
  │   │   │   ├── messages (历史 + 新消息)
  │   │   │   ├── tools (转换后的 AI SDK tools)
  │   │   │   ├── onStepFinish (步完成钩子)
  │   │   │   └── experimental_output (结构化输出)
  │   │   └── 应用 Output Processors
  │   │
  │   ├── Step 2: map(toolCalls)
  │   │   └── 展开 LLM 返回的工具调用列表
  │   │
  │   ├── Step 3: foreach(toolCallStep)
  │   │   ├── 对每个 tool call:
  │   │   │   ├── beforeToolCall hook
  │   │   │   ├── 工具审批检查 (requireApproval)
  │   │   │   ├── 创建 Tool Span (TOOL_CALL)
  │   │   │   ├── 执行工具 (with context injection)
  │   │   │   ├── afterToolCall hook
  │   │   │   └── 返回 tool-result
  │   │   └── 可暂停 (suspend for approval)
  │   │
  │   ├── Step 4: llmMappingStep
  │   │   └── 将工具结果映射回 LLM 对话格式
  │   │
  │   ├── Step 5: backgroundTaskCheckStep
  │   │   └── 检查/启动后台任务
  │   │
  │   ├── Step 6: signalDrainStep
  │   │   └── 处理当前迭代中到达的信号
  │   │
  │   ├── Step 7: isTaskCompleteStep
  │   │   └── 检查 finishReason，判断是否完成
  │   │
  │   └── Step 8: goalStep (如果配置了 goal)
  │       └── 评估目标进度
  │
  ├── stopWhen: finishReason === 'stop' || 'error' || maxSteps reached
  │
  └── onIterationComplete
      ├── 持久化消息到 Memory
      └── 触发 OM (观察记忆) 输出处理
```

---

## 3. 工具集成体系

### 3.1 工具组装（10+ 来源）

文件：`agent.ts` 的 `convertTools()` 方法

```typescript
async function convertTools(agent: Agent): Promise<Record<string, CoreTool>> {
  const allTools = {};
  
  // 1. 直接分配的工具（Agent 级别）
  Object.assign(allTools, await listAssignedTools());
  
  // 2. 记忆工具（updateWorkingMemory, recall）
  Object.assign(allTools, await listMemoryTools());
  
  // 3. 外部 Toolset 集成
  Object.assign(allTools, await listToolsets());
  
  // 4. 客户端提供的工具
  Object.assign(allTools, await listClientTools());
  
  // 5. 子 Agent 作为工具
  Object.assign(allTools, await listAgentTools());
  
  // 6. Workflow 包装为工具
  Object.assign(allTools, await listWorkflowTools());
  
  // 7. Workspace 工具（文件系统 + 沙箱）
  Object.assign(allTools, await listWorkspaceTools());
  
  // 8. Skill 工具（skill, skill_search, skill_read）
  Object.assign(allTools, await listSkillTools());
  
  // 9. Channel 工具（Slack, Discord 等）
  Object.assign(allTools, await listChannelTools());
  
  // 10. Browser 工具（Playwright）
  Object.assign(allTools, await listBrowserTools());
  
  // 11. Input Processor 注入的工具
  Object.assign(allTools, await listInputProcessorLoadedTools());
  
  // 应用钩子包装
  return wrapToolsWithHooks(allTools, hooks);
}
```

### 3.2 工具转换管道

```
Mastra Tool
  │
  ▼
makeCoreTool()
  ├── Tool → CoreToolBuilder.build()
  │   ├── 输入 Schema → parameters
  │   ├── Schema 兼容层应用
  │   │   ├── OpenAI reasoning
  │   │   ├── Anthropic cache control
  │   │   ├── Google safety
  │   │   └── DeepSeek / Meta
  │   ├── 注入 _background / suspend 字段
  │   └── 创建 ToolExecutionContext
  │       ├── mastra (Mastra 实例)
  │       ├── memory (记忆引用)
  │       ├── requestContext
  │       ├── workspace (工作区引用)
  │       ├── browser (浏览器引用)
  │       └── observe (创建追踪 span)
  │
  ▼
wrapToolsWithHooks()
  ├── beforeToolCall → 执行前拦截
  └── afterToolCall  → 执行后拦截
  │
  ▼
AI SDK CoreTool (传递给 streamText / generateText)
```

### 3.3 工具审批机制

```typescript
interface ToolApprovalContext {
  toolId: string;
  toolName: string;
  args: unknown;
  agent: Agent;
  mastra: Mastra;
  threadId: string;
  resourceId: string;
  requestContext: RequestContext;
}

type RequireToolApproval = 
  | boolean                          // 全局开关
  | ((ctx: ToolApprovalContext) => boolean | Promise<boolean>);  // 条件审批

// Agent 执行流程中:
if (requireApproval === true || await requireApproval(ctx)) {
  // 暂停执行，发出 tool-call-suspended 事件
  await context.agent.suspend({ toolCallId, toolName, args });
  // 等待 resume，resumeData 中含用户批准/拒绝
}
```

---

## 4. 模型选择与 LLM 集成

### 4.1 模型解析

```typescript
// 支持静态配置或动态函数
type ModelConfig = 
  | string                          // "openai/gpt-4o"
  | ModelConfigObject               // { id, url, apiKey }
  | ModelWithRetries[]              // 回退链
  | ((ctx: RuntimeContext) => ...); // 动态选择

// 模型回退配置
interface ModelWithRetries {
  model: MastraModelConfig;
  maxRetries?: number;
  enabled?: boolean;
  modelSettings?: ModelSettings;
  providerOptions?: Record<string, any>;
  headers?: Record<string, string>;
}
```

### 4.2 模型网关

```
"openai/gpt-4o"
    │
    ▼
parseModelString("openai/gpt-4o")
    ├── providerId: "openai"
    └── modelId: "gpt-4o"
    │
    ▼
findGatewayForModel("openai", "gpt-4o")
    ├── 用户配置的 gateways → 优先查找
    └── ModelsDevGateway → 默认回退
    │
    ▼
gateway.resolveLanguageModel(config)
    ├── resolveAuth() → API Key
    ├── buildUrl() → API URL
    └── 返回 AI SDK LanguageModel
    │
    ▼
AISDKV5LanguageModel / AISDKV6LanguageModel
    └── wrap 为 MastraLLMVNext
```

### 4.3 三个 LLM 版本适配

| 类 | 文件 | AI SDK 版本 |
|------|------|-------------|
| `MastraLLMV1` | `llm/model/model.ts` | v4 (旧版) |
| `MastraLLMVNext` (v2) | `llm/model/model.loop.ts` | v5 |
| `MastraLLMVNext` (v3) | `llm/model/model.loop.ts` | v6 |

### 4.4 底层模型调用

```typescript
// MastraLLMVNext.doGenerate()
async doGenerate({ messages, tools, ...opts }) {
  const aiSdkModel = await resolveUnderlyingModel();
  
  return await generateText({
    model: aiSdkModel,
    messages: injectSystemMessage(messages, systemPrompt),
    tools: convertTools(tools),
    onStepFinish: wrapOnStepFinish(opts.onStepFinish),
    ...opts,
  });
}

// MastraLLMVNext.doStream()
async doStream({ messages, tools, ...opts }) {
  const aiSdkModel = await resolveUnderlyingModel();
  
  const result = await streamText({
    model: aiSdkModel,
    messages: injectSystemMessage(messages, systemPrompt),
    tools: convertTools(tools),
    onStepFinish: wrapOnStepFinish(opts.onStepFinish),
    ...opts,
  });
  
  return result.fullStream;
}
```

---

## 5. 系统提示词构建

### 5.1 组装顺序

```
System Prompt 组装
  │
  ├── 1. Agent Instructions
  │   ├── 静态字符串或函数动态生成
  │   └── (runtime: { threadId, resourceId, requestContext }) => string
  │
  ├── 2. Memory Context
  │   ├── Observational Memory: 当前活跃观察
  │   └── 长期记忆摘要
  │
  ├── 3. Working Memory
  │   ├── 模板/JSON Schema 格式
  │   └── 包裹在 <working_memory> XML 标签中
  │
  ├── 4. Skills Metadata
  │   ├── XML/JSON/Markdown 格式
  │   └── <available_skills> 列表
  │
  ├── 5. Available Tools
  │   └── 工具名称 + 描述 + 参数 Schema
  │
  ├── 6. Date/Time Context
  │   └── 当前日期时间
  │
  └── 7. 其他系统注入
      ├── System reminders (过滤后)
      └── Processor 注入内容
```

---

## 6. 信号系统

### 6.1 架构

文件：`packages/core/src/agent/signals.ts`

```typescript
enum SignalType {
  USER = 'user',            // 用户发送的信号
  STATE = 'state',          // 状态更新信号（工作记忆变更等）
  REACTIVE = 'reactive',    // 反应式信号
  NOTIFICATION = 'notification',  // 通知信号
}

enum SignalBehavior {
  WAKE = 'wake',           // 唤醒 Agent
  DELIVER = 'deliver',     // 发送给 Agent
  PERSIST = 'persist',     // 持久化
  DISCARD = 'discard',     // 丢弃
}

interface Signal {
  id: string;
  type: SignalType;
  behavior: SignalBehavior;
  payload: unknown;
  timestamp: number;
}
```

### 6.2 信号流程

```
外部 → PubSub publish(topic, signal)
         │
         ▼
Signal Provider (轮询/订阅)
         │
         ▼
signalDrainStep (Agentic Loop 中)
         │
         ├── 收集当前迭代中的所有信号
         ├── 按优先级排序
         ├── DELIVER → 注入到 LLM 上下文
         ├── PERSIST → 写入存储
         ├── WAKE → 唤醒 Agent 继续执行
         └── DISCARD → 忽略
```

### 6.3 状态信号（工作记忆）

文件：`packages/core/src/agent/state-signals.ts`

```typescript
// 替代系统消息方式的工作记忆传输
class WorkingMemoryStateSignal {
  mode: 'snapshot' | 'delta';
  content: string;  // 完整内容或 unified diff
  sha256: string;   // 去重缓存键
}
```

---

## 7. 持久 Agent（Resumable Execution）

### 7.1 DurableAgent

文件：`packages/core/src/agent/durable/durable-agent.ts`

```typescript
class DurableAgent extends Agent {
  // 完全序列化 Agent 配置
  // 用于持久执行引擎 (Inngest, Temporal 等)
  
  constructor(config: DurableAgentConfig) {
    super(config);
    // 1. 序列化所有配置为可传输格式
    // 2. 创建 PubSub 事件流
    // 3. 建立 Per-run 注册表（非序列化运行时状态）
  }
}
```

### 7.2 执行组件

| 组件 | 文件 | 功能 |
|------|------|------|
| `create-durable-agent.ts` | 工厂函数 | 创建持久 Agent |
| `evented-agent.ts` | 事件 Agent | 事件驱动的执行变体 |
| `durable-stream-until-idle.ts` | 空闲流 | 后台空闲执行 |
| `preparation.ts` | 序列化 | Agent 配置 → 可序列化工作流输入 |
| `run-registry.ts` | 注册表 | Per-run 非序列化状态管理（工具函数、模型实例、工作区） |
| `stream-adapter.ts` | 流适配 | PubSub 流适配（含 `CachingPubSub` 用于可恢复流） |

### 7.3 Per-run Registry

```typescript
// 解决工具函数、模型 doStream 等不可序列化问题
class RunRegistry {
  // 30 秒自动清理
  // 可选 clean() 手动清理
  set(runId: string, key: string, value: unknown): void;
  get(runId: string, key: string): unknown;
  delete(runId: string): void;
}
```

---

## 8. 多 Agent 网络

### 8.1 network() 方法

文件：`packages/core/src/loop/network/index.ts` (~2703 行)

```typescript
async network(options: NetworkOptions): Promise<NetworkResult> {
  // 1. 创建路由 Agent
  //    - 列出所有子 Agent / Workflow / 工具
  //    - 决定委派给谁
  
  // 2. dountil 工作流:
  //    routing → execution → validation → repeat
  
  // 3. 委派钩子:
  //    onDelegationStart / onDelegationComplete
  
  // 4. 消息过滤以控制委派上下文
}
```

---

## 9. 处理器管道

### 9.1 管道架构

```
Input Phase (LLM 调用前)
  │
  ├── MessageHistory      → 注入最近消息
  ├── SemanticRecall      → 语义召回
  ├── SkillsProcessor     → 注入 Skill 元数据
  ├── WorkingMemory       → 注入工作记忆
  ├── 用户自定义 Input Processors
  │
  ▼
LLM Call
  │
  ▼
Output Phase (LLM 响应后)
  │
  ├── 用户自定义 Output Processors
  ├── ObservationalMemory  → 触发观察/反思
  └── 保存消息到存储

Error Phase (出错时)
  │
  ├── StreamErrorRetry    → 重试瞬时错误
  ├── PrefillErrorHandler → 恢复 Anthropic prefill 错误
  └── ProviderHistoryCompat → 修复历史格式不兼容
```

### 9.2 ProcessorRunner

```typescript
class ProcessorRunner {
  // 顺序处理消息
  // 维护跨轮次的 per-processor 状态
  async processInput(messages, processors): Promise<Message[]>;
  async processOutput(chunks, processors): Promise<Chunk[]>;
  async processError(error, processors): Promise<void>;
}
```

---

## 10. 子 Agent 委派

### 10.1 SubAgent 接口

文件：`packages/core/src/agent/subagent.ts`

```typescript
interface SubAgent {
  generate(messages, options?): Promise<FullOutput>;
  stream(messages, options?): Promise<MastraModelOutput>;
  resumeGenerate(runId, data): Promise<FullOutput>;
  resumeStream(runId, data): Promise<MastraModelOutput>;
  
  getModel(): MastraModelConfig;
  getMemory(): MastraMemory | undefined;
  getInstructions(runtime?): Promise<string>;
  getDescription(): string;
  hasOwnMemory(): boolean;
  __setMemory(memory: MastraMemory): void;
}
```

### 10.2 委派流程

```
父 Agent 决定委派
  │
  ├── 子 Agent 作为 Tool 暴露给父 Agent
  │   toolName = agent_{childAgentId}
  │
  ├── 父 Agent 调用子 Agent Tool
  │   ├── 注入委派上下文（delegationContext）
  │   ├── 可选 VersionOverrides
  │   └── 可选 Memory 隔离
  │
  ├── 子 Agent 独立执行
  │   ├── 自己的 System Prompt
  │   ├── 自己的 Tools
  │   └── 自己的 Memory（如果 hasOwnMemory）
  │
  └── 返回结果给父 Agent
      └── 父 Agent 继续执行
```

---

## 11. 旧版 vs 当前执行路径

### 11.1 旧版路径（v1 模型）

```typescript
// agent-legacy.ts
class AgentLegacyHandler {
  generateLegacy(messages) {
    return this.llm.__text(messages, { ... });
    // 或 this.llm.__textObject(messages, { structuredOutput });
  }
  
  streamLegacy(messages) {
    return this.llm.__stream(messages, { ... });
    // 或 this.llm.__streamObject(messages, { structuredOutput });
  }
}
```

### 11.2 当前路径（v2/v3 模型）

```
#execute() → 工作流引擎
  ├── 完整的 Agentic Loop
  ├── 完整的 Processor 管道
  ├── 信号处理
  ├── 目标追踪
  ├── 后台任务
  └── Suspend/Resume
```

### 11.3 兼容性处理

```typescript
// 自动检测模型版本
// 检查 model.specificationVersion
if (model.specificationVersion === 'v1') {
  return agent.generateLegacy(messages, options);
} else {
  return agent.generate(messages, options);
}
```

---

## 12. 配置访问器

### 12.1 懒解析

```typescript
class Agent {
  // 所有配置支持 DynamicArgument: 静态值 | (ctx) => value
  async getInstructions(runtime?): Promise<string> {
    if (typeof this.#instructions === 'function') {
      return await this.#instructions(runtime);
    }
    return this.#instructions;
  }
  
  async getLLM(): Promise<MastraLLM> {
    // 1. 解析 model config (支持 DynamicArgument)
    // 2. 通过 ModelRouter 获取实际模型
    // 3. 包装为 MastraLLMVNext 或 MastraLLMV1
    // 4. 缓存结果
  }
  
  async getMemory(): Promise<MastraMemory | undefined> {
    // 从 Agent 配置或 Mastra 全局配置解析
    if (this.#memory) return this.#memory;
    if (this.#mastra?.memory?.default) return this.#mastra.memory.default;
    return undefined;
  }
}
```

---

## 13. 依赖库总结

| 库 | 用途 |
|------|------|
| `ai` (Vercel AI SDK v4) | 旧版 LLM 调用 |
| `@ai-sdk/provider-utils` v5/v6 | 新版 LLM 调用 |
| `@ai-sdk/openai` / `@ai-sdk/anthropic` / `@ai-sdk/google` | AI 提供商 |
| `zod` v3 + v4 | Schema 定义和验证 |
| `@modelcontextprotocol/sdk` | MCP 协议支持 |
| `better-sqlite3` / `@libsql/client` | 数据库 |
| `pg` (node-postgres) | PostgreSQL |
| `pino` | 结构化日志 |
| `mitt` | EventEmitter（钩子系统） |
| `execa` | Shell 命令执行 |
| `@ast-grep/napi` | AST 代码转换 |
| `onnxruntime-node` | ONNX 本地推理（嵌入） |

---

## 14. 关键文件索引

| 文件 | 大小 | 说明 |
|------|------|------|
| `packages/core/src/agent/agent.ts` | ~302KB | Agent 主类 |
| `packages/core/src/agent/types.ts` | - | Agent 配置类型 |
| `packages/core/src/agent/agent.types.ts` | - | 执行选项类型 |
| `packages/core/src/agent/agent-legacy.ts` | - | v1 模型兼容 |
| `packages/core/src/agent/signals.ts` | - | 信号系统 |
| `packages/core/src/agent/state-signals.ts` | - | 状态信号 |
| `packages/core/src/agent/subagent.ts` | - | SubAgent 接口 |
| `packages/core/src/agent/durable/` | - | 持久 Agent |
| `packages/core/src/loop/loop.ts` | - | 循环入口 |
| `packages/core/src/loop/workflows/stream.ts` | - | 流式循环 |
| `packages/core/src/loop/workflows/agentic-loop/index.ts` | - | Agentic Loop |
| `packages/core/src/loop/workflows/agentic-execution/index.ts` | - | 执行步骤链 |
| `packages/core/src/loop/network/index.ts` | ~2703 行 | 多 Agent 网络 |
| `packages/core/src/agent/workflows/prepare-stream/index.ts` | - | 准备阶段 |
| `packages/core/src/llm/model/model.loop.ts` | - | MastraLLMVNext |
| `packages/core/src/llm/model/router.ts` | - | 模型路由 |
| `packages/core/src/llm/model/gateways/` | - | 网关实现 |
| `packages/core/src/tools/tool.ts` | - | Tool 类 |
| `packages/core/src/tools/tool-builder/builder.ts` | - | CoreToolBuilder |
| `packages/core/src/tools/builtin/` | - | 内置工具 |
| `packages/core/src/processors/` | - | 处理器系统 |
