# Vico 前端报文协议迁移：UIMessage → ag-ui（方案）

> 目标态：后端不再输出 ai 包的 `UIMessage`/`UIMessageChunk`，改输出 [AG-UI 协议](https://github.com/ag-ui-protocol/ag-ui) 事件流；前端从 `@assistant-ui/react-ai-sdk`（消费 ai UIMessage SSE）切换到 `@assistant-ui/react-ag-ui`（消费 ag-ui 事件）。
> 前置依赖：任务一已把引擎输出统一为自有 `Chunk` 协议（`{ type, runId, payload }`），本方案在其之上做 **Chunk → ag-ui 事件** 的边界转换。

## 一、目标与约束

- 废弃 `ai` 包的 `UIMessage`/`UIMessageChunk`/`toUIMessageStream`/`createUIMessageStreamResponse`，最终从 `vico/server` 与 `vico/web` 移除 `ai` 依赖。
- **不牺牲现有体验**：流式文本/推理、工具调用卡片与 ToolUI、审批门禁（含 `ask_user` 澄清、会话级「始终允许」）、token 用量展示、线程列表/历史加载、模型/Agent/审批模式/工作区选择器、语音、编辑/重发/取消，均需等价保留。

## 二、协议映射（引擎 Chunk → ag-ui 事件）

ag-ui 事件家族（[Events](https://docs.ag-ui.com/spec/1.0/events/index)）：`RUN_* / STEP_*`、`TEXT_MESSAGE_*`、`TOOL_CALL_*`、`REASONING_*`、`STATE_*`、`ACTIVITY_*`、`SUBAGENT_*`、`CUSTOM/RAW`。

| 引擎 Chunk | ag-ui 事件 | 备注 |
|---|---|---|
| `start` | `RUN_STARTED` | 携带 `threadId` / `runId`（`runId` 用引擎 chunk 的 `runId`） |
| `start-step` / `finish-step` | `STEP_STARTED` / `STEP_FINISHED` | 信号级；step 级 usage 仍在 `finish-step`，可经 `CUSTOM` 透出（可选） |
| `text-start` / `text-delta` / `text-end` | `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` | 服务端为每条文本块分配 `messageId`（用 chunk `payload.id`） |
| `reasoning-*` | `REASONING_MESSAGE_*` / `REASONING_*` | `showThinking: true` 时前端渲染 |
| `tool-call` | `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` | `TOOL_CALL_ARGS.delta` 传 JSON 字符串化的 `input` |
| `tool-result` / `tool-error` | `TOOL_CALL_RESULT` | `content` 分 `text` / `json` / `error` 三种；`error` → error result |
| `tool-output-denied` | `TOOL_CALL_RESULT`（error/denied）或 `CUSTOM` | 见「审批」节 |
| `finish` | `RUN_FINISHED` | `outcome: { type: 'success' }`；`totalUsage`/`usage` 经 `metadata.agui.usage` 或 `CUSTOM` 透出 |
| `error` | `RUN_ERROR` | `message` 取 `payload.error` |
| `abort` | `RUN_CANCELLED` | 用户取消/中断 |
| `source` / `file` / `reasoning-file` / `custom` / `raw` | `CUSTOM` / `RAW` | 按需透传（当前前端对 source/file 无专门渲染，可先经 `CUSTOM` 保底） |

## 三、服务端改造（`vico/server`）

1. **新增 `src/chat/chunk-to-agui.ts`**：`ReadableStream<Chunk> → ReadableStream<AGUIEvent>` 的 TransformStream（参考 `chunk-to-uimessage.ts` 的逆映射，但目标是 ag-ui 事件，不需要 `ai`）。事件编码用 `@ag-ui/core` 的事件类型 + `@ag-ui/encoder`（或手写 `text/event-stream` 分帧）。
2. **`api/chat.ts`**：`POST /api/v1/chat` 改为返回 ag-ui SSE——解析 `RunAgentInput`（`threadId/runId/messages/tools/context/forwardedProps/resume`），把 `messages`（ag-ui `Message[]`）转成 `ModelMessage[]` 喂给 `executeAgentChat`，再把 `output.stream` 经 `chunk-to-agui` 编码回 SSE。响应头沿用 `x-thread-id`（或改用 ag-ui 约定的 thread 回传）。
3. **`chat.ts`**：`executeAgentChat` 的入参从 `UIMessage` 改为 ag-ui 消息（或直接 `ModelMessage[]`），标题派生逻辑改用 ag-ui 消息的文本 part。
4. **`services/thread/ui-messages.ts` → `services/thread/agui-messages.ts`**：历史接口返回 ag-ui `Message[]`（替代 `UIMessage[]`），转换逻辑从 `toUiMessages` 改为 ag-ui 消息组装（后端持久化仍是 `ModelMessage.content`，此层只做 model → ag-ui 的展示映射）。
5. **`RunAgentInput.tools`**：Vico 工具是**服务端执行**的，因此 `tools` 字段无需下发客户端执行器；但前端 ToolUI 的 schema 已在 `vico/web/src/tools/toolkit.ts`，ag-ui 协议下前端工具执行是可选的。Vico 保持「服务端执行 + 客户端渲染」，故后端不消费 `tools`（或在能力声明中说明）。

## 四、前端改造（`vico/web`）

1. **依赖**：新增 `@ag-ui/client`、`@assistant-ui/react-ag-ui`；移除 `@assistant-ui/react-ai-sdk`、`@assistant-ui/ai-sdk`（及 `ai` 直接引用）。
2. **`use-chat-thread-runtime.ts`**：用 `HttpAgent`（`@ag-ui/client`，`url: '/api/v1/chat'`）+ `useAgUiRuntime`（`@assistant-ui/react-ag-ui`）替换 `AssistantChatTransport` + `useChatRuntime`。`x-thread-id` 回写、`onFinish` 逻辑在 ag-ui 运行时下用 `RUN_STARTED` 携带的 `threadId` 或 `runConfig` 回传实现。
3. **线程列表**：保留 `useRemoteThreadListRuntime({ runtimeHook: () => useAgUiRuntime(...), adapter })` 的既有架构；`createThreadListAdapter` 不变。
4. **历史**：`createThreadHistoryAdapter` 的 `load` 用 `fromAgUiMessages`（`@assistant-ui/react-ag-ui`）把后端 ag-ui `Message[]` 还原为 assistant-ui 消息。
5. **配置注入**（模型/Agent/审批模式/工作区）：现有 `modelContext`（ModelSelector/AgentSelector/ApprovalMode/Workspace 选择器）→ ag-ui 的 `forwardedProps`。`useAgUiRuntime` 已把 `runConfig` 转进 `RunAgentInput.forwardedProps`，后端从 `forwardedProps.config` 读取（与当前 `body.config` 对齐）。

## 五、审批 / 人机协作（关键决策，已确认用 interrupts）

现状：服务端执行工具 + 审批门禁——`tool-approval-request` 暂停 turn，前端 `respondToApproval` 回 `tool-approval-response`；`ask_user` 的答案也走这里。

**ag-ui 映射（interrupts）**：

- 后端：当引擎产出 `tool-approval-request` 时，不再作为工具结果直出，而是 **结束当前 run**：发 `RUN_FINISHED { outcome: { type: 'interrupt', interrupts: [{ id, type/toolName, payload: { toolCallId, toolName, input, ...question }, responseSchema }] } }`。此时 turn 已暂停（checkpoint 已保存），等待用户决议。
- 前端：`@assistant-ui/react-ag-ui` 把 interrupt 落到当前 assistant 消息的 `requires-action` 状态 + `metadata.custom.agui.interrupts`，用 `useAgUiInterrupts` 渲染审批 UI、`useAgUiSubmitInterruptResponses` 提交 `resume: [{ interruptId, status: 'resolved', payload: { approved, reason, scope } }]`。
- 后端：收到带 `resume` 的下一次请求 → 从 checkpoint 恢复 turn，把 `resume` 还原为 `tool-approval-response`（`scope: 'session'` 复用 `SESSION_SCOPE_REASON` 约定），执行/拒绝工具后继续流式输出。

**现有 ToolUI 适配**：`vico/web/src/tools/ToolUIs/*.tsx` 的 `respondToApproval`/`approval` prop 需改为 interrupt 驱动——`ask-user-ui.tsx` 的问题表单改从 `interrupt.payload` 读取；`tool-card.tsx`/`tool-fallback.aui.tsx` 的审批卡改接 `useAgUiSubmitInterruptResponses`。这是前端工作量最大的部分。

## 六、实施顺序（分步可回退）

1. **Phase 0（现状已验证）**：任务一的 `Chunk` 引擎 + `chunk-to-uimessage` 过渡适配器，前端照常工作（本阶段已落地）。
2. **Phase 1（后端双轨）**：新增 `chunk-to-agui` + `/api/v1/chat/agui`（或 `/api/v1/chat` 加 `Accept: application/ag-ui` 分支），旧 `/api/v1/chat` 暂留，实现 ag-ui 事件流并做单测/冒烟。
3. **Phase 2（前端切轨）**：`use-chat-thread-runtime` 切 `useAgUiRuntime`，验证流式文本/推理/工具结果（审批先降级为「拒绝」或阻塞式提示）。
4. **Phase 3（审批 interrupts）**：接入 interrupts 全链路，重写 ToolUI 审批态与 `ask_user`。
5. **Phase 4（收尾）**：移除 `chunk-to-uimessage.ts`、`services/thread/ui-messages.ts`、`ai` 依赖（server + web）、`@assistant-ui/react-ai-sdk`/`@assistant-ui/ai-sdk`；更新文档。

## 七、风险与待确认点

| 风险 | 说明 | 对策 |
|---|---|---|
| **interrupts 为 experimental** | `@assistant-ui/react-ag-ui` 的 interrupts/threadList API 标 experimental | 用锁定版本 + 集成测试覆盖；必要时回退到「自定义 CUSTOM 事件桥」 |
| **审批 UI 重写量大** | ToolUI 全部 `respondToApproval` 需改 interrupt 驱动 | 抽一层 `useToolApproval` 适配 hook，屏蔽 runtime 差异，逐工具迁移 |
| **`sendAutomaticallyWhen` 语义变化** | 当前 `lastAssistantMessageIsCompleteWithApprovalResponses` 触发自动重发 | ag-ui 下用 `useAgUiSubmitInterruptResponses` 提交后由 runtime 自动 resume，无需该谓词 |
| **token 用量展示** | 当前 `finish` 的 `usage` 经 `messageMetadata` 挂到消息 metadata | ag-ui 下经 `RUN_FINISHED.metadata.agui.usage` 或 `CUSTOM` 事件透出，前端在 `onFinish`/data part 读取 |
| **source/file 事件** | 当前无专门渲染 | 先经 `CUSTOM` 保底，后续按需加 data renderer |

## 八、关键参考

- [AG-UI Events Spec](https://docs.ag-ui.com/spec/1.0/events/index)
- [AG-UI Core Types](https://docs.ag-ui.com/sdk/js/core/types)
- [assistant-ui AG-UI Runtime](https://www.assistant-ui.com/docs/runtimes/ag-ui/overview.mdx)
- [assistant-ui AG-UI Runtime options](https://www.assistant-ui.com/docs/runtimes/ag-ui/runtime-options.mdx)
