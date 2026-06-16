# RAG 迁移至 @mastra/rag 设计文档

## 概述

用 `@mastra/rag` 替换手写 RAG 分块和检索逻辑，同时将 Agent 与知识库的绑定从多对多简化为一对一，使 `createVectorQueryTool` 能够直接使用。

## 核心决策

### 1. Agent 单知识库绑定

Agent 从多 KB 改为单 KB，`kb_id` 直接存 `agents` 表，废弃 `agent_knowledge_bases` 多对多关联表。

原因：
- 简化数据模型，消除复合主键关联表
- 使 `createVectorQueryTool` 单索引查询模式能够直接适配
- 大多数场景下一个 Agent 只需一个领域知识库，多 KB 带来的收益有限

### 2. 使用 createVectorQueryTool

`createVectorQueryTool` 是 `@mastra/rag` 提供的标准向量查询工具，自带 metadata 过滤、reranker 等能力。单 KB 场景下直接指定 `indexName: kb_${kbId}`，无需手写 for 循环。

### 3. MDocument 替代 splitText

`@mastra/rag` 的 `MDocument` 提供更好的分块策略（recursive/markdown/sentence 等），替换当前手写的按段落+单词拆分逻辑。

## 变更范围

### 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/package.json` | 修改 | 新增 `@mastra/rag` 依赖 |
| `packages/server/src/db/schema.ts` | 修改 | agents 表新增 `kb_id` 列，标记 `agent_knowledge_bases` 废弃 |
| `packages/server/src/services/agent/types.ts` | 修改 | AgentDetail 的数组改为单个 `kb_id`；校验 schema 改为单对象 |
| `packages/server/src/services/agent/agent-manager.ts` | 修改 | replaceKnowledge 改为写入 agents.kb_id；getById/list 适配单 KB |
| `packages/server/src/memory/rag.ts` | 重写 | MDocument 分块，清理死代码 |
| `packages/server/src/agent/tools/rag-tool.ts` | 重写 | 使用 createVectorQueryTool |
| `packages/web/src/pages/AgentDetail.tsx` | 修改 | KB 选择改为 Radio/SingleSelect |
| `packages/server/src/auth/seed.ts` | 修改 | agent_knowledge_bases seed 数据迁移到 agents.kb_id |

### 不变文件

| 文件 | 原因 |
|------|------|
| `knowledge-manager.ts` | 只调 `ragManager.indexFile()`，接口不变 |
| `agent-tools.factory.ts` | 只调 `createRagSearchTool()`，返回类型调整但调用方式不变 |
| `team-network.ts` | 只读 `agentRow.kb_id`，从数组变为单值 |
| `memory-setup.ts` | `getVector()`/`getMemory()` 不变 |
| `config.ts` | RAG 配置项不复用，createVectorQueryTool 内部处理 |
| `server.config.yaml` | 无需新增配置项 |

## 数据库变更

### agents 表新增列

```sql
ALTER TABLE agents ADD COLUMN kb_id TEXT;
```

### agent_knowledge_bases 表废弃

保留表结构不做删除，但不再写入新数据。已有数据无需迁移（项目处于早期阶段）。

## tags 表变更（可选）

Agent 列表/卡片展示时，`skill_names` 仍保留为数组，`kb_ids` 改为可选单值。

## API 变更

### `PUT /api/v1/agents/:id/knowledge`

请求体从数组改为单对象：

```json
// Before
{ "knowledge_bases": [{ "kb_id": "xxx", "mode": "auto" }] }

// After
{ "kb_id": "xxx", "mode": "auto" }
```

`kb_id` 为 `null` 时解绑。

### `GET /api/v1/agents` / `GET /api/v1/agents/:id`

响应中 `knowledge_bases` 数组替换为 `kb_id: string | null`。

## rag.ts 重构

### indexText — MDocument 分块

