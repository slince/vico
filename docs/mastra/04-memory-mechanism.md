# Mastra Memory 机制详细文档

> 基于 `mastra` 项目 `@mastra/memory` v1.21.0 和 `@mastra/core` 源码深度分析。

## 1. 概述

Mastra Memory 系统是一个**三层记忆架构**，分为工作记忆、语义召回和观察记忆三个子系统。它通过 Processor 模式与 Agent 集成，支持多种存储后端和嵌入模型。

### 1.1 三层架构

```
┌─────────────────────────────────────────────────┐
│                  Memory System                    │
│                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ Working     │  │ Semantic     │  │Observa-  │ │
│  │ Memory      │  │ Recall       │  │tional    │ │
│  │ (工作记忆)   │  │ (语义召回)    │  │Memory    │ │
│  │             │  │              │  │(观察记忆) │ │
│  │ 短期/可变    │  │ 向量相似搜索  │  │长期/提取  │ │
│  │ Key-Value   │  │ 历史消息检索  │  │自动模式   │ │
│  └──────┬──────┘  └──────┬───────┘  └────┬─────┘ │
│         │                │                │        │
│         ▼                ▼                ▼        │
│  ┌─────────────────────────────────────────────┐  │
│  │              Processor System                │  │
│  │  InputProcessors  │  OutputProcessors        │  │
│  └─────────────────────────────────────────────┘  │
│                       │                            │
│                       ▼                            │
│                 Agent Loop                          │
└─────────────────────────────────────────────────┘
```

---

## 2. 包结构与文件布局

### 2.1 核心抽象层：`packages/core/src/memory/`

| 文件 | 行数 | 职责 |
|------|------|------|
| `memory.ts` | ~1095 | `MastraMemory` 抽象基类 |
| `types.ts` | - | 所有配置类型、接口、辅助函数 |
| `mock.ts` | ~452 | `MockMemory` 测试实现 |
| `working-memory-utils.ts` | - | Tag 提取/移除工具 |
| `system-reminders.ts` | - | 系统提醒消息过滤 |

### 2.2 具体实现层：`packages/memory/src/`

| 文件 | 行数 | 职责 |
|------|------|------|
| `index.ts` | ~2983 | `Memory` 类（继承 `MastraMemory`）|
| `tools/working-memory.ts` | - | `updateWorkingMemoryTool`、`createWorkingMemoryTool`、`deepMergeWorkingMemory` |
| `tools/om-tools.ts` | - | `recallTool`（长期记忆检索工具）|
| `processors/working-memory-state/processor.ts` | - | `WorkingMemoryStateProcessor`（状态信号发送）|
| `processors/observational-memory/observational-memory.ts` | ~1000+ | `ObservationalMemory` 引擎 |
| `processors/observational-memory/processor.ts` | - | `ObservationalMemoryProcessor` |
| `processors/observational-memory/types.ts` | - | OM 配置、解决方案类型 |
| `processors/observational-memory/constants.ts` | - | 默认值 |
| `processors/observational-memory/token-counter.ts` | ~1879 | Token 计数器 |
| `processors/observational-memory/observation-turn/turn.ts` | - | `ObservationTurn` 生命周期 |
| `processors/observational-memory/observation-turn/step.ts` | - | `ObservationStep` 准备 |
| `processors/observational-memory/observation-strategies/base.ts` | - | `ObservationStrategy` 抽象类 |
| `processors/observational-memory/observer-agent.ts` | - | Observer Agent 指令 |
| `processors/observational-memory/reflector-agent.ts` | - | Reflector Agent 指令 |

---

## 3. 工作记忆（Working Memory）

### 3.1 概述

工作记忆是短期可变的状态存储，随对话进行而更新，可以是**线程级别**或**资源级别**。

### 3.2 两种模式

#### 模板模式（Template Mode）

使用 Markdown 模板字符串，预定义章节：

```markdown
## Name: 
## Location: 
## Occupation: 
## Interests: 
## Goals: 
## Events: 
## Facts: 
## Projects: 
```

