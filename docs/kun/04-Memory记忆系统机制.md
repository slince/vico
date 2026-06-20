# Kun Memory 记忆系统机制

## 一、系统概述

Kun 的 Memory 系统是一个**轻量级长期记忆**方案，设计目标是零外部依赖、文件级持久化、N-gram 文本匹配检索。**不支持向量检索或语义搜索**。

**核心设计理念**：极简。不引入向量数据库、Embedding 模型、Tokenizer 依赖，全凭 N-gram 文本重叠度实现记忆召回。

---

## 二、Memory 数据类型

### 2.1 MemoryRecord 结构

文件：`kun/src/contracts/memory.ts`

```typescript
interface MemoryRecord {
  id: string
  content: string                // 记忆内容
  scope: 'user' | 'workspace' | 'project'  // 作用域
  workspace?: string             // 关联的工作区路径
  project?: string               // 关联的项目名
  tags: string[]                 // 标签列表
  confidence: number             // 置信度 0-1
  sourceThreadId?: string        // 来源 Thread
  sourceTurnId?: string          // 来源 Turn
  createdAt: number              // 创建时间戳
  updatedAt: number              // 更新时间戳
  disabledAt?: number            // 禁用时间戳（软禁用）
  deletedAt?: number             // 删除时间戳（软删除/墓碑）
}
```

### 2.2 三种作用域（Scope）

| Scope | 含义 | 检索行为 |
|-------|------|---------|
| `user` | 用户级持久事实（名称、偏好、账户） | **无条件注入**，跳过评分 |
| `workspace` | 工作区级记忆（项目特定偏好） | N-gram 评分检索 |
| `project` | 项目级记忆 | N-gram 评分检索 |

### 2.3 生命周期状态

```
ACTIVE    (无 deletedAt, 无 disabledAt)
  ↓ 用户/LLM 调用 disable
DISABLED  (disabledAt 已设置)
  ↓ 用户/LLM 调用 re-enable
ACTIVE

ACTIVE
  ↓ 用户/LLM 调用 delete
DELETED   (deletedAt 已设置，墓碑记录)
  ↓ 仅 includeDeleted=true 时可见
```

---

## 三、存储机制

### 3.1 文件存储

文件：`kun/src/memory/memory-store.ts`

**存储方案**：每个 Memory 一条独立的 JSON 文件。

```
<dataDir>/memory/
  ├── {uuid1}.json
  ├── {uuid2}.json
  ├── {uuid3}.json
  └── ...
```

每文件内容：
```json
{
  "id": "abc123",
  "content": "用户偏好使用 pnpm 而非 npm",
  "scope": "user",
  "tags": ["preference", "package-manager"],
  "confidence": 0.9,
  "createdAt": 1718000000000,
  "updatedAt": 1718000000000
}
```

### 3.2 原子写入

文件：`kun/src/adapters/file/atomic-write.ts`

```
写入流程：
  1. 将 JSON 写入 .tmp 临时文件
  2. fs.rename(.tmp → 目标路径)
  3. Windows 上处理 EPERM/EACCES/EBUSY 重试
  4. 成功/失败后清理 .tmp
```

### 3.3 读取方式

**无索引结构**。每次 `list()` 或 `retrieve()` 遍历目录下所有 `.json` 文件并解析。适用于少量记忆（数十条），大数据量场景不适合。

### 3.4 MemoryStore 接口

```typescript
interface MemoryStore {
  create(input: MemoryCreateRequest): Promise<MemoryRecord>
  update(id: string, patch: MemoryUpdateRequest): Promise<MemoryRecord>
  delete(id: string): Promise<MemoryRecord>  // 软删除（设置 deletedAt）
  list(filter?: { workspace?: string; includeDeleted?: boolean }): Promise<MemoryRecord[]>
  retrieve(input: { query: string; workspace?: string; limit: number }): Promise<MemoryRecord[]>
  diagnostics(): Promise<MemoryDiagnostics>
  setLastInjected(ids: string[]): void  // 诊断用
}
```

---

## 四、检索机制（N-gram 文本匹配）

### 4.1 核心算法

文件：`kun/src/memory/memory-store.ts` 第 166-208 行

```typescript
function scoreMemory(record: MemoryRecord, query: string): number {
  // 1. 提取查询的 N-gram
  const queryGrams = ngrams(query)

  // 2. 提取记录的 N-gram
  const recordText = `${record.content} ${record.tags.join(' ')}`
  const recordGrams = ngrams(recordText)

  // 3. 计算重叠的 N-gram 数量
  const overlap = intersect(queryGrams, recordGrams).size

  // 4. 计算覆盖率 = 重叠数 / 查询 N-gram 总数
  const coverage = overlap / queryGrams.size

  // 5. 最终得分 = (重叠数 + 覆盖率) * 置信度
  return (overlap + coverage) * record.confidence
}
```

