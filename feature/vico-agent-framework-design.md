# Vico Agent Framework 自研框架设计方案

> 基于 Kun（自研 AgentLoop 架构）和 Mastra（IoC + AI SDK + 工作流引擎）的深度分析，为 Vico 量身设计的底层 Agent 框架实现路径。

## 一、为什么要自研框架

### Mastra 的核心问题

| 问题 | 详情 |
|------|------|
| **不支持动态创建 Agent** | Mastra 的 Agent 必须在构造 `Mastra` 实例时注册，无法在运行时根据数据库配置动态创建/销毁 Agent。这是致命缺陷——Vico 作为多租户平台，Agent 的增删改是核心操作 |
| **IoC 容器过于厚重** | `Mastra` 类有 11 个泛型参数，启动时需要装配所有组件，拆不开、减不掉。动态添加 Agent 需要 hack `addAgent()` 方法 |
| **版本兼容负担** | 同时支持 AI SDK v4/v5/v6 三个版本，内部用 npm alias + 适配器强行兼容，代码膨胀严重（`agent.ts` 302KB） |
| **事件驱动工作流引擎过重** | Agent 循环被建模为 Workflow（dowhile + sequential + foreach），引入 suspend/resume、时间旅行等概念，对 Vico 场景过度设计 |
| **存储抽象复杂度高** | 24 个存储领域接口 + 26 个后端适配器，Vico 只需 SQLite |

### Kun 的参考价值与不足

| 优点（值得借鉴） | 不足（不适用于 Vico） |
|------|------|
| Ports & Adapters 架构，高度可测试 | 手写 HTTP 服务器，Vico 已有 Hono |
| AgentLoop 多步循环，精确控制每步行为 | 手写 CompatModelClient（2600 行），不如复用 AI SDK |
| 工具策略分级（auto/on-request/suggest/never） | N-gram 文本匹配记忆，无语义检索（Vico 已有向量方案） |
| 子 Agent 委托（readOnly/inherit 策略） | 无多租户（Vico 需要 tenant_id） |
| Hook 生命周期系统 | Skill 仅文本注入，无代码执行（Vico 新方案同样采用纯知识注入） |
| 上下文压缩 + Token 经济 | 无认证系统 |
| Prompt 缓存策略 | 本地单用户，无数据隔离 |

### 结论

**取 Kun 的架构模式（Ports & Adapters + AgentLoop），复用 Vico 已有的基础设施（AI SDK、Hono、Drizzle、better-auth），融合两者 Skill/Memory 优势，构建轻量自研框架。**

---

## 二、框架总体架构

### 2.1 分层架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      应用层 (Hono API Routes)                     │
│  /api/agents  /api/chat  /api/skills  /api/memory  /api/knowledge │
└──────────────────────────────┬───────────────────────────────────┘
                               │
┌──────────────────────────────┴───────────────────────────────────┐
│                    框架核心层 (@vico/agent)                       │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    AgentRuntime (单例)                       │ │
│  │  动态创建/销毁/管理 Agent 实例的运行时容器                      │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                               │                                   │
│  ┌───────────────────────────┴─────────────────────────────────┐ │
│  │                      Agent 实例                              │ │
│  │  ┌────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │ │
│  │  │ Prompt     │ │ Model    │ │ Tool     │ │ Memory      │  │ │
│  │  │ Assembler  │ │ Resolver │ │ Executor │ │ Context     │  │ │
│  │  └────────────┘ └──────────┘ └──────────┘ └─────────────┘  │ │
│  └───────────────────────────┬─────────────────────────────────┘ │
│                               │                                   │
│  ┌───────────────────────────┴─────────────────────────────────┐ │
│  │                    AgentLoop (循环引擎)                       │ │
│  │  runTurn() → modelStep() → dispatchTools() → repeat         │ │
│  │  上下文压缩 · Token 经济 · 审批门控 · Hook 生命周期            │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────┴───────────────────────────────────┐
│                    端口层 (Ports / 接口定义)                       │
│                                                                   │
│  ModelClient  │ ToolHost │ MemoryStore │ SkillLoader │ SessionStore │
└──────────────────────────────┬───────────────────────────────────┘
                               │
┌──────────────────────────────┴───────────────────────────────────┐
│                    适配器层 (Adapters)                             │
│                                                                   │
│  AISDKModelClient │ LocalToolHost │ SQLiteMemory │ FSSkillLoader │
│  (复用 AI SDK)    │ (审批+策略)    │ (向量+关键词) │ (manifest)   │
└──────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────┴───────────────────────────────────┐
│                    基础设施层                                      │
│                                                                   │
│  AI SDK (streamText) │ Drizzle ORM │ better-sqlite3 │ better-auth │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 核心设计原则

| 原则 | 说明 |
|------|------|
| **Ports & Adapters** | 所有外部依赖通过接口定义，适配器实现，可替换可测试 |
| **动态 Agent** | Agent 实例按需创建/销毁，与数据库配置联动 |
| **最小依赖** | 复用现有基础设施（AI SDK、Hono、Drizzle、better-auth），不引入新框架 |
| **模块解耦** | 每个模块独立定义端口，可单独开发、测试、替换 |
| **多租户原生** | 所有操作带 `tenant_id`，Agent 实例按租户隔离 |

---

## 三、模块体系定义

### 3.1 模块全景图

