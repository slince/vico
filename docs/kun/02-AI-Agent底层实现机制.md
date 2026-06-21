# Kun AI Agent 底层实现机制

## 一、Agent 定义体系

Kun 的 Agent 有两层定义：

### 1.1 GUI 层：AgentProvider 接口

文件：`src/renderer/src/agent/types.ts`

这是渲染进程与 Agent 运行时交互的抽象接口。定义了约 30 个操作：

```typescript
export interface AgentProvider {
  readonly id: 'kun'
  readonly displayName: string

  // 能力查询
  getCapabilities(): {
    interrupt: boolean
    stream: boolean
    approvals: boolean
    steering: boolean
    plans: boolean
    goals: boolean
    // ...
  }

  // 连接管理
  connect(): Promise<void>

  // Thread CRUD
  listThreads(options?): Promise<NormalizedThread[]>
  createThread(input): Promise<NormalizedThread>
  archiveThread(id): Promise<void>
  deleteThread(id): Promise<void>
  forkThread(id, options?): Promise<NormalizedThread>

  // 消息发送（核心）
  sendUserMessage(threadId, text, options?): Promise<{
    turnId: string
    threadId: string
    status: 'completed' | 'failed' | 'aborted'
  }>

  // 实时事件订阅
  subscribeThreadEvents(threadId, sinceSeq, sink, signal): Promise<void>

  // 审批交互
  submitApproval(approvalId, decision): Promise<void>
  submitUserInput(inputId, text): Promise<void>

  // 干预/引导
  interruptTurn(threadId, turnId): Promise<void>
  steerTurn(threadId, turnId, text): Promise<void>

  // 计划/目标/Todo
  // ...（约 30 个方法）
}
```

### 1.2 运行时层：AgentLoop 类

文件：`kun/src/loop/agent-loop.ts`（约 2400 行）

这是真正的 Agent 执行引擎。核心构造函数参数：

```typescript
interface AgentLoopOptions {
  model: ModelClient              // LLM 适配器
  toolHost: ToolHost              // 工具执行端口
  prefix: ImmutablePrefix         // 不可变系统提示词前缀
  turns: TurnService              // Turn 持久化
  threadStore: ThreadStore        // Thread 存储
  sessionStore: SessionStore      // Session 存储
  events: RuntimeEventRecorder    // SSE 事件广播
  compactor: ContextCompactor     // 上下文压缩引擎
  approvalGate?: ApprovalGate     // 审批门控
  userInputGate?: UserInputGate   // 用户输入门控
  skillRuntime?: SkillRuntime     // Skill 系统（可选）
  memoryStore?: MemoryStore       // 记忆存储（可选）
  attachmentStore?: AttachmentStore
  forcedAllowedToolNames?: string[]  // 子 Agent 只读工具限制
  hooks?: HookRunner[]            // 生命周期 Hooks
  goalResume?: GoalResumeConfig   // Goal 自动恢复配置
}
```

### 1.3 子 Agent/子任务定义

文件：`kun/src/delegation/builtin-profiles.ts`

```typescript
export const DESIGN_REVIEWER_PROFILE: SubagentProfileConfig = {
  toolPolicy: 'readOnly',   // 只读工具
  promptPreamble: '你是 Kun 内置的设计审查者，专注于代码设计质量审查...'
}

// 只读工具列表
const SUBAGENT_READ_ONLY_TOOL_NAMES = ['read', 'grep', 'find', 'ls']
```

子 Agent 策略：
- `readOnly`: 只能使用只读工具，不能修改文件
- `inherit`: 继承父 Agent 的全部工具

---

## 二、Agent Loop 核心执行流程

### 2.1 整体状态机

```
                    ┌─────────────┐
    用户输入 ──────→│  runTurn()  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  前置处理    │
                    │ - Goal 计时器 │
                    │ - TurnStart Hook│
                    │ - UserPromptSubmit│
                    │ - 注入引导文本  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
               ┌───→│  modelStep() │←──┐
               │    │ (最多 64 步)  │   │
               │    └──────┬──────┘   │
               │           │           │
               │    ┌──────▼──────┐   │
               │    │  工具调用？   │   │
               │    └──┬───────┬──┘   │
               │   是 │       │ 否    │
               │      │       └──→ 完成
               │ ┌────▼────┐        │
               └─│dispatch │        │
                 │ToolCalls│────────┘
                 └─────────┘
                      ↓
              ┌──────────────┐
              │  Goal 自动恢复 │
              │  (失败时触发)  │
              └──────────────┘
```