### 4.2 N-gram 分词规则

```typescript
function ngrams(text: string): Set<string> {
  // 分类处理两种字符：
  // ASCII/拉丁：匹配 [a-z0-9_]{3,} → 提取 Trigrams（3字符滑动窗口）
  // CJK（中日韩）：匹配 [\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+ → 提取 Bigrams（2字符滑动窗口）
}
```

示例：
- 英文 "workspace preference" → trigrams: `{"wor","ork","rks","ksp","spa","pac","ace","pre","ref","efe","fer","ere","ren","enc","nce"}`
- 中文 "工作区偏好" → bigrams: `{"工作","作区","区偏","偏好"}`

### 4.3 检索流程（retrieve）

```typescript
async retrieve(input: { query, workspace?, limit }): Promise<MemoryRecord[]> {
  // 1. 如果 memory 能力未启用 → 返回空
  // 2. 列出活跃记录（排除 disabled 和 deleted）
  // 3. 分支处理：
  //    A. user 作用域 → 全部无条件包含（不评分）
  //    B. workspace/project 作用域 → N-gram 评分
  // 4. 过滤：score > 0
  // 5. 排序：score desc → updatedAt desc
  // 6. 切片：取前 limit 条（默认 8）
  // 7. 返回结果
}
```

### 4.4 User 作用域特殊处理

**设计原因**：查询 "who am I?" 与记忆内容 "用户名叫张三" 之间的字符重叠为零，N-gram 匹配永远无法命中。因此所有 `user` 作用域的记忆**无条件注入**每一轮 Turn，跳过评分。

---

## 五、Agent Loop 中的集成

### 5.1 检索时机

文件：`kun/src/loop/agent-loop.ts`

每轮 Turn 开始时调用 `retrieveMemories()`：

```typescript
// 简化逻辑（第 2559-2571 行）
async function retrieveMemories(thread, turn): Promise<MemoryRecord[]> {
  return this.opts.memoryStore.retrieve({
    query: turn.prompt,         // 使用用户提示词作为查询
    workspace: thread.workspace, // 限定工作区
    limit: config.maxInjectedRecords  // 默认 8
  })
}
```

### 5.2 上下文注入格式

文件：`kun/src/loop/agent-loop.ts` 第 2749-2757 行

```
"Relevant long-term memories for this turn:
- [mem_abc123] (user) 用户偏好使用 pnpm 而非 npm
- [mem_def456] (workspace) 本项目使用 Vitest 进行测试
- [mem_ghi789] (project) 部署目标为 Cloudflare Workers"
```

这些内容作为上下文指令（`contextInstructions`）的一部分发送给 LLM。

### 5.3 Turn 元数据记录

每个 Turn 记录其注入了哪些记忆：

```typescript
// kun/src/domain/turn.ts
{
  injectedMemoryIds: [],  // 初始为空
  // ...
}

// runTurn() 完成后 updateTurnMetadata()
turnService.updateTurnMetadata(turnId, { injectedMemoryIds: [...] })
```

---

## 六、LLM 可调用的 Memory 工具

### 6.1 工具定义

文件：`kun/src/adapters/tool/memory-tool-provider.ts`

| 工具 | 功能 | 审批策略 |
|------|------|---------|
| `memory_create` | 创建新记忆 | `on-request`（需用户批准） |
| `memory_update` | 更新记忆内容/标签/禁用状态 | `on-request` |
| `memory_delete` | 软删除记忆（设置墓碑） | `on-request` |

### 6.2 memory_create

```typescript
{
  name: 'memory_create',
  arguments: {
    content: '用户偏好使用 pnpm 而非 npm',
    scope: 'workspace',   // 默认 'workspace'
    tags: ['preference', 'package-manager'],
    // workspace 自动从当前 thread 上下文填充
    // sourceThreadId / sourceTurnId 自动记录
  }
}
```

### 6.3 系统提示词指导

文件：`kun/src/prompt/kun-system-prompt.ts` 第 35-39 行

```
Memory behavior:
- Relevant long-term memories may be injected per turn as context.
  Treat them as authoritative facts about the user and workspace.
- When the user states a durable preference, fact, or decision worth
  keeping, proactively call `memory_create` to persist it.
- Use `memory_update` to refine a memory, `memory_delete` to remove.
- Do not create memories for transient task state.
```

---

## 七、HTTP REST API

