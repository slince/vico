# 上下文压缩（Context Compaction）设计

> 日期：2026-10-15
> 状态：待评审
> 范围：`packages/core`、`packages/libsql-adapter`、`packages/mysql-adapter`、`vico/server`

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

现有 `packages/core/src/agent/context-compactor.ts` 是**死代码**：未被 `createAgent` 接线，且只做内存态替换（每 model step 前原地替换 `step.messages`，不持久化，下次 turn 重载历史即失效）。本设计将其重写为**持久化、可主动触发的压缩器**。

## 2. 设计原则（参考 deepseek-harness / kun）

- **capability seam**：压缩作为 core 层的**端口 + 默认实现**，不塞进 LoopAgent 主循环内部逻辑。
- **append-only**：旧消息软归档（`archived` 标记），不物理删除，可审计、可回滚。
- **只压缩已完成 turn**：绝不碰 in-flight（running/paused/failed）turn。
- **增量滚动**：新摘要 = 旧摘要 + 新被压缩段；历史中始终只有一条最新非归档摘要。
- **判定只测可压缩部分**：只测「摘要 + 窗口内已完成 turn 消息」，不纳入 system prompt / skill / 记忆 / RAG。

## 3. 架构与组件归属

| 层 | 文件 | 改动 |
|---|---|---|
| 端口 | `packages/core/src/agent/context-compactor.ts` | 重写为持久化压缩器：`ContextCompactor` 接口 + `ModelContextCompactor` 默认实现 |
| 端口 | `packages/core/src/thread/thread-store.ts` | `Message.archived?: boolean`；`getEntries`/`getEntriesByTurns` 加 `includeArchived` 选项；新增 `archiveMessages(threadId, messageIds)` |
| 加载 | `packages/core/src/memory/conversation-history-memory.ts` | 历史 = 摘要（前置）+ 最近 N 个已完成 turn 的**非归档**消息 |
| 接线 | `packages/core/src/agent/loop-agent.ts` | 删除死代码 `tryCompact`；改为新 turn 开始前调用 `compactor.compactIfNeeded`；实现 `Agent.compactThread` |
| 契约 | `packages/core/src/agent/agent.ts` | `Agent` 接口新增 `compactThread(threadId, signal?)` |
| 装配 | `packages/core/src/agent/create-agent.ts`、`agent/vico.ts` | `AgentConfig` / `VicoOptions` 增加 `compaction` 配置，自动构造默认 compactor |
| 适配器 | `libsql-adapter` / `mysql-adapter` / `memory-thread-store.ts` | `vico_messages.archived` 列 + `archiveMessages` 实现 + `includeArchived` 过滤 |
| 服务 | `vico/server/src/memory/memory-setup.ts` | 构造 compactor 单例并注入 |
| 服务 | `vico/server/src/api/threads.ts` | 新增 `POST /api/v1/threads/:id/compact` |
| 配置 | `vico/server/server.config.yaml` | 新增 `memory.compaction` 配置块 |

## 4. 端口与 API 形态

### 4.1 ContextCompactor（core 层端口）

```ts
// @vico/core
export type CompactionTrigger = 'pressure' | 'context-overflow';

export interface CompactionResult {
  /** 是否实际执行了压缩 */
  wasCompacted: boolean;
  /** 新写入的摘要消息 id（未压缩时 undefined） */
  summaryMessageId?: string;
  /** 本次被归档的已完成 turn id 列表 */
  archivedTurnIds: string[];
  /** 估算移除的 token 数 */
  removedTokens: number;
}

export interface ContextCompactorOptions {
  /** 消息持久化端口（归档 + 写摘要 + 读历史） */
  thread: ThreadStore;
  /** 普通压缩阈值（默认 8000 tokens） */
  softThreshold?: number;
  /** 强制压缩阈值（默认 12000 tokens） */
  hardThreshold?: number;
  /** 普通模式保留的最近已完成 turn 数（默认 4；强制模式固定 1） */
  keepRecentTurns?: number;
  /** 摘要最大输出 token（默认 1200） */
  maxSummaryTokens?: number;
  /** 摘要 prompt 覆盖（可选） */
  summaryPrompt?: string;
}

export interface ContextCompactor {
  /** 自动：按阈值判定，未达阈值返回 no-op（wasCompacted=false） */
  compactIfNeeded(
    thread: Thread,
    modelClient: ModelClient,
    trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult>;

  /** 主动：忽略阈值，只要存在可压缩区间就压缩；无可用区间返回 null */
  compactNow(
    thread: Thread,
    modelClient: ModelClient,
    signal: AbortSignal,
  ): Promise<CompactionResult | null>;
}
```

- `modelClient` 由调用方传入（`LoopAgent` 持有 run 级解析后的 `modelClient`），压缩器不持有模型、保持无状态（除配置与 `thread` 端口外）。
- 默认实现类名 `ModelContextCompactor`，`ContextCompactor` 作为接口导出（兼容既有 `ContextCompactor` 导出名）。

