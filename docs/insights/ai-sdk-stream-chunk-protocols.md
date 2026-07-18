# AI SDK Stream Chunk 协议深度对比：TextStreamPart vs UIMessageChunk

> Vercel AI SDK 6.x 中两条核心流式事件协议的角色分工与差异分析。

## 一、定位与角色

| 维度 | TextStreamPart\<TOOLS\> | UIMessageChunk\<METADATA, DATA_TYPES\> |
|------|------------------------------|----------------------------------------------|
| **来源** | `streamText().fullStream` | `streamText().toUIMessageStream()` |
| **语义** | 引擎原始输出流，忠实反映模型交互全过程 | UI 导向流，面向前端消费，经过语义裁剪与重组 |
| **抽象层级** | 低层，贴近模型 & provider | 高层，面向消息/UI 渲染 |
| **泛型参数** | `TOOLS extends ToolSet` — 按工具集参数化，工具调用/结果带类型 | `METADATA` + `DATA_TYPES` — 按消息元数据与自定义数据通道参数化 |
| **典型消费者** | 后端 Agent 循环、可观测性管线、中间件 | 前端聊天 UI、`useChat`、SSE 响应 |

## 二、事件类型全景对照

### 2.1 文本 & 推理事件

两者的文本/推理 chunk 均采用 **start → delta → end** 三段式生命周期，但字段命名不同：

| 事件 | TextStreamPart 字段 | UIMessageChunk 字段 |
|------|---------------------|---------------------|
| `text-start` | `id`, `providerMetadata?` | `id`, `providerMetadata?` |
| `text-delta` | `id`, `text` (string), `providerMetadata?` | `id`, **`delta`** (string), `providerMetadata?` |
| `text-end` | `id`, `providerMetadata?` | `id`, `providerMetadata?` |
| `reasoning-start` | `id`, `providerMetadata?` | `id`, `providerMetadata?` |
| `reasoning-delta` | `id`, `text` (string), `providerMetadata?` | `id`, **`delta`** (string), `providerMetadata?` |
| `reasoning-end` | `id`, `providerMetadata?` | `id`, `providerMetadata?` |

**关键差异**：TextStreamPart 的 delta 内容字段叫 `text`，UIMessageChunk 统一用 `delta`。同一套 AI SDK 内部，这是最常见的迁移坑。

### 2.2 工具调用事件

这是两者分歧最大的区域。TextStreamPart 沿用经典的 **tool-call → tool-result** 离散模型；UIMessageChunk 则重新建模为面向 UI 的 **input-available → output-available** 模式。

| 场景 | TextStreamPart | UIMessageChunk |
|------|---------------|----------------|
| **工具被调用（含完整输入）** | `tool-call`（嵌入 `TypedToolCall<TOOLS>`，含 `toolCallId`, `toolName`, `input`） | `tool-input-available`（`toolCallId`, `toolName`, `input`, `providerExecuted?`, `dynamic?`, `title?`） |
| **工具输入流式到达（开始）** | `tool-input-start`（`id`, `toolName`, `providerExecuted?`, `dynamic?`, `title?`） | `tool-input-start`（`toolCallId`, `toolName`, 同上） |
| **工具输入流式块** | `tool-input-delta`（`id`, `delta`） | `tool-input-delta`（`toolCallId`, **`inputTextDelta`**） |
| **工具输入流式结束** | `tool-input-end`（`id`） | ❌ 无此事件 |
| **工具输入错误** | ❌ 无独立事件 | `tool-input-error`（`toolCallId`, `toolName`, `input`, `errorText`） |
| **工具执行完成** | `tool-result`（嵌入 `TypedToolResult<TOOLS>`） | `tool-output-available`（`toolCallId`, `output`, `preliminary?`） |
| **工具执行失败** | `tool-error`（嵌入 `TypedToolError<TOOLS>`） | `tool-output-error`（`toolCallId`, `errorText`） |
| **工具被拒绝** | `tool-output-denied`（嵌入 `StaticToolOutputDenied<TOOLS>`） | `tool-output-denied`（仅 `toolCallId`） |
| **审批请求** | `tool-approval-request`（`ToolApprovalRequestOutput<TOOLS>`） | `tool-approval-request`（`approvalId`, `toolCallId`, `signature?`） |

**关键差异总结**：

1. **命名体系不同**：TextStreamPart 用 `tool-call` / `tool-result` / `tool-error`；UIMessageChunk 用 `tool-input-*` / `tool-output-*` 前缀。
2. **类型安全**：TextStreamPart 通过 `TOOLS` 泛型提供完整的工具调用/结果类型推导；UIMessageChunk 的 `input` / `output` 字段是 `unknown`，不做工具级类型参数化。
3. **流式输入 ID**：TextStreamPart 的 `tool-input-*` 事件使用 `id` 字段；UIMessageChunk 使用 `toolCallId`，与 `tool-input-available` 等事件保持一致。
4. **UIMessageChunk 无 `tool-input-end`**：客户端通过 `tool-input-available` 或切换到其他事件来推断输入完成。

