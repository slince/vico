# Mastra SemanticRecall 向量库更新完整生命周期

> 回答核心问题：SemanticRecall 什么时候更新向量库？覆盖消息从生成到可检索的完整时序。

## 1. 概览：三个向量写入路径

Mastra 中存在**三条独立的向量写入路径**，同一条消息可能被重复嵌入：

```
                     ┌──────────────┐
                     │  Agent 响应   │
                     └──────┬───────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │ Path A       │ │ Path B       │ │ Path C       │
    │ saveMessages │ │ Recall       │ │ Message      │
    │ (memory层)   │ │ Output Proc  │ │ History Proc │
    │              │ │              │ │              │
    │ 嵌入+upsert  │ │ 嵌入+upsert  │ │ 仅存文本     │
    │ 1083行触发   │ │ 519行触发    │ │ 无向量操作   │
    └──────────────┘ └──────────────┘ └──────────────┘
```

---

## 2. Path A：saveMessages() 路径（Memory 层）

### 2.1 触发时机

文件：`packages/memory/src/index.ts`，第 1051 行

```
SaveQueueManager (Agent.ts:6346)
  │
  │  debounce: 100ms
  │  max staleness: 1000ms
  │
  ▼
memory.saveMessages(messages)
```

**SaveQueueManager** 负责驱动保存：

```typescript
// packages/core/src/agent/save-queue/index.ts
class SaveQueueManager {
  private DEBOUNCE_MS = 100;          // 100ms 去抖
  private MAX_STALENESS_MS = 1000;    // 最多 1s 必须刷新
  
  // 去抖批处理：快速连续更新时合并
  // 过期保护：如果最早未保存消息超过 1s，立即刷新
}
```

**除了 SaveQueueManager，子 Agent 委派也会直接调用** `saveMessages()`：
- `agent.ts` 第 4460 行：子 Agent 委派后直接保存
- `agent.ts` 第 4645 行：另一个委派路径
- `agent.ts` 第 4812 行：还有一个委派路径

### 2.2 完整执行流程（同步、阻塞）

```
saveMessages(messages)                          // memory/index.ts:1051
  │
  ├── 1. 过滤/标准化消息                            // :1067-1072
  │      ├── 过滤 system 消息
  │      └── 移除 working_memory XML 标签
  │
  ├── 2. 持久化消息到存储（文本）                     // :1083-1086
  │      └── memoryStore.saveMessages(messages)
  │          ├── LibSQL: INSERT INTO mastra_messages
  │          └── PG: INSERT INTO mastra_messages
  │
  ├── 3. 检查 semanticRecall + vector 是否启用      // :1090
  │      └── if (!semanticRecall || !vector) → 跳过嵌入
  │
  ├── 4. 收集每条消息的线程元数据                     // :1101-1116
  │
  ├── 5. 并发嵌入所有消息（Promise.all）            // :1132-1176
  │      │
  │      └── 对每条消息:
  │          ├── extractTextForEmbedding(content)
  │          ├── embedMessageContent(text)          // :1154
  │          │   ├── xxhash.h64(content) 计算缓存键
  │          │   ├── 查本地 LRU 缓存 (max 1000)
  │          │   ├── chunkText() 分块
  │          │   │   └── 按词边界分割，~16K 字符/块（4096 tokens * 4）
  │          │   ├── AI SDK embedMany({ values: chunks })
  │          │   │   └── FastEmbed: 串行化首次调用（等待模型下载）
  │          │   ├── 缓存结果到 this.embeddingCache
  │          │   └── 返回 { embeddings, chunks, usage, dimension }
  │          └── 收集到 embeddingData[]
  │
  ├── 6. 确保向量索引存在                              // :1184
  │      └── createEmbeddingIndex(dimension)
  │          ├── 索引名: memory_messages (1536d)
  │          │           memory_messages_768 (非标准维度)
  │          ├── LibSQL: CREATE TABLE IF NOT EXISTS ... F32_BLOB(...)
  │          │         + CREATE INDEX IF NOT EXISTS ... libsql_vector_idx
  │          ├── PG: CREATE TABLE IF NOT EXISTS ...
  │          │       + CREATE EXTENSION IF NOT EXISTS vector
  │          │       + CREATE INDEX IF NOT EXISTS ... USING hnsw/ivfflat
  │          └── 幂等操作，已存在则跳过
  │
  ├── 7. 批量写入向量到向量库                          // :1187-1205
  │      └── vector.upsert(embeddingData)
  │          ├── LibSQL: 逐行 INSERT ... ON CONFLICT DO UPDATE
  │          │          含 SQLITE_BUSY 重试
  │          └── PG: 事务中先 delete 再 insert/update
  │                 ON CONFLICT (vector_id) DO UPDATE
  │
  └── 8. 返回结果（含 token 用量）                     // :1220
```