### 2.2 入口方法：runTurn()

文件：`kun/src/loop/agent-loop.ts` 第 566 行

```typescript
async runTurn(threadId: string, turnId: string): Promise<'completed' | 'failed' | 'aborted'>
```

阶段：

**阶段 1：前置处理**
1. 启动 Goal 计时器（如果该 Thread 有活跃 Goal）
2. 执行 TurnStart 生命周期 Hook（只读观察）
3. 执行 UserPromptSubmit Hook（**可以否决**整个 Turn，返回 `hook_denied`）
4. 排干待处理的引导文本（用户中途修正注入）

**阶段 2：内循环 loop()**（第 938-975 行）
```typescript
for (let step = 0; step < MAX_TURN_MODEL_STEPS; step++) {
  const result = await this.modelStep(threadId, turnId, signal, step)
  if (result === 'stop') break
  // 检查 goal，检查 abort
}
```

每次迭代调用 `modelStep()`，最多 `MAX_TURN_MODEL_STEPS = 64` 步。

**阶段 3：每步 modelStep()**（第 977-1622 行）

这是 Agent 的核心，每个步骤执行以下操作：

```
 1. 验证不可变前缀完整性
 2. 加载 Thread/Turn 状态
 3. 检查用量预算门控
 4. 首步时修复历史记录中的损坏项
 5. 检查工具目录漂移（tools changed between turns?）
 6. 解析模型路由（auto-model-router）
 7. 解析附件、Skills、Memories
 8. 构建上下文指令：
    - Goal 继续指令
    - Goal 无工具重复恢复指令
    - Todo 继续指令
    - 空 Post-Tool 恢复指令
    - Memory 上下文注入
    - Skill 指令
    - Shell 运行时指令
    - 工具目录漂移消息
 9. 构建工具上下文并列出可用工具
10. Plan 模式工具限制（仅只读 + create_plan）
11. 上下文压缩（按需触发）
12. 应用 Token 经济+历史卫生
13. 发送请求到 LLM 并流式接收响应
14. 物化缺失的 Plan 工具调用
15. 处理空响应/循环响应恢复
```

### 2.3 LLM 流式交互

文件：`kun/src/loop/agent-loop.ts` 第 1270-1405 行

```typescript
for await (const chunk of this.opts.model.stream(request)) {
  switch (chunk.type) {
    case 'assistant_text_delta':     // 文本增量
    case 'assistant_reasoning_delta': // 推理增量（思维链）
    case 'tool_call_delta':          // 工具调用参数增量
    case 'tool_call_complete':       // 工具调用完整
    case 'usage':                    // Token 用量
    case 'completed':                // 完成
    case 'error':                    // 错误
  }
}
```

### 2.4 工具调用分发

文件：`kun/src/loop/agent-loop.ts` 第 1624-1753 行

**并行度控制：**

| 工具类型 | 并行策略 |
|---------|---------|
| `delegate_task`（子 Agent） | 所有委托调用同时并行发出 |
| 内置只读工具（read, grep, find, ls） | 最多 **3** 个并行 |
| 非并行安全调用 | 逐个串行执行 |
| **工具风暴断路器** | 检测并抑制重复相同调用 |

**执行模型：**
```
Model Response → 解析 tool_calls[] → 批量 dispatch
  ├── 并行组 1: [read fileA, grep fileB, find fileC] (最多 3)
  ├── 等待全部完成
  ├── 并行组 2: [read fileD, ls dirA]
  ├── 串行调用: [bash "rm dangerous"]
  └── 累积结果，追加到 history → 下一轮 modelStep()
```

### 2.5 Goal 自动恢复

文件：`kun/src/loop/agent-loop.ts` 第 831-916 行

当带有活跃 Goal 的 Thread 的 Turn 失败时：
1. `evaluateGoalResume()` 评估是否自动发起续接 Turn
2. 使用指数退避延迟
3. 最大无进展尝试次数限制（`DEFAULT_MAX_GOAL_RESUME_NO_PROGRESS_ATTEMPTS`）
4. 超过限制后将 Goal 设为 `blocked` 状态
5. 运行时重启也会触发 `resumeInterruptedGoals()` 恢复被中断的 Goal

### 2.6 空响应/循环恢复

- **空 Post-Tool 恢复**：工具结果返回后 LLM 没有产生有效输出时，自动重试最多 1 步
- **Goal 无工具重复恢复**：Goal 连续产生无工具文本时，通过相似度检测判断是否卡住，最多 3 次恢复