Agent 通过 `updateWorkingMemory` 工具**整体替换** blob 内容。

#### Schema 模式（Schema Mode）

使用 Zod JSON Schema 定义结构：

```typescript
const workingMemorySchema = z.object({
  preferences: z.object({
    language: z.string(),
    timezone: z.string(),
  }).optional(),
  context: z.object({
    currentTask: z.string().optional(),
    recentTopics: z.array(z.string()).optional(),
  }).optional(),
});
```

Agent 通过工具**增量合并**更新，使用 `deepMergeWorkingMemory()`。

### 3.3 作用域

```typescript
type WorkingMemoryScope = 'resource' | 'thread';

// resource：同一资源的所有线程共享
// thread：每个线程独立
```

### 3.4 存储位置

| 作用域 | 存储位置 |
|--------|----------|
| Resource | `mastra_resources.working_memory` 列 |
| Thread | `mastra_threads.metadata` JSONB 列 |

### 3.5 深度合并算法

文件：`packages/memory/src/tools/working-memory.ts`

```typescript
function deepMergeWorkingMemory(
  current: Record<string, unknown>,
  update: Record<string, unknown>
): Record<string, unknown> {
  // null → 删除属性
  // 数组 → 完全替换
  // 嵌套对象 → 递归合并
  // 原始类型 → 覆盖
}
```

### 3.6 状态信号模式

当 `useStateSignals: true` 时，工作记忆以状态信号方式发送（而非折叠入系统消息）：

```typescript
interface WorkingMemoryStateConfig {
  useStateSignals: true;
  mode?: 'snapshot' | 'delta';
}

// Snapshot 模式：发送完整工作记忆内容
// Delta 模式：发送 Unified-diff 补丁（仅 Markdown）
// 去重：SHA-256 缓存键，防止冗余发送
```

工具名从 `updateWorkingMemory` 变为 `setWorkingMemory`。

### 3.7 互斥锁保护

`updateWorkingMemory()` 使用内存互斥锁（per thread/resource），序列化并发访问防止写冲突。

---

## 4. 语义召回（Semantic Recall）

### 4.1 概述

基于**向量嵌入**的历史消息相似度搜索。配置型功能，需要在 Memory 配置中启用。

### 4.2 配置选项

```typescript
interface SemanticRecallConfig {
  topK: number;                    // 返回结果数
  messageRange: {                  // 时间/消息窗口
    last?: number;                 // 最近 N 条
    before?: string;               // 在某消息之前
    limit?: number;                // 限制数量
  };
  scope: 'thread' | 'resource';   // 搜索范围
  filter?: object;                 // 向量存储过滤器
  threshold?: number;              // 最小相似度
  indexConfig?: VectorIndexConfig; // 索引配置
  indexName?: string;              // 自定义索引名
}

interface VectorIndexConfig {
  type: 'ivfflat' | 'hnsw' | 'flat';
  metric: 'cosine' | 'euclidean' | 'dotproduct';
  ivf?: { lists: number };
  hnsw?: { m: number; efConstruction: number };
}
```

### 4.3 召回流程

```
1. 获取嵌入器实例
      ↓
2. 对查询文本生成嵌入向量
      ↓
3. 查询向量存储（topK, filter, scope）
      ↓
4. 按相似度阈值过滤
      ↓
5. 通过 ID 从存储中获取完整消息
      ↓
6. 返回带评分的消息结果
```

### 4.4 向量索引

索引名模式：`memory_messages_{dimension}`

```typescript
// 创建索引
await memory.createEmbeddingIndex({
  indexName: 'memory_messages_1536',
  dimension: 1536,
  indexConfig: {
    type: 'ivfflat',
    metric: 'cosine',
    ivf: { lists: 100 },
  },
});
```

---

## 5. 观察记忆（Observational Memory）

### 5.1 概述

观察记忆是最复杂的子系统，使用**三 Agent 架构**异步从对话中提取长期记忆。

### 5.2 三 Agent 架构

