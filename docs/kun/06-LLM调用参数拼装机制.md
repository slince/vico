# Kun LLM 调用参数拼装机制

## 一、整体架构概览

Kun 的 LLM 请求拼装分为四个层次：

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: AgentLoop.modelStep()                          │
│   构建逻辑 ModelRequest 对象                              │
│   → 组合 systemPrompt、history、tools、contextInstructions│
├─────────────────────────────────────────────────────────┤
│ Layer 2: Token 经济 + 卫生层                              │
│   → 压缩工具描述/结果、清理历史上的工具输出                 │
├─────────────────────────────────────────────────────────┤
│ Layer 3: CompatModelClient.stream()                     │
│   → 将 ModelRequest 翻译为具体协议的 HTTP JSON body       │
├─────────────────────────────────────────────────────────┤
│ Layer 4: Prompt 缓存层                                   │
│   → 不可变前缀指纹、挥发性检测、工具目录漂移检测             │
└─────────────────────────────────────────────────────────┘
```

最终输出支持三种协议格式：**OpenAI Chat Completions**（默认）、**Anthropic Messages**、**OpenAI Responses**。

---

## 二、ModelRequest 接口（拼装目标）

文件：`kun/src/ports/model-client.ts`（第 22-66 行）

```typescript
type ModelRequest = {
  threadId: string
  turnId: string
  model: string
  systemPrompt?: string              // 不可变系统提示词
  modeInstruction?: string            // Plan 模式指导（可选）
  contextInstructions?: string[]      // 动态每轮指令（goal/todo/memories/skills等）
  prefix: TurnItem[]                  // Few-shot 示例
  history: TurnItem[]                 // 对话历史
  attachments?: ModelInputAttachment[]         // 图片附件
  attachmentTextFallbacks?: ModelTextAttachmentFallback[]
  tools: ModelToolSpec[]              // 工具定义
  requiredToolName?: string           // 强制要求的工具调用
  stream?: boolean
  maxTokens?: number
  temperature?: number
  reasoningEffort?: string            // 推理力度控制
  abortSignal: AbortSignal
}
```

---

## 三、Layer 1：AgentLoop.modelStep() 拼装全流程

文件：`kun/src/loop/agent-loop.ts`，核心方法 `modelStep()`（约 650 行）

### 完整时序

```
modelStep(threadId, turnId, signal, stepIndex)
│
├─ 1. 验证不可变前缀完整性 ─→ verifyImmutablePrefix(prefix)
│
├─ 2. 加载 Thread/Turn 状态 ─→ threadStore.load(), sessionStore.loadItems()
│
├─ 3. 首步修复损坏的历史项 ─→ healLoadedHistoryItems(loaded)
│
├─ 4. 挥发性检测 ─→ detectVolatilePrefixContent(prefix)
│     扫描前缀中的 UUID、ISO8601 日期、Hex 哈希、JWT
│     （会破坏 Prompt 缓存的动态内容）
│
├─ 5. 上下文压缩 ─→ compactIfNeeded(items, model, signal)
│     详见第八节
│
├─ 6. 解析模型路由 ─→ resolveTurnModel({...})
│     auto-model-router: 根据上下文选择 flash/pro 模型
│
├─ 7. 解析附件 ─→ 图片转 base64 data URI
│
├─ 8. 解析 Skills ─→ skillRuntime.resolveTurn({prompt, workspace})
│     返回: { activeSkillIds, activations, instructions, allowedToolNames }
│
├─ 9. 检索 Memories ─→ memoryStore.retrieve({query, workspace, limit})
│     返回: MemoryRecord[]
│
├─ 10. 构建 Goal/Todo 继续指令
│     goalContinuationInstruction(thread.goal)
│     goalNoToolRecoveryInstruction(...)
│     todoContinuationInstruction(thread.todos)
│     emptyPostToolRecoveryInstruction()
│
├─ 11. 解析工具列表 ─→ toolHost.listTools(toolContext)
│     按 Skill 允许列表、Plan 模式、Sandbox 模式过滤
│
├─ 12. 组装 contextInstructions[] （动态指令，顺序固定）
│
├─ 13. 组装 ModelRequest
│
├─ 14. Token 经济处理 ─→ applyTokenEconomyToRequest()
│
├─ 15. 历史卫生处理 ─→ applyRequestHistoryHygiene()
│
└─ 16. 发送请求 ─→ model.stream(request)
```

---

## 四、系统提示词（System Prompt）的组装

### 4.1 不可变前缀结构

文件：`kun/src/cache/immutable-prefix.ts`

```typescript
type ImmutablePrefix = {
  systemPrompt: string           // 完整的系统提示词（含 Skill 目录）
  tools: { name, description, inputSchema }[]  // 工具定义（目前为空数组）
  pinnedConstraints: string[]    // 压缩时保留的约束
  fewShots: TurnItem[]           // Few-shot 示例
  fingerprint: string            // SHA256 前 16 位
  revision: number               // 每次变动递增
}
```

### 4.2 组装顺序（运行时启动时一次性完成）

文件：`kun/src/server/runtime-factory.ts` 第 142-181 行

```
Step 1: 创建基础前缀
  prefix = createImmutablePrefix({
    systemPrompt: KUN_SYSTEM_PROMPT,
    pinnedConstraints: [
      'system: preserve user intent across compaction',
      'system: keep the HTTP/SSE contract stable for the GUI',
      'system: keep the stable Kun prefix byte-stable for prompt-cache reuse'
    ]
  })