---

## 三、子 Agent 委托系统

### 3.1 子 Agent 创建

文件：`kun/src/delegation/child-agent-executor.ts`

```typescript
createChildAgentExecutor({
  model,           // 共享父 Agent 的模型客户端
  toolHost,        // 共享父 Agent 的工具执行器
  skillRuntime,    // 共享 Skill 系统
  // ...
})

// 创建子 Agent：
// 1. 创建内存存储（session, thread, events）
// 2. 构建全新 AgentLoop 实例
// 3. ReadOnly 子 Agent：forcedAllowedToolNames = ['read','grep','find','ls']
// 4. 运行单 Turn：创建 thread → 开始 turn → loop.runTurn() → 汇总结果
```

### 3.2 委托运行时

文件：`kun/src/delegation/delegation-runtime.ts`

```typescript
class DelegationRuntime {
  // 并行槽信号量：最多 maxParallel 个并发子 Agent
  // 超出容量的委托进入 FIFO 队列
  // 每个父 Thread 有 maxChildRuns 上限
  // 支持多种 SubagentProfile 配置
  // 子运行结果持久化到 FileDelegationStore（JSON 文件）
}
```

---

## 四、工具系统详解

### 4.1 工具定义

文件：`kun/src/adapters/tool/local-tool-host.ts`

```typescript
type LocalTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>     // JSON Schema
  toolKind: 'tool_call' | 'command_execution' | 'file_change'
  policy: 'auto' | 'on-request' | 'suggest' | 'never' | 'untrusted'
  shouldAdvertise?: (context: ToolHostContext) => boolean
  execute: (args, context, onUpdate?) => Promise<{ output, isError? }>
}
```

### 4.2 工具执行流程（LocalToolHost）

文件：`kun/src/adapters/tool/local-tool-host.ts` 第 85-252 行

```
execute(call, context):
  1. 从 CapabilityRegistry 解析工具
  2. policy === 'never' → 立即拒绝
  3. Sanbox 模式检查 → 拒绝不允许的工具
  4. PreToolUse Hook → 可拒绝或修改调用
  5. 读前编辑守卫验证
  6. 审批策略检查 → approval_policy_blocked ?
  7. 需要审批 → 请求用户批准（context.awaitApproval）
  8. 执行工具（支持 AbortSignal 取消和 onUpdate 流式更新）
  9. PostToolUse Hook → 可修改结果
 10. 应用速率限制
 11. 更新读追踪器
```

### 4.3 内置工具（7 个核心工具）

文件：`kun/src/adapters/tool/builtin-tools-source.ts`

| 工具 | 功能 | 类型 |
|------|------|------|
| `read` | 读取文件内容 | 只读 |
| `bash` | 执行 Shell 命令 | 命令执行 |
| `edit` | 精确字符串替换编辑文件 | 文件变更 |
| `write` | 创建/覆写文件 | 文件变更 |
| `grep` | 正则搜索文件内容 | 只读 |
| `find` | 按名称模式查找文件 | 只读 |
| `ls` | 列出目录内容 | 只读 |
| `lsp` | 语言服务器协议支持（可选） | 只读 |

### 4.4 扩展工具 Provider

文件：`kun/src/adapters/tool/` 目录

| Provider | 工具 | 能力开关 |
|----------|------|---------|
| `mcp-tool-provider.ts` | MCP 服务器提供的全部工具 | `capabilities.mcp` |
| `web-tool-provider.ts` | `web_search`, `web_fetch` | `capabilities.web` |
| `skill-tool-provider.ts` | `load_skill` | `capabilities.skills` |
| `memory-tool-provider.ts` | `memory_create`, `memory_update`, `memory_delete` | `capabilities.memory` |
| `delegation-tool-provider.ts` | `delegate_task` | `capabilities.subagents` |
| `image-gen-tool-provider.ts` | 图像生成 | 对应 capability |
| `media-gen-tool-provider.ts` | 语音/音乐/视频生成 | 对应 capability |
| `computer-use-tool-provider.ts` | 桌面自动化控制 | `capabilities.computerUse` |
| `goal-tools.ts` | `get_goal`, `update_goal` | 始终可用 |
| `todo-tools.ts` | `todo_list`, `todo_write` | 始终可用 |
| `create-plan-tool.ts` | `create_plan` | Plan 模式专用 |

### 4.5 能力注册表（CapabilityRegistry）

文件：`kun/src/adapters/tool/capability-registry.ts`

