# 上下文压缩（Context Compaction）设计

> 日期：2026-10-15
> 状态：待评审
> 范围：`packages/core`、`packages/libsql-adapter`、`packages/mysql-adapter`、`vico/server`
> 对齐基线：`~/www/js/deepseek-harness`（`dsh-compaction` seam + `dsh-compaction-basic` + `dsh-token-meter`）

## 1. 背景与目标

Vico 的会话历史在每次新 turn 开始时**全量重新注入**模型上下文：

```
LoopAgent.startTurn → pipeline.enter → MemoryProcessor.injectConversationHistory
  → ConversationHistoryMemory.get(threadId)
    = getRecentTurns(threadId, stm_window)   // 最近 N 个已完成 turn
    + getEntriesByTurns(turnIds)             // 这些 turn 的全部消息
  → ctx.messages.unshift(history)
```

当历史消息过大（长对话、大量工具调用结果）时，token 占用持续增长，最终超出模型上下文窗口或显著抬高成本/延迟。

**目标**：当历史过大时，对用户消息、助手消息、工具调用结果等进行**摘要汇总**，形成**一条新的持久化消息**；后续加载历史时**不再读取被摘要的旧消息**。摘要采用**增量滚动**方式，长度有界。

现有 `packages/core/src/agent/context-compactor.ts` 是**死代码**：未被 `createAgent` 接线，且只做内存态替换（每 model step 前原地替换 `step.messages`，不持久化，下次 turn 重载历史即失效）。本设计将其重写为**持久化、可主动触发的压缩器**，配置口径与 token 估算**全面对齐 deepseek-harness**。

## 2. 设计原则（对齐 deepseek-harness / kun）

- **capability seam**：压缩作为 core 层的**端口 + 默认实现**，不塞进 LoopAgent 主循环内部逻辑；对应 deepseek 的 Service Definition（`ctx.compaction`）+ Service Provider（`compaction-basic`）+ Consumer（`agent/pre-step`、`agent/request-error`、`dsh-command-compact`）。
- **append-only**：旧消息软归档（`archived` 标记），不物理删除，可审计、可回滚；对应 deepseek 的 surface `replace` 语义（Vico 用「归档 + 追加摘要」落地）。
- **只压缩已完成 turn**：绝不碰 in-flight（running/paused/failed）turn。
- **增量滚动**：新摘要 = 旧摘要 + 新被压缩段；历史中始终只有一条最新非归档摘要。
- **两级 token 定价 + usage 锚定**：判定/切分用 route-priced token，替换记账用固定启发式 token，两者都由 provider 上报的 usage 锚定。
- **结构化 checkpoint**：摘要输出固定 8 节 Markdown 模板，且**摘要必须小于被压缩内容**（shrink check）。

## 3. 架构与组件归属

| 层 | 文件 | 改动 |
|---|---|---|
| 端口 | `packages/core/src/agent/context-compactor.ts` | 重写：`ContextCompactor` 接口 + `ModelContextCompactor` 默认实现 + `CompactionResult` / `CompactionTrigger` / `ManualCompactionError` |
| 估算 | `packages/core/src/agent/token-estimator.ts`（新增） | 对齐 token-meter：分 part 定价、`ROLE_OVERHEAD`/`BLOCK_OVERHEAD`、usage 锚定 |
| 端口 | `packages/core/src/thread/thread-store.ts` | `Message.archived?: boolean`；`getEntries`/`getEntriesByTurns` 加 `includeArchived`；新增 `archiveMessages` |
| 加载 | `packages/core/src/memory/conversation-history-memory.ts` | 历史 = 摘要（前置）+ 最近 N 个已完成 turn 的**非归档**消息 |
| 接线 | `packages/core/src/agent/loop-agent.ts` | 删除死代码 `tryCompact`；新 turn 前触发 `compactIfNeeded('pressure')`；`callModel` 检测 context-overflow 触发 `compactIfNeeded('context-overflow')` 并重试；实现 `Agent.compactThread` |
| 契约 | `packages/core/src/agent/agent.ts` | `Agent` 接口新增 `compactThread(threadId, signal?)` |
| 装配 | `packages/core/src/agent/create-agent.ts`、`agent/vico.ts`、`agent/types.ts` | `AgentConfig`/`VicoOptions` 增加 `compaction` 配置；`ModelConfig` 增加可选 `contextWindow` |
| 适配器 | `libsql-adapter` / `mysql-adapter` / `memory-thread-store.ts` | `vico_messages.archived` 列 + `archiveMessages` + `includeArchived` 过滤 |
| 服务 | `vico/server/src/memory/memory-setup.ts` | 构造 compactor 单例并注入 |
| 服务 | `vico/server/src/api/threads.ts` | 新增 `POST /api/v1/threads/:id/compact` |
| 配置 | `vico/server/server.config.yaml` | 新增 `memory.compaction` 配置块 + 模型 `contextWindow` |