```
@vico/agent (框架包)
├── agent-runtime/     # Agent 运行时容器（动态管理）
│   ├── AgentRuntime   # 单例：创建/销毁/查找 Agent 实例
│   └── AgentConfig    # Agent 配置类型（从 DB 加载）
│
├── agent-loop/        # Agent 循环引擎（核心）
│   ├── AgentLoop      # 主循环：runTurn → modelStep → dispatchTools
│   ├── ContextCompactor # 上下文压缩（启发式 + LLM 摘要）
│   ├── TokenEconomy   # Token 经济管理
│   └── ApprovalGate   # 审批门控
│
├── prompt/            # 系统提示词拼装
│   ├── PromptAssembler # 组装系统 prompt（Agent prompt + Skill 目录 + Memory + RAG）
│   └── ImmutablePrefix # 不可变前缀管理（Prompt 缓存优化）
│
├── model/             # 模型抽象层
│   ├── ModelClient    # 抽象端口
│   ├── AISDKAdapter   # AI SDK 适配器实现
│   └── ModelRegistry  # 模型注册表（从 DB 加载）
│
├── tool/              # 工具系统
│   ├── ToolHost       # 抽象端口
│   ├── LocalToolHost  # 工具执行器（审批+策略+并行）
│   ├── ToolPolicy     # 审批策略（auto/on-request/suggest/never）
│   ├── CapabilityRegistry # 能力注册表（按 capability 过滤工具）
│   └── BuiltinToolsSource   # 内置工具（与 Vico 业务相关）
│
├── skill/             # Skill 插件系统（遵循 Agent Skills 规范）
│   ├── SkillLoader    # 抽象端口
│   ├── FSSkillLoader  # 文件系统加载器（扫描 SKILL.md）
│   ├── SkillManager   # 单例管理器（发现/加载/绑定/激活）
│   └── SkillTools     # skill / skill_search / skill_read 工具
│
├── memory/            # 记忆系统
│   ├── MemoryStore    # 抽象端口
│   ├── ShortTermMemory # 短期记忆（FIFO 窗口）
│   ├── LongTermMemory  # 长期记忆（向量检索）
│   ├── RagManager     # RAG 知识库（文档分块+混合搜索）
│   └── Embedder       # 嵌入器抽象 + 适配器
│
├── hook/              # 生命周期 Hook
│   ├── HookRunner     # Hook 执行引擎
│   └── HookTypes      # PreToolUse/PostToolUse/TurnStart/TurnEnd 等
│
├── session/           # 会话/存储
│   ├── SessionStore   # 会话持久化端口
│   ├── ConversationStore # 对话记录存储
│   └── MessageStore   # 消息存储
│
├── contracts/         # Zod Schema 定义
│   ├── AgentSchema    # Agent 配置 Schema
│   ├── ToolSchema     # 工具定义 Schema
│   ├── MemorySchema   # 记忆记录 Schema
│   └── EventSchema    # SSE 事件 Schema
│
└── observable/        # 可观测性
    ├── SpanTracker    # Span 追踪
    ├── EventRecorder  # SSE 事件广播
    └── UsageTracker   # Token 用量统计
```

### 3.2 模块关系图

```
                        ┌─────────────────────┐
                        │    AgentRuntime      │
                        │  (动态 Agent 容器)    │
                        └──────────┬──────────┘
                                   │ 创建/管理
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
            ┌──────────┐   ┌──────────┐   ┌──────────┐
            │  Agent A  │   │  Agent B  │   │  Agent C  │
            │ (租户1)   │   │ (租户1)   │   │ (租户2)   │
            └─────┬────┘   └─────┬────┘   └─────┬────┘
                  │              │              │
       ┌──────────┼──────────────┼──────────────┼──────────┐
       │          ▼              ▼              ▼          │
       │              AgentLoop (每个 Agent 独立)           │
       │                                                   │
       │  ┌─────────────────────────────────────────────┐ │
       │  │          PromptAssembler                     │ │
       │  │  Agent Prompt + Skill Prompt + Memory + RAG │ │
       │  └─────────────────┬───────────────────────────┘ │
       │                    │                              │
       │  ┌─────────────────▼───────────────────────────┐ │
       │  │          ModelClient (AI SDK 适配)           │ │
       │  │  stream() → SSE → streamText                 │ │
       │  └─────────────────┬───────────────────────────┘ │
       │                    │                              │
       │  ┌─────────────────▼───────────────────────────┐ │
       │  │          ToolHost                            │ │
       │  │  审批 → 策略 → 执行 → Hook → 结果           │ │
       │  └─────────────────┬───────────────────────────┘ │
       │                    │                              │
       │  ┌─────────────────▼───────────────────────────┐ │
       │  │          Tool Sources (并行聚合)             │ │
       │  │  Builtin + Skill Tools + MCP + Memory Tools  │ │
       │  └─────────────────────────────────────────────┘ │
       │                                                   │
       │  ┌─────────────────────────────────────────────┐ │
       │  │          Context Management                  │ │
       │  │  ContextCompactor + TokenEconomy             │ │
       │  └─────────────────────────────────────────────┘ │
       │                                                   │
       │  ┌─────────────────────────────────────────────┐ │
       │  │          Hook System                         │ │
       │  │  PreToolUse → PostToolUse → TurnStart → ... │ │
       │  └─────────────────────────────────────────────┘ │
       └───────────────────────────────────────────────────┘
                │              │              │
       ┌────────┼──────────────┼──────────────┼──────────┐
       │        ▼              ▼              ▼          │
       │           Memory & Session & Storage            │
       │  STM(FIFO)  LTM(Vector)  RAG  Conversation      │
       └─────────────────────────────────────────────────┘
```

---

## 四、核心模块详细设计

### 4.1 AgentRuntime — 动态 Agent 容器（优先级最高）

**职责**：替代 Mastra 的 IoC 容器，支持运行时动态创建/销毁/更新 Agent。

```typescript
// agent-runtime/agent-runtime.ts

interface AgentRuntime {
  // 生命周期
  createAgent(config: AgentConfig): Promise<Agent>;   // 从 DB 配置创建
  destroyAgent(agentId: string): Promise<void>;        // 销毁并清理资源
  updateAgent(agentId: string, config: Partial<AgentConfig>): Promise<Agent>;
  
  // 查询
  getAgent(agentId: string): Agent | undefined;
  listAgents(tenantId: string): Agent[];
  
  // 热重载
  reloadAgent(agentId: string): Promise<Agent>;        // 重新加载配置
  
  // 健康检查
  isHealthy(agentId: string): boolean;
}
```

**关键设计**：
- Agent 实例按 `tenant_id + agent_id` 作为缓存键
- LRU 淘汰策略（最近 N 个 Agent 保持热加载，冷 Agent 自动卸载）
- 配置变更时（DB 更新的 Agent/Skill/Memory 配置），自动 revalidate 对应 Agent

**参考来源**：
- Kun 的 `runtime-factory.ts`：一次性装配所有组件，AgentLoop 按需创建
- Mastra 的反面教训：Agent 注册到 IoC 容器后无法灵活管理

### 4.2 AgentLoop — 核心循环引擎

**职责**：执行 Agent 的 "思考-行动" 循环，是框架的心脏。