### 4.2 ThreadStore 端口扩展

```ts
export interface Message {
  // ...现有字段
  /** 是否已被压缩归档（模型上下文不再读取；UI 仍全量展示） */
  archived?: boolean;
}

export interface ThreadStore {
  // 扩展既有方法
  getEntries(threadId: string, options?: {
    limit?: number; start?: number; roles?: string[];
    /** 默认 true；false 时排除已归档消息 */
    includeArchived?: boolean;
  }): Promise<Message[]>;

  getEntriesByTurns(turnIds: string[], options?: {
    /** 默认 true；false 时排除已归档消息 */
    includeArchived?: boolean;
  }): Promise<Message[]>;

  // 新增
  /** 批量归档消息（软标记 archived=1），只作用于已完成 turn 的消息 */
  archiveMessages(threadId: string, messageIds: string[]): Promise<void>;
}
```

### 4.3 Agent 契约扩展

```ts
export interface Agent {
  // 新增
  /**
   * 主动压缩指定会话：忽略 token 阈值，压缩除最近保留 turn 外的全部已完成 turn。
   * 无可用区间时返回 null（不写库）。
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
- 返回：`compactNow` 有结果 → `200` + `CompactionResult`；返回 null（无可压缩区间）→ `200` + `{ compacted: false }`。
- 同步执行（单次摘要 LLM 调用，约 1–2s）；异步任务化留作 follow-up。

## 5. 数据模型与迁移

### 5.1 摘要消息约定

- `role = 'summary'`（`role` 列为自由文本，无枚举约束，**无需迁移**）。
- `metadata = { type: 'summary', compactedTurnIds: string[], previousSummaryId?: string }`。
- 注入模型：`ConversationHistoryMemory` 将 `role='summary'` 映射为 `{ role: 'system', content }` 前置注入。
- UI：`toUiMessages` 对未知 role 静默跳过 → **前端零改动**，摘要不显示，真实历史全量展示（符合「仅模型上下文」决策）。

### 5.2 `vico_messages.archived` 列

- libsql / mysql：`archived INTEGER NOT NULL DEFAULT 0`。
- 迁移方式：沿用 `ensureTables` 既有模式——`CREATE TABLE IF NOT EXISTS` 更新列定义 + 存量表用 `pragma_table_info` 检测缺失后 `ALTER TABLE vico_messages ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`（参照 `vico_turns.forked_from` 写法）。同时更新 `schema.ts` 的 drizzle 定义与 `_toMessage` 映射。
- in-memory：`Message.archived` 字段，默认 `false`。

## 6. 触发判定逻辑（精确口径）

**测量时机**：新 turn 开始前、history 注入前，对已完成历史做一次快照。

**测量对象（scope）**——只测可压缩部分：

```
candidate = [最新非归档摘要] ++ [最近 stm_window 个已完成 turn 的非归档消息]
```

**token 估算**（v1 启发式，非真实 tokenizer）：

```
estimateTokens(messages) = Σ ceil(len(content) / 4)
  - content 为 string   → content.length
  - content 为 parts[]  → JSON.stringify(content).length   // 含 tool-call/result 结构开销
```

**判定树**：

```
occupied = estimateTokens(candidate)

occupied < soft(8000)              → 不压缩（wasCompacted=false）
soft ≤ occupied < hard(12000)      → normal：保留最近 keepRecentTurns(4) 个已完成 turn
occupied ≥ hard(12000)             → aggressive：保留最近 1 个已完成 turn

压缩前置条件：候选已完成 turn 数 > 保留尾部数，否则 head 为空 → 不压缩
```

**阈值基准**：绝对 token 数（默认 8000/12000）。`contextWindow` 百分比口径（75%/85%）留作后续增强。

## 7. 数据流

### 7.1 自动压缩（compactIfNeeded）

```
1. 读候选历史：最新非归档摘要 + 最近 stm_window 个已完成 turn 的非归档消息
2. estimateTokens → 判定 no-op / normal / aggressive（见 §6）
3. 按 turn 边界切分：head = 更旧的已完成 turn（整 turn 归档，保证 tool-call/result 配对完整）
                     tail = 最近 keepRecentTurns 个 turn（原文保留）
4. 增量摘要：LLM 调用（复用 agent modelClient，temperature 0、无工具、maxTokens≈maxSummaryTokens）
             input = [旧摘要] ++ [head 消息] + 摘要 prompt
5. append-only 落库（同一次 per-thread 锁内，**先写后删**保证崩溃不丢上下文）：
   - appendEntries 追加新摘要消息（role='summary'，metadata.previousSummaryId 指向旧摘要）
   - 归档旧摘要消息（若有）
   - archiveMessages(head 消息 id)