Step 2: 将 Skill 目录折叠进 systemPrompt
  skillCatalog = skillRuntime.catalogInstruction()
  prefix = setSystemPrompt(
    prefix,
    `${KUN_SYSTEM_PROMPT}\n\n${skillCatalog}`
  )
  // 注意：是被拼接到 systemPrompt 文本内部，保持字节稳定！

Step 3: 最终前缀状态
  - systemPrompt: KUN_SYSTEM_PROMPT + "\n\n" + catalogInstruction
  - tools: [] (工具按 Turn 动态提供)
  - pinnedConstraints: 3 条系统约束
  - fewShots: [] (暂无预置示例)
  - fingerprint: SHA256(canonicalize(systemPrompt, tools, pinned, fewShots))
```

### 4.3 KUN_SYSTEM_PROMPT 内容

文件：`kun/src/prompt/kun-system-prompt.ts`（约 60 行 Markdown 风格文本）

包含以下段落：

```
"You are Kun, the GUI-native agent inside the Kun desktop app."

## Core identity
- Kun is delivered as an Electron desktop app
- Interact exclusively through the GUI contract...

## GUI contract
- The GUI sends HTTP/SSE requests...

## Coding behavior
- Respect the ports-and-adapters architecture...

## Tool behavior
- Use tools when relevant, prefer the built-in tool family...

## Memory behavior
- Relevant long-term memories may be injected per turn...
- When user states a durable preference, proactively call memory_create...

## Cache behavior
- This operating contract is intentionally stable...
- Do not casually reorder or rewrite this contract...

## Response style
- Clear, direct, useful; Chinese when appropriate...

