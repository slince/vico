# RAG 迁移至 @mastra/rag 设计文档

## 概述

将手写的文本分块逻辑替换为 `@mastra/rag` 的 `MDocument` 分块 API，同时清理 `rag.ts` 中从未被调用的死代码，简化 `rag-tool.ts` 的重复逻辑。

## 核心决策

### 保留多索引搜索工具，不使用 `createVectorQueryTool`

`createVectorQueryTool` 只支持单索引查询，而每个知识库是独立的 LibSQLVector 索引（`kb_${kbId}`），一个 Agent 可能绑定多个 KB。迁移到单索引需要复杂的数据迁移，风险过高。当前多索引工具逻辑简单（~40 行），保留并重构即可。

### MDocument 替代 splitText

`@mastra/rag` 的 `MDocument` 提供更好的分块策略（recursive/markdown/sentence 等），替换当前手写的按段落+单词拆分逻辑，分块质量更高且可扩展。

## 变更范围

### 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/package.json` | 修改 | 新增 `@mastra/rag` 依赖 |
| `packages/server/src/memory/rag.ts` | 重写 | MDocument 分块 + 清理死代码 |
| `packages/server/src/agent/tools/rag-tool.ts` | 重构 | 提取辅助函数，消除重复 |

### 不变文件

| 文件 | 原因 |
|------|------|
| `knowledge-manager.ts` | 只调 `ragManager.indexFile()`，接口不变 |
| `agent-tools.factory.ts` | 只调 `createRagSearchTool()`，接口不变 |
| `team-network.ts` | 只调 `createRagSearchTool()`，接口不变 |
| `memory-setup.ts` | `getVector()`/`getMemory()` 不变 |
| `config.ts` | RAG 配置项被新代码复用 |
| `server.config.yaml` | 无需新增配置项 |

## rag.ts 重构

### indexText — MDocument 分块

```ts
import { MDocument } from '@mastra/rag';

async indexText(kbId: string, text: string, metadata: Record<string, any> = {}): Promise<number> {
  const vector = getVector();
  const memory = await getMemory();
  if (!memory.embedder) throw new Error('Embedder not configured');

  // MDocument 分块，策略: recursive（段落 → 空格 → 字符）
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

  // 更新 chunk_count
  const db = getDb();
  const { knowledge_bases } = schema;
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
| `splitText()` (私有) | 被 MDocument.chunk() 替代 |
| `semanticSearch()` | 从未被调用，`rag-tool.ts` 自行实现 |
| `keywordSearch()` | 从未被调用 |
| `hybridSearch()` | 从未被调用 |
| `RetrievedChunk` 接口 | 仅被上述三个方法使用，无外部引用 |

### 保留的方法

`indexFile()` 和 `indexResourceDir()` — 文件 I/O 逻辑不在 `@mastra/rag` 范围内，保持不变。

## rag-tool.ts 简化

提取 `searchKbIndex` 辅助函数，消除 `execute` 中的重复 embed + query 逻辑：

```ts
async function searchKbIndex(
  vector: LibSQLVector,
  queryEmbedding: number[],
  kbId: string,
  topK: number,
): Promise<string[]> {
  try {
    const results = await vector.query({
      indexName: `kb_${kbId}`,
      queryVector: queryEmbedding,
      topK,
    });
    return results
      .filter((r) => r.metadata?.content && typeof r.metadata.content === 'string')
      .map((r) => r.metadata.content as string);
  } catch {
    return [];
  }
}
```

`createRagSearchTool` 对外接口不变（参数、返回值类型不变）。

## 配置

无变更。现有配置项 `chunk_size`(512)、`chunk_overlap`(64)、`retrieval_top_k`(5) 被新代码复用。

## 数据库

无变更。元数据格式 `{ content, chunk_index, ...metadata }` 保持不变，新旧 chunks 在 LibSQLVector 中完全兼容。

## 向后兼容

- 已有索引的 KB 仍能正常检索（元数据结构一致）
- 新旧 chunks 可共存于同一索引
- API 接口不变（上传、搜索均不受影响）

## 验证清单

- [ ] 上传文件到知识库，分块和索引成功，`chunk_count` 正确更新
- [ ] 使用绑定知识库的 Agent 触发 `search_knowledge_base` 工具，返回正确结果
- [ ] 已有索引的 KB 仍能正常检索
- [ ] `pnpm build` 无类型错误
- [ ] 边界情况：空文件、大文件、PDF 无文本