### 7.1 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/v1/memory?workspace=&include_deleted=` | 列出记忆 |
| `POST` | `/v1/memory` | 创建记忆 |
| `PATCH` | `/v1/memory/:id` | 更新记忆 |
| `DELETE` | `/v1/memory/:id` | 软删除记忆 |
| `GET` | `/v1/memory/diagnostics` | 获取诊断信息 |

### 7.2 认证

所有端点需要 Bearer Token 认证（与运行时 Token 一致）。

### 7.3 诊断端点返回

```json
{
  "enabled": true,
  "rootDir": "/path/to/data/memory",
  "activeCount": 15,
  "tombstoneCount": 3,
  "lastInjectedIds": ["abc123", "def456"]
}
```

---

## 八、GUI 管理面板

文件：`src/renderer/src/components/settings-section-memory.tsx`

提供完整的前端管理界面：

- 启用/禁用 Memory 功能开关
- 统计面板：活跃数量、墓碑数量
- 作用域过滤器（All / User / Workspace / Project）
- 手动创建新记忆（内容、作用域、标签、置信度）
- 编辑/禁用/重新启用/删除记忆
- 显示最后注入的记忆 ID 列表

---

## 九、配置参数

文件：`kun/src/contracts/capabilities.ts` 第 254-258 行

```typescript
const MemoryCapabilityConfig = {
  enabled: false,              // 默认关闭
  scopes: ['user', 'workspace', 'project'],  // 启用的作用域
  maxInjectedRecords: 8       // 每轮最多注入的记忆数
}
```

---

## 十、设计评价与限制

### 优点

1. **零外部依赖**：不需要向量数据库、Embedding 模型
2. **文件透明**：每条记忆一个 JSON 文件，用户可直接查看/编辑
3. **原子写入**：防止写入中断导致数据损坏
4. **User 作用域特殊处理**：巧妙弥补 N-gram 无法匹配短查询中的人名/偏好的问题
5. **LLM 自主管理**：Agent 自行判断何时创建/更新/删除记忆

### 限制

1. **无语义理解**：纯字符串匹配，无法理解同义词、近义词
2. **缺少向量检索**：不能按语义相似度召回
3. **无 Embedding 模型**：无法处理长文本或抽象查询
4. **线性扫描**：每次检索遍历所有文件，记录数多时性能差
5. **仅支持长期记忆**：无短期记忆、工作记忆、情景记忆
6. **无分块策略**：不支持长文档的自动分块和索引
7. **无 RAG 管道**：没有文档摄取 → 分块 → 向量化 → 检索的工作流

### 与 Vico 的差异

| 维度 | Kun | Vico |
|------|-----|------|
| 检索方式 | N-gram 文本匹配 | 向量嵌入 + 余弦相似度 + 关键词混合搜索 (70/30) |
| Embedding | 无 | Transformers.js（本地）/ OpenAI API |
| 存储 | 文件 JSON（每记录一个文件） | SQLite（经 Drizzle ORM） |
| 记忆类型 | 长期记忆（user/workspace/project） | 短期记忆（FIFO 窗口）+ 长期记忆（向量）+ RAG（文档分块） |
| 语义召回 | 无 | 有 |
| 自动提取 | LLM 主动调用工具 | 正则匹配自动从对话提取事实 |

---

## 十一、关键文件索引

| 文件 | 职责 |
|------|------|
| `kun/src/memory/memory-store.ts` | FileMemoryStore 实现 + MemoryStore 接口 + N-gram 评分 |
| `kun/src/contracts/memory.ts` | Zod Schema（MemoryRecord, MemoryCreateRequest, MemoryUpdateRequest, MemoryDiagnostics） |
| `kun/src/contracts/capabilities.ts` | MemoryCapabilityConfig（enabled, scopes, maxInjectedRecords） |
| `kun/src/adapters/tool/memory-tool-provider.ts` | LLM 工具（memory_create, memory_update, memory_delete） |
| `kun/src/server/routes/memory.ts` | Memory CRUD + diagnostics HTTP 路由 |
| `kun/src/server/runtime-factory.ts` | 运行时装配（实例化 FileMemoryStore，注入 AgentLoop） |
| `kun/src/loop/agent-loop.ts` | retrieveMemories() + memoryInstructions() 上下文注入 |
| `kun/src/services/turn-service.ts` | updateTurnMetadata() 持久化 injectedMemoryIds |
| `kun/src/prompt/kun-system-prompt.ts` | 系统提示词：指示 LLM 何时创建/更新/删除记忆 |
| `kun/src/adapters/file/atomic-write.ts` | 原子文件写入（rename + retry） |
| `kun/tests/memory-store.test.ts` | 测试（CRUD, 检索, CJK, User 作用域注入, 审批门控） |
| `src/renderer/src/components/settings-section-memory.tsx` | GUI 设置面板 |
