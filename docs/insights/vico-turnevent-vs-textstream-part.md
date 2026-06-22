# Vico TurnEvent vs AI SDK TextStreamPart 深度对比

> `TurnEvent` 是 Vico 面向 Agent-turn 生命周期定义的**自有流式事件协议**，`TextStreamPart` 是 AI SDK 的**引擎原始输出流**。两者在 Vico 内部通过 `AgentLoop.callModel()` 完成协议转换。

## 一、定位与设计哲学

| 维度 | TurnEvent | TextStreamPart\<TOOLS\> |
|------|-----------|------------------------|
| **所属层** | Vico Agent 框架层 | AI SDK 引擎层 |
| **抽象粒度** | Turn（一次用户消息 → 最终回复） | 单次 model call（一次 LLM 调用） |
| **生命周期边界** | `step_start` → (model + tool)* → `step_end` → `done` | `start` → (start-step → finish-step)* → `finish` |
| **设计目标** | 前端 SSE 消费 + Agent 可观测性 | LLM 交互完整记录 |
| **事件数量** | 9 种 | 20+ 种 |
| **泛型** | 无 | `TOOLS extends ToolSet` |

## 二、事件类型逐一对标

### 2.1 文本 & 推理

| TurnEvent | TextStreamPart | 差异说明 |
|-----------|---------------|---------|
| `text_delta` (`content: string`) | `text-delta` (`id`, `text`, `providerMetadata?`) + `text-start` / `text-end` | TurnEvent 无 start/end 生命周期，无 message id，字段名 `content` vs `text` |
| `reasoning_delta` (`content: string`) | `reasoning-delta` (`id`, `text`, `providerMetadata?`) + `reasoning-start` / `reasoning-end` | 同上，无 start/end 包裹 |

**设计取舍**：Vico 去掉了 text/reasoning 的 start/end 事件，前端通过第一条 delta 推断开始，通过 step_end/done 推断结束。这减少了 SSE 事件数，代价是丢失了 message id 和 provider 元数据。

### 2.2 工具调用

| TurnEvent | TextStreamPart | 差异说明 |
|-----------|---------------|---------|
| `tool_call_start` (`id`, `name`, `args: Record<string, unknown>`) | `tool-call`（含 `toolCallId`, `toolName`, `input`，泛型约束）| TurnEvent 只支持**流式调用**模型（tool-use content parts）；字段名 `id`/`name`/`args` vs `toolCallId`/`toolName`/`input` |
| — | `tool-input-start` / `tool-input-delta` / `tool-input-end` | TurnEvent 不支持流式工具输入 |
| `tool_result` (`id`, `name`, `status`, `output: unknown`) | `tool-result`（含 `toolCallId`, `toolName`, `output`，泛型约束）| TurnEvent 多了 `status: 'success' \| 'error'`，TextStreamPart 用独立的 `tool-error` 表示失败 |
| — | `tool-error` | TurnEvent 通过 `tool_result.status === 'error'` 表达 |
| — | `tool-output-denied` | TurnEvent 不支持审批拒绝的独立事件 |
| — | `tool-approval-request` | TurnEvent 不支持 |

**设计取舍**：

1. **非流式工具调用假设**：Vico 只处理 `tool-call`（完整调用），不支持 `tool-input-start/delta/end` 流式工具输入。这是合理的——当前多数模型的 tool-use 仍是 content-part 模式，流式 tool input 仅在少数 provider 中可用。
2. **结果与错误合并在 `tool_result`**：通过 `status` 字段区分，比 TextStreamPart 的 `tool-result` / `tool-error` 二事件模型更紧凑，但丢失了错误的类型信息（`ToolError` 对象 → 仅 `status: 'error'`）。
3. **无审批/拒绝事件**：审批职责在 `ApprovalGate` 层（Agent 循环内），不暴露到流事件。好处是前端只管展示，坏处是审批状态对前端不可见。

### 2.3 Step 生命周期

| TurnEvent | TextStreamPart | 差异说明 |
|-----------|---------------|---------|
| `step_start` (`step: number`) | `start-step`（`request: LanguageModelRequestMetadata`, `warnings: CallWarning[]`）| TurnEvent 仅带步骤序号，TextStreamPart 携带完整模型请求元数据 |
| `step_end` (`step: number`) | `finish-step`（`response: LanguageModelResponseMetadata`, `usage: LanguageModelUsage`, `finishReason`, `rawFinishReason`, `providerMetadata`）| TurnEvent 仅带步骤序号，TextStreamPart 携带完整响应元数据 + usage |

**关键差异**：