## 4. 端口与 API 形态

### 4.1 ContextCompactor（core 层端口，对齐 `CompactionEngine`）

```ts
// @vico/core
export type CompactionTrigger = 'pressure' | 'context-overflow';

/** 手动压缩失败的稳定分类（对齐 ManualCompactionErrorCode） */
export type ManualCompactionErrorCode =
  | 'busy' | 'cancelled' | 'changed' | 'summary' | 'commit' | 'persistence';

export class ManualCompactionError extends Error {
  constructor(readonly code: ManualCompactionErrorCode, message: string, options?: ErrorOptions);
}

export interface CompactionResult {
  /** 新写入的摘要消息 id */
  summaryMessageId: string;
  /** 被归档的已完成 turn id 列表（surface 位置语义由 turn 顺序表达） */
  archivedTurnIds: string[];
  /** 被替换区间的首/尾 turn id（对齐 shadowedRange 的位置语义） */
  shadowedRange: { startTurnId: string; endTurnId: string };
  /** 被归档消息的固定启发式 token 数（对齐 shadowedTokenCount） */
  shadowedTokenCount: number;
  /** 本次估算移除的 route-priced token 数（shadowedTokenCount 的 route 口径） */
  removedTokens: number;
}

export interface ContextCompactor {
  /** 自动：按 trigger 判定；未达阈值或无可压缩区间返回 null（对齐 deepseek 的 null = 未压缩） */
  compactIfNeeded(
    thread: Thread,
    modelClient: ModelClient,
    trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null>;

  /** 主动：忽略阈值，压缩除保留尾部外的全部已完成 turn；无可用区间返回 null */
  compactNow(
    thread: Thread,
    modelClient: ModelClient,
    signal: AbortSignal,
  ): Promise<CompactionResult | null>;

  /** 记录最近一次请求的 provider 上报 prompt token（usage 锚定用；LoopAgent 在 callModel 后调用） */
  recordUsage(threadId: string, pressureTokens: number): void;
}
```

- `modelClient` 由调用方传入（`LoopAgent` 持有 run 级解析后的 `modelClient`）；摘要目标模型按 §5.2 的 `summarizationProvider/summarizationModel` 独立解析，未配置时复用该 `modelClient` 对应模型。压缩器不持有模型、保持无状态（除配置与 `thread` 端口外）。
- deepseek 的 `compactRegion(start, end, agent, signal)` 定位为内部私有步骤（Vico 不对外暴露按 seq 区间压缩的公共 API；区间的稳定性由 per-thread 锁与「只压缩 completed turn」保证）。
- 默认实现类名 `ModelContextCompactor`，`ContextCompactor` 作为接口导出（兼容既有 `ContextCompactor` 导出名）。

### 4.2 ThreadStore 端口扩展