```typescript
// agent-loop/agent-loop.ts

interface AgentLoopOptions {
  model: ModelClient;              // LLM 适配器
  toolHost: ToolHost;              // 工具执行器
  promptAssembler: PromptAssembler; // 提示词拼装器
  memoryStore: MemoryStore;        // 记忆存储
  sessionStore: SessionStore;      // 会话存储
  compactor: ContextCompactor;     // 上下文压缩器
  approvalGate?: ApprovalGate;     // 审批门控
  hooks?: HookRunner[];            // 生命周期 Hooks
  maxSteps?: number;               // 每 Turn 最大步数
  events: EventRecorder;           // SSE 事件广播
}

interface AgentLoop {
  // 执行一个完整的 Turn（用户消息 → LLM → 工具 → ... → 完成）
  runTurn(threadId: string, turnId: string, signal: AbortSignal): Promise<TurnResult>;
  
  // 中断当前 Turn
  interrupt(): Promise<void>;
  
  // 引导（注入修正文本到下个 modelStep）
  steer(text: string): void;
}

type TurnResult = {
  status: 'completed' | 'failed' | 'aborted' | 'interrupted';
  steps: number;
  usage: TokenUsage;
  messages: Message[];
};
```

**核心流程**（参考 Kun AgentLoop ~2400 行）：

```
runTurn(threadId, turnId):
  │
  ├─ 1. 前置处理
  │   ├─ 加载 Thread/Turn 状态
  │   ├─ 执行 TurnStart Hook
  │   ├─ 排干 steer 缓冲区
  │   └─ 检索 Memory（STM + LTM + RAG）
  │
  ├─ 2. 循环 modelStep()（最多 maxSteps 步）
  │   │
  │   ├─ 2.1 验证不可变前缀完整性
  │   ├─ 2.2 检查 Token 预算（超限触发压缩）
  │   ├─ 2.3 上下文压缩（按需）
  │   ├─ 2.4 组装 Prompt（System + Context Instructions + History）
  │   ├─ 2.5 解析工具列表（按 Skill allowedTools 过滤）
  │   ├─ 2.6 调用 LLM stream()
  │   │   ├─ 流式接收 text_delta → SSE event
  │   │   ├─ 流式接收 reasoning_delta → SSE event
  │   │   └─ 累积 tool_calls[]
  │   ├─ 2.7 如果 modelStep 返回 tool_calls → dispatchTools()
  │   │   ├─ 并行组 1: 只读工具 (max 3 concurrent)
  │   │   ├─ 并行组 2: 子 Agent 委托 (all concurrent)
  │   │   ├─ 串行: 非并行安全工具
  │   │   └─ 工具风暴断路器
  │   └─ 2.8 如果无 tool_calls → 完成，退出循环
  │
  ├─ 3. 后置处理
  │   ├─ 执行 TurnEnd Hook
  │   ├─ 持久化消息到 Conversation
  │   ├─ 更新 STM（滑动窗口）
  │   ├─ 自动提取 LTM 事实
  │   └─ 返回 TurnResult
```

**与 Mastra 的区别**：
- Mastra 将循环建模为 Workflow（dowhile + sequential + foreach），过度抽象
- Vico 直接实现循环逻辑，更轻量、更可控

**与 Kun 的异同**：
- 借鉴：多步循环 + 并行工具执行 + 工具风暴断路器 + Goal 恢复
- 不同：Vico 不需要 Goal 系统（面向任务的长时运行机制）

### 4.3 PromptAssembler — 系统提示词拼装

**职责**：组装发送给 LLM 的完整消息数组。

```typescript
// prompt/assembler.ts

interface PromptAssembler {
  assemble(context: PromptContext): ModelRequest;
}

interface PromptContext {
  agent: AgentConfig;           // Agent 系统提示词 + 参数
  skillCatalog: Skill[];        // 可用 Skill 列表（元数据，非完整指令）
  memoryItems: MemoryRecord[];  // STM + LTM 记忆
  ragResults: RagChunk[];       // RAG 检索结果
  history: Message[];           // 对话历史
  tools: ToolSpec[];            // 可用工具列表
  dynamicInstructions: string[]; // 动态指令（Goal、Todo 等）
}
```

**组装顺序**（参考 Kun 的 9 类固定顺序 + Mastra 的 System Prompt 组装）：

```
assemble(context):
  messages = []
  
  // 1. System Prompt（不可变前缀，可缓存）
  messages.push(system: agent.systemPrompt)
  
  // 2. Skill 目录（始终可见的可用 Skill 列表，折叠进 systemPrompt 以利用缓存）
  // 格式: <available_skills><skill><name>...</name><description>...</description>...
  // 注意：这里是元数据列表，不是完整的 Skill 指令文本
  //      完整指令需 LLM 通过 skill 工具按需加载
  messages[0] += "\n\nAvailable Skills:\n- skill_a: ...\n- skill_b: ..."
  
  // 3. 对话历史
  messages.push(...history)
  
  // 4. 动态上下文指令（放在 history 之后，避免破坏缓存）
  if (memoryItems.length)
    messages.push(system: "Relevant memories:\n- ...")
  if (ragResults.length)
    messages.push(system: "Relevant knowledge:\n...")
  // 注意：Skill 完整指令不在此处注入
  //      LLM 通过 skill 工具按需加载 Skill 指令
  if (dynamicInstructions.length)
    messages.push(system: dynamicInstructions.join("\n"))
  
  // 5. 工具目录漂移消息
  if (driftMessage)
    messages.push(system: driftMessage)
  
  return { messages, tools, modelConfig }
```

**为什么 contextInstructions 放在 history 之后**（Kun 的核心经验）：
> 动态指令（如 Memory、Skill、RAG 结果）每轮 Turn 都不同。放在 System Prompt 前面 → 每次变化都使整个对话的 Prompt 缓存失效。放在最后 → 只有变化的尾部不被缓存，前缀和历史仍可复用。

### 4.4 ModelClient — 模型抽象层

**职责**：封装 LLM 调用，提供统一接口。

```typescript
// model/model-client.ts

interface ModelClient {
  readonly provider: string;
  readonly model: string;
  
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}

interface ModelRequest {
  system?: string;
  contextInstructions?: string[];
  messages: ModelMessage[];
  tools: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: string;
  abortSignal: AbortSignal;
}

type ModelStreamChunk =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call_delta'; id: string; name: string; args: string }
  | { type: 'tool_call_complete'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'usage'; input: number; output: number }
  | { type: 'completed'; finishReason: string }
  | { type: 'error'; message: string };
```

**适配器选择**：