- TextStreamPart 的 step 事件是**重量级审计记录**——包含了发给 LLM 的完整请求和返回的完整响应元数据，适合计费、调试、可观测性。
- TurnEvent 的 step 事件是**轻量级进度信号**——只告诉前端"第几步开始了/结束了"，前端据此渲染步骤分隔符或进度条。

### 2.4 流/会话生命周期

| TurnEvent | TextStreamPart | 差异说明 |
|-----------|---------------|---------|
| `done`（`usage: { input, output }`） | `finish`（`finishReason`, `rawFinishReason`, `totalUsage`）| TurnEvent 无 finishReason，usage 字段扁平化 |
| — | `start` | TurnEvent 无 start 事件——客户端从第一条 `step_start` 推断开始 |
| — | `abort` | TurnEvent 不 emit abort 事件，而是通过 generator return 的 `TurnResult.status === 'aborted'` 表达 |

### 2.5 错误

| TurnEvent | TextStreamPart | 差异说明 |
|-----------|---------------|---------|
| `error` (`message: string`) | `error` (`error: unknown`) | TurnEvent 已序列化为 string，TextStreamPart 保留原始错误对象 |

这跟之前 `TextStreamPart` vs `UIMessageChunk` 的错误差异一致——Vico 在协议边界做了序列化。

### 2.6 TurnEvent 独有事件

| TurnEvent | 用途 | TextStreamPart 对标 |
|-----------|------|-------------------|
| `compacted` (`removedTokens: number`) | 上下文压缩通知 | ❌ 无——TextStreamPart 不感知 compaction 概念 |

`compacted` 是 Vico 框架层特有的语义——当 `ContextCompactor` 压缩对话历史时会触发此事件，告诉前端"消息列表已被裁剪"。AI SDK 自身无此概念，compaction 是 Vico 在引擎层之上自建的。

### 2.7 TextStreamPart 有而 TurnEvent 无的事件

| TextStreamPart 事件 | 说明 | Vico 如何处理 |
|---------------------|------|--------------|
| `text-start` / `text-end` | 文本消息边界 | 忽略 |
| `reasoning-start` / `reasoning-end` | 推理消息边界 | 忽略 |
| `tool-input-start` / `tool-input-delta` / `tool-input-end` | 流式工具输入 | 不处理（不支持） |
| `tool-error` | 工具执行错误 | 合并到 `tool_result.status` |
| `tool-output-denied` | 工具输出被拒绝 | 不处理 |
| `tool-approval-request` | 审批请求 | 不处理 |
| `start-step` / `finish-step` | Step 边界 + 元数据 | 映射为简化版 `step_start` / `step_end` |
| `start` | 流开始 | 忽略 |
| `source` | 来源引用（grounding） | 不处理 |
| `file` | 生成的文件 | 不处理 |
| `raw` | 原始 provider 事件 | 不处理 |

## 三、协议转换全景（Vico 内部的映射逻辑）

```
TextStreamPart (fullStream)                TurnEvent (AsyncGenerator)
════════════════════════════               ═══════════════════════
                                    ┌───→ step_start (Vico 自增 step 序号)
                                    │
text-start ─────────────────────→ (忽略)
text-delta (text) ──────────────→ text_delta (content)  ← 字段重命名
text-end ───────────────────────→ (忽略)
reasoning-start ────────────────→ (忽略)
reasoning-delta (text) ─────────→ reasoning_delta (content)
reasoning-end ─────────────────→ (忽略)
tool-call (toolCallId,toolName,input) → tool_call_start (id,name,args) ← 字段重命名
tool-result (toolCallId,toolName,output) → tool_result (id,name,status,output)  ← 合并 tool-error
tool-error ─────────────────────→ (同上，status='error')
finish (totalUsage) ────────────→ (usage 累加，不 emit)
error (error: unknown) ─────────→ error (message: string)  ← 序列化
start ─────────────────────────→ (忽略)

                                    ┌───→ step_end (Vico 自增 step 序号)
                                    │
(Vico 框架层自产) ──────────────→ compacted (removedTokens)
(Vico 框架层自产) ──────────────→ done (usage)
                                    ↑
                              runTurn generator 收尾
```

关键观察：

1. **转换是 N:1 的**——多个 TextStreamPart 事件（start/delta/end）折叠为一个 TurnEvent。
2. **转换是有损的**——provider 元数据、message id、start/end 信号全部丢失。
3. **step 序号是 Vico 自己的**——不依赖 TextStreamPart 的 `start-step`/`finish-step`，Vico 自己维护 step 计数。
4. **压缩和 done 事件完全独立于 TextStreamPart**——它们是 Vico 框架层的原生事件。