```
┌──────────────────────────────────────────┐
│           Observational Memory            │
│                                           │
│  用户 ──→ Actor (主对话 Agent)             │
│              │                            │
│              │ 对话轮次                     │
│              ▼                            │
│          Observer (观察 Agent)             │
│              │                            │
│              │ 提取结构化观察                │
│              │ - 用户断言                   │
│              │ - 状态变化                   │
│              │ - 时间事实 "(TIME)" 前缀      │
│              ▼                            │
│          Reflector (反思 Agent)             │
│              │                            │
│              │ 压缩/合并观察                 │
│              │ - 跨线程合并                  │
│              │ - 用户断言优先级              │
│              │ - 空反思检测                  │
│              ▼                            │
│       持久化观察 → 向量索引                  │
└──────────────────────────────────────────┘
```

### 5.3 异步缓冲机制

观察和反思在后台**异步**进行，有可配置的阈值和回退策略：

```typescript
interface ObservationalMemoryConfig {
  enabled: boolean;
  model?: string | ModelConfig;     // Observer 使用的模型（默认 gemini-2.5-flash）
  observation?: {
    messageTokens: number;          // 触发阈值（默认 30000）
    bufferTokens: number;           // 缓冲间隔比例（默认 0.2 = 20%）
    bufferActivation: number;       // 激活比例（默认 0.8 = 80%）
    blockAfter: number;             // 同步回退时间（默认 2s）
    activateAfterIdle: number;      // 空闲后激活 TTL
    threadTitle: string;
    observeAttachments: boolean;
  };
  reflection?: {
    observationTokens: number;      // 触发阈值（默认 40000）
    bufferActivation: number;       // 激活比例（默认 0.5 = 50%）
    blockAfter: number;
    activateAfterIdle: number;
  };
}
```

### 5.4 缓冲时序

```
消息累积中...
  │
  ├─ Token 达到 bufferTokens 阈值（20%）
  │    └─ 启动异步缓冲（background）
  │
  ├─ Token 继续累积...
  │
  ├─ 达到 bufferActivation 阈值（80%）
  │    └─ 如果异步未完成 + blockAfter 超时 → 同步回退
  │
  ├─ activateAfterIdle：空闲后 TTL 触发缓冲
  │
  └─ activateOnProviderChange：模型变更时触发
```

### 5.5 Token 计数器

`packages/memory/src/processors/observational-memory/token-counter.ts` (~1879 行)

- 支持多模态 token 估算
- 图像维度计算
- 文件字节计算
- 按模型类型的特定启发式估算

### 5.6 数据库表结构

`mastra_observational_memory` 表（30+ 列）：

| 关键列 | 用途 |
|--------|------|
| `id`, `lookupKey`, `scope` | 身份和路由 |
| `resourceId`, `threadId` | 多租户隔离 |
| `activeObservations` | 当前活动观察 |
| `activeObservationsPendingUpdate` | 待更新观察 |
| `originType`, `config`, `generationCount` | 配置追踪 |
| `lastObservedAt`, `lastReflectionAt` | 时间追踪 |
| `pendingMessageTokens` | 待处理 token 数 |
| `totalTokensObserved` | 累计已处理 token |
| `observationTokenCount` | 观察 token 数 |
| `isObserving`, `isReflecting` | 运行状态标志 |
| `isBufferingObservation`, `isBufferingReflection` | 缓冲标志 |
| `bufferedObservations`, `bufferedObservationTokens` | 缓冲数据 |
| `bufferedReflection`, `bufferedReflectionTokens` | 反思缓冲 |
| `metadata` | JSONB 扩展数据 |

---

## 6. 嵌入生成流水线

### 6.1 文本分块

```typescript
// vico/memory/src/index.ts
function chunkText(text: string, tokensPerChunk: number): string[] {
  // 按词边界分割
  // 最大块大小：tokens * 4 字符（~16K chars @ 4096 tokens）
  // 每块生成独立向量
  // 同一条消息的块共享 thread_id + resource_id
}
```

### 6.2 嵌入生成