| 方案 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| **A. AI SDK streamText** | 成熟稳定、多 Provider 支持、Vico 已集成 | 受 AI SDK 版本演进影响 | **推荐** |
| B. 手写 HTTP 客户端（如 Kun） | 完全可控、零 SDK 依赖 | 需要维护 2600 行协议适配代码 | 不推荐 |
| C. Mastra 网关模式 | 多模型路由 | 过度设计 | 不推荐 |

**推荐方案**：复用 AI SDK 的 `streamText` + `generateText`，封装为 `ModelClient` 端口。

```typescript
// model/ai-sdk-adapter.ts

class AISDKModelClient implements ModelClient {
  constructor(private config: ModelConfig) {}
  
  async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
    const result = streamText({
      model: this.resolveProvider(),
      system: request.system,
      messages: this.toAISDKMessages(request),
      tools: this.toAISDKTools(request.tools),
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      abortSignal: request.abortSignal,
    });
    
    for await (const chunk of result.fullStream) {
      yield this.toModelChunk(chunk); // 标准化为 ModelStreamChunk
    }
  }
}
```

**关键：标准化 `ModelStreamChunk` 类型**
- 屏蔽 AI SDK 版本差异（v4/v5/v6 的 chunk 格式不同）
- 框架内部只依赖 `ModelStreamChunk`，不直接 import AI SDK 类型
- 未来 AI SDK 升级，只需修改适配器

### 4.5 ToolHost — 工具系统

**职责**：管理工具的发现、过滤、审批、执行全流程。

```typescript
// tool/tool-host.ts

interface ToolHost {
  // 列出当前上下文可用的工具
  listTools(context: ToolContext): Promise<ToolSpec[]>;
  
  // 执行工具调用
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
  
  // 批量执行（支持并行）
  executeBatch(calls: ToolCall[], context: ToolExecutionContext): Promise<ToolResult[]>;
}

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
  policy: ToolPolicy;                     // 审批策略
  kind: 'readonly' | 'command' | 'file_change' | 'delegate';
}

type ToolPolicy = 'auto' | 'on-request' | 'suggest' | 'never';

interface ToolExecutionContext {
  tenantId: string;
  userId: string;
  agentId: string;
  threadId: string;
  workspace: string;          // 工作目录
  awaitApproval: (call: ToolCall) => Promise<ApprovalDecision>;
  hooks: HookRunner[];
  signal: AbortSignal;
}
```

**工具来源聚合**（参考 Mastra 的 10+ 来源）：

```typescript
// tool/local-tool-host.ts

class LocalToolHost implements ToolHost {
  private capabilityRegistry: CapabilityRegistry;
  
  async listTools(context: ToolContext): Promise<ToolSpec[]> {
    const allTools: ToolSpec[] = [];
    
    // 1. 内置工具（始终可用）
    allTools.push(...BuiltinToolsSource.list(context));
    
    // 2. Skill 工具（skill / skill_search / skill_read，由框架提供，非 Skill 自带）
    allTools.push(...await this.skillManager.listTools(context.agentId));
    
    // 3. Memory 工具（memory_create/update/delete，按 capability 过滤）
    if (context.capabilities.memory) {
      allTools.push(...MemoryTools.list());
    }
    
    // 4. RAG 工具（search_knowledge，按 capability 过滤）
    if (context.capabilities.rag) {
      allTools.push(...RagTools.list());
    }
    
    // 5. MCP 工具（可选，按 capability 过滤）
    if (context.capabilities.mcp) {
      allTools.push(...await this.mcpProvider.listTools());
    }
    
    // 6. 按 Skill allowedTools 过滤
    return this.capabilityRegistry.filter(allTools, context);
  }
}
```

**工具执行流程**（参考 Kun 的 11 步执行 + Mastra 的 Hook 系统）：

```
execute(call, context):
  1. 从 CapabilityRegistry 解析工具
  2. policy === 'never' → 立即拒绝
  3. 执行 PreToolUse Hook → 可拒绝或修改调用
  4. 审批策略检查
     - 'auto': 自动通过
     - 'on-request': 首次使用请求用户批准
     - 'suggest': 建议确认但不强制
     - 'never': 拒绝执行
  5. 需要审批 → context.awaitApproval(call)
  6. 执行工具（支持 AbortSignal 取消）
  7. 执行 PostToolUse Hook → 可修改结果
  8. 返回 ToolResult
```

**并行执行策略**（参考 Kun）：

| 工具类型 | 并行策略 |
|---------|---------|
| 只读工具（search, read_file 等） | 最多 3 个并行 |
| 命令执行（bash 等） | 逐个串行 |
| 文件变更（write, edit 等） | 逐个串行 |
| 子 Agent 委托 | 所有委托同时并行 |

**工具风暴断路器**（参考 Kun）：
- 检测同一工具+参数的重复调用
- 连续 3 次 → 警告，连续 5 次 → 强制终止

### 4.6 Skill 系统