## 四、架构决策分析

### 4.1 为什么不直接透传 TextStreamPart？

Vico 选择自定义 TurnEvent 而非透传 TextStreamPart 给前端，背后有几个权衡：

| 考量 | 透传 TextStreamPart | 自定义 TurnEvent |
|------|-------------------|----------------|
| **前端复杂度** | 前端需理解 20+ 种事件类型 | 前端只需处理 9 种，心智负担低 |
| **协议稳定性** | 依赖 AI SDK 版本，升级可能 break 前端 | 中间加一层映射，AI SDK 升级只影响后端 |
| **框架语义** | 需额外机制传递 compacted / turn done | 框架层语义原生融入协议 |
| **类型安全** | 保留 `TOOLS` 泛型的工具类型推导 | 丢失——`args` 变为 `Record<string, unknown>` |
| **可观测性** | 保留完整 request/response metadata | 丢失——仅保留 step 序号 |
| **SSE 适配** | 需整体序列化 TextStreamPart（含 unknown error 等不可序列化字段） | 所有字段均为 JSON 安全类型 |

### 4.2 丢失了什么？

1. **Message ID**（`text-delta.id`）— 前端无法按消息 id 关联 delta，无法做流式取消后的消息拼接。
2. **Provider 元数据**（`providerMetadata`）— 无法透传 provider 特有的补充信息（如 token logprobs、引用来源）。
3. **完整 Usage 分解** — `finish-step` 的步骤级 usage vs `done` 的 turn 级 usage。Vico 丢失了单步 granularity。
4. **Finish Reason** — `finish.finishReason` 可区分 `stop` / `length` / `content-filter` / `tool-calls`，TurnEvent 未暴露。
5. **工具类型推断** — TextStreamPart 的 `TOOLS` 泛型使 `chunk.input` 可推导为工具对应的 schema 类型；TurnEvent 的 `args` 是 `Record<string, unknown>`。
6. **来源引用 & 文件** — Vico 当前不处理 grounding/生成文件，但未来可能需要。

### 4.3 获得了什么？

1. **协议自主权** — 不绑定 AI SDK 版本，升级 SDK 不会 break 前端。
2. **语义清洁** — `compacted` / `done` / `step_start` / `step_end` 这些 turn 级语义是 AI SDK 没有的。
3. **序列化安全** — 所有字段可安全 JSON.stringify（`message: string` vs `error: unknown`）。
4. **前端简洁** — 9 种事件 vs 20+，且事件名风格一致（snake_case，非 kebab-case）。

## 五、改进建议

如果未来想在不破坏协议的基础上增强 TurnEvent：

### 5.1 最小增强（向后兼容）

```typescript
// 给现有事件加可选字段
| { type: 'text_delta'; content: string; messageId?: string }
| { type: 'reasoning_delta'; content: string; messageId?: string }
| { type: 'done'; usage: { input: number; output: number }; finishReason?: string }
```

messageId 可从 `chunk.id` 获取，finishReason 可从 `finish.finishReason` 获取。

### 5.2 可观测性增强

```typescript
// 新增 step 级 usage 事件，保留完成 step 元数据
| { type: 'step_usage'; step: number; usage: { input: number; output: number } }
```

当前 `finish-step` 携带的 usage 被静默累加，如 emit 出来，前端可按步骤展示 token 消耗。

### 5.3 审批事件暴露

```typescript
| { type: 'approval_request'; toolCallId: string; toolName: string }
```

当前审批在 `ApprovalGate` 内部通过异步回调完成，前端不可见。如果 emit 审批事件，前端可展示"等待审批"状态，提升用户体验。

## 六、总结

| | TurnEvent | TextStreamPart |
|---|----------|---------------|
| **事件数** | 9 | 20+ |
| **设计原则** | 按需裁剪，够用就好 | 完整记录，不遗漏 |
| **生命周期** | Turn 级（step → done） | Model call 级（start → finish） |
| **字段命名** | `content` / `id` / `name` / `args` / `message` | `text` / `toolCallId` / `toolName` / `input` / `error` |
| **类型安全** | 弱（args/output 是 unknown） | 强（TOOLS 泛型约束） |
| **元数据** | 极简（仅 step 序号） | 丰富（request/response/usage/finishReason/providerMetadata） |
| **序列化安全** | 是（全部 JSON-safe） | 否（error: unknown 等） |
| **框架语义** | 有（compacted / done） | 无 |
| **前端友好度** | 高 | 低（需裁剪后使用） |