### 2.3 来源引用事件

| TextStreamPart | UIMessageChunk |
|---------------|----------------|
| `source`（嵌入完整 `Source` 类型，含 `id`, `url`, `title`, `metadata` 等） | `source-url`（`sourceId`, `url`, `title?`） + `source-document`（`sourceId`, `mediaType`, `title`, `filename?`） |

UIMessageChunk 将来源拆分为 URL 和 Document 两种子类型，方便前端直接按类型渲染不同的来源卡片。

### 2.4 文件事件

| TextStreamPart | UIMessageChunk |
|---------------|----------------|
| `file`（含 `file: GeneratedFile` 完整对象 + `providerMetadata?`） | `file`（含 `url`, `mediaType`, `providerMetadata?`） |

TextStreamPart 携带完整的 `GeneratedFile` 对象（含 base64 data 等）；UIMessageChunk 仅保留 URL 和媒体类型，数据体通过 `url` 异步加载，减少流内体积。

### 2.5 Step & Stream 生命周期

| 事件 | TextStreamPart | UIMessageChunk |
|------|---------------|----------------|
| `start-step` | ✅ 携带 `request`（完整模型请求元数据）+ `warnings` | ✅ 仅事件本身，无负载 |
| `finish-step` | ✅ 携带 `response`（模型响应元数据）、`usage`、`finishReason`、`rawFinishReason`、`providerMetadata` | ✅ 仅事件本身，无负载 |
| `start` | ✅ 仅事件本身 | ✅ 携带 `messageId?`, `messageMetadata?` |
| `finish` | ✅ 携带 `finishReason`、`rawFinishReason`、`totalUsage` | ✅ 携带 `finishReason?`, `messageMetadata?` |
| `abort` | ✅ 携带 `reason?` | ✅ 携带 `reason?` |
| `message-metadata` | ❌ | ✅ 携带 `messageMetadata` |

**关键差异**：

- TextStreamPart 的 step 事件是**重量级**的：携带完整的请求/响应 metadata，适合审计、计费、可观测性场景。
- UIMessageChunk 的 step 事件是**信号级**的：几乎不带负载，只告诉 UI "模型开始/结束了一个 step"，Usage 由 finish 事件统一上报。
- UIMessageChunk 额外提供 `message-metadata` 事件用于按消息传递元数据。

### 2.6 错误事件

| TextStreamPart | UIMessageChunk |
|---------------|----------------|
| `error`（`error: unknown` — 原始错误对象） | `error`（`errorText: string` — 错误消息文本） |
| — | `tool-input-error`（工具输入解析失败） |
| — | `tool-output-error`（工具执行失败） |

TextStreamPart 传递原始错误对象（可能包含堆栈、上下文），适合后端日志与诊断。UIMessageChunk 将其序列化为 `errorText` 字符串，适合安全传输到前端，并将工具相关错误拆分为独立事件。

### 2.7 扩展机制

| 机制 | TextStreamPart | UIMessageChunk |
|------|---------------|----------------|
| **原始数据穿透** | `raw` 事件（`rawValue: unknown`），可夹带任意 provider 原始事件 | ❌ 无 |
| **类型化数据通道** | ❌ 无 | `data-<NAME>` 事件（通过 `DATA_TYPES` 泛型约束），如 `data-temperature`、`data-status` |
| **用户自定义** | 通过 TransformStream 中间件注入 | 通过 `writer.write(type: 'data-xxx', ...)` |

TextStreamPart 偏向"开放穿透"`raw`，适合中间件获取 provider 特定数据。UIMessageChunk 偏向"结构化扩展"`data-*`，适合前端声明式消费自定义数据类型。

## 三、架构关系图

```
                    streamText()
                         │
                         ▼
              ┌─────────────────────┐
              │   fullStream        │  TextStreamPart<TOOLS>
              │   (引擎原始流)        │
              └────────┬────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         ▼             ▼             ▼
    Agent Loop    中间件/日志    toUIMessageStream()
    (后端消费)    (Transform)          │
                                      ▼
                              ┌─────────────────────┐
                              │  UIMessageChunk      │
                              │  (UI 导向流)          │
                              └────────┬────────────┘
                                       │
                                       ▼
                              useChat / SSE Response
                              (前端消费)
```

## 四、选型指南