```ts
export interface Message {
  // ...现有字段
  /** 是否已被压缩归档（模型上下文不再读取；UI 仍全量展示） */
  archived?: boolean;
}

export interface ThreadStore {
  getEntries(threadId: string, options?: {
    limit?: number; start?: number; roles?: string[];
    /** 默认 true；false 时排除已归档消息 */
    includeArchived?: boolean;
  }): Promise<Message[]>;

  getEntriesByTurns(turnIds: string[], options?: {
    /** 默认 true；false 时排除已归档消息 */
    includeArchived?: boolean;
  }): Promise<Message[]>;

  /** 批量归档消息（软标记 archived=1），只作用于已完成 turn 的消息 */
  archiveMessages(threadId: string, messageIds: string[]): Promise<void>;
}
```

### 4.3 Agent 契约扩展

```ts
export interface Agent {
  /**
   * 主动压缩指定会话：忽略 token 阈值，压缩除最近保留 turn 外的全部已完成 turn。
   * 无可用区间时返回 null（不写库）；thread 不存在返回 null。
   */
  compactThread(threadId: string, signal?: AbortSignal): Promise<CompactionResult | null>;
}
```

`LoopAgent` 实现：`getThread(threadId)` → 不存在返回 null → `compactor.compactNow(thread, this.modelClient, signal)`。

### 4.4 HTTP API

`vico/server/src/api/threads.ts` 新增：

```
POST /api/v1/threads/:id/compact
```

- 鉴权：`getAuthContext(c)`，`thread.userId` 归属校验（复用 `threadManager` 现有校验逻辑）。
- 判定顺序：线程不存在 → `404`；`agent.compactor` 未配置 → `501`；否则调用 `agent.compactThread(id, c.req.raw.signal)`。
- 返回：有结果 → `200` + `CompactionResult`；返回 null（无可压缩区间）→ `200` + `{ compacted: false }`；`ManualCompactionError` → 按 `code` 映射 4xx（`busy`→409）。
- 同步执行（单次摘要 LLM 调用，约 1–2s）；异步任务化留作 follow-up。

## 5. 配置模型（对齐 `BasicCompactionConfig` + `resolveCompactSpec`）

### 5.1 压缩配置（`memory.compaction`）

```ts
// CompactionSettings，字段语义逐一对应 deepseek BasicCompactionConfig
export interface CompactionSettings {
  /** 是否启用自动压缩（pressure + context-overflow 监听）。默认 true */
  auto?: boolean;
  /** 窗口压力比例 (0,1]。默认 0.8 */
  thresholdRatio?: number;
  /** 输出预留之外再预留的 headroom token。默认 65536 */
  headroomTokens?: number;
  /** 保留尾部比例（相对 messageBudget，与 retainTokens 互斥）。默认 0.16 */
  retainRatio?: number;
  /** 保留尾部绝对 token 预算（与 retainRatio 互斥） */
  retainTokens?: number;
  /** 摘要 provider；与 summarizationModel 成对设置，空字符串 = 复用 agent 模型 */
  summarizationProvider?: string;
  /** 摘要 model；与 summarizationProvider 成对设置 */
  summarizationModel?: string;
  /** 摘要生成 token 上限。默认 = headroomTokens */
  maxTokens?: number;
  /** pressure 达阈值后的额外压缩尝试次数。默认 1 */
  compactionRetries?: number;
  /** context-overflow 后的最大恢复重试次数，0 禁用。默认 1 */
  maxOverflowRetries?: number;
  /** 精确 provider/model 覆盖表（Vico 单租户通常用默认即可）；override 字段为除 `auto`/`modelPolicies` 外的全部策略字段 */
  modelPolicies?: Array<{
    provider: string;
    model: string;
    thresholdRatio?: number;
    headroomTokens?: number;
    retainRatio?: number;
    retainTokens?: number;
    summarizationProvider?: string;
    summarizationModel?: string;
    maxTokens?: number;
    compactionRetries?: number;
    maxOverflowRetries?: number;
  }>;
}
```