### 2.3 关键时序特征

- **同步阻塞**：`Promise.all()` 并行嵌入，但调用方等待全部完成
- **无后台队列**：嵌入不在后台进行
- **LRU 缓存**：1000 条，`xxhash.h64(content)` 作为键
- **跨消息并行**：多条消息的嵌入是并行的，但同一条消息的多个 chunk 是串行的
- **首次调用慢**：需要创建表/索引 + FastEmbed 下载模型

---

## 3. Path B：SemanticRecall Output Processor 路径

### 3.1 触发时机

文件：`packages/core/src/processors/memory/semantic-recall.ts`，第 519 行

当 `MastraMemory.getOutputProcessors()` 被调用时（`memory.ts:869`），如果启用了 `semanticRecall`，自动注册 `SemanticRecall` 作为 Output Processor。

```
Agent Loop
  │
  │ 每次 LLM 响应后
  │
  ▼
OutputProcessor 管道
  │
  ├── SemanticRecall.processOutputResult()      // semantic-recall.ts:519
  │     │
  │     ├── 收集响应消息 + 新用户消息               // :563-573
  │     ├── 每条消息: embedMessageContent()       // :603
  │     │   └── 使用独立的全局 LRU 缓存 (embedding-cache.ts:13)
  │     ├── ensureVectorIndex()                   // :633
  │     └── vector.upsert()                       // :634-640
  │
  └── MessageHistory.processOutputResult()       // (仅存文本，无向量)
```

### 3.2 与 Path A 的区别

| 特征 | Path A (saveMessages) | Path B (Recall Output Proc) |
|------|----------------------|---------------------------|
| 嵌入缓存 | Memory 实例级 LRU | 全局静态 LRU (embedding-cache.ts) |
| 嵌入方式 | Promise.all 并行 | 顺序逐一嵌入 |
| 触发条件 | saveMessages 被调用时 | Output Processor 管道中 |
| 去重 | 不走 saveMessages 的逻辑 | **会重复嵌入同一条消息** |

### 3.3 重复嵌入问题

**同一条消息可能被嵌入两次**（Path A + Path B），因为两条路径使用**不同的嵌入缓存**：

```
Path A 缓存: Memory.embeddingCache (实例级, xxhash.h64(content) 键)
Path B 缓存: globalEmbeddingCache (全局静态, xxhash 键)

→ 两条路径不共享缓存 → 可能对同一条消息生成两次嵌入
```

向量 upsert 使用 `ON CONFLICT(vector_id) DO UPDATE`，所以**向量库中不会重复**（后者覆盖前者），但**嵌入计算本身被浪费了**。

---

## 4. Path C：MessageHistory Output Processor

文件：`packages/core/src/processors/memory/message-history.ts`

```
MessageHistory.processOutputResult()          // :227
  │
  └── this.persistMessages()                   // :321
        └── this.storage.saveMessages()       // 仅文本存储
            └── 无向量操作！
```

此路径**不生成嵌入、不更新向量库**，仅将消息文本持久化到 `mastra_messages` 表。

---

## 5. 向量索引创建时机

### 5.1 懒创建，非构造时

```typescript
// memory.ts 构造函数: NOT created
constructor(config) {
  this.vector = config.vector;
  this.embedder = config.embedder;
  // 嵌入索引在这里 NOT 创建
}

// 首次使用时创建
// 时机1: recall() 查询前          → memory/index.ts:488
// 时机2: saveMessages() 写入前    → memory/index.ts:1184
// 时机3: SemanticRecall 处理器中   → semantic-recall.ts:496
// 时机4: cloneThread() 克隆时     → memory/index.ts:2275
```

### 5.2 幂等设计

```sql
-- LibSQL
CREATE TABLE IF NOT EXISTS memory_messages (...)
CREATE INDEX IF NOT EXISTS memory_messages_vector_idx ...

-- PG
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS memory_messages (...)
CREATE INDEX IF NOT EXISTS memory_messages_vector_idx ...
```