6. emit 'compacted' 事件（含 archivedTurnIds / summaryMessageId / removedTokens）
```

### 7.2 主动压缩（compactNow）

- 忽略 token 阈值；可压缩区间 = 除最近 `keepRecentTurns` 个已完成 turn 之外，仍存在 ≥1 个已完成 turn。
- 无可用区间返回 null（不写库）。
- 其余步骤与 7.1 的 3–6 相同。

### 7.3 历史加载（改造后）

```
ConversationHistoryMemory.get(threadId)
  = [摘要消息（最新非归档，role='summary' → system）]
    ++ [getRecentTurns(threadId, stm_window, status='completed') 的非归档消息]
```

- 修正既有实现：`getRecentTurns` 补上 `status='completed'` 过滤（docstring 声称如此，当前代码未传）。
- 摘要消息由 `getEntries(threadId, { roles: ['summary'], includeArchived: false })` 读取，并按 `metadata.previousSummaryId` 链跳过已归档旧摘要（最新一条非归档即为当前摘要）。

## 8. 增量摘要算法

- 保留「当前摘要」为唯一非归档摘要消息；每次压缩时：
  1. 读取当前摘要（若存在），作为 `input` 的前缀。
  2. 用 LLM 折叠：`新摘要 = summarize([旧摘要] ++ [head 消息])`。
  3. 归档旧摘要、追加新摘要。
- 摘要长度有界：`maxSummaryTokens ≈ 1200` 上限，滚动折叠不随历史线性增长。
- 摘要 prompt（默认）：要求保留关键决策、未完成事项、用户偏好/事实、工具执行结论；丢弃冗余工具输出。

## 9. 错误处理与边界

| 场景 | 处理 |
|---|---|
| 摘要 LLM 失败 / abort | 回退「原文截断摘要」（head 各消息 `role: text.slice(0,200)` 拼接），**不归档、不写摘要**；主流程不阻塞，下次 turn 再试 |
| 摘要输出为空 | 视为失败，走回退路径 |
| 并发压缩同一 thread | per-thread `KeyedMutex`（已有 `@vico/core` 的 `async-keyed-lock`）互斥 |
| 压缩与运行中 turn 竞争 | 只归档 `completed` turn；in-flight turn 消息天然不在候选集 |
| 无可压缩区间（turn 太少） | no-op / null，不写库 |
| `compactThread` 线程不存在 | 返回 null |
| 未配置 compactor | 自动压缩跳过；`compactThread` 返回 null（HTTP 层映射 501） |
| deleteThread | 消息级级联删除，归档/摘要一并清除（现有 `deleteThread` 已删 messages） |

## 10. 并发与一致性

- 每个 thread 一把 `KeyedMutex`；自动压缩（turn 开始）与主动压缩（HTTP）共用同一把锁，避免重复压缩 / 重复摘要。
- 归档与摘要追加在同一锁内按序完成，保证「摘要 + 剩余非归档消息」始终一致。
- 崩溃安全：先追加新摘要、再归档旧摘要与 head 消息（**先写后删**）。任一步中断都只产生「重复但非丢失」的中间态——最坏是新旧摘要并存、或 head 未归档，下次压缩/加载可自然收敛，不会丢失任何历史上下文。

## 11. 配置

`vico/server/server.config.yaml`：

```yaml
memory:
  stm_window: 20
  compaction:
    enabled: true
    soft_threshold: 8000      # 普通压缩阈值（tokens）
    hard_threshold: 12000     # 强制压缩阈值（tokens）
    keep_recent_turns: 4      # 普通模式保留尾部 turn 数
    max_summary_tokens: 1200  # 摘要最大输出 token
```

`AgentConfig` / `VicoOptions` 增加 `compaction?: Partial<CompactionSettings>`；server 层在 `memory-setup.ts` 用 `config.memory.compaction` 构造 `ModelContextCompactor` 并注入 `Vico` / `createAgent`。

## 12. 事件

沿用并扩充 `TurnEvent` 的 `compacted`：

```ts
{ type: 'compacted';
  removedTokens: number;
  archivedTurnIds: string[];
  summaryMessageId: string; }
```

## 13. 测试计划

- **单元（core）**：token 估算、阈值分区（no-op/normal/aggressive）、head/tail 按 turn 切分、增量摘要拼接（含旧摘要）、失败回退。
- **集成（libsql-adapter）**：`archiveMessages` + `includeArchived` 过滤；压缩后 `ConversationHistoryMemory.get` 只含「摘要 + 尾部」；主动压缩 `compactNow` 无区间返回 null。
- **HTTP**：`POST /api/v1/threads/:id/compact` 鉴权、归属校验、404、无 compactor 501。

## 14. 范围外（follow-up）

- 单个已完成 turn 内部过大（超阈值但不足整 turn 归档粒度）→ 不拆分，对应 deepseek 的 tool-result-pruner 单独演进。
- `contextWindow` 百分比阈值、真实 tokenizer / token-meter。
- 主动压缩异步任务化。
- 归档消息的物理清理 / 长期归档策略。
- 压缩事件接入可观测性（observability）面板。