## Safety and quality
- Never hide failures...
```

**核心设计约束**：系统提示词刻意保持**字节级稳定**，以便供应商的 Prompt 缓存可以跨所有模式（Code/Write/Plan/Tool 继续）复用同一个前缀。

---

## 五、contextInstructions 的组装顺序（最关键！）

文件：`kun/src/loop/agent-loop.ts` 第 1176-1194 行

**顺序固定、严格排列，每条都作为一个独立的 `system` 消息**：

```typescript
const contextInstructions = [
  // 位置 1：Goal 继续指令（如果存在活跃 Goal）
  // "You are working toward a goal: {objective}"
  // 包含预算、完成/阻塞审计规则、tokens-used 计数器
  ...(activeGoalInstruction ? [activeGoalInstruction] : []),

  // 位置 2：Goal 无工具重复恢复指令
  // 当模型连续无工具输出且相似度过高时触发
  ...(goalRecoveryInstruction && recoveryStep > 0 ? [goalRecoveryInstruction] : []),

  // 位置 3：Todo 继续指令
  // "Active todo list:\n- [ ] task1\n- [x] task2"
  ...(activeTodoInstruction ? [activeTodoInstruction] : []),

  // 位置 4：空 Post-Tool 恢复指令
  // 上一步工具结果返回后模型未产生有效输出时
  ...(emptyPostToolRecoverySteps > 0 ? [emptyPostToolRecoveryInstruction()] : []),

  // 位置 5：Memory 指令
  // "Relevant long-term memories for this turn:\n- [id] (scope) content"
  ...memoryInstructions(memories),

  // 位置 6：Skill 指令（从 skillRuntime 解析）
  // 每个激活 Skill 的 entry 内容（受 instructionBudgetBytes 限制）
  ...skillResolution.instructions,

  // 位置 7：用户输入不可用警告（IM/无头模式）
  ...(userInputDisabled ? [userInputUnavailableInstruction()] : []),

  // 位置 8：Shell 运行时指令（如果有 bash 工具）
  // 告知模型当前 shell 环境
  ...(toolSpecs.some(t => t.name === 'bash') ? [shellRuntimeInstruction()] : []),

  // 位置 9：工具目录漂移消息
  // "New tools available since your last turn: ..."
  ...(toolCatalogDriftMessage ? [toolCatalogDriftMessage] : [])
]
```

---

## 六、ModelRequest 的最终组装

文件：`kun/src/loop/agent-loop.ts` 第 1196-1221 行

```typescript
const baseRequest: ModelRequest = {
  threadId,
  turnId,
  model,
  systemPrompt: this.opts.prefix.systemPrompt,    // 不可变前缀
  ...(planTurnActive ? { modeInstruction: PLAN_MODE_INSTRUCTION } : {}),
  ...(contextInstructions.length ? { contextInstructions } : {}),
  prefix: this.opts.prefix.fewShots,               // Few-shot 示例
  history: capToolResultImages(history, MAX_FORWARDED_TOOL_IMAGES), // 历史 + 图片上限
  ...(attachments.imageAttachments.length ? { attachments: attachments.imageAttachments } : {}),
  ...(attachments.textFallbacks.length ? { attachmentTextFallbacks: attachments.textFallbacks } : {}),
  tools: effectiveToolSpecs,                        // 按字母排序的工具列表
  ...(requiredToolName ? { requiredToolName } : {}),
  ...(modelRoute.reasoningEffort ? { reasoningEffort: modelRoute.reasoningEffort } : {}),
  abortSignal: signal
}
```

---

## 七、Layer 2：Token 经济与历史卫生

### 7.1 Token 经济

文件：`kun/src/loop/token-economy.ts`

```typescript
type TokenEconomyConfig = {
  enabled?: boolean                  // 默认 false
  compressToolDescriptions?: boolean // 默认 true — 压缩工具描述用词
  compressToolResults?: boolean      // 默认 true — 压缩工具输出
  conciseResponses?: boolean         // 默认 true — 追加"简洁回复"指令
  historyHygiene?: RequestHistoryHygieneOptions
}
```

启用后效果：
- **压缩工具描述**：`compressProse()` + `compactSchemaDescriptions()` 精简描述文本
- **压缩工具结果**：按工具类型定制截断策略：

| 工具 | 策略 |
|------|------|
| `bash` | 保留头部 24 行 + 尾部 96 行 + 错误/警告行，最多 180 行 / 24KB |
| `read` | 仅保留头部，最多 320 行 / 32KB |
| `grep` | 最多 80 个匹配，上下文行被截为 2 行 |
| `find` | 最多 160 个匹配 |
| `ls` | 最多 120 个条目 |
| 通用文本 | 保留头部，最多 220 行 / 24KB |
| 数组 | 最多 80 项 |

- **简洁回复指令**：追加一段指令要求模型：跳过开场白、修辞、客套话
- **散文压缩**：去除 "I'll"、"let me"、"please"、"just"、"really" 等冗余词

### 7.2 历史卫生

文件：`kun/src/loop/request-history-hygiene.ts`

无条件执行：

```
- 每条工具结果的限制：320 行 / 32KB / 8K tokens
- 累计工具结果 token 预算：默认 120K tokens
- 最近 4 条工具结果保持原文
- 超出预算的旧结果折叠为单行摘要
- Base64 数据（非模型可见图片）超过 256 字符则去除
- 工具参数字符串：限制 8KB / 2K tokens
```

### 7.3 工具结果图片上限

文件：`kun/src/loop/tool-result-image.ts`

仅保留最近 **3** 条含图片的工具结果的 base64 数据，更旧的替换为文本占位符。

---

## 八、上下文压缩

文件：`kun/src/loop/context-compactor.ts`

### 8.1 触发阈值

```typescript
// 默认值
softThreshold: 96,000 tokens     // 普通压缩，保留 4 条最近项
hardThreshold: 108,800 tokens    // 强制压缩，保留 1 条最近项
// DeepSeek V4 定制值
softThreshold: 750,000 tokens    // (1M * 0.75)
hardThreshold: 850,000 tokens    // (1M * 0.85)
```

安全上限：即使配置了更大的值，也会被强制限制在上下文窗口的 75%/85%。

### 8.2 压缩算法

```
planCompaction(items, options):
  1. 计算估计 token 数
  2. 判断压缩模式: normal / aggressive / force
  3. 分割: head = items.slice(0, -keepRecent)
           tail = items.slice(-keepRecent)
  4. 构建 summaryItem:
     - 原因/模式/预算
     - Pinned constraints（从不可变前缀提取，跨压缩保留）
     - Pinned skills（从历史中提取 "Active Skill:" / "Skill Pin:" 标记）
     - 每个被压缩项的摘要（一行一项，最旧的排除）
     - 压缩摘要短哈希（去重用）
  5. 返回 [frozen..., summaryItem, ...tail]
