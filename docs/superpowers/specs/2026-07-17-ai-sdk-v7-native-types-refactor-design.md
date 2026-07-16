# @vico/agent 全面接入 AI SDK v7 生态 — 设计文档

日期：2026-07-17
状态：已确认（待实施）

## 背景与动机

`@ai-sdk/provider` 已升级到 4.0.3（LanguageModelV4 spec）、`@ai-sdk/provider-utils` 升级到 5.0.9，现有代码基于 V3 类型无法通过类型检查。同时，`packages/agent` 中大量自定义类型（`ModelMessage`、`ModelStreamChunk`、`UIStreamChunk`、`UIMessage`）本质上是在手工镜像 AI SDK 的类型与协议——`vico/web` 前端已经在用原生 AI SDK v7 协议（`useChatRuntime` + `DefaultChatTransport`）消费这些"镜像"。

本次重构借 V4 迁移之机，引入 `ai@7.0.26`，用原生类型和官方积木替换全部镜像代码，**但保留自研 agent loop（审批、checkpoint、记忆、压缩、追踪），不使用 `streamText` / `generateText`**。

## 目标

1. `packages/agent` 与客户端交互全部使用原生 `UIMessage` / `ModelMessage` / `UIMessageChunk`
2. 删除自定义的 `ModelStreamChunk`、`UIStreamChunk`、`UIMessage` 镜像、扁平 `ModelMessage`、`ToolDescriptor`
3. 复用 `ai` / `ai/internal` 的转换积木，直接调 provider `doStream`
4. 完成 LanguageModelV3 → V4 迁移，新增 `reasoning` 推理力度参数
5. 全链路适配：packages/agent、libsql/mysql adapter、vico/server、vico/web
6. 修复 4 处与升级无关的 `string | undefined` 类型错误（working-memory-tool.ts、lsp-tool.ts）

## 非目标

- 不引入 `streamText` / `generateText` / `ToolLoopAgent`（保留自研 loop）
- 不做旧持久化数据的兼容/迁移（项目 init 阶段，直切）
- 不改造 Vico Tool 为 ai 的 `tool()`/`ToolSet`（审批/策略元数据是 ai tool 没有的）

## 已确认的决策

| 决策点 | 结论 |
|--------|------|
| 消费方范围 | 全链路：agent + adapters + vico/server（ai v6→v7）+ vico/web |
| `ai/internal` 非公开 API | 使用，锁定 `ai@7.0.26` 精确版本，升级走人工回归 |
| 持久化历史数据 | 不兼容直切，无读兼容层 |
| Vico Tool 类型 | 保留自有类型（policy/kind/tags/审批），仅在 model 层转换 |
| TurnOutput 流词汇 | provider 原生 `LanguageModelV4StreamPart`，UI 映射收敛在 turn-stream |
| reasoning 参数 | 配置级（AgentConfig → Agent → ModelRequest），不做 per-run 覆盖 |

## 架构设计

### 分层（重构后）

```
vico/web (useChatRuntime + DefaultChatTransport, 原生协议, 零改动)
    ↑ SSE: UIMessageChunk（createUIMessageStreamResponse 输出）
vico/server api/chat.ts（validateUIMessages 解析入参）
    ↑
@vico/agent stream/turn-stream.ts
    createUIMessageStream: LanguageModelV4StreamPart → UIMessageChunk 映射
    ↑ TurnOutput: ReadableStream<LanguageModelV4StreamPart>
@vico/agent agent-loop（自研 loop：审批/checkpoint/记忆/压缩/追踪）
    内部消息: 原生 ModelMessage（parts 数组）
    ↑
@vico/agent model/model-client.ts（薄封装）
    convertToLanguageModelPrompt + prepareTools (ai/internal) → model.doStream()
    ↑
@ai-sdk/openai | @ai-sdk/anthropic（LanguageModelV4）
```

### 依赖与版本

- `packages/agent`：新增 `"ai": "7.0.26"`（**精确锁定**，因使用 `ai/internal`）
- `vico/server`：`ai` 从 `^6.0.204` 升到 `7.0.26`（当前 src 无直接 import，仅改声明 + chat.ts 新增类型 import）
- 全仓对齐 `@ai-sdk/provider@4.0.3`、`@ai-sdk/provider-utils@5.0.9`
- `ai@7.0.26` 自身依赖恰好是 provider@4.0.3 + provider-utils@5.0.9，无版本冲突

## 模块变更明细

### 1. model 层（packages/agent/src/model/）

| 文件 | 处理 |
|------|------|
| `prompt-converter.ts` | **删除** → `convertToLanguageModelPrompt`（ai/internal；注意其为 async 且含文件下载逻辑） |
| `tool-converter.ts` | **删除** → `prepareTools`（ai/internal），入参 Vico Tool 在此转换 |
| `stream-processor.ts` | **删除** → 流直接透传 V4 part；tool-call 的 input JSON 解析在 loop 消费处用 `parseToolCall`（ai/internal） |
| `types.ts` | 删除 `ModelMessage`/`MessageRole`/`ModelStreamChunk`/`ToolDescriptor`/`StreamWarning`；`ModelRequest` 保留但字段改为：`messages: ModelMessage[]`（ai 原生）、`tools?: Tool[]`（Vico）、新增 `reasoning?: 'provider-default' \| 'none' \| 'minimal' \| 'low' \| 'medium' \| 'high' \| 'xhigh'` |
| `model-client.ts` | 保留薄封装：转换 → `doStream()` → 返回 `ReadableStream<LanguageModelV4StreamPart>`；透传 `reasoning` |
| `factory.ts` | `LanguageModelV3` → `LanguageModelV4` 重命名 |