### 5.2 预算解析（对齐 `resolveCompactSpec`）

```
messageBudgetTokens  = contextWindow − reservedCompletionTokens
pressureBudgetTokens = messageBudgetTokens − headroomTokens
thresholdTokens      = floor(min(contextWindow × thresholdRatio, pressureBudgetTokens))
retainTokens         = 显式 retainTokens ?? floor(messageBudgetTokens × retainRatio)
约束：retainTokens < thresholdTokens；pressureBudgetTokens > 0
```

- `contextWindow` 来源：`ModelConfig.contextWindow`（**新增可选字段**，见 §5.3）。缺失且触发 pressure 时抛 `TargetPressureConfigError`（对齐 deepseek：`info.context === undefined` 时报错）。
- `reservedCompletionTokens` = `agent.maxTokens ?? 0`（对应 `ModelRequest.maxOutputTokens`；未配置输出上限则无预留，对齐 deepseek「无声明 cap 则不预留」）。
- 校验规则照搬 deepseek `resolveConfig`/`resolveTargetPolicy`：未知 key 报错、`retainRatio` 与 `retainTokens` 互斥、`retainRatio < thresholdRatio`、`summarizationProvider/Model` 必须成对空/非空、`modelPolicies` 重复 target 报错。

### 5.3 `ModelConfig.contextWindow`（Vico 侧适配）

`@ai-sdk/provider` v4.0.7 的 `LanguageModelV4` **不暴露 `contextWindow`**（已确认），故比例阈值所需容量必须显式配置：

```ts
export interface ModelConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey: string;
  /** 模型上下文窗口 token 数；启用压缩（pressure 触发）时必填 */
  contextWindow?: number;
}
```

- server 侧从 `server.config.yaml` 的模型配置读取并透传。
- 这是与 deepseek 的唯一硬性架构差异：deepseek 的 adapter 自带 `resolveModelInfo().contextWindow`，Vico 需显式声明。

## 6. 触发判定（对齐 `compactIfNeeded` 双 trigger）

### 6.1 `pressure`（新 turn 开始前）

- **测量时机**：新 turn 开始前、history 注入前（对齐 deepseek 的 `agent/pre-step`，但 Vico 只压缩已完成 turn，故钩在 turn 边界而非每个 model step）。
- **候选 surface**（测量对象）：

```
candidate = [最新非归档摘要] ++ [最近 stm_window 个已完成 turn 的非归档消息]
```

- 流程（逐行对应 deepseek `BasicCompactionEngine.compactIfNeeded` pressure 分支）：

```
1. 解析 conversation target（agent 的 provider/model）→ resolveTargetPolicy
2. resolveCompactSpec(policy, contextWindow, agent.maxTokens ?? 0)
3. measurement = meter.measure(candidate)   // §7 usage 锚定 + surface 增量
4. measurement.totalTokens < thresholdTokens → no-op（返回 null）
5. 循环 attempt = 0..compactionRetries：
   a. range = selectCompactableRange(candidate, measurement, retainTokens)   // §6.3
   b. range === null → 返回 null（或已压缩过则 break）
   c. 执行压缩（§8 数据流）
   d. 重新测量；totalTokens < thresholdTokens → 返回结果
6. 仍未低于阈值 → 抛错（对齐 deepseek「compaction still above threshold」）
```

### 6.2 `context-overflow`（模型报错重试）

- **触发点**：`callModel` 捕获到上下文窗口超限错误（对齐 deepseek 的 `agent/request-error` 钩子 + `CONTEXT_WINDOW_EXCEEDED_CODE`）。
- **Vico 侧适配（关键差异）**：`@ai-sdk/provider` v4 无 first-class 超限错误码，错误以 `error` part 的 `unknown` 出现。采用**启发式检测**：匹配 `error.message` / `APICallError.statusCode`（如 400 + `context length` / `maximum context length` / `context_length_exceeded` 等关键词）。检测函数独立成 `isContextOverflowError(error)`，便于扩展 provider 特例。
- **流程**：