```

### 8.3 模型辅助压缩

当 `summaryMode === 'model'` 时，会发起一个极简的独立模型请求来生成更高质量的总结：

```
请求参数:
- systemPrompt: 与主请求相同
- contextInstruction: "Summarize context for a history fold..."
- compaction prompt: 包含待压缩的对话项
- tools: 无
- temperature: 0
- reasoning_effort: off
- maxTokens: ~1200
```

---

## 九、Layer 3：CompatModelClient 的协议翻译

文件：`kun/src/adapters/model/compat-model-client.ts`（约 2600 行）

### 9.1 入口

```typescript
async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
  const body = this.buildRequestBody(request)
  const response = await this.fetchWithRetry(url, { method: 'POST', headers, body })
  // 解析 SSE 或 JSON 响应
  for await (const chunk of parseStream(response.body)) {
    yield chunk
  }
}
```

### 9.2 消息序列化顺序：collectMessages()

文件：`compat-model-client.ts` 第 613-652 行

**这是整个拼装中最关键的排序决策**。最终 HTTP body 中 messages 数组的排列顺序：

```
消息数组 (messages/input):
┌──────────────────────────────────────────────────────┐
│                                                       │
│  [0] system: KUN_SYSTEM_PROMPT + skillCatalog        │ ← 不可变，可缓存
│  [1] system: PLAN_MODE_INSTRUCTION (if plan mode)     │ ← 模式相关，可缓存
│                                                       │
│  ── FEW-SHOT + HISTORY ITEMS ──────────────────────  │
│  [2] user:   "<few-shot user message>"               │ ← 前缀部分可缓存
│  [3] assistant: "...", tool_calls: [...]             │
│  [4] tool:   "...", tool_call_id: "..."              │
│  [5] user:   "<history user message>"                │ ← 历史部分每轮变化
│  [6] assistant: "...", tool_calls: [...]             │
│  [7] tool:   "...", tool_call_id: "..."              │
│  ...                                                  │
│                                                       │
│  ── CONTEXT INSTRUCTIONS (volatile, AFTER history) ─│
│  [N+0] system: "<goal continuation>"                 │ ← 动态，每步变化
│  [N+1] system: "<goal no-tool recovery>"             │
│  [N+2] system: "<todo list>"                         │
│  [N+3] system: "<empty post-tool recovery>"          │
│  [N+4] system: "Relevant memories: ..."              │
│  [N+5] system: "<skill instruction 1>"               │
│  ...                                                  │
│                                                       │
│  [图片附件追加到最新一条 user 消息后]                   │
│  [文本 fallback 追加到最新一条 user 消息后]             │
│                                                       │
└──────────────────────────────────────────────────────┘
```

**为什么 contextInstructions 放在 history 之后？**

文件：`compat-model-client.ts` 第 637-644 行注释：

> "Per-turn context (goal budgets, todo state, memories, skill notes, drift warnings) is volatile — the goal instruction alone embeds a tokens-used counter that changes every step. It must trail the stable history: placed before it, every counter tick invalidated the provider prompt cache for the entire conversation."

Goal 指令包含一个 `tokensUsed` 计数器，如果放在历史前面，每次计数器变化都会使整个对话的缓存失效。放在最后意味着只有变动的尾部不会被缓存，前缀和历史仍然可复用。

---

## 十、TurnItem → ChatMessage 转换

文件：`compat-model-client.ts` 第 654 行 `itemsToMessages()`

| TurnItem 类型 | ChatMessage role | 说明 |
|--------------|-----------------|------|
| `user_message` | `user` | 直接文本 |
| `assistant_text` | `assistant` | 文本 + 可选 `reasoning_content` |
| `assistant_reasoning` | (合并) | 与后续 `assistant_text` 合并为 `reasoning_content` |
| `tool_call` | `assistant` | 含 `tool_calls` 数组 |
| `tool_result` | `tool` | 含 `tool_call_id`，内容为文本或图片 |
| `compaction` | `system` | 压缩摘要（仅当 replacedTokens > 0） |
| `review` | `system` | 代码审查结果（仅当已完成） |
| `approval` / `user_input` / `error` | (跳过) | 不发送给模型 |

### 工具调用批处理

连续的同 Turn 工具调用被合并为单个 assistant 消息，包含多个 `tool_calls`，后跟所有对应的 `tool_result`。

### 图片处理

- **OpenAI 兼容协议**：工具结果中的图片被提取出来，附加到后续独立的 user 消息中（因为 OpenAI 不支持 tool 消息中的 image_url）
- **Anthropic 协议**：图片作为同级 block 直接放在包含工具结果的 user 消息中

---

## 十一、三种协议格式对比

### 11.1 OpenAI Chat Completions（默认）

```json
{
  "model": "deepseek-v4-pro",
  "stream": true,
  "stream_options": { "include_usage": true },
  "messages": [
    { "role": "system", "content": "<KUN_SYSTEM_PROMPT>" },
    { "role": "system", "content": "<PLAN_MODE_INSTRUCTION>" },
    { "role": "user", "content": "<user msg>" },
    { "role": "assistant", "content": "...", "tool_calls": [...] },
    { "role": "tool", "content": "...", "tool_call_id": "..." },
    { "role": "system", "content": "<goal continuation>" },
    { "role": "system", "content": "<todo list>" },
    { "role": "system", "content": "Relevant memories: ..." },
    { "role": "system", "content": "<skill instructions>" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "bash",
        "description": "Execute a shell command...",
        "parameters": { "type": "object", "properties": {...}, "required": [...] }
      }
    }
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "reasoning_effort": "high"
}
```

**特点**：
- 系统提示词、模式指令、上下文指令全部作为 `role: "system"` 消息
- 工具使用 `type: "function"` 包裹
- 工具按名称字母排序
- `stream_options.include_usage: true` 获取每块的用量统计

### 11.2 Anthropic Messages

```json
{
  "model": "claude-sonnet-4-20250514",
  "stream": true,
  "max_tokens": 4096,
  "system": [
    {
      "type": "text",
      "text": "<KUN_SYSTEM_PROMPT>",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "<user message>" }
      ]
    },
    {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "<response>" },
        { "type": "tool_use", "id": "call_1", "name": "bash", "input": {...} }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "tool_result", "tool_use_id": "call_1", "content": "..." },
        { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "<trailing context instructions>" },
        { "cache_control": { "type": "ephemeral" } }
      ]
    }
  ],
  "tools": [
    {
      "name": "bash",
      "description": "Execute a shell command...",
      "input_schema": { "type": "object", "properties": {...}, "required": [...] }
    }
  ],
  "thinking": { "type": "adaptive" }
}
```

**特点**：
- **System prompt 是顶层 `system` 字段**，不是消息数组中的元素
- `cache_control: { type: "ephemeral" }` 标记可缓存部分（system block、最后 2 条 user 消息的末尾内容块）
- 消息严格交替 `user`/`assistant`
- 早期的 system message（systemPrompt, modeInstruction）进入顶层 `system` 块
- **尾随的 system message（contextInstructions）被转换为 user 消息**，折叠进对话流
- 工具直接使用 `name/description/input_schema`，无 `type: "function"` 包裹
- Assistant 内容块可包含 `thinking` 块（思考模式）

### 11.3 OpenAI Responses API

```json
{
  "model": "gpt-4o",
  "stream": true,
  "input": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." },
    { "type": "function_call", "call_id": "call_1", "name": "bash", "arguments": "{...}" },
    { "type": "function_call_output", "call_id": "call_1", "output": "..." }
  ],
  "tools": [
    { "type": "function", "name": "bash", "description": "...", "parameters": {...} }
  ],
  "max_output_tokens": 4096,
  "reasoning": { "effort": "high" }
}
```

**特点**：`function_call` 和 `function_call_output` 是 `input` 数组中的独立项，不嵌套在消息内部。

---

## 十二、Layer 4：Prompt 缓存策略

### 12.1 不可变前缀指纹

文件：`kun/src/cache/immutable-prefix.ts`

```typescript
// 计算指纹
fingerprint = SHA256(
  JSON.stringify(canonicalize({
    systemPrompt,
    tools: tools.sort(byName).map(canonicalSchema),
    pinnedConstraints: pinnedConstraints.sort(),
    fewShots: fewShots.map(extractShape)
  }))
).slice(0, 16)