同时有**进内缓存**防止重复 DDL：
- PG: `cachedIndexExists` (xxhash 键) — `pg/src/vector/index.ts:884-886`
- SemanticRecall Processor: `indexValidationCache` (Map<indexName, dimension>) — `semantic-recall.ts:137`

### 5.3 索引名规则

```typescript
// memory.ts:323-329
getEmbeddingIndexName(dimensions?: number): string {
  const defaultDimensions = 1536;
  const usedDimensions = dimensions ?? defaultDimensions;
  return usedDimensions === defaultDimensions
    ? `memory_messages`
    : `memory_messages_${usedDimensions}`;
}
```

---

## 6. 语义召回查询流程

### 6.1 触发时机：Loop 开始前

```
Agent.generate() / stream()
  │
  ▼
createPrepareStreamWorkflow()
  │
  ├── prepareTools (并行)
  │
  └── prepareMemory (并行)
       │
       ▼
  getMemoryMessages()                           // agent.ts:3894-3928
       │
       ├── 提取最后一条用户消息作为查询文本
       │
       └── memory.recall({
             threadId,
             resourceId,
             vectorSearchString: lastUserMessage,
             options: { lastMessages, semanticRecall }
           })
```

### 6.2 recall() 方法步骤

```
memory.recall()                                  // memory/index.ts:362-570
  │
  ├── 1. 合并配置 (default → thread → runtime)    // :389
  ├── 2. 验证线程归属                              // :403
  ├── 3. 计算分页 (lastMessages: N → 最近 N 条)     // :418-421
  │
  ├── 4. 如果 semanticRecall + vectorSearchString + vector:
  │   │
  │   ├── embedMessageContent(query)              // 查询嵌入
  │   ├── createEmbeddingIndex(dimension)         // 确保索引存在
  │   └── vector.query({                          // :484-510
  │         indexName: 'memory_messages',
  │         vector: queryEmbedding,
  │         topK: config.topK ?? 4,
  │         filter: {
  │           $and: [
  │             scopeFilter,  // { resource_id: X } 或 { thread_id: Y }
  │             userFilter,   // 用户自定义 filter
  │           ]
  │         },
  │         minScore: config.threshold,
  │       })
  │
  ├── 5. 从存储获取完整消息                            // :521
  │     └── storage.listMessages({
  │           include: vectorResultIds,
  │           withNextMessages,
  │           withPreviousMessages
  │         })
  │
  ├── 6. 过滤系统提醒消息                             // :551
  │
  └── 7. 返回 { messages, usage, total, page, ... }
```

### 6.3 vector.query() 底层实现

**LibSQL** (`stores/libsql/src/vector/index.ts:204`)：
```sql
-- 如果有 vector_idx 索引：
SELECT *, vector_distance_cos(embedding, ?) AS score
FROM memory_messages
WHERE ...
ORDER BY score ASC
LIMIT ?

-- 如果无索引或过滤条件为空，回退到暴力搜索：
-- 对所有行计算 vector_distance_cos
```

**PG** (`stores/pg/src/vector/index.ts:434`)：
```sql
-- HNSW 索引且无 filter 且 minScore <= 0：
-- ORDER BY + LIMIT 推入 CTE 以使用索引
WITH cte AS (
  SELECT *, embedding <=> $1 AS score
  FROM memory_messages
  ORDER BY embedding <=> $1
  LIMIT $2
)
SELECT * FROM cte;

-- IVFFlat 索引：
-- probes 参数可调
```

---

## 7. Input Processor 中的语义召回

### 7.1 SemanticRecall.processInput()

文件：`packages/core/src/processors/memory/semantic-recall.ts:165`

```
每次 Agent Loop 迭代（LLM 调用前）
  │
  ▼
Input Processor 管道
  │
  └── SemanticRecall.processInput()
       │
       ├── 1. 提取最后一条用户消息文本               // :332-364
       │
       ├── 2. performSemanticSearch()
       │   ├── embedMessageContent(query)           // 用全局缓存
       │   ├── ensureVectorIndex()
       │   ├── vector.query()
       │   └── storage.listMessages()
       │
       ├── 3. 去重：排除已在 MessageList 中的消息
       │
       └── 4. 注入结果到上下文
           ├── 同线程结果：直接加入消息列表
           └── 跨线程结果：格式化为系统消息（带日期头）
```

### 7.2 两条输入路径的差异