工具按 Provider 组织，Provider 种类包括：
```typescript
type ToolProviderKind =
  | 'built-in' | 'mcp' | 'web' | 'skill'
  | 'memory' | 'gui' | 'delegation'
  | 'image' | 'audio' | 'video'
```

注册表负责：
- 按上下文过滤工具（启用的能力、Sandbox 模式、shouldAdvertise、allowed-tool-names）
- Skill 工具允许列表交叉
- MCP 工具搜索模式（大量工具时折叠为搜索入口）

---

## 五、LLM 集成

### 5.1 ModelClient 端口

文件：`kun/src/ports/model-client.ts`

```typescript
interface ModelClient {
  readonly provider: string
  readonly model: string
  stream(request: ModelRequest): AsyncIterable<ModelStreamChunk>
}

interface ModelRequest {
  system?: string
  modeInstruction?: string
  contextInstructions?: string[]
  prefixItems?: ModelMessage[]
  historyItems: ModelMessage[]
  toolSpecs: ToolSpec[]
  requiredToolName?: string
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
  abortSignal?: AbortSignal
}
```

### 5.2 CompatModelClient 实现

文件：`kun/src/adapters/model/compat-model-client.ts`（约 2600 行）

特点：
- **零第三方 AI SDK 依赖**：不依赖 openai、@anthropic-ai/sdk 等任何 AI SDK
- **手写 HTTP 客户端**：使用原始 `fetch` + `POST`
- **多协议支持**：
  - OpenAI Chat Completions (`/v1/chat/completions`) — 默认
  - OpenAI Responses (`/v1/responses`)
  - Anthropic Messages (`/v1/messages`)
- **流式处理**：手写 SSE（Server-Sent Events）解析器
- **重试机制**：502/503/504 瞬态故障最多重试 2 次，指数退避
- **流空闲超时**：默认 45 秒，可配置
- **代理支持**：通过 `proxy-agent` 自动检测 HTTP 代理
- **Prompt 缓存标记**：Anthropic `cache_control` 支持
- **推理/思考协议翻译**：支持 DeepSeek、GLM、MiMo、Anthropic Thinking 多种推理协议转换
- **工具调用修复**：自动修复格式不正确的工具调用参数

### 5.3 推理协议支持

文件：`kun/src/contracts/capabilities.ts` 第 47-62 行

```typescript
type ReasoningProtocol =
  | 'none'
  | 'deepseek-chat-completions'
  | 'glm-chat-completions'
  | 'mimo-chat-completions'
  | 'openai-responses'
  | 'anthropic-thinking'
```

### 5.4 默认模型配置

```typescript
// kun/src/config/kun-config.ts
const DEFAULT_MODEL = 'deepseek-v4-pro'
const DEFAULT_BASE_URL = 'https://api.deepseek.com/beta'
```

---

## 六、子 Agent 完整调用链

```
用户：请审查我的代码设计

AgentLoop.runTurn()
  └→ modelStep()
      └→ LLM 决定调用 delegate_task(profile="design_reviewer", prompt="...")
          └→ dispatchToolCalls()
              └→ DelegationRuntime.execute()
                  └→ createChildAgentExecutor()
                      └→ 创建 InMemoryStores
                      └→ 创建新 AgentLoop(forcedAllowedToolNames=['read','grep','find','ls'])
                      └→ 创建 Turn，调用 loop.runTurn()
                      └→ 子 Agent 只读审查代码
                      └→ 返回审查结果摘要
                  └→ 结果注入父 Agent 上下文
          └→ 下一轮 modelStep() 处理审查结果
```

---

## 七、关键设计特点总结

1. **自研型 Agent 引擎**：没有使用 LangChain、AutoGPT、CrewAI 等框架，完全自研
2. **Ports & Adapters 架构**：高度可测试、可替换
3. **多步循环（Multi-Step Loop）**：每 Turn 最多 64 个模型步骤，支持复杂多步推理
4. **并行工具执行**：最大限度地并行化只读操作
5. **工具风暴断路器**：防止 LLM 陷入工具调用死循环
6. **Goal 自动恢复**：失败后自动续接，支持长时间运行的任务
7. **子 Agent 委托**：支持并行子任务，具有只读/继承两种策略
8. **上下文压缩**：Token 经济管理，混合使用启发式和模型总结
9. **Plan 模式**：先规划后执行，计划阶段限制工具集
10. **生命周期 Hooks**：外部可编程干预 Agent 行为