**职责**：遵循 [Agent Skills 规范](https://agentskills.io/specification)，基于文件系统的结构化知识注入机制。Skill 是知识（Knowledge），Tool 是动作（Action），两者严格分离。

#### 4.6.1 为什么选择 Agent Skills 规范（选项 A）

| 优势 | 说明 |
|------|------|
| **生态兼容** | 与 Claude Code、Cursor、Kun、Codex 等主流 Agent 产品共享 Skill 格式，一个 Skill 多平台通用 |
| **标准化** | SKILL.md + YAML frontmatter 是行业共识格式，社区已有大量可复用 Skill |
| **关注分离** | Skill = 知识注入，Tool = 可执行动作，边界清晰，避免 Vico 现有方案中 Skill 与 Tool 混淆 |
| **简单可靠** | 文件即数据库，无需安装/卸载流程，扫描目录即用 |

#### 4.6.2 SKILL.md 格式

每个 Skill 是一个包含 `SKILL.md` 文件的目录：

```
my-skill/
├── SKILL.md          # 核心文件：YAML 前置元数据 + Markdown 指令
├── references/       # 参考文档（可选）
│   ├── api.md
│   └── guide.md
├── scripts/          # 可执行脚本（可选）
│   └── setup.sh
└── assets/           # 图片等二进制资源（可选）
    └── diagram.png
```

**SKILL.md 格式**：

```markdown
---
name: my-skill              # 1-64 字符，小写字母+连字符
description: My skill desc  # 1-1024 字符
license: MIT                # 可选
compatibility: ">=1.0.0"    # 可选
user-invocable: true        # 可选，默认 true（是否可被用户手动调用）
metadata:                   # 可选，任意键值对
  category: code-generation
---

# Instructions content...

这里写 Markdown 指令文本，作为 Agent 的知识注入。
```

**验证规则**：

| 字段 | 约束 |
|------|------|
| `name` | 1-64 字符，`^[a-z0-9-]+$`，不能以 `-` 开头/结尾，不能有连续 `-`，必须与目录名一致 |
| `description` | 1-1024 字符，非空 |
| `license` | 可选，最长 500 字符 |
| `compatibility` | 可选，最长 500 字符 |
| `user-invocable` | 可选布尔值，控制是否在 `/skills` 命令中列出 |
| `metadata` | 可选，任意 key-value |

#### 4.6.3 核心接口

```typescript
// skill/skill-loader.ts

interface SkillLoader {
  // 发现
  discover(roots: string[]): Promise<Skill[]>;
  
  // 加载单个 Skill
  load(skillPath: string): Promise<Skill>;
  
  // 刷新（目录变化时）
  refresh(roots: string[]): Promise<void>;
}

interface Skill {
  name: string;              // 唯一标识
  description: string;       // 简短描述
  instructions: string;      // Markdown 正文（注入 LLM 的内容）
  path: string;              // 目录路径
  source: 'local' | 'external' | 'managed';  // 来源类型
  license?: string;
  compatibility?: string;
  userInvocable: boolean;
  references: string[];      // references/ 下文件列表
  scripts: string[];         // scripts/ 下文件列表
  assets: string[];          // assets/ 下文件列表
  metadata?: Record<string, string>;
}
```

#### 4.6.4 发现机制

```
discover(roots):
  for each root in roots:
    // 1. root 本身是否包含 SKILL.md？
    if root has SKILL.md:
      add root as candidate
    
    // 2. 扫描 root 的一级子目录
    for each subdirectory in root:
      if subdirectory has SKILL.md:
        add subdirectory as candidate
    
    // 3. 处理符号链接
    if subdirectory is a symlink → add resolved directory
    
  // 4. 加载每个候选项
  for each candidate:
    skill = loadSkill(candidate)
      // 解析 YAML frontmatter（使用 gray-matter）
      // 验证元数据
      // 扫描 references/ scripts/ assets/
    
  // 5. 按 name 去重（第一个胜出）
  return deduplicated by name
```

**扫描根目录优先级**（参考 Kun）：

| 优先级 | 路径 | 说明 |
|--------|------|------|
| 1 (最高) | `.agents/skills/` | 项目级 |
| 2 | `.claude/skills/` | Claude Code 兼容 |
| 3 | `.codex/skills/` | Codex 兼容 |
| 4 | `skills/` | 通用 |
| - | `~/.agents/skills/` | 全局级 |
| - | `~/.claude/skills/` | 全局 Claude Code 兼容 |

#### 4.6.5 与 Agent 集成

**两种集成模式**：

**模式 A：SkillsProcessor（提前注入）** — 适用于 Skill 数量较少时

```
Agent 首步 (stepNumber === 0)
  → skills.maybeRefresh()
  → 将所有可用 Skill 的元数据注入系统提示词
  → 格式：XML / JSON / Markdown（可配置）
```

注入的元数据格式（以 XML 为例）：
```xml
<available_skills>
  <skill>
    <name>my-skill</name>
    <description>Description here</description>
    <location>/path/to/skill</location>
    <source>local</source>
  </skill>
</available_skills>
```

同时注入系统指令：
```
Skills are NOT tools. Do not call skill names directly as tool names.
To use a skill, call the `skill` tool with the skill name as the 'name' parameter.
```

**模式 B：SkillSearchProcessor（按需发现）** — 适用于 Skill 数量较多时

```
→ 不提前注入全部 Skill 列表
→ 提供 search_skills + load_skill 元工具
→ Agent 按需搜索和加载 Skill
```

#### 4.6.6 三个核心工具

由 `createSkillTools(skills)` 创建，自动添加到 Agent 可用工具列表：

| 工具 | 功能 | 审批策略 |
|------|------|---------|
| `skill` | 按名称加载 Skill 的完整指令文本 | `auto`（无需审批） |
| `skill_search` | 跨所有 Skill 内容搜索（BM25/关键词） | `auto` |
| `skill_read` | 读取 Skill 的 references/scripts/assets 中的文件 | `auto` |

```typescript
// skill 工具
{ name: 'skill', parameters: { name: string, source?: string } }
// 返回: { instructions: string, references: string[], scripts: string[], assets: string[] }

// skill_search 工具  
{ name: 'skill_search', parameters: { query: string, limit?: number } }
// 返回: [{ snippet: string, score: number, skillName: string, filePath: string }]

// skill_read 工具
{ name: 'skill_read', parameters: { skillName: string, filePath: string, startLine?, endLine? } }
// 返回: { content: string }
```

**关键设计**：
- **无状态**：不跟踪激活状态，Skill 指令只作为历史消息加载
- **无需审批**：所有 Skill 工具 `requireApproval: false`
- **不暴露为直接 Tool 名**：Skill 名称不作为独立 Tool，避免与可执行工具混淆

#### 4.6.7 激活机制

```typescript
// Skill 的两种使用方式

// 方式 A：绑定式
// Agent 在 DB 中绑定 Skill → 该 Skill 的元数据始终注入系统提示词
agent_skills 表: { agent_id, skill_id }

// 方式 B：触发式（借鉴 Kun）
// Skill 定义 triggers → 运行时按用户输入自动匹配激活
// 注意：Agent Skills 规范本身未定义 triggers，Vico 作为扩展实现
{
  "triggers": {
    "commands": ["/review"],
    "promptPatterns": ["代码审查", "code review"],
    "fileTypes": [".ts", ".tsx"]
  }
}
```

#### 4.6.8 与旧 Vico Skill 方案的迁移

| 维度 | 旧方案 (manifest.json + tools.ts) | 新方案 (SKILL.md) |
|------|------|------|
| Skill 定义 | `manifest.json` 元数据 + `prompt.md` 指令 + `tools.ts` 可执行工具 | `SKILL.md`（YAML frontmatter + Markdown 指令） |
| 工具 | 每个 Skill 可导出任意多个 SkillTool | **无**。Skill 是纯知识。工具在框架 Tool 层独立注册 |
| 资源文件 | `resources/` 目录 | `references/` + `scripts/` + `assets/` |
| 跨平台兼容 | 仅 Vico | Claude Code、Cursor、Kun、Codex 等通用 |

**迁移策略**：
- 将现有 Skill 的 `prompt.md` 内容合并到 `SKILL.md` Markdown 正文
- 将 `manifest.json` 中的元数据映射到 `SKILL.md` YAML frontmatter
- 将 `tools.ts` 中的工具提取到框架 Tool 层的独立工具注册（不再与 Skill 耦合）

### 4.7 Memory 系统

**职责**：双层记忆 + RAG 知识库。

```typescript
// memory/memory-store.ts

interface MemoryStore {
  // 短期记忆（滑动 FIFO 窗口）
  stm: {
    push(threadId: string, message: Message): void;
    get(threadId: string, window: number): Message[];
  };
  
  // 长期记忆（向量检索）
  ltm: {
    search(query: string, tenantId: string, limit?: number): Promise<MemoryRecord[]>;
    create(record: MemoryRecord): Promise<void>;
    update(id: string, patch: Partial<MemoryRecord>): Promise<void>;
    delete(id: string): Promise<void>;
  };
  
  // RAG
  rag: {
    search(query: string, knowledgeBaseId: string, limit?: number): Promise<RagChunk[]>;
  };
}
```

**对比分析**：

| 维度 | Kun | Mastra | Vico（新框架） |
|------|-----|--------|---------------|
| 短期记忆 | 无独立模块 | Working Memory (Key-Value/Schema) | FIFO 窗口（现有） |
| 长期记忆 | N-gram 文本匹配 | 3-Agent 观察记忆（Actor/Observer/Reflector） | 向量嵌入 + 余弦相似度（现有） |
| RAG | 无 | Semantic Recall | 混合搜索 70/30（现有） |
| 嵌入 | 无 | FastEmbed (ONNX) + API | Transformers.js + OpenAI（现有） |
| 事实提取 | LLM 手动调用工具 | 异步 Observer Agent | 正则自动提取（现有） |

**决策**：保持 Vico 现有记忆系统架构，将其封装到 `MemoryStore` 端口背后。Mastra 的 3-Agent 观察记忆过于复杂，Kun 的 N-gram 过于简陋，Vico 现有方案（向量 + 正则自动提取）是最佳平衡。

### 4.8 Hook 系统

**职责**：在 Agent 生命周期关键节点插入自定义逻辑。

```typescript
// hook/hook-types.ts

type HookEvent = 
  | 'turn:start' | 'turn:end'
  | 'tool:before' | 'tool:after'
  | 'prompt:submit'
  | 'compact:before' | 'compact:after';

interface HookResult {
  action: 'continue' | 'modify' | 'deny';
  modifiedData?: unknown;
  message?: string;
}

interface HookRunner {
  event: HookEvent;
  run(data: unknown): Promise<HookResult>;
}
```

**参考来源**：
- Kun：完整生命周期 Hook（PreToolUse/PostToolUse/TurnStart/TurnEnd/PreCompact/UserPromptSubmit），外部脚本可观察或拒绝/修改操作
- Mastra：用 Workflow Step 中间件 + Tool Hooks（beforeToolCall/afterToolCall）

### 4.9 ContextCompactor — 上下文压缩

**职责**：当上下文超出 Token 预算时，自动压缩历史消息。

```typescript
// agent-loop/context-compactor.ts

interface ContextCompactor {
  compactIfNeeded(items: Message[], model: ModelClient, signal: AbortSignal): Promise<{
    compacted: Message[];       // 压缩后的消息（含摘要）
    wasCompacted: boolean;
    removedTokens: number;
  }>;
}
```

**压缩策略**（参考 Kun）：

```
compactIfNeeded(items):
  // 1. 估算当前 Token 数
  estimated = estimateTokens(items)
  
  // 2. 判断是否需要压缩
  if (estimated < softThreshold) return { compacted: items, wasCompacted: false }
  
  // 3. 分割：head(旧) + tail(最近 keepRecent 条)
  head = items.slice(0, -keepRecent)
  tail = items.slice(-keepRecent)
  
  // 4. 生成摘要
  summaryItem = await generateSummary(head, model)
  
  // 5. 保留 Pin（Skill 标记、系统约束）
  pins = extractPins(head)
  
  // 6. 返回 [frozen..., summaryItem, pins..., ...tail]
  return { compacted: [...pins, summaryItem, ...tail], wasCompacted: true }
```

### 4.10 Observable — 可观测性

**职责**：追踪 Agent 执行过程，记录 Span 和事件。

```typescript
// observable/event-recorder.ts

interface SpanTracker {
  startSpan(type: SpanType, metadata: Record<string, unknown>): Span;
}

interface Span {
  id: string;
  end(result?: Record<string, unknown>): void;
  error(error: Error): void;
}

type SpanType = 
  | 'agent_run' | 'model_step' | 'tool_call' | 'memory_retrieval'
  | 'rag_search' | 'skill_activation' | 'context_compaction';

interface EventRecorder {
  emit(event: SSEEvent): void;
  on(event: string, handler: (data: unknown) => void): void;
}
```

---

## 五、框架实现路径

### Phase 1：基础骨架（4-6 周）

**目标**：搭建框架骨架，验证架构可行性。

| 任务 | 内容 | 优先级 |
|------|------|--------|
| 1.1 创建 `@vico/agent` 包 | monorepo 新包，独立于 server/web | P0 |
| 1.2 定义全部端口（Ports） | ModelClient / ToolHost / MemoryStore / SkillLoader / SessionStore / HookRunner / EventRecorder | P0 |
| 1.3 实现 AgentRuntime | 动态 Agent 创建/销毁/缓存，与 DB 联动 | P0 |
| 1.4 实现 PromptAssembler | 组装顺序：System Prompt + History + Context Instructions | P0 |
| 1.5 实现 AISDKModelClient | 封装 AI SDK streamText，标准化 ModelStreamChunk | P0 |
| 1.6 实现 AgentLoop 基础版 | runTurn → modelStep → dispatchTools（不含压缩/审批/Hook） | P0 |
| 1.7 适配现有 chat API | 将 `packages/server/src/api/chat.ts` 切换到新框架 | P0 |

**验收标准**：现有聊天功能在新框架下跑通，无功能回退。

### Phase 2：工具与 Skill（3-4 周）

| 任务 | 内容 | 优先级 |
|------|------|--------|
| 2.1 实现 LocalToolHost | 工具聚合 + 审批策略（auto/on-request/suggest/never） | P0 |
| 2.2 实现 CapabilityRegistry | 按 capability + Skill allowedTools 过滤 | P0 |
| 2.3 工具并行执行 | 只读并行(3) + 命令串行 + 委托并行 | P1 |
| 2.4 工具风暴断路器 | 重复检测 + 强制终止 | P2 |
| 2.5 实现 FSSkillLoader | SKILL.md 扫描 + YAML 解析 + gray-matter | P0 |
| 2.6 实现 Skill 工具 | skill / skill_search / skill_read 三个工具 | P0 |
| 2.7 SkillsProcessor | 提前注入模式（<available_skills> XML/JSON/Markdown） | P1 |
| 2.8 Skill 迁移工具 | 旧 manifest.json → 新 SKILL.md 格式转换脚本 | P1 |

### Phase 3：记忆与上下文（2-3 周）

| 任务 | 内容 | 优先级 |
|------|------|--------|
| 3.1 MemoryStore 端口实现 | STM(FIFO) + LTM(Vector) + RAG(Hybrid) 统一封装 | P0 |
| 3.2 ContextCompactor 实现 | 启发式阈值 + LLM 摘要 + Skill Pin 保留 | P1 |
| 3.3 TokenEconomy 实现 | 工具输出截断 + 累计预算(120K) + 历史卫生 | P2 |
| 3.4 不可变前缀管理 | SHA256 指纹 + 挥发性检测 | P2 |

### Phase 4：高级特性（2-3 周）

| 任务 | 内容 | 优先级 |
|------|------|--------|
| 4.1 Hook 系统 | Turn/PreToolUse/PostToolUse Hook | P2 |
| 4.2 可观测性 | SpanTracker + EventRecorder | P1 |
| 4.3 审批交互 | SSE 审批事件 + 前端审批 UI | P1 |
| 4.4 子 Agent 委托 | ChildAgentExecutor(只读/继承策略) | P2 |

### Phase 5：清理与迁移（1-2 周）

| 任务 | 内容 | 优先级 |
|------|------|--------|
| 5.1 移除 Mastra 依赖 | 清理 `packages/server` 中的 Mastra import | P0 |
| 5.2 更新配置文件 | 移除 Mastra 相关配置项 | P0 |
| 5.3 测试覆盖 | 核心模块单元测试 + E2E 冒烟测试 | P1 |

---

## 六、底层包选型

### 6.1 复用现有依赖

| 包 | 用途 | 复用理由 |
|------|------|---------|
| `ai` (Vercel AI SDK v4) | LLM 调用 | Vico 已集成，成熟稳定，多 Provider 支持 |
| `@ai-sdk/openai` | OpenAI 兼容 Provider | 支持 DeepSeek、通义千问等兼容 API |
| `@ai-sdk/anthropic` | Anthropic Provider | Claude 模型支持 |
| `hono` 4 | HTTP 框架 | Vico 后端已使用 |
| `drizzle-orm` + `better-sqlite3` | ORM + 数据库 | Vico 已使用，WAL 模式 |
| `better-auth` | 认证 | Vico 已使用 |
| `zod` | Schema 校验 | Vico 已使用，框架 Contract 层需要 |
| `@xenova/transformers` | 本地嵌入 | Vico 已使用 |
| `pino` | 日志 | 可选 |

### 6.2 新增依赖评估

| 包 | 用途 | 是否引入 | 理由 |
|------|------|---------|------|
| `fastembed` (ONNX) | 本地嵌入替代 | **可选** | 比 Transformers.js 更快更轻，384d/768d 可选。但引入 ONNX Runtime 依赖 |
| `mitt` | EventEmitter | **引入** | 极轻量（200 bytes），用于 Hook 事件和内部事件总线 |
| `p-limit` | 并发控制 | **引入** | 工具并行执行需要，更可靠的并发限制 |
| `@modelcontextprotocol/sdk` | MCP 协议 | **可选** | 未来支持 MCP 工具时引入 |

### 6.3 不引入的包

| 包 | 不引入理由 |
|------|------|
| LangChain / CrewAI / AutoGPT | Vico 目标是轻量自研，不做框架绑定 |
| OpenAI SDK / Anthropic SDK | 通过 AI SDK 统一抽象 |
| 任何向量数据库 (Pinecone/Chroma/Qdrant 等) | sqlite 的向量扩展足够当前规模 |
| 任何工作流引擎 (Temporal/Inngest) | AgentLoop 内建循环即可 |
| Express / Fastify / Koa | 已有 Hono |
| Redis / PostgreSQL | Vico 定位 SQLite 单机部署 |

---

## 七、关键架构决策记录

### 决策 1：AgentLoop 用循环而非工作流

**选项 A**：像 Mastra 一样用 Workflow 引擎（dowhile + sequential + foreach）
**选项 B**：像 Kun 一样直接写循环逻辑

**选择 B**。理由：
- Mastra 的工作流方式将简单循环抽象为事件驱动步骤链，调试困难
- Vico 不需要 suspend/resume（Mastra 工作流引擎的核心价值）
- 循环逻辑更直观、更易维护、性能更好

### 决策 2：复用 AI SDK 而非手写 HTTP 客户端

**选项 A**：像 Kun 手写 CompatModelClient（2600 行）
**选项 B**：复用 AI SDK streamText

**选择 B**。理由：
- AI SDK 已经稳定，支持多 Provider，处理了流式解析、错误重试等细节
- 手写客户端收益（Prompt 缓存精细控制）可以通过 PromptAssembler 层的不可变前缀管理达到
- Vico 不像 Kun 需要支持 6 种推理协议转换

### 决策 3：使用 Ports & Adapters 而非 Mastra IoC

**选项 A**：像 Mastra 的 Mastra 类（11 个泛型参数，集中注册）
**选项 B**：像 Kun 的 Ports & Adapters + 工厂装配

**选择 B**。理由：
- Ports & Adapters 天然支持动态替换（测试时注入 Mock 实现）
- Mastra IoC 依赖 `__registerMastra` / `__registerPrimitives` 的双向绑定，组件与容器耦合
- AgentRuntime 只需要简单的工厂模式，不需要完整的 IoC 容器

### 决策 4：Skill 系统采用 Agent Skills 规范（SKILL.md）

**选项 A**：像 Mastra 用 SKILL.md（遵循 Agent Skills 规范，纯知识注入）
**选项 B**：像 Kun 用 skill.json + SKILL.md（触发器匹配）
**选项 C**：保持 Vico 现有方案（manifest.json + prompt.md + tools.ts）

**选择 A**。理由：
- **生态兼容性**：SKILL.md 是 Agent Skills 规范的行业标准格式，Claude Code、Cursor、Kun、Codex 等主流 Agent 产品共享此格式。Vico 采用后可直接使用社区大量已有 Skill，无需改造
- **关注分离**：Skill = 知识（Knowledge），Tool = 动作（Action），两者严格分离。旧方案中 tools.ts 耦合在 Skill 内部，界限模糊
- **简单可靠**：文件即数据库，YAML frontmatter + Markdown，人可直接阅读和编辑
- **旧方案迁移**：将 tools.ts 中的可执行工具提取到框架 Tool 层独立注册，不再与 Skill 耦合，架构反而更清晰

### 决策 5：记忆系统融合而非替换

保持 Vico 现有三层记忆（STM + LTM + RAG），封装到统一 `MemoryStore` 端口。Kun 和 Mastra 的记忆架构对 Vico 规模而言要么太简陋要么太复杂。

---

## 八、包结构规划

```
packages/
├── server/                  # 现有后端（逐步将 Agent 逻辑迁移到 @vico/agent）
│   └── src/
│       ├── api/             # Hono 路由（调用 @vico/agent 的 AgentRuntime）
│       ├── auth/
│       ├── db/
│       └── config.ts
│
├── agent/                   # NEW: @vico/agent 框架包
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts         # 统一导出
│       │
│       ├── agent-runtime/   # Agent 运行时容器（动态管理）
│       │   ├── agent-runtime.ts    # 单例：创建/销毁/查找 Agent 实例
│       │   └── agent-config.ts     # Agent 配置类型（从 DB 加载）
│       │
│       ├── agent-loop/      # Agent 循环引擎（核心）
│       │   ├── agent-loop.ts        # 主循环：runTurn → modelStep → dispatchTools
│       │   ├── context-compactor.ts # 上下文压缩（启发式 + LLM 摘要）
│       │   ├── token-economy.ts     # Token 经济管理
│       │   └── approval-gate.ts     # 审批门控
│       │
│       ├── prompt/          # 系统提示词拼装
│       │   ├── assembler.ts         # 组装系统 prompt
│       │   └── immutable-prefix.ts  # 不可变前缀管理（Prompt 缓存优化）
│       │
│       ├── model/           # 模型抽象层
│       │   ├── model-client.ts      # 抽象端口
│       │   ├── ai-sdk-adapter.ts    # AI SDK 适配器实现
│       │   └── model-registry.ts    # 模型注册表（从 DB 加载）
│       │
│       ├── tool/            # 工具系统
│       │   ├── tool-host.ts         # 抽象端口
│       │   ├── local-tool-host.ts   # 工具执行器（审批+策略+并行）
│       │   ├── capability-registry.ts # 能力注册表
│       │   └── builtin-tools-source.ts     # 内置工具
│       │
│       ├── skill/           # Skill 插件系统
│       │   ├── skill-loader.ts      # 抽象端口
│       │   ├── fs-skill-loader.ts   # 文件系统加载器
│       │   ├── skill-manager.ts     # 单例管理器
│       │   └── skill-tools.ts       # skill / skill_search / skill_read 工具
│       │
│       ├── memory/          # 记忆系统
│       │   ├── memory-store.ts      # 抽象端口
│       │   ├── short-term-memory.ts # 短期记忆（FIFO 窗口）
│       │   ├── long-term-memory.ts  # 长期记忆（向量检索）
│       │   ├── rag-manager.ts       # RAG 知识库
│       │   └── embedder.ts          # 嵌入器抽象 + 适配器
│       │
│       ├── hook/            # 生命周期 Hook
│       │   ├── hook-runner.ts       # Hook 执行引擎
│       │   └── hook-types.ts        # PreToolUse/PostToolUse/TurnStart 等
│       │
│       ├── session/         # 会话/存储
│       │   ├── session-store.ts     # 会话持久化端口
│       │   ├── conversation-store.ts # 对话记录存储
│       │   └── message-store.ts     # 消息存储
│       │
│       ├── contracts/       # Zod Schema 定义
│       │   ├── agent.ts
│       │   ├── tool.ts
│       │   ├── memory.ts
│       │   └── events.ts
│       │
│       └── observable/      # 可观测性
│           ├── span-tracker.ts      # Span 追踪
│           ├── event-recorder.ts    # SSE 事件广播
│           └── usage-tracker.ts     # Token 用量统计
│
├── web/                     # 前端（不变）
└── skills/                  # Skill 插件（不变）
```

---

## 九、风险评估与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| AI SDK 大版本升级后适配器失效 | 中 | 高 | 标准化 `ModelStreamChunk`，仅适配器层修改，框架无感 |
| AgentLoop 复杂度控制不足 | 中 | 高 | 严格参考 Kun 的 AgentLoop 2400 行上限，避免膨胀到 Mastra 的 302KB |
| 内存泄漏（Agent 实例未正确清理） | 低 | 高 | LRU 自动淘汰 + AbortSignal 传播 + WeakMap 引用 |
| 性能退化（切换后响应变慢） | 低 | 中 | Phase 1 完成即进行性能对比测试 |
| 迁移工作量超预期 | 中 | 中 | Phase 分步推进，每 Phase 有明确验收标准，可随时暂停 |

---

## 十、总结

这个框架设计方案：

1. **从 Kun 汲取**：Ports & Adapters 架构、AgentLoop 多步循环、工具并行执行、审批策略分级、上下文压缩、Prompt 缓存策略、Hook 生命周期
2. **从 Mastra 汲取**：Agent Skills 规范（SKILL.md）、工具来源聚合模式、可观测性 Span 类型
3. **保留 Vico 优势**：AI SDK 集成、Hono + Drizzle + better-auth 基础设施、三层记忆系统
4. **解决核心问题**：动态 Agent 创建/销毁（Mastra 缺失的能力）、轻量化（去掉 302KB 的 agent.ts 和 157KB 的 workflow.ts）
5. **最小化新增依赖**：仅引入 `mitt`（事件）和 `p-limit`（并发控制），其余全部复用现有依赖