```ts
import { MDocument } from '@mastra/rag';

async indexText(kbId: string, text: string, metadata: Record<string, any> = {}): Promise<number> {
  const vector = getVector();
  const memory = await getMemory();
  if (!memory.embedder) throw new Error('Embedder not configured');

  const doc = MDocument.fromText(text);
  const chunks = await doc.chunk({
    strategy: 'recursive',
    maxSize: config.rag.chunk_size,
    overlap: config.rag.chunk_overlap,
  });

  const chunkTexts = chunks.map((c) => c.text);
  const chunkIds = chunks.map(() => uuid());

  const embedResult = await memory.embedder.doEmbed({ values: chunkTexts });

  await vector.upsert({
    indexName: `kb_${kbId}`,
    vectors: embedResult.embeddings,
    ids: chunkIds,
    metadata: chunkTexts.map((c, i) => ({ content: c, chunk_index: i, ...metadata })),
  });

  const db = getDb();
  await db
    .update(knowledge_bases)
    .set({ chunk_count: sql`${knowledge_bases.chunk_count} + ${chunkTexts.length}` })
    .where(eq(knowledge_bases.id, kbId));

  return chunkTexts.length;
}
```

### 删除的方法和类型

| 删除项 | 原因 |
|------|------|
| `splitText()` | 被 MDocument.chunk() 替代 |
| `semanticSearch()` | 未被调用，已被 createVectorQueryTool 替代 |
| `keywordSearch()` | 未被调用 |
| `hybridSearch()` | 未被调用 |
| `RetrievedChunk` 接口 | 仅被上述三个方法使用 |

### 保留的方法

`indexFile()` 和 `indexResourceDir()` — 文件 I/O 不在 `@mastra/rag` 范围内。

## rag-tool.ts 重写

用 `createVectorQueryTool` 替换手写工具：

```ts
import { createVectorQueryTool } from '@mastra/rag';
import { getMemory } from '../memory-setup.js';
import type { AgentDetail } from '../../services/agent/types.js';

export async function createRagSearchTool(agent: AgentDetail) {
  const kbId = agent.kb_id;
  if (!kbId) return null;

  const memory = await getMemory();
  if (!memory.embedder) return null;

  return createVectorQueryTool({
    id: 'search_knowledge_base',
    description:
      '搜索知识库获取相关文档内容。当需要查找特定信息、参考文档或获取领域知识时使用。',
    vectorStoreName: 'libSqlVector',
    indexName: `kb_${kbId}`,
    model: memory.embedder,
    enableFilter: true,
  });
}
```

关键变化：
- 从 `agent.kb_id`（单值）而非 `agent.knowledge_bases`（数组）读取
- 返回 `createVectorQueryTool` 创建的标准 CoreTool，而非手写 `createTool`
- 不再需要超时保护（Mastra 框架内置）
- `getMemory()` 已有单例模式，`getVector()` 不再直接使用

## agent-tools.factory.ts 适配

```ts
// Before
const ragTool = await createRagSearchTool(agent);
if (ragTool) tools[ragTool.id] = ragTool;

// After — 接口不变，但 createRagSearchTool 内部使用 createVectorQueryTool
```

## team-network.ts 适配

从 `agentRow.knowledge_bases` 改为 `agentRow.kb_id`：

```ts
// Before
if (agentRow.rag_mode !== 'disabled') {
  const ragTool = await createRagSearchTool(agentRow);
  if (ragTool) tools[ragTool.id] = ragTool;
}

// After — 调用方式不变，createRagSearchTool 内部读 agent.kb_id
```

## 向前端变更

### AgentDetail 页面 — KB 选择器

从多选 Checkbox 列表改为单选 Radio/Select：

```tsx
// Before: 多选
<KnowledgeBaseSelector selected={agent.kb_ids} onChange={...} />

// After: 单选
<KnowledgeBaseSelect value={agent.kb_id} onChange={...} nullable />
```

### API Client 类型

```ts
// Before
interface AgentDetail {
  kb_ids: string[];
  knowledge_bases: { kb_id: string; mode: string }[];
}

// After
interface AgentDetail {
  kb_id: string | null;
}
```

## 配置

无变更。`createVectorQueryTool` 内部使用 Mastra 框架默认行为（topK 在工具调用时由 LLM 决定）。

## 向后兼容

- 已有索引（`kb_xxx`）完全兼容，无需重新索引
- API 返回格式变更需前端同步更新
- `agent_knowledge_bases` 表保留但不使用，已有数据通过迁移脚本写入 `agents.kb_id`

## 验证清单

- [ ] `pnpm build` 无类型错误
- [ ] 上传文件到知识库，分块和索引成功
- [ ] 绑定知识库的 Agent 能通过 `search_knowledge_base` 工具检索
- [ ] 未绑定知识库的 Agent 不暴露该工具
- [ ] 前端 KB 选择器改为单选，创建/编辑 Agent 功能正常
- [ ] 空文件、大文件、PDF 无文本等边界情况