// 每次变动校验
verifyImmutablePrefix(prefix) // 指纹不匹配时抛出异常
```

### 12.2 挥发性检测

文件：`kun/src/cache/prefix-volatility.ts`

扫描前缀中可能破坏缓存一致性的动态内容：

| 模式 | 说明 |
|------|------|
| UUID | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| ISO 8601 日期 | `2024-01-15T...` |
| Hex 哈希 (32/40/64) | MD5 / SHA1 / SHA256 格式 |
| JWT | `eyJ...` 格式 |

检测到会作为诊断信息记录，但不会自动修改内容。

### 12.3 工具目录指纹与漂移

文件：`kun/src/cache/tool-catalog-fingerprint.ts`

```typescript
type ToolCatalogDrift = 'none' | 'additive' | 'breaking'
// none:     工具集未变
// additive: 仅新增工具，无删除/修改
// breaking: 工具被删除或修改 → 中止 Turn
```

### 12.4 各级缓存协同

```
┌────────────────────────────────────────────────────────┐
│ 字节稳定的前缀部分 (provider 侧缓存整个前缀)            │
│                                                        │
│  system: KUN_SYSTEM_PROMPT + skill catalog             │
│  system: PLAN_MODE_INSTRUCTION                         │
│  user/assistant/tool: few-shot items                   │
│                                                        │
│ Anthropic: cache_control ephemeral on system block     │
│ OpenAI: implicit prefix caching                        │
├────────────────────────────────────────────────────────┤
│ 相对稳定的历史部分 (可能被缓存)                          │
│                                                        │
│  user/assistant/tool: conversation history             │
│  system: compaction summaries                          │
│                                                        │
│ Anthropic: cache_control on last 2 user msgs          │
├────────────────────────────────────────────────────────┤
│ 每步变化的尾部 (不能被缓存)                              │
│                                                        │
│  system: goal instruction (含 tokensUsed 计数器)       │
│  system: todo state                                    │
│  system: memories                                      │
│  system: skills                                        │
│  system: drift warnings                                │
│                                                        │
│ 这是有意放在最后的 — 缓存前缀被保留                      │
└────────────────────────────────────────────────────────┘
```

---

## 十三、完整请求拼装时序总结

```
运行时启动（一次性）:
  KUN_SYSTEM_PROMPT
    + skillRuntime.catalogInstruction()  (始终可见的 Skill 目录)
    = prefix.systemPrompt                 (字节稳定，整个会话不变)