```typescript
async function embedMessageContent(
  content: string,
  embedder: Embedder
): Promise<number[][]> {
  // 1. 分块
  const chunks = chunkText(content);
  
  // 2. LRU 缓存查找（xxhash 键，max 1000 条目）
  for (const chunk of chunks) {
    const hash = xxhash(chunk);
    const cached = embeddingCache.get(hash);
    if (cached) continue;
    
    // 3. 生成嵌入
    const embedding = await embedder.doEmbed({ values: [chunk] });
    embeddingCache.set(hash, embedding);
  }
}
```

### 6.3 FastEmbed 本地嵌入

文件：`packages/fastembed/src/index.ts`

| 模型 | 维度 |
|------|------|
| BGE-small-en-v1.5 | 384 |
| BGE-base-en-v1.5 | 768 |

```typescript
import { fastembed } from '@mastra/fastembed';

// 运行时：ONNX Runtime via fastembed.js
// 批量：默认 batch size 256，使用 AsyncGenerator
// 预热：warmup() 预下载模型

// AI SDK 兼容：三版适配器（v1/v2/v3 spec）
const embedder = fastembed.small;   // BGE-small (384d)
const embedderBase = fastembed.base; // BGE-base (768d)
```

### 6.4 API 嵌入

支持的云端嵌入提供商：
- **OpenAI**：text-embedding-3-small、text-embedding-3-large、ada-002
- **Google**：Generative AI embeddings
- **Anthropic**：通过 Voyage AI

维度自动探测：`getEmbeddingDimension()` 探测并缓存结果。

---

## 7. 向量搜索实现

### 7.1 搜索流程

```typescript
// 语义召回搜索
async function recall(params: {
  threadId: string;
  query: string;
  options: SemanticRecallConfig;
}): Promise<ScoredMessage[]> {
  // 1. 生成查询嵌入
  const queryEmbedding = await embedder.doEmbed({ values: [query] });
  
  // 2. 向量查询
  const results = await vectorStore.query({
    indexName: 'memory_messages_1536',
    vector: queryEmbedding[0],
    topK: options.topK,
    filter: buildFilter(options.scope, threadId, resourceId),
  });
  
  // 3. 阈值过滤
  const filtered = results.filter(r => r.score >= options.threshold);
  
  // 4. 获取完整消息
  const messages = await storage.getMessages({
    messageIds: filtered.map(r => r.id),
  });
  
  // 5. 排名返回
  return messages.map((msg, i) => ({
    ...msg,
    score: filtered[i].score,
  }));
}
```

### 7.2 观察搜索

```typescript
// 观察组语义搜索
async function searchMessages(params: {
  threadId: string;
  query: string;
  topK?: number;
}): Promise<ScoredObservation[]> {
  // 使用 observation-specific 索引
  // 索引名：memory_observations_{dimension}
}
```

---

## 8. 召回工具（recallTool）

文件：`packages/memory/src/tools/om-tools.ts`

### 8.1 三种模式

| 模式 | 功能 |
|------|------|
| `messages` | 基于游标的对话历史分页 |
| `threads` | 线程列表（日期过滤、分页） |
| `search` | 观察组语义搜索 |

### 8.2 Messages 模式

```typescript
interface RecallMessagesParams {
  mode: 'messages';
  threadId: string;
  detail?: 'low' | 'high';     // 低/高详情
  cursor?: string;             // 分页游标
  direction?: 'forward' | 'backward';
  partType?: string;           // 过滤消息类型
  toolName?: string;           // 过滤工具名
  tokenBudget?: number;        // Token 预算（默认 2000）
}

// 自动扩展阈值：
//   100 tokens 文本内容
//   20 tokens 工具结果
```

---

## 9. Agent 集成：Processor 模式

### 9.1 Processor 生成

`MastraMemory` 实现了 `ProcessorProvider` 接口，为 Agent 自动生成处理器：