| 特征 | prepareMemory (Loop 前) | Input Processor (每个 step) |
|------|------------------------|---------------------------|
| 调用方 | `getMemoryMessages()` | `SemanticRecall.processInput()` |
| 触发时机 | Loop 开始前，一次性 | 每次 LLM 调用前（每个 step） |
| 查询文本 | 最后一条用户消息 | 同 |
| 结果注入 | 直接加入消息列表 | 去重后加入或格式化为系统消息 |

---

## 8. 消息删除时的向量清理

文件：`packages/memory/src/index.ts`

```typescript
// deleteMessages() :2311
async deleteMessages(messageIds) {
  await memoryStore.deleteMessages(messageIds);    // 删除文本
  void this.deleteMessageVectors(messageIds);      // 🔥 fire-and-forget
}

// deleteMessageVectors() :2366
async deleteMessageVectors(messageIds) {
  const indexes = await getMemoryVectorIndexes(); // 匹配 memory_messages*
  for (const index of indexes) {
    for (let i = 0; i < messageIds.length; i += 100) {
      try {
        await vector.deleteVectors({
          filter: { message_id: { $in: batch } }
        });
      } catch {
        this.logger.debug('Failed to delete vector batch, skipping');
      }
    }
  }
}

// deleteThread() 同样 fire-and-forget :672-676
```

**关键特征**：
- 向量删除是 **fire-and-forget**（`void`）
- 批量删除，每批 100 条
- 错误被静默吞下（仅 debug 日志）
- 可能导致**向量库与消息表不一致**（文本已删但向量还在）

---

## 9. 完整时序图

```
时间线 →

  ┌─ Mastra 启动 ───────────────────────────────────────┐
  │                                                       │
  │  new Memory({ semanticRecall: true, vector, embedder })│
  │  ├── 存储 vector 和 embedder 引用                      │
  │  ├── ✗ 不创建嵌入索引                                  │
  │  ├── ✗ 不预热任何缓存                                  │
  │  └── ✗ 不调用 createEmbeddingIndex()                  │
  └───────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─ 用户第一条消息 ─────────────────────────────────────┐
  │                                                       │
  │  Agent.generate([{ role: 'user', content: 'Hello' }]) │
  │  │                                                    │
  │  ├── prepareMemory (Loop 前)                          │
  │  │   └── memory.recall({ vectorSearchString: 'Hello' })│
  │  │       ├── embedMessageContent('Hello')             │
  │  │       │   └── FastEmbed: 下载模型（如未预热）      │
  │  │       │   └── API: 网络调用（~100-500ms）           │
  │  │       ├── createEmbeddingIndex()             ← 首次│
  │  │       │   └── CREATE TABLE IF NOT EXISTS           │
  │  │       │       + CREATE INDEX IF NOT EXISTS         │
  │  │       └── vector.query()                           │
  │  │           └── 空结果（尚无历史）                    │
  │  │                                                    │
  │  ├── Agentic Loop (可能多轮 tool call)                 │
  │  │   ├── 每个 step: Input Processors                  │
  │  │   │   └── SemanticRecall.processInput()            │
  │  │   │       └── 同样做一次嵌入+查询                  │
  │  │   │                                                │
  │  │   └── 每个 step 后: Output Processors              │
  │  │       ├── SemanticRecall.processOutputResult()     │
  │  │       │   └── 嵌入 LLM 响应 → upsert 向量  ← Path B│
  │  │       └── MessageHistory.processOutputResult()     │
  │  │           └── 仅存文本到 mastra_messages    ← Path C│
  │  │                                                    │
  │  ├── Loop 结束                                         │
  │  │   └── SaveQueueManager.flush()                     │
  │  │       └── memory.saveMessages()               ← Path A│
  │  │           ├── 嵌入所有消息                          │
  │  │           ├── createEmbeddingIndex()（幂等)        │
  │  │           └── vector.upsert(所有向量)              │
  │  │                                                    │
  │  └── Response 返回给用户                               │
  └───────────────────────────────────────────────────────┘
                          │
                          ▼
  ┌─ 第二条消息（有历史可召回）─────────────────────────┐
  │                                                       │
  │  Agent.generate([...history, { role: 'user', ... }]) │
  │  │                                                    │
  │  ├── prepareMemory                                   │
  │  │   └── memory.recall({ vectorSearchString: '...' })│
  │  │       ├── embedMessageContent('...')               │
  │  │       ├── createEmbeddingIndex()（幂等，跳过)      │
  │  │       └── vector.query()                           │
  │  │           └── ✅ 返回相关历史消息                  │
  │  │              （第一条消息的向量已在上次 upsert 后可用）│
  │  │                                                    │
  │  └── ...（流程同首次，但向量搜索有结果）               │
  └───────────────────────────────────────────────────────┘
```