```
1. isContextOverflowError(err) 为 false 或 signal.aborted → 原样冒泡
2. resolveTargetPolicy → overflowRetries.get(thread) >= maxOverflowRetries → 原样冒泡
3. result = compactIfNeeded(thread, modelClient, 'context-overflow', signal)
   - retainTokens = 0：强制压缩全部可压缩区间（对齐 deepseek 的「bypass 正常阈值与保留尾部」）
   - 失败但已产生 durable 归档（archivedTurnIds 非空）→ 记一次重试并返回 retry
4. 成功 → overflowRetries.set(thread, +1) → 重试原模型请求
```

- `overflowRetries` 用 `WeakMap<Thread, number>` 维护，任一 turn 成功完成（收到正常 assistant 消息）即清零（对齐 deepseek 的 `agent/status === 'idle'` / `assistant/message` 重置）。

### 6.3 压缩区间选择（对齐 `selectCompactableRange`）

```
selectCompactableRange(candidate, measurement, retainTokens):
  nodes = 按 surface 顺序（摘要在前，其后为各已完成 turn 的消息）
  firstIdx = 0（candidate 无 system head；Vico 的 system prompt 由 SystemPromptProcessor 注入，不在历史内）
  从尾部向前累计 node.tokens，直到累计 >= retainTokens → 得 keepFromIdx
  若 keepFromIdx <= firstIdx → null
  将 keepFromIdx 向上取整到 turn 边界（Vico 的 turn 天然 tool-pairing balanced，
    因为 tool-call/result 位于同一 turn 内）→ 对齐 deepseek 的 toolPairingBalancedBefore 扩界
  若切到 turn 边界后 head 为空 → null
  返回 head 区间（待归档的 turn 列表；最旧的摘要节点计入 head，随增量折叠进新摘要）
```

- **粒度差异（诚实标注）**：deepseek 在 message 级 + `toolPairingBalancedBefore/After` 切，可得到比 turn 更细的 balanced 边界；Vico 按 **turn 粒度**切（更粗但天然 balanced）。语义（token 预算保留尾部 + 不拆 tool 配对）完全对齐，粒度不同。

## 7. token 估算（对齐 `dsh-token-meter`）

### 7.1 固定启发式（`estimate.ts`）

```
CHARS_PER_TOKEN = 4
BLOCK_OVERHEAD  = 4   // 每个 content block 的 JSON 结构/类型标签开销
ROLE_OVERHEAD   = 4   // 每条消息 role 字段框架开销

estimateContent(blocks):
  text/reasoning block → ceil(len / 4) + BLOCK_OVERHEAD
  tool-call block     → ceil(name.len / 4) + ceil(arguments.len / 4) + BLOCK_OVERHEAD
  其它/未知 block     → BLOCK_OVERHEAD + ceil(JSON.stringify(block).len / 4)

estimateMessage(msg):
  role === 'system' → estimateSystemMessage(msg)   // 文本密度 + ROLE_OVERHEAD，无 per-block
  其它              → estimateContent(msg.content) + ROLE_OVERHEAD
```

- Vico 的 `Message.content` 是 AI SDK 的 `ModelMessage`（string 或 parts[]）。parts 按上述 block 类型分派（text / reasoning / tool-call / tool-result 等）；纯 string content 视为 text block。

### 7.2 两级定价与 usage 锚定（`route-pricing` + `contextPressureProjection`）