| 场景 | 推荐协议 | 原因 |
|------|---------|------|
| **后端 Agent 循环**（如 Vico AgentLoop） | `TextStreamPart` | 需要 `tool-call` / `tool-result` 的精确类型、step 级 usage 追踪、原始错误对象 |
| **可观测性 & 审计** | `TextStreamPart` | `start-step` / `finish-step` 携带完整请求响应元数据 |
| **Provider 中间件** | `TextStreamPart` | `raw` 事件可穿透任意 provider 特定数据 |
| **前端聊天 UI** | `UIMessageChunk` | `delta` 命名统一、工具事件 UI 友好、`data-*` 扩展通道 |
| **SSE 响应到浏览器** | `UIMessageChunk` | `toUIMessageStreamResponse()` 原生支持，自动序列化 |
| **useChat hook** | `UIMessageChunk` | React hook 原生消费此协议 |
| **自定义数据面板**（温度、状态等） | `UIMessageChunk` | `DATA_TYPES` 泛型 + `data-*` 通道声明式消费 |

## 五、Vico 项目中的应用

Vico 的流式链路与 AI SDK 的三层协议一一对齐（2026-07 协议升级后）：

```
ModelClient.stream()          → LanguageModelV4StreamPart   （provider 合同，model/model-client.ts）
        │  AgentLoop.callModel 转换（agent-loop/stream-parts.ts）
        ▼
TurnOutput.stream             → TextStreamPart<ToolSet>     （引擎合同，别名 AgentStreamPart）
        │  turnOutputToSSEResponse 转换（stream/turn-stream.ts）
        ▼
SSE Response                  → UIMessageChunk              （UI 合同，@assistant-ui/react 原生消费）
```

`AgentLoop`（`agent-loop.ts`）在引擎层承担与 `streamText` 相同的职责：

- **V4 → TextStreamPart 逐 part 映射**：`text-delta` 的 `delta` 字段改名 `text`；`tool-call` 的 JSON 字符串 input 解析为对象（失败时标记 `invalid: true`）；`file`/`reasoning-file` 的 data/url 变体包装为 `GeneratedFile`；`stream-start` 的 warnings 并入 `start-step`；`response-metadata` + V4 `finish` 合成 `finish-step`（含 response/usage/performance）。
- **引擎合成生命周期事件**：流首 `start`，每步 `start-step`/`finish-step`，终态 `abort`（中断时）+ `finish`（携带 totalUsage）。
- **工具执行结果上流**：ToolExecutor 执行完成后 enqueue `tool-result`/`tool-error`（dynamic 变体）；策略/审批拒绝 enqueue `tool-output-denied`；审批请求/恢复决策 enqueue `tool-approval-request`/`tool-approval-response`。
- **dynamic 工具形态**：Vico 工具为运行时定义（非静态 ToolSet），所有工具类 part 使用 `dynamic: true` 变体。

part 构造逻辑集中在 `agent-loop/stream-parts.ts`；`turn-stream.ts` 只做纯字段映射（`text` ↔ `delta`、`id` ↔ `toolCallId` 等），不再用 `inStep` 启发式推断 step 边界。

## 六、迁移注意事项（TextStreamPart → UIMessageChunk）

如果未来需要把 Agent 输出从 `TextStreamPart` 迁移到 `UIMessageChunk`（例如对接 `useChat`），需要注意以下变更：

1. **文本 delta 字段**：`chunk.text` → `chunk.delta`
2. **工具调用的检测方式**：`chunk.type === 'tool-call'` → `chunk.type === 'tool-input-available'`
3. **工具结果的检测方式**：`chunk.type === 'tool-result'` → `chunk.type === 'tool-output-available'`
4. **错误类型**：`chunk.error`（unknown） → `chunk.errorText`（string）
5. **Usage 获取**：从 `finish-step` 的 `usage` 字段 → 从 `finish` 的 `totalUsage`（但 `toUIMessageStream` 可选 `onFinish` 回调直接拿到）
6. **Tool Call ID 获取**：`tool-input-start.id` → `tool-input-start.toolCallId`
7. **审批流**：TextStreamPart 的 `tool-approval-request` 类型为 `ToolApprovalRequestOutput<TOOLS>`；UIMessageChunk 的 `tool-approval-request` 为简化版 `{ approvalId, toolCallId, signature? }`

## 七、总结

| | TextStreamPart | UIMessageChunk |
|---|---------------|----------------|
| **设计原则** | 完整性 — 不漏掉任何信息 | 可用性 — 只给 UI 需要的 |
| **类型安全** | 工具级泛型 `TOOLS` | 消息元数据 + 自定义数据泛型 |
| **工具模型** | 离散调用/结果事件 | 流式输入 + 审批 + 输出生命周期 |
| **适合谁** | 后端引擎、中间件、可观测性 | 前端 UI、SSE 响应、React hooks |
| **信息密度** | 高（携带 model metadata、usage、原始错误） | 低（裁剪后的事件，安全序列化） |
| **扩展方式** | `raw` 穿透 + TransformStream | `data-*` 泛型通道 |