每轮 Turn 开始:
  1. 验证前缀指纹
  2. 挥发性检测（UUID/日期/哈希扫描）
  3. 加载并修复历史
  4. 上下文压缩（按需）
  5. 解析模型路由
  6. 解析 Skills（触发器匹配）
  7. 检索 Memories
  8. 构建 Goal/Todo/Emergency 指令

每个 modelStep():
  9. 解析工具列表（按 Skill 允许列表过滤）
  10. 组装 contextInstructions（9 类固定顺序）
  11. 组装 ModelRequest
  12. Token 经济压缩
  13. 历史卫生清理
  14. CompatModelClient.stream()
      └→ collectMessages()  // 严格排列消息顺序
      └→ buildRequestBody() // 翻译为具体协议的 JSON
      └→ fetch()             // HTTP POST → SSE 流式解析
```

---

## 十四、与 Vico 的对比

| 维度 | Kun | Vico |
|------|-----|------|
| Agent 引擎 | 自研 AgentLoop (~2400行) | Vercel AI SDK `streamText()` |
| 系统提示词 | 手动拼接常量字符串 | AI SDK system prompt 参数 |
| Skill 注入 | 拼接到 systemPrompt 内部（字节稳定） | prompt.md 拼接到系统提示词 |
| Skill 目录 | catalogInstruction 始终可见 | 无此概念 |
| 上下文指令 | 手动维护 9 类指令的顺序数组 | AI SDK 自动管理 |
| 消息序列化 | 手写 3 种协议适配 | AI SDK 统一抽象 |
| 缓存策略 | 自研不可变前缀 + 指纹 + 挥发性检测 | 依赖 AI SDK 和供应商 |
| 历史管理 | 自研压缩 + 卫生 + 图片上限 | AI SDK 默认行为 |
| Token 经济 | 自研 prose 压缩 + 工具输出截断 | 无此机制 |
| 工具格式 | 按协议手写 JSON | AI SDK Tool type |
| 推理协议 | 手写 DeepSeek/Anthropic/GLM 等多协议推理翻译 | AI SDK 自动处理 |

**Kun 对 Vico 最有参考价值的设计**：

1. **contextInstructions 放在 history 之后**——这是 Kun 经过实践验证的缓存优化关键：goal 的 tokensUsed 计数器如果放在历史前面，每次变化都会使整段对话的缓存失效
2. **不可变前缀 + 指纹校验**——确保系统提示词在整个会话中字节不变，最大化 Prompt 缓存利用率
3. **Token 经济压缩**——定制化工具输出截断策略（bash 保留头尾+错误行，read 保留头部等）
4. **历史卫生**——累计工具结果 token 预算（120K）+ 最近 4 条保留，自动折叠旧输出
5. **Skill 目录折叠进 systemPrompt**——让模型始终知道有哪些可用 Skill，而无需等待触发器匹配
6. **上下文压缩的 Skill Pin 保留**——压缩时从历史中提取 Skill 标记并保留，确保 Skill 约束跨压缩持续生效