```
每个 surface node 携带两个价格：
  heuristicTokens = 固定启发式价格（替换记账/shadow-price 用）
  tokens          = route-priced 价格（判定/切分/shrink 比较用）

route-pricing：图片/文件 block 用模型实际表示计价（Vico v1 无图片/文件 → 纯文本时 tokens === heuristicTokens）。
  该路径仍保留接口，图片/文件场景留作 follow-up（对齐 deepseek 的 priceSurface）。

usage 锚定（projectedTokens）：
  pressureTokens      = 最近一次请求 provider 上报的 inputTokens.total + cacheRead + cacheWrite
  surfaceTokens       = 当前 surface 的 route-priced 总和
  sampledSurfaceTokens = 采样 pressureTokens 时的 surfaceTokens 快照
  projectedTokens     = max(0, pressureTokens + surfaceTokens − sampledSurfaceTokens)
```

- Vico 的 usage 来源：`ModelStreamReader` 已从 `finish` part 累积 `usage`（`done` 事件携带 `UsageMetrics{input, output}`）。为实现锚定，`UsageMetrics` 需扩展记录 `inputTokens.total/cacheRead/cacheWrite`（或至少 total）。
- **anchor 维护**：`surface` = candidate（仅可压缩历史，不含 system/tools）；`sampledSurfaceTokens` 与 `pressureTokens` 由 `ModelContextCompactor` 内部按 thread 维护——`recordUsage(threadId, pressureTokens)`（LoopAgent 在每次 `callModel` 后调用）更新 `pressureTokens`，`compactIfNeeded`/`compactNow` 测量后更新 `sampledSurfaceTokens`。公式 `pressureTokens + surfaceTokens − sampledSurfaceTokens` 由此闭合：`pressureTokens` 隐含 system/tools 开销，`surfaceTokens − sampledSurfaceTokens` 表达历史增量。
- 未采样到任何 usage（历史从未发过请求）时退化为纯启发式（`baseline.kind='none'`，`projectedTokens = surfaceTokens`）。
- 摘要消息为纯文本，其 route 价格即启发式价格（对齐 deepseek「text-only checkpoint 的 fixed-heuristic price IS its route price」）。

## 8. 数据流

### 8.1 自动压缩（`compactIfNeeded`，pressure / context-overflow 共用 3–6）

```
1. 读候选 surface：最新非归档摘要 + 最近 stm_window 个已完成 turn 的非归档消息
2. resolveCompactSpec → thresholdTokens / retainTokens（context-overflow 时 retainTokens=0）
3. measurement = meter.measure(candidate)（§7 usage 锚定）
4. pressure：totalTokens < thresholdTokens → null；context-overflow：直接进入选择
5. selectCompactableRange → head（待归档 turn）+ tail（保留 turn）
6. 增量摘要（§9）：LLM 调用（摘要模型，temperature 0、无工具、maxOutputTokens≈maxTokens）
   input = [旧摘要] ++ [head 消息] + 结构化 checkpoint 指令
   shrink check：framedSummaryTokens < head 的 route-priced tokens，否则视为失败
7. append-only 落库（同一次 per-thread 锁内，先写后删保证崩溃不丢上下文）：
   - appendEntries 追加新摘要消息（role='summary'，metadata.previousSummaryId 指向旧摘要）
   - 归档旧摘要消息（若有）
   - archiveMessages(head 消息 id)
8. emit 'compacted' 事件（§12）
```

### 8.2 主动压缩（`compactNow`）

- 忽略 token 阈值；可压缩区间 = 除最近 `retainTokens`（预算）保留尾部外，仍存在 ≥1 个已完成 turn。
- 无可用区间返回 null（不写库）。
- 其余步骤与 8.1 的 5–8 相同。

### 8.3 历史加载（改造后）

```
ConversationHistoryMemory.get(threadId)
  = [摘要消息（最新非归档，role='summary' → system）]
    ++ [getRecentTurns(threadId, stm_window, status='completed') 的非归档消息]
```

- 修正既有实现：`getRecentTurns` 补上 `status='completed'` 过滤（docstring 声称如此，当前代码未传）。
- 摘要消息由 `getEntries(threadId, { roles: ['summary'], includeArchived: false })` 读取，最新一条非归档即为当前摘要（旧摘要已被归档）。