---

## 10. 关键发现总结

### 10.1 向量库何时更新？

| 时机 | 路径 | 触发条件 | 同步/异步 |
|------|------|----------|-----------|
| Agent 响应后，Output Processor | Path B | 每个 LLM step 完成后 | 同步 |
| SaveQueueManager flush | Path A | 100ms debounce 或 1s staleness | 同步 |
| 子 Agent 委派完成 | Path A | 委派结束时直接调用 | 同步 |

### 10.2 消息何时可被检索到？

消息写入向量库后**立即可检索**（无额外异步索引构建延迟）。

从 Agent 视角：
- **同一轮对话内**：Loop 的后续 step 通过 Input Processor 可以检索到前面的 Tool 结果（如果已经 embed+upsert）
- **下一次请求**：上一次请求的所有消息已在 SaveQueueManager flush 时写入向量库

### 10.3 性能注意点

| 关注点 | 详情 |
|--------|------|
| 首次调用慢 | FastEmbed 下载模型 + 创建表/索引，可能需要数秒 |
| 重复嵌入 | Path A + Path B 可能对同一条消息各嵌入一次 |
| 无后台队列 | 所有嵌入同步完成，阻塞请求响应 |
| 缓存不共享 | Path A 和 Path B 使用不同 LRU 缓存 |
| 向量删除不可靠 | fire-and-forget 模式，错误静默 |
| 首次查询可检索到 | 向量 upsert 后立即生效，无延迟 |

### 10.4 与 vico 项目对比建议

vico 的 Memory 实现可以参考：
1. **单一路径写入**：避免重复嵌入，统一在 saveMessages 时嵌入
2. **共享嵌入缓存**：所有路径使用同一个 LRU 缓存
3. **异步队列**：大规模消息可考虑后台队列嵌入
4. **向量清理同步**：删除消息时同步清理向量，避免不一致
5. **查询时可配置 scope**：支持 thread-only / resource-level 两种搜索范围

---

## 11. 关键文件索引

| 组件 | 文件 | 行号 |
|------|------|------|
| Memory.saveMessages | `packages/memory/src/index.ts` | 1051-1220 |
| Memory.recall | `packages/memory/src/index.ts` | 362-570 |
| Memory.embedMessageContent | `packages/memory/src/index.ts` | 993-1049 |
| Memory.chunkText | `packages/memory/src/index.ts` | 948-991 |
| Memory.deleteMessages | `packages/memory/src/index.ts` | 2311-2350 |
| Memory.deleteMessageVectors | `packages/memory/src/index.ts` | 2366-2385 |
| MastraMemory.createEmbeddingIndex | `packages/core/src/memory/memory.ts` | 331-369 |
| MastraMemory.getEmbeddingIndexName | `packages/core/src/memory/memory.ts` | 323-329 |
| SaveQueueManager | `packages/core/src/agent/save-queue/index.ts` | 全部 |
| getMemoryMessages (Agent) | `packages/core/src/agent/agent.ts` | 3894-3928 |
| SemanticRecall.processInput | `packages/core/src/processors/memory/semantic-recall.ts` | 165 |
| SemanticRecall.processOutputResult | `packages/core/src/processors/memory/semantic-recall.ts` | 519 |
| SemanticRecall.embedMessageContent | `packages/core/src/processors/memory/semantic-recall.ts` | 440 |
| 全局嵌入缓存 | `packages/core/src/processors/memory/embedding-cache.ts` | 13 |
| LibSQL vector.createIndex | `stores/libsql/src/vector/index.ts` | 378 |
| LibSQL vector.upsert | `stores/libsql/src/vector/index.ts` | 301 |
| LibSQL vector.query | `stores/libsql/src/vector/index.ts` | 204 |
| PG vector.createIndex | `stores/pg/src/vector/index.ts` | 816 |
| PG vector.upsert | `stores/pg/src/vector/index.ts` | 621 |
| PG vector.query | `stores/pg/src/vector/index.ts` | 434 |
| Memory 存储 deleteMessages | `stores/libsql/src/storage/domains/memory/index.ts` | 819 |