```typescript
class MastraMemory {
  getInputProcessors({ threadId, resourceId, memoryConfig }): Processor[] {
    return [
      new MessageHistory(),        // 注入最近消息（当 lastMessages 设置且 OM 未启用时）
      new SemanticRecall(),        // 注入语义召回的记忆
      new ObservationalMemoryProcessor(),  // 观察记忆引擎
      new WorkingMemoryStateProcessor(),   // 状态信号（当 useStateSignals 时）
    ].filter(Boolean);
  }
  
  getOutputProcessors({ threadId, resourceId, memoryConfig }): Processor[] {
    return [
      new ObservationalMemoryProcessor(),  // 处理输出触发观察/反思
    ];
  }
}
```

### 9.2 系统提醒过滤

```typescript
// system-reminders.ts
function filterSystemReminderMessages(messages: Message[]): Message[] {
  return messages.filter(msg => {
    // 过滤 type: 'system-reminder' | 'reactive'
    // 过滤 user messages with systemReminder metadata
    // 过滤 text parts starting with <system-reminder>
  });
}
// 防止 Agent 将自己的工作记忆视为用户输入
```

### 9.3 配置合并

```typescript
// 多层配置深合并
function getMergedThreadConfig(
  defaultConfig: MemoryConfig,
  threadConfig?: MemoryConfig,
  runtimeConfig?: MemoryConfig,
): MemoryConfig;

// 运行时覆盖 via RequestContext
function parseMemoryRequestContext(ctx: RequestContext): Partial<MemoryConfig>;
```

---

## 10. MastraMemory 抽象基类 API

### 10.1 抽象方法（子类必须实现）

```typescript
abstract class MastraMemory extends MastraBase {
  // 线程操作
  abstract getThreadById({ threadId }): Promise<StorageThread>;
  abstract saveThread({ thread }): Promise<void>;
  abstract updateThread({ threadId, ...updates }): Promise<void>;
  abstract deleteThread({ threadId }): Promise<void>;
  abstract listThreads({ resourceId }): Promise<StorageThread[]>;
  abstract cloneThread({ sourceThreadId, targetThreadId }): Promise<void>;
  
  // 消息操作
  abstract saveMessages({ messages }): Promise<void>;
  abstract deleteMessages({ messageIds }): Promise<void>;
  
  // 记忆检索
  abstract recall({ threadId, query, options }): Promise<ScoredMessage[]>;
  
  // 工作记忆
  abstract getWorkingMemory({ threadId, resourceId }): Promise<WorkingMemory>;
  abstract getWorkingMemoryTemplate({ memoryConfig }): Promise<string>;
  abstract updateWorkingMemory({ threadId, resourceId, workingMemory }): Promise<void>;
}
```

### 10.2 已实现方法（基类提供）

```typescript
// 线程创建
createThread({ threadId, resourceId }): Promise<StorageThread>;

// ID 生成
generateId(): string;

// Token 估算
estimateTokens({ messages }): Promise<number>;

// 配置合并
getMergedThreadConfig(memoryConfig): MemoryConfig;
getConfig(): SerializableConfig;

// 嵌入索引
getEmbeddingIndexName(dimension?): string;
createEmbeddingIndex({ indexName, dimension, indexConfig }): Promise<void>;
getEmbeddingDimension(): Promise<number>;

// 处理器工厂
getInputProcessors({ threadId, resourceId, memoryConfig }): Processor[];
getOutputProcessors({ threadId, resourceId, memoryConfig }): Processor[];
```

---

## 11. MockMemory 测试实现

文件：`packages/core/src/memory/mock.ts`

```typescript
class MockMemory extends MastraMemory {
  // 所有抽象方法已实现
  // 基于 InMemoryStore
  // 支持 enableWorkingMemory, enableMessageHistory
  // Schema 工作记忆使用 deepMergeWorkingMemory 实现 JSON 合并
}
```

---

## 12. 存储适配器

### 12.1 MemoryStorage 抽象