## 9. 增量摘要算法（对齐 `summarizer.ts`）

### 9.1 结构化 checkpoint 模板

摘要指令沿用 deepseek 的 `COMPACTION_INSTRUCTION`（固定 8 节 Markdown）：

```
## Primary Request and Intent
## Key Technical Concepts
## Files and Code
## Errors and Fixes
## Pending Jobs
## Current Work
## Next Step
## Critical Context
```

- 规则：逐节保留、简洁 bullet、空节写 "(none)"、保留精确路径/命令/错误串/标识符/数值/函数签名、忠实记录用户反馈与纠正、不提及「本次压缩」、已存在 `<compacted-summary>` 块时合并而非逐字复制。
- Vico 的摘要 prompt 用 `CompactionSettings.summaryPrompt` 可整体覆盖（默认用上述模板）。

### 9.2 摘要调用与 framing（对齐 `summarizeWithLlm` + `frameSummary`）

- 摘要目标：`summarizationProvider/summarizationModel` 非空 → 独立构造 `ModelClient`；为空 → 复用 agent 当前 `modelClient`（对齐 deepseek 的 `configured ?? latest ?? agentTarget` 回退链）。
- 输出用 `<compacted-summary>` / `</compacted-summary>` 包裹，前置 `CHECKPOINT_PREAMBLE`（声明为自动生成的 checkpoint、无需确认）。
- **shrink check**：framed 摘要 token ≥ head 的 route-priced token → 视为失败（对齐 deepseek「summary is not smaller than the shadowed content」）。
- 保留「当前摘要」为唯一非归档摘要消息；每次压缩：读旧摘要 → 折叠 → 归档旧摘要 → 追加新摘要。
- 摘要长度有界：`maxTokens`（默认 = `headroomTokens`）上限，滚动折叠不随历史线性增长。

## 10. 错误处理与边界

| 场景 | 处理 |
|---|---|
| 摘要 LLM 失败 / abort | 回退「原文截断摘要」（head 各消息 `role: text.slice(0,200)` 拼接），**不归档、不写摘要**；主流程不阻塞，下次 turn 再试。对齐 deepseek 的 `compaction/summary-error` waterfall recover（Vico 简化为内置回退，不暴露事件） |
| 摘要输出为空 | 视为失败，走回退路径 |
| 摘要不小于被压缩内容（shrink 失败） | 视为失败，走回退路径（对齐 deepseek 的 shrink 检查抛错） |
| contextWindow 缺失触发 pressure | `TargetPressureConfigError`，自动压缩跳过并告警（对齐 deepseek 的 warning suppression） |
| 并发压缩同一 thread | per-thread `KeyedMutex`（`@vico/core` 已有 `async-keyed-lock`）互斥；自动/主动共用同一把锁 |
| 压缩与运行中 turn 竞争 | 只归档 `completed` turn；in-flight turn 消息天然不在候选集 |
| 无可压缩区间（turn 太少） | no-op / null，不写库 |
| `compactThread` 线程不存在 | 返回 null |
| 未配置 compactor | 自动压缩跳过；`compactThread` 返回 null（HTTP 层映射 501） |
| 主动压缩时 agent 非 idle | `ManualCompactionError('busy')`（对齐 deepseek 的 `runMaintenance` 语义；Vico 用 KeyedMutex 表达） |
| deleteThread | 消息级级联删除，归档/摘要一并清除（现有 `deleteThread` 已删 messages） |

## 11. 并发与一致性

- 每个 thread 一把 `KeyedMutex`；自动压缩（turn 开始）与主动压缩（HTTP）共用同一把锁，避免重复压缩 / 重复摘要。
- 归档与摘要追加在同一锁内按序完成，保证「摘要 + 剩余非归档消息」始终一致。
- 崩溃安全：先追加新摘要、再归档旧摘要与 head 消息（**先写后删**）。任一步中断都只产生「重复但非丢失」的中间态——最坏是新旧摘要并存、或 head 未归档，下次压缩/加载可自然收敛，不会丢失任何历史上下文。