### 2. stream 层（packages/agent/src/stream/）

- `types.ts`：删除 `UIMessage`/`UIMessagePart`/`UIStreamChunk` 镜像定义；`UserMessage` 改为 `string | UIMessage[]`（UIMessage 来自 ai）
- `turn-stream.ts`：重写。`createUIMessageStream` 内做 V4 part → UIMessageChunk 映射（与现有映射几乎 1:1）+ usage 扁平化（V4 Usage 嵌套结构不变），`createUIMessageStreamResponse` 出 SSE
  - `file` part：`data.type === 'url'` → `url.href`；`data.type === 'data'` → base64 data URI
  - V4 新增的 `custom` part → `data-custom` UI chunk（transient）；`reasoning-file` → 复用 file 映射
  - `data-turn-paused` 等 Vico 事件继续走 `data-*` 通道（协议不变，web 无感）
- `sse.ts`：**删除**（`createSSEResponse` 由 `createUIMessageStreamResponse` 替代）

### 3. agent-loop 层（最深改动）

- 内部消息全部换为原生 `ModelMessage`：
  - 用户输入：`Agent.stream/invoke` 接受 `string | UIMessage[]`，内部 `validateUIMessages` + `convertToModelMessages`
  - assistant/tool 消息：用 `toResponseMessages`（ai/internal）从模型 content 生成，直接持久化
  - 工具结果消息：`ToolModelMessage`（content 为 `tool-result` parts），`createToolModelOutput` 辅助
- `callModel` 的 chunk switch 适配 V4 part 词汇（含新增 `custom`、`reasoning-file` 透传 enqueue）
- loop 合成的 `tool-result`/`tool-approval-request` chunk 复用 V4 同名 part 形状
- `agent.ts`/`create-agent.ts`：`LanguageModelV4` 类型；`AgentOptions`/`AgentConfig` 新增 `reasoning?`
- 新增 `message-utils.ts`（~50 行）：
  - `getMessageText(msg: ModelMessage): string` — parts 提取文本（memory/compactor/tracer 用）
  - `modelMessagesToUIMessages(msgs): UIMessage[]` — 历史接口用（ai 无官方反向转换）
- 适配 parts 形态：`conversation-history-memory.ts`、`context-compactor.ts`、`turn-tracer.ts`、`context-processors/*`、`checkpoint`

### 4. 持久化（ThreadStore + 两个 adapter）

- `thread/thread-store.ts` 的 `Message` 改为：`{id, threadId, turnId, role, content: string /* JSON(ModelMessage.content) */, metadata?, createdAt}`
  - **删除 `toolCalls` / `toolCallId` 字段**（并入 content parts）
- `packages/libsql-adapter`、`packages/mysql-adapter`：
  - schema：`vico_messages` 删 `tool_calls` 列，`content` 列语义改为 JSON（parts 数组或字符串）
  - 读写映射同步修改，出新迁移文件，不做旧数据兼容

### 5. 消费方适配

- **vico/server**：
  - `api/chat.ts`：`extractMessage` 手工解析 → 原生 `UIMessage` 类型 + `validateUIMessages`；`tool-approval-response` part 处理保留
  - `services/conversation/conversation-manager.ts`：`extractMessageText` → `getMessageText`；历史接口返回 `modelMessagesToUIMessages` 结果
- **vico/web**：
  - `lib/conversation-thread-adapter.ts`：删除手工包装 `parts:[{type:'text'}]` 的逻辑，直接消费服务端返回的 `UIMessage[]`
  - runtime（use-chat-thread-runtime 等）零改动
- **@vico/agent 公共 API（src/index.ts）**：
  - re-export `UIMessage`、`ModelMessage`、`UIMessageChunk`（来自 ai）
  - 删除 `ModelStreamChunk`、`UIStreamChunk`、`ToolDescriptor`、`createSSEResponse`、`MessageRole` 等导出
  - `turnOutputToSSEResponse` 签名保留，内部重写

### 6. 无关类型错误修复

- `memory/tool/working-memory-tool.ts:30`：workspace 分支补 `?? ''`
- `tool/builtin/coding/lsp-tool.ts:180,184`：提取 `const workspace = ctx.session.workspace!` 复用

## 错误处理

- 模型流 `error` part：loop 现有处理保留（记录 trace、emit error、返回 CallModelResult.error）
- `validateUIMessages` 校验失败：在 server 路由层自然冒泡（符合后端规范：路由层不 try-catch）
- `convertToLanguageModelPrompt` 的下载失败：仅影响含远程文件的消息，纯文本场景无此路径

## 测试策略

- 更新现有 mock：`specificationVersion: 'v3'` → `'v4'`、类型重命名（agent-loop.test.ts、model-client.test.ts、agent-loop-checkpoint.test.ts、stream-processor.test.ts（随源码删除）、agent-runtime.test.ts）
- 新增：turn-stream 对 V4 part → UIMessageChunk 映射（含 custom/reasoning-file/file 新形态）；message-utils 的双向转换；adapter 读写 JSON content 往返
- 验收：`pnpm typecheck` + `pnpm test` 全仓通过；`pnpm dev` 启动后 web 端完整走通一轮含工具调用与审批的对话

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| `ai/internal` 无 semver 保证 | 精确锁定 7.0.26；升级需人工回归 model 层测试 |
| `convertToLanguageModelPrompt` async + 文件下载副作用 | 纯文本/工具场景不触发下载；测试覆盖 |
| 持久化直切，旧会话不可读 | 已确认接受（init 阶段） |
| vico/server ai v6→v7 协议差异 | server 未直接使用 ai API，实际风险极低 |