```typescript
// vico/core/src/storage/domains/memory/base.ts
abstract class MemoryStorage {
  abstract getThreadById(id: string): Promise<StorageThread>;
  abstract saveMessages(messages: Message[]): Promise<void>;
  abstract listMessages(threadId: string, opts?): Promise<Message[]>;
  abstract createThread(thread: StorageThread): Promise<void>;
  abstract updateThread(id: string, updates: Partial<StorageThread>): Promise<void>;
  abstract deleteThread(id: string): Promise<void>;
  
  // Observational Memory
  abstract getObservationalMemoryState(lookupKey: string): Promise<OMState>;
  abstract updateActiveObservations(...): Promise<void>;
  abstract swapBufferedToActive(...): Promise<void>;
}
```

### 12.2 后端实现

| 适配器 | 用于 |
|--------|------|
| **LibSQL** | 默认，本地 SQLite 兼容，开发/单机部署 |
| **PostgreSQL** | pgvector 扩展，生产部署 |
| **Upstash** | Redis 基础，Serverless |
| **MongoDB** | 文档型存储 |

---

## 13. 核心架构模式总结

| 模式 | 用途 | 实现细节 |
|------|------|----------|
| **Mutex-guarded writes** | 工作记忆更新 | Per-thread/resource 内存互斥锁 |
| **Async buffering** | 观察记忆 | 后台异步观察+反思，可配置同步回退 |
| **Token-aware chunking** | 文本分块+OM缓冲 | 多模态 token 计数（图像维度、文件字节） |
| **Processor pattern** | Agent 集成 | 通过 Input/Output Processor 解耦 |
| **Configuration layering** | 配置管理 | Default → Thread → Runtime 三层深合并 |
| **State signals vs system messages** | 工作记忆传输 | 支持去重、delta 补丁、上下文窗口管理 |
| **LRU embedding cache** | 嵌入缓存 | xxhash 键, 1000 条目, 避免重复计算 |
| **Three-agent architecture** | 观察记忆 | Actor/Observer/Reflector 分层处理 |

---

## 14. 配置示例

```typescript
const memory = new Memory({
  storage: new LibSQLStore({ url: ':memory:' }),
  embedder: fastembed.small,
  vector: new LibSQLVector({ url: ':memory:' }),
  
  // 配置
  lastMessages: 10,
  generateTitle: true,
  
  // 工作记忆（Schema 模式）
  workingMemory: {
    enabled: true,
    type: 'schema',
    schema: z.object({
      preferences: z.object({
        language: z.string(),
      }),
    }),
    scope: 'resource',
    useStateSignals: true,
  },
  
  // 语义召回
  semanticRecall: {
    topK: 5,
    scope: 'thread',
    threshold: 0.7,
  },
  
  // 观察记忆
  observationalMemory: {
    enabled: true,
    model: 'google/gemini-2.5-flash',
    observation: {
      messageTokens: 30000,
      bufferTokens: 0.2,
      bufferActivation: 0.8,
    },
    reflection: {
      observationTokens: 40000,
      bufferActivation: 0.5,
    },
  },
});
```

---

## 15. 关键文件索引

| 组件 | 文件路径 |
|------|----------|
| MastraMemory 抽象基类 | `packages/core/src/memory/memory.ts` |
| Memory 类型定义 | `packages/core/src/memory/types.ts` |
| Memory 具体实现 | `packages/memory/src/index.ts` |
| 工作记忆工具 | `packages/memory/src/tools/working-memory.ts` |
| 召回工具 | `packages/memory/src/tools/om-tools.ts` |
| 观察记忆引擎 | `packages/memory/src/processors/observational-memory/observational-memory.ts` |
| OM Processor | `packages/memory/src/processors/observational-memory/processor.ts` |
| Token 计数器 | `packages/memory/src/processors/observational-memory/token-counter.ts` |
| 状态信号 Processor | `packages/memory/src/processors/working-memory-state/processor.ts` |
| 系统提醒过滤 | `packages/core/src/memory/system-reminders.ts` |
| MockMemory | `packages/core/src/memory/mock.ts` |
| FastEmbed | `packages/fastembed/src/index.ts` |
| Memory 存储接口 | `packages/core/src/storage/domains/memory/base.ts` |