## 12. 配置（`server.config.yaml`）

```yaml
memory:
  stm_window: 20
  compaction:
    auto: true
    threshold_ratio: 0.8        # 窗口压力比例
    headroom_tokens: 65536      # 输出预留之外的 headroom
    retain_ratio: 0.16          # 保留尾部比例（与 retain_tokens 互斥）
    # retain_tokens: 8000       # 或绝对保留预算
    # summarization_provider: ''  # 摘要模型，空 = 复用 agent 模型
    # summarization_model: ''
    max_tokens: 65536           # 摘要生成上限（默认 = headroom_tokens）
    compaction_retries: 1
    max_overflow_retries: 1
    # model_policies: []        # 精确 provider/model 覆盖
```

`AgentConfig` / `VicoOptions` 增加 `compaction?: Partial<CompactionSettings>`；server 层在 `memory-setup.ts` 用 `config.memory.compaction` 构造 `ModelContextCompactor` 并注入 `Vico` / `createAgent`。模型配置增加 `contextWindow`。

## 13. 事件

沿用并扩充 `TurnEvent` 的 `compacted`：

```ts
{ type: 'compacted';
  summaryMessageId: string;
  archivedTurnIds: string[];
  removedTokens: number;
  shadowedTokenCount: number; }
```

## 14. 测试计划

- **单元（core）**：token 估算（分 part 定价、ROLE/BLOCK 开销）、`resolveCompactSpec` 预算解析（含约束校验）、`selectCompactableRange`（token 预算保留尾部 + turn 边界扩界）、`isContextOverflowError`、增量摘要拼接（含旧摘要）、shrink check、失败回退。
- **集成（libsql-adapter）**：`archiveMessages` + `includeArchived` 过滤；压缩后 `ConversationHistoryMemory.get` 只含「摘要 + 尾部」；主动压缩 `compactNow` 无区间返回 null；context-overflow 重试计数。
- **HTTP**：`POST /api/v1/threads/:id/compact` 鉴权、归属校验、404、无 compactor 501、busy 409。

## 15. 与 deepseek 的显式差异（诚实标注）

| 维度 | deepseek | Vico 适配 |
|---|---|---|
| contextWindow 来源 | adapter `resolveModelInfo().contextWindow` | `ModelConfig.contextWindow` 显式配置（provider v4 不暴露） |
| context-overflow 检测 | 稳定 `CONTEXT_WINDOW_EXCEEDED_CODE` | 启发式匹配 error message/statusCode（provider v4 无 code） |
| 切分粒度 | message 级 + tool-pairing balanced | turn 级（天然 balanced） |
| surface replace | `surfaceOp: {op:'replace', startSeq, endSeq}` | 归档 head + 追加 summary（append-only） |
| 摘要 KV cache 复用 | 复用 conversation 前缀触发 provider KV cache | 独立 `ModelClient` 调用，不追求 KV cache 复用（AI SDK 调用模型不同） |
| `compactRegion` 公共 API | 公开（含 seq 定位） | 内部私有步骤，不对外暴露 |
| summary-error 事件 | `compaction/summary-error` waterfall 事件 | 内置回退，不暴露事件 |

## 16. 范围外（follow-up）

- 图片/文件的 route-pricing（`priceSurface`）——Vico v1 无图片/文件块。
- 单个已完成 turn 内部过大（超阈值但不足整 turn 归档粒度）→ 不拆分，对应 deepseek 的 tool-result-pruner 单独演进。
- 真实 tokenizer / 精确 token 计数（当前为启发式 + usage 锚定）。
- 主动压缩异步任务化。
- 归档消息的物理清理 / 长期归档策略。
- 压缩事件接入可观测性（observability）面板。
- `modelPolicies` 的精确 provider/model 覆盖（单租户默认用 top-level 配置）。
