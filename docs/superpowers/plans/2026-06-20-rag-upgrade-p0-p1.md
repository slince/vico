# RAG 知识库升级 — P0 + P1 实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将知识库从基础可用提升为具备向量检索增强（查询改写 + 重排序）、文档管理、溯源引用的企业级 RAG 系统。

**Architecture:** 在现有 LibSQLVector + Mastra 基础上，新增 documents 表层、向量检索增强（查询改写 + 重排序），升级文件解析管道。RAG 参数通过 `server.config.yaml` 全局配置。

**Tech Stack:** TypeScript, Hono 4, Drizzle ORM + libsql, Mastra Memory/Vector, @mastra/rag MDocument, Transformers.js (reranker)

## Global Constraints

- 所有 API handler 第一行 `getAuthContext(c)`，不做业务逻辑，不写 try-catch
- 数据库查询必须带 `tenant_id` 过滤
- 主键使用 `uuid()`
- ESM 导入带 `.js` 扩展名
- 前端组件必须处理加载态(Skeleton)、空态(Empty)、错误态、正常态
- Manager 类模块级单例导出

---

## Phase 1: 基础数据模型与文档管理 (P0)

### Task 1.1: 定义全局 RAG 配置类型和默认值

**Files:**
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: 在 config.ts 中新增 RagConfig 类型和全局默认配置常量**

```typescript
// packages/server/src/config.ts — 在现有 rag 配置块后追加：

/** RAG 全局配置类型 */
export interface RagConfig {
  chunk: { size: number; overlap: number; strategy: 'recursive' | 'semantic' | 'heading' };
  retrieval: { top_k: number; similarity_threshold: number };
  rerank: { enabled: boolean; model: string };
  no_match: { strategy: 'free_answer' | 'fallback' | 'reject'; fallback_message: string };
  query_rewrite: { enabled: boolean };
}

/** RAG 全局默认配置（从 config.rag 读取，可通过 server.config.yaml 覆盖） */
export const DEFAULT_RAG_CONFIG: RagConfig = {
  chunk: {
    size: config.rag.chunk_size,
    overlap: config.rag.chunk_overlap,
    strategy: 'recursive',
  },
  retrieval: {
    top_k: config.rag.retrieval_top_k,
    similarity_threshold: 0.7,
  },
  rerank: {
    enabled: false,
    model: 'Xenova/bge-reranker-base',
  },
  no_match: {
    strategy: 'free_answer',
    fallback_message: '抱歉，未找到相关知识。',
  },
  query_rewrite: { enabled: false },
};
```



---

### Task 1.2: 创建 documents 表

**Files:**
- Modify: `packages/server/src/db/schema.ts`

- [ ] **Step 1: 在 schema 中添加 documents 表定义**

```typescript
// packages/server/src/db/schema.ts — 在 knowledge_bases 定义之后，chunks 注释之前插入：

/** 文档表 — 知识库中单个文件/URL/手动创建的文档记录 */
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull().references(() => organization.id),
  kb_id: text('kb_id').notNull().references(() => knowledge_bases.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  file_type: text('file_type').notNull(),         // 'txt'|'md'|'pdf'|'docx'|'csv'|'html'|'url'|'manual'
  file_size: integer('file_size').notNull().default(0),
  file_hash: text('file_hash'),                    // SHA256，用于去重
  chunk_count: integer('chunk_count').notNull().default(0),
  status: text('status').notNull().default('pending'), // pending|parsing|indexing|ready|error
  error_msg: text('error_msg'),
  tags: text('tags').notNull().default('[]'),       // JSON 数组
  source: text('source').notNull().default('upload'), // upload|url|manual
  source_url: text('source_url'),
  metadata: text('metadata').notNull().default('{}'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
}, (table) => ({
  kbIdx: index('idx_documents_kb_id').on(table.kb_id),
  tenantIdx: index('idx_documents_tenant').on(table.tenant_id),
  kbFileUnq: unique('uq_documents_kb_file').on(table.kb_id, table.file_hash),
}));
```

- [ ] **Step 2: 运行迁移**

```bash
pnpm db:migrate
```



---

### Task 1.3: 创建 DocumentManager 服务

**Files:**
- Create: `packages/server/src/services/knowledge/document-manager.ts`

**Interfaces:**
- Consumes: `getDb()` from `../../db/db.js`, `schema` from `../../db/db.js`, `v4 as uuid` from `uuid`, `eq/and/desc/count` from `drizzle-orm`
- Produces: `documentManager` singleton, methods: `listByKb`, `getById`, `create`, `updateStatus`, `remove`, `count`

- [ ] **Step 1: 创建文件**

```typescript
/**
 * DocumentManager — 文档生命周期管理。
 *
 * 负责文档记录的 CRUD、状态流转和去重检测。
 * 不负责文件解析和索引（由 RAGManager 处理）。
 */
import { eq, and, desc, count } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../db/db.js';

const { documents } = schema;

export interface DocumentRow {
  id: string;
  tenant_id: string;
  kb_id: string;
  filename: string;
  file_type: string;
  file_size: number;
  file_hash: string | null;
  chunk_count: number;
  status: string;
  error_msg: string | null;
  tags: string;
  source: string;
  source_url: string | null;
  metadata: string;
  created_at: number;
  updated_at: number;
}

class DocumentManager {
  /** 获取知识库内文档列表 */
  async listByKb(tenantId: string, kbId: string): Promise<DocumentRow[]> {
    const db = getDb();
    return db.select().from(documents)
      .where(and(eq(documents.tenant_id, tenantId), eq(documents.kb_id, kbId)))
      .orderBy(desc(documents.created_at))
      .all();
  }

  /** 获取单个文档 */
  async getById(tenantId: string, docId: string): Promise<DocumentRow | null> {
    const db = getDb();
    return db.select().from(documents)
      .where(and(eq(documents.id, docId), eq(documents.tenant_id, tenantId)))
      .get() || null;
  }

  /** 创建文档记录 */
  async create(params: {
    tenantId: string; kbId: string; filename: string; fileType: string;
    fileSize: number; fileHash?: string; source?: string; sourceUrl?: string;
  }): Promise<DocumentRow> {
    const db = getDb();
    const id = uuid();
    const now = Date.now();
    await db.insert(documents).values({
      id,
      tenant_id: params.tenantId,
      kb_id: params.kbId,
      filename: params.filename,
      file_type: params.fileType,
      file_size: params.fileSize,
      file_hash: params.fileHash ?? null,
      status: 'pending',
      source: params.source ?? 'upload',
      source_url: params.sourceUrl ?? null,
      created_at: now,
      updated_at: now,
    }).run();
    return (await this.getById(params.tenantId, id))!;
  }

  /** 按 file_hash 查找已存在文档（去重） */
  async findByHash(tenantId: string, kbId: string, hash: string): Promise<DocumentRow | null> {
    const db = getDb();
    return db.select().from(documents)
      .where(and(
        eq(documents.tenant_id, tenantId),
        eq(documents.kb_id, kbId),
        eq(documents.file_hash, hash),
      ))
      .get() || null;
  }

  /** 更新文档状态 */
  async updateStatus(id: string, status: string, errorMsg?: string): Promise<void> {
    const db = getDb();
    await db.update(documents).set({
      status,
      error_msg: errorMsg ?? null,
      updated_at: Date.now(),
    }).where(eq(documents.id, id)).run();
  }

  /** 更新文档 chunk_count */
  async updateChunkCount(id: string, delta: number): Promise<void> {
    const db = getDb();
    const doc = await db.select().from(documents).where(eq(documents.id, id)).get();
    if (!doc) return;
    await db.update(documents).set({
      chunk_count: doc.chunk_count + delta,
      updated_at: Date.now(),
    }).where(eq(documents.id, id)).run();
  }

  /** 更新文档标签或元数据 */
  async updateMeta(id: string, data: { tags?: string[]; metadata?: Record<string, unknown> }): Promise<void> {
    const db = getDb();
    const updates: Record<string, any> = { updated_at: Date.now() };
    if (data.tags) updates.tags = JSON.stringify(data.tags);
    if (data.metadata) updates.metadata = JSON.stringify(data.metadata);
    await db.update(documents).set(updates).where(eq(documents.id, id)).run();
  }

  /** 删除文档 */
  async remove(id: string): Promise<void> {
    const db = getDb();
    await db.delete(documents).where(eq(documents.id, id)).run();
  }

  /** 统计知识库内文档数 */
  async countByKb(tenantId: string, kbId: string): Promise<number> {
    const db = getDb();
    const [row] = await db.select({ c: count() }).from(documents)
      .where(and(eq(documents.tenant_id, tenantId), eq(documents.kb_id, kbId)))
      .all();
    return row?.c ?? 0;
  }
}

export const documentManager = new DocumentManager();
```



---

### Task 1.4: 更新 RAGManager 支持文档级索引

**Files:**
- Modify: `packages/server/src/memory/rag.ts`

**Interfaces:**
- Consumes: `DEFAULT_RAG_CONFIG` from `../config.js`
- Produces: Updated `indexText` that uses global config and stores `document_id` in chunk metadata; `deleteDocumentChunks` new method

- [ ] **Step 1: 修改 indexText 签名和逻辑，使用全局配置并支持 document_id**

```typescript
// 修改 indexText 方法签名，新增 documentId 参数
async indexText(
  kbId: string,
  text: string,
  metadata: Record<string, any> = {},
  documentId?: string,  // 新增
): Promise<number> {
  const vector = getVector();
  const memory = await getMemory();
  if (!memory.embedder) throw new Error('Embedder not configured');

  // 使用全局 RAG 配置
  const kbConfig = DEFAULT_RAG_CONFIG;

  const doc = MDocument.fromText(text);
  const chunks = await doc.chunk({
    strategy: kbConfig.chunk.strategy,
    maxSize: kbConfig.chunk.size,
    overlap: kbConfig.chunk.overlap,
  });

  const chunkTexts = chunks.map((c) => c.text);
  const chunkIds = chunks.map(() => uuid());

  const embedResult = await memory.embedder.doEmbed({
    values: chunkTexts,
  });

  const indexName = kbIndexName(kbId);

  try {
    await vector.createIndex({
      indexName,
      dimension: embedResult.embeddings[0].length,
      metric: 'cosine',
    });
  } catch (err: any) {
    if (!err?.message?.includes('already exists')) throw err;
  }

  // metadata 中携带 document_id，用于后续关联查询和级联删除
  const chunkMetadata = chunkTexts.map((c, i) => ({
    content: c,
    chunk_index: i,
    document_id: documentId ?? null,
    ...metadata,
  }));

  await vector.upsert({
    indexName,
    vectors: embedResult.embeddings,
    ids: chunkIds,
    metadata: chunkMetadata,
  });

  // 更新知识库计数
  await db.update(knowledge_bases)
    .set({ chunk_count: sql`${knowledge_bases.chunk_count} + ${chunkTexts.length}` })
    .where(eq(knowledge_bases.id, kbId));

  return chunkTexts.length;
}
```

- [ ] **Step 3: 新增 deleteDocumentChunks 方法**

```typescript
// 在 RAGManager 类中新增：
/** 删除指定文档的所有向量 chunks，更新计数 */
async deleteDocumentChunks(kbId: string, documentId: string): Promise<number> {
  const vector = getVector();
  const indexName = kbIndexName(kbId);

  // LibSQLVector 没有按 metadata 删除的 API，
  // 需要先查询该文档的所有 chunk ids，再批量删除。
  // 当前 LibSQLVector 不支持 list/filter，采用 query + manual filter 方式：
  // 1. 用空查询获取所有向量（传入一个不可能匹配的向量，取大量结果）
  // 2. 过滤出 document_id 匹配的 ids
  // 3. 批量删除

  // 实际上 LibSQLVector 没有 list API。此处的替代方案：
  // 从 kb 索引的 libsql 表中直接查询 metadata 过滤。
  // 简化实现：直接操作底层 libsql 表。
  const { getClient } = await import('../db/init-libsql.js');
  const client = getClient();

  // 查询 vector 表中该 document 的所有 chunk ids
  const tableName = `mastra_vector_${indexName}`;
  const { rows } = await client.execute({
    sql: `SELECT id FROM ${tableName} WHERE json_extract(metadata, '$.document_id') = ?`,
    args: [documentId],
  });

  const ids = rows.map((r: any) => r.id as string);
  if (ids.length === 0) return 0;

  await vector.deleteIndex({ indexName, ids });

  // 更新知识库计数
  const db = getDb();
  await db.update(knowledge_bases)
    .set({ chunk_count: sql`MAX(0, ${knowledge_bases.chunk_count} - ${ids.length})` })
    .where(eq(knowledge_bases.id, kbId));

  return ids.length;
}
```

- [ ] **Step 4: 更新 indexFile 传递 documentId**

```typescript
// indexFile 新增 documentId 参数
async indexFile(kbId: string, filePath: string, documentId?: string): Promise<number> {
  let text: string;
  const ext = basename(filePath).toLowerCase();

  if (ext.endsWith('.md') || ext.endsWith('.txt')) {
    text = readFileSync(filePath, 'utf-8');
  } else if (ext.endsWith('.pdf')) {
    // ... 保持不变 ...
  } else if (ext.endsWith('.csv')) {
    text = readFileSync(filePath, 'utf-8');
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  return this.indexText(kbId, text, { filename: basename(filePath), source: filePath }, documentId);
}
```



---

### Task 1.5: 更新 KnowledgeManager 集成文档管理

**Files:**
- Modify: `packages/server/src/services/knowledge/knowledge-manager.ts`

**Interfaces:**
- Consumes: `documentManager` from `./document-manager.js`, `createHash` from `node:crypto`
- Produces: Updated `uploadFile` that creates document records and detects duplicates

- [ ] **Step 1: 在 uploadFile 中集成文档创建、SHA256 去重和状态流转**

```typescript
// packages/server/src/services/knowledge/knowledge-manager.ts
// 新增 import:
import { createHash } from 'node:crypto';
import { documentManager } from './document-manager.js';

// uploadFile 方法替换为：
async uploadFile(tenantId: string, kbId: string, formData: FormData): Promise<{ chunkCount: number; documentId: string }> {
  const db = getDb();

  const kb = await db.select().from(knowledge_bases)
    .where(and(eq(knowledge_bases.id, kbId), eq(knowledge_bases.tenant_id, tenantId)))
    .get();
  if (!kb) throw new Error('Knowledge base not found');

  // 提取文件
  let file: File | null = null;
  for (const [_, value] of formData.entries()) {
    if (value instanceof File) { file = value; break; }
  }
  if (!file || !file.name) throw new Error('No file uploaded');

  // 文件大小检查
  if (file.size > config.upload.max_size_bytes) {
    const limitMB = Math.round(config.upload.max_size_bytes / 1024 / 1024);
    throw new Error(`File too large (max ${limitMB}MB)`);
  }

  const safeName = sanitizeFilename(file.name);
  if (!safeName) throw new Error('Invalid filename');

  const ext = extname(safeName).toLowerCase();
  const declaredType = file.type || EXT_TO_MIME[ext] || 'application/octet-stream';
  if (!config.upload.allowed_mime_types.includes(declaredType)) {
    throw new Error(`Unsupported file type: ${declaredType}`);
  }

  const tmpDir = '/tmp/vico-uploads';
  mkdirSync(tmpDir, { recursive: true });
  const tmpPath = `${tmpDir}/${uuid()}-${safeName}`;
  const buf = Buffer.from(await file.arrayBuffer());
  writeFileSync(tmpPath, buf);

  // Magic bytes 校验
  const expectedMagic = MAGIC_BYTES[declaredType];
  if (expectedMagic) {
    const header = buf.subarray(0, expectedMagic.length);
    if (!expectedMagic.every((b, i) => header[i] === b)) {
      try { unlinkSync(tmpPath); } catch {}
      throw new Error('File content does not match declared type');
    }
  }

  // SHA256 去重检查
  const fileHash = createHash('sha256').update(buf).digest('hex');
  const existing = await documentManager.findByHash(tenantId, kbId, fileHash);
  if (existing) {
    try { unlinkSync(tmpPath); } catch {}
    throw new Error(`Duplicate file: ${existing.filename} already indexed as document ${existing.id}`);
  }

  // 创建文档记录
  const doc = await documentManager.create({
    tenantId, kbId,
    filename: safeName,
    fileType: declaredType,
    fileSize: file.size,
    fileHash,
    source: 'upload',
  });

  try {
    await documentManager.updateStatus(doc.id, 'indexing');
    const count = await ragManager.indexFile(kbId, tmpPath, doc.id);
    unlinkSync(tmpPath);
    await documentManager.updateChunkCount(doc.id, count);
    await documentManager.updateStatus(doc.id, 'ready');
    return { chunkCount: count, documentId: doc.id };
  } catch (err) {
    try { unlinkSync(tmpPath); } catch {}
    const message = err instanceof Error ? err.message : 'Unknown error';
    await documentManager.updateStatus(doc.id, 'error', message);
    throw new Error(message);
  }
}
```

- [ ] **Step 2: create 方法保持不变**

`create` 方法无需改动 — 全局配置统一生效。



---

### Task 1.6: 新增文档和 Chunk 管理 API 路由

**Files:**
- Modify: `packages/server/src/api/knowledge.ts`

**Interfaces:**
- Consumes: `documentManager`, `ragManager`, `getVector` from `../agent/memory-setup.js`, `kbIndexName` from `../lib/resource.js`

- [ ] **Step 1: 重写 knowledge.ts 路由文件**

```typescript
// packages/server/src/api/knowledge.ts — 完整替换：
import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { knowledgeManager } from '../services/knowledge/knowledge-manager.js';
import { documentManager } from '../services/knowledge/document-manager.js';
import { ragManager } from '../memory/rag.js';
import { getVector } from '../agent/memory-setup.js';
import { kbIndexName } from '../lib/resource.js';

export function knowledgeRoutes(app: Hono<{ Variables: Variables }>) {
  // ── 知识库 CRUD ──

  app.get('/api/v1/knowledge-bases', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json(await knowledgeManager.list(auth.tenantId));
  });

  app.post('/api/v1/knowledge-bases', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const kb = await knowledgeManager.create(auth.tenantId, await c.req.json());
    return c.json({ id: kb.id, message: 'created' });
  });

  app.get('/api/v1/knowledge-bases/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const kb = await knowledgeManager.getById(auth.tenantId, c.req.param('id'));
    if (!kb) return c.json({ error: 'Not found' }, 404);
    // 同时返回文档列表
    const docs = await documentManager.listByKb(auth.tenantId, kb.id);
    return c.json({ ...kb, documents: docs });
  });

  app.delete('/api/v1/knowledge-bases/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    await knowledgeManager.remove(auth.tenantId, c.req.param('id'));
    return c.json({ message: 'deleted' });
  });

  // ── 文档管理 ──

  app.get('/api/v1/knowledge-bases/:id/documents', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json(await documentManager.listByKb(auth.tenantId, c.req.param('id')));
  });

  app.get('/api/v1/knowledge-bases/:id/documents/:docId', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const doc = await documentManager.getById(auth.tenantId, c.req.param('docId'));
    if (!doc) return c.json({ error: 'Not found' }, 404);
    return c.json(doc);
  });

  app.delete('/api/v1/knowledge-bases/:id/documents/:docId', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const kbId = c.req.param('id');
    const docId = c.req.param('docId');
    await ragManager.deleteDocumentChunks(kbId, docId);
    await documentManager.remove(docId);
    return c.json({ message: 'deleted' });
  });

  app.post('/api/v1/knowledge-bases/:id/documents/:docId/reindex', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    // 重新索引：先删后建
    const kbId = c.req.param('id');
    const docId = c.req.param('docId');
    const doc = await documentManager.getById(auth.tenantId, docId);
    if (!doc) return c.json({ error: 'Document not found' }, 404);
    // 仅支持 upload 来源的文档重新索引
    // TODO: 需要存储文件路径或重新从向量中还原文本
    return c.json({ message: 'Reindex not yet implemented for LibSQLVector-stored documents' }, 501);
  });

  app.patch('/api/v1/knowledge-bases/:id/documents/:docId', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const docId = c.req.param('docId');
    const body = await c.req.json();
    await documentManager.updateMeta(docId, body);
    return c.json({ message: 'updated' });
  });

  // ── Chunk 管理 ──

  app.get('/api/v1/knowledge-bases/:id/chunks', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const kbId = c.req.param('id');
    const docId = c.req.query('document_id');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

    // 从 LibSQLVector 底层表查询 chunks
    const { getClient } = await import('../db/init-libsql.js');
    const client = getClient();
    const tableName = `mastra_vector_${kbIndexName(kbId)}`;

    try {
      let sql = `SELECT id, metadata FROM ${tableName}`;
      const args: string[] = [];
      if (docId) {
        sql += ` WHERE json_extract(metadata, '$.document_id') = ?`;
        args.push(docId);
      }
      sql += ` LIMIT ?`;
      args.push(String(limit));

      const { rows } = await client.execute({ sql, args });
      const chunks = rows.map((r: any) => {
        let metadata: any = {};
        try { metadata = JSON.parse(r.metadata as string); } catch {}
        return {
          id: r.id,
          content: metadata.content || '',
          metadata: r.metadata,
        };
      });
      return c.json(chunks);
    } catch (err: any) {
      // 索引可能还不存在
      return c.json([]);
    }
  });

  app.delete('/api/v1/knowledge-bases/:id/chunks/:chunkId', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const vector = getVector();
    const kbId = c.req.param('id');
    const chunkId = c.req.param('chunkId');

    await vector.deleteIndexById({
      indexName: kbIndexName(kbId),
      ids: [chunkId],
    });

    // 更新计数
    const { getDb } = await import('../db/db.js');
    const { knowledge_bases } = (await import('../db/db.js')).schema;
    const db = getDb();
    await db.update(knowledge_bases)
      .set({ chunk_count: sql`MAX(0, ${knowledge_bases.chunk_count} - 1)` })
      .where(eq(knowledge_bases.id, kbId));

    return c.json({ message: 'deleted' });
  });

  // ── 文件上传 ──

  app.post('/api/v1/knowledge-bases/:id/upload', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    try {
      const result = await knowledgeManager.uploadFile(
        auth.tenantId,
        c.req.param('id'),
        await c.req.formData(),
      );
      return c.json({ message: 'indexed', chunk_count: result.chunkCount, document_id: result.documentId });
    } catch (e: any) {
      const msg = e.message;
      if (msg === 'Knowledge base not found') return c.json({ error: 'Not found' }, 404);
      if (msg.startsWith('File too large')) return c.json({ error: msg }, 413);
      if (msg.startsWith('Duplicate file')) return c.json({ error: msg }, 409);
      if (['No file uploaded', 'Invalid filename', 'Unsupported file type', 'File content does not match declared type'].some((m) => msg.includes(m))) {
        return c.json({ error: msg }, 400);
      }
      throw e;
    }
  });
}
```



---

### Task 1.7: 更新前端知识库详情页

**Files:**
- Modify: `packages/web/src/pages/KnowledgeDetail.tsx`
- Modify: `packages/web/src/i18n/locales/en/knowledge.json` (可选)
- Modify: `packages/web/src/i18n/locales/zh/knowledge.json` (可选)

- [ ] **Step 1: 更新 KnowledgeDetail 数据结构和渲染**

```typescript
// 替换 KnowledgeBaseDetail 接口：
interface DocumentItem {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  status: string;
  source: string;
  created_at: number;
}

interface ChunkItem {
  id: string;
  content: string;
  metadata: string;
}

interface KnowledgeBaseDetail {
  id: string;
  name: string;
  description: string | null;
  source: string;
  chunk_count: number;
  config: string | null;
  documents: DocumentItem[];
  chunks: ChunkItem[];  // 保留兼容，实际从 /chunks 端点获取
}
```

- [ ] **Step 2: 新增文档列表 Tab 和 chunks Tab 切换**

在详情页中新增 Tabs 组件，分为「文档列表」和「Chunks」两个 Tab：
- 文档 Tab：表格展示 `DocumentItem[]`，显示文件名、类型、大小、状态 Badge、chunk 数量、操作按钮（删除/重新索引）
- Chunks Tab：保持现有卡片列表，但改为从 `/api/v1/knowledge-bases/:id/chunks` 获取
- 新增独立的 `useQuery` 获取 chunks 列表



---

## Phase 2: 增强检索能力 (P0)

### Task 2.1: 更新 RAG Search Tool，集成查询改写和重排序

**Files:**
- Modify: `packages/server/src/agent/tools/rag-tool.ts`

- [ ] **Step 1: 重写 rag-tool.ts，保留向量搜索 + 集成 Query Rewrite 和 Rerank**

```typescript
/**
 * RAG 知识库检索工具
 * 基于向量语义搜索，可选启用查询改写 + 重排序。
 */
import { tool } from 'ai';
import { z } from 'zod';
import { getVector, getMemory } from '../memory-setup.js';
import { kbIndexName } from '../../lib/resource.js';
import { DEFAULT_RAG_CONFIG } from '../../config.js';
import type { AgentDetail } from '../../services/agent/types.js';

export async function createRagSearchTool(agent: AgentDetail): Promise<any> {
  const kbId = agent.kb_id;
  if (!kbId) return null;

  const memory = await getMemory();
  if (!memory.embedder) return null;

  const cfg = DEFAULT_RAG_CONFIG;
  const vector = getVector();
  const indexName = kbIndexName(kbId);

  return tool({
    id: 'search_knowledge_base',
    description:
      '搜索知识库获取相关文档内容。返回结果包含来源标记 [source: 文件名#chunk序号]。
使用规则：
1. 每条基于知识库的结论必须引用对应的 [source: ...] 标记
2. 如果检索无结果或结果不相关，明确告知用户"未找到相关知识"
3. 不要编造检索结果中不存在的信息',
    inputSchema: z.object({
      query: z.string().describe('搜索查询内容'),
    }),
    execute: async ({ query }) => {
      // Query Rewrite
      let queries = [query];
      if (cfg.query_rewrite.enabled) {
        try {
          const { rewriteQuery } = await import('../../memory/query-rewrite.js');
          queries = await rewriteQuery(query, /* model */);
        } catch {}
      }

      // 对每个 rewrite 执行向量搜索，合并结果
      const allResults: any[] = [];
      for (const q of queries) {
        try {
          const { embeddings } = await memory.embedder!.doEmbed({ values: [q] });
          const results = await vector.query({
            indexName, queryVector: embeddings[0],
            topK: cfg.retrieval.top_k * 3,
          });
          allResults.push(...results.filter((r: any) =>
            (r.score ?? r.similarity ?? 0) >= cfg.retrieval.similarity_threshold));
        } catch {}
      }

      if (allResults.length === 0) {
        if (cfg.no_match.strategy === 'fallback') {
          return { results: [], message: cfg.no_match.fallback_message };
        }
        if (cfg.no_match.strategy === 'reject') {
          return { results: [], message: '未找到相关知识，请根据已有信息如实告知用户。' };
        }
        return { results: [], message: '未找到相关文档片段。' };
      }

      // 去重 + 按相似度排序
      const seen = new Set<string>();
      let results = allResults
        .filter((r: any) => {
          const id = r.id || r.vectorId;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((r: any) => ({
          id: r.id || r.vectorId,
          content: r.metadata?.content || '',
          metadata: r.metadata || {},
          score: r.score ?? r.similarity ?? 0,
        }))
        .sort((a: any, b: any) => b.score - a.score);

      // Rerank
      if (cfg.rerank.enabled && results.length > 1) {
        try {
          const { rerank } = await import('../../memory/reranker.js');
          results = await rerank(query, results, cfg.rerank.model);
        } catch {}
      }

      results = results.slice(0, cfg.retrieval.top_k);

      // 格式化结果，带引用标记
      const formatted = results.map((r: any, i: number) => {
        const filename = r.metadata?.filename || 'unknown';
        const chunkIdx = r.metadata?.chunk_index ?? i;
        return `[source: ${filename}#chunk${chunkIdx}] ${r.content}`;
      });

      return { results: formatted, total: results.length, query };
    },
  });
}
```



---

### Task 2.2: Query Rewrite 查询改写

**Files:**
- Create: `packages/server/src/memory/query-rewrite.ts`

- [ ] **Step 1: 创建文件**

```typescript
/**
 * QueryRewrite — 检索前通过 LLM 改写用户问题提升召回率。
 *
 * 策略：拆分复合问题 + 补充同义词 + 纠正拼写。
 * 使用轻量模型调用，结果缓存至内存 Map（TTL 5 分钟）。
 */
import { generateText } from 'ai';
import { config } from '../config.js';
import logger from '../lib/logger.js';

interface CacheEntry {
  rewrites: string[];
  at: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

export async function rewriteQuery(
  query: string,
  modelProvider: any,
): Promise<string[]> {
  // 检查缓存
  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return cached.rewrites;
  }

  try {
    const { text } = await generateText({
      model: modelProvider,
      prompt: `你是一个搜索查询优化器。将用户的原始问题改写为多个更适合检索的查询变体。

规则：
1. 如果问题是复合问题，拆分为多个简单查询
2. 为关键概念补充同义词和不同表述
3. 保持原始查询含义不变
4. 每行一个查询，最多 3 个
5. 第一个必须是原始查询的语义等价表述

用户问题：${query}

查询变体：`,
      maxTokens: 200,
      temperature: 0.3,
    });

    const rewrites = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .slice(0, 3);

    if (rewrites.length === 0) rewrites.push(query);

    // 缓存
    cache.set(query, { rewrites, at: Date.now() });
    // 限制缓存大小
    if (cache.size > 1000) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }

    return rewrites;
  } catch (err) {
    logger.warn({ err, query }, 'Query rewrite failed, using original');
    return [query];
  }
}
```

- [ ] **Step 2: 在 rag-tool.ts 中已集成（见 Task 2.1），无需额外步骤**

Query Rewrite 作为独立模块被 rag-tool 动态导入，在 `cfg.query_rewrite.enabled` 时生效。



---

### Task 2.3: Rerank 重排序

**Files:**
- Create: `packages/server/src/memory/reranker.ts`

- [ ] **Step 1: 创建文件**

```typescript
/**
 * Reranker — 使用 Cross-Encoder 对检索结果二次打分重排序。
 *
 * 基于 Transformers.js，懒加载模型。
 */
import logger from '../lib/logger.js';

export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, any>;
  score: number;
}

let _reranker: any = null;
let _rerankerModelName: string | null = null;

async function getReranker(modelName: string) {
  if (_reranker && _rerankerModelName === modelName) return _reranker;

  const { pipeline } = await import('@xenova/transformers');
  _reranker = await pipeline('text-classification', modelName);
  _rerankerModelName = modelName;
  logger.info({ modelName }, 'Reranker loaded');
  return _reranker;
}

export async function rerank(
  query: string,
  results: SearchResult[],
  modelName: string = 'Xenova/bge-reranker-base',
): Promise<SearchResult[]> {
  if (results.length <= 1) return results;

  try {
    const reranker = await getReranker(modelName);
    const pairs = results.map((r) => ({
      text: query,
      text_pair: r.content.substring(0, 512), // 截断避免超长
    }));

    const scores = await reranker(pairs, { topk: 1 });

    // 将重排分数赋给结果
    const reranked = results.map((r, i) => ({
      ...r,
      score: scores[i]?.score ?? r.score,
      _rerankScore: scores[i]?.score,
    }));

    return reranked.sort((a, b) => b.score - a.score);
  } catch (err) {
    logger.warn({ err, modelName }, 'Rerank failed, returning original order');
    return results;
  }
}
```

- [ ] **Step 2: 在 rag-tool.ts 中已集成（见 Task 2.1），无需额外步骤**

Reranker 作为独立模块被 rag-tool 动态导入，在 `cfg.rerank.enabled` 时生效。



---

## Phase 3: 回答质量与溯源 (P1)

### Task 3.1: 上下文压缩模块

**Files:**
- Create: `packages/server/src/memory/context-compression.ts`

**Interfaces:**
- Consumes: LLM model provider
- Produces: `compressChunks` function

- [ ] **Step 1: 创建文件**

```typescript
/**
 * ContextCompression — 当检索结果过长时，通过 LLM 摘要压缩控制 Token 成本。
 */
import { generateText } from 'ai';
import type { SearchResult } from './reranker.js';
import logger from '../lib/logger.js';

const MAX_CONTEXT_CHARS = 6000; // ~1.5K tokens

export async function compressChunks(
  results: SearchResult[],
  query: string,
  modelProvider: any,
): Promise<string> {
  const fullText = results
    .map((r) => {
      const src = r.metadata?.filename || 'unknown';
      return `[${src}] ${r.content}`;
    })
    .join('\n\n');

  if (fullText.length <= MAX_CONTEXT_CHARS) return fullText;

  try {
    const { text } = await generateText({
      model: modelProvider,
      prompt: `你是一个文档摘要助手。以下是与用户查询相关的多个文档片段。
请保留所有关键事实、数据、名称和时间，用简练的语言合并重复内容。

用户查询：${query}

文档片段：
${fullText}

摘要：`,
      maxTokens: 2000,
      temperature: 0.1,
    });
    return text;
  } catch (err) {
    logger.warn({ err }, 'Context compression failed, returning truncated');
    return fullText.substring(0, MAX_CONTEXT_CHARS) + '\n\n[内容已截断...]';
  }
}
```

- [ ] **Step 2: 在 rag-tool.ts 中集成压缩**

```typescript
// rag-tool.ts execute 函数中，在格式化结果之前：
const totalLen = results.reduce((acc, r) => acc + r.content.length, 0);
if (totalLen > 6000) {
  const { compressChunks } = await import('../../memory/context-compression.js');
  const compressed = await compressChunks(results, query, /* model */);
  return { results: [compressed], total: results.length, query, compressed: true };
}
```



---

### Task 3.2: 前端引用标记渲染

**Files:**
- Find chat message rendering component in `packages/web/src/components/assistant-ui/`
- Modify the markdown/message rendering to parse `[source: ...]` patterns

- [ ] **Step 1: 在对话消息渲染中解析引用标记**

在消息渲染组件中，正则匹配 `[source: filename#chunkN]`，替换为可点击的 Badge/Link 组件，点击时发送请求获取原文内容并在 Popover 中展示。



---

## Phase 4: 文件解析增强 (P1)

### Task 4.1: 可扩展解析器注册表

**Files:**
- Create: `packages/server/src/memory/parsers/registry.ts`
- Create: `packages/server/src/memory/parsers/txt-parser.ts`
- Create: `packages/server/src/memory/parsers/pdf-parser.ts`
- Create: `packages/server/src/memory/parsers/md-parser.ts`
- Create: `packages/server/src/memory/parsers/csv-parser.ts`
- Create: `packages/server/src/memory/parsers/html-parser.ts`
- Create: `packages/server/src/memory/parsers/docx-parser.ts`
- Modify: `packages/server/src/memory/rag.ts` (indexFile 使用 ParserRegistry)

- [ ] **Step 1: 创建 Parser 接口和注册表**

```typescript
// packages/server/src/memory/parsers/registry.ts
export interface ParserResult {
  text: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface DocumentParser {
  name: string;
  supportedTypes: string[];       // ['text/plain', '.txt']
  parse(filePath: string, options?: any): Promise<ParserResult>;
}

class ParserRegistry {
  private parsers: DocumentParser[] = [];

  register(parser: DocumentParser): void {
    this.parsers.push(parser);
  }

  findParser(filePath: string, mimeType?: string): DocumentParser | null {
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    return this.parsers.find((p) =>
      p.supportedTypes.some((t) => t === mimeType || t === ext),
    ) ?? null;
  }

  getAll(): DocumentParser[] {
    return this.parsers;
  }
}

export const parserRegistry = new ParserRegistry();
```

- [ ] **Step 2: 创建各格式解析器**

```typescript
// packages/server/src/memory/parsers/txt-parser.ts
import { readFileSync } from 'node:fs';
import { parserRegistry } from './registry.js';

parserRegistry.register({
  name: 'txt',
  supportedTypes: ['text/plain', '.txt', '.py', '.js', '.json', '.xml'],
  parse: async (filePath) => ({
    text: readFileSync(filePath, 'utf-8'),
  }),
});
```

```typescript
// packages/server/src/memory/parsers/html-parser.ts
import { readFileSync } from 'node:fs';
import { parserRegistry } from './registry.js';

parserRegistry.register({
  name: 'html',
  supportedTypes: ['text/html', '.html', '.htm'],
  parse: async (filePath) => {
    // 使用简单的正则去除 HTML 标签，生产环境建议用 cheerio
    const html = readFileSync(filePath, 'utf-8');
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s{2,}/g, '\n')
      .trim();
    return { text };
  },
});
```

```typescript
// packages/server/src/memory/parsers/docx-parser.ts
import { readFileSync } from 'node:fs';
import { parserRegistry } from './registry.js';

parserRegistry.register({
  name: 'docx',
  supportedTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  parse: async (filePath) => {
    try {
      const mammoth = await import('mammoth');
      const buf = readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer: buf });
      return { text: result.value };
    } catch (err: any) {
      throw new Error(`DOCX parsing failed: ${err.message}. Install mammoth: npm install mammoth`);
    }
  },
});
```

- [ ] **Step 3: 更新 RAGManager.indexFile 使用 ParserRegistry**

```typescript
// packages/server/src/memory/rag.ts — indexFile 修改为：
async indexFile(kbId: string, filePath: string, documentId?: string): Promise<number> {
  // 导入 parser registry（ensure side-effect imports）
  await import('./parsers/registry.js');
  await import('./parsers/txt-parser.js');
  await import('./parsers/pdf-parser.js');
  await import('./parsers/md-parser.js');
  await import('./parsers/csv-parser.js');
  await import('./parsers/html-parser.js');
  await import('./parsers/docx-parser.js');

  const { parserRegistry } = await import('./parsers/registry.js');
  const parser = parserRegistry.findParser(filePath);
  if (!parser) throw new Error(`Unsupported file type: ${filePath}`);

  const result = await parser.parse(filePath);
  return this.indexText(kbId, result.text, {
    filename: basename(filePath),
    source: filePath,
    ...result.metadata,
  }, documentId);
}
```



---

### Task 4.2: URL 导入功能

**Files:**
- Modify: `packages/server/src/api/knowledge.ts` (新增路由)
- Modify: `packages/server/src/services/knowledge/knowledge-manager.ts` (新增方法)

- [ ] **Step 1: 在 KnowledgeManager 中新增 importUrl 方法**

```typescript
// knowledge-manager.ts 新增方法：
async importUrl(tenantId: string, kbId: string, url: string): Promise<{ chunkCount: number; documentId: string }> {
  const db = getDb();
  const kb = await db.select().from(knowledge_bases)
    .where(and(eq(knowledge_bases.id, kbId), eq(knowledge_bases.tenant_id, tenantId)))
    .get();
  if (!kb) throw new Error('Knowledge base not found');

  // 抓取网页
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch URL: ${response.status}`);
  const html = await response.text();

  // HTML → text
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, '\n')
    .trim();

  // 生成文件名
  const urlObj = new URL(url);
  const filename = `${urlObj.hostname}${urlObj.pathname.replace(/\//g, '_')}`.slice(0, 200) + '.html';

  // 创建文档记录
  const doc = await documentManager.create({
    tenantId, kbId, filename,
    fileType: 'text/html',
    fileSize: html.length,
    source: 'url',
    sourceUrl: url,
  });

  try {
    await documentManager.updateStatus(doc.id, 'indexing');
    const count = await ragManager.indexText(kbId, text, { filename, source: url }, doc.id);
    await documentManager.updateChunkCount(doc.id, count);
    await documentManager.updateStatus(doc.id, 'ready');
    return { chunkCount: count, documentId: doc.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await documentManager.updateStatus(doc.id, 'error', message);
    throw err;
  }
}
```

- [ ] **Step 2: 新增 import-url 路由**

```typescript
// knowledge.ts 新增路由：
app.post('/api/v1/knowledge-bases/:id/import-url', async (c) => {
  const auth = await getAuthContext(c);
  if (auth instanceof Response) return auth;
  const { url } = await c.req.json();
  if (!url) return c.json({ error: 'url is required' }, 400);
  try {
    const result = await knowledgeManager.importUrl(auth.tenantId, c.req.param('id'), url);
    return c.json({ message: 'imported', ...result });
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});
```



---

### Task 4.3: 在线 Markdown 编辑器（前端）

**Files:**
- Create: `packages/web/src/pages/knowledge/ManualEditor.tsx` 或在 KnowledgeDetail 中新增「新建文档」按钮
- Modify: `packages/web/src/pages/KnowledgeDetail.tsx`
- Modify: `packages/server/src/api/knowledge.ts` (新增手动文档创建路由)

- [ ] **Step 1: 后端新增手动文档创建路由**

```typescript
// knowledge.ts 新增：
app.post('/api/v1/knowledge-bases/:id/documents', async (c) => {
  const auth = await getAuthContext(c);
  if (auth instanceof Response) return auth;
  const { content, filename } = await c.req.json();
  if (!content || !filename) return c.json({ error: 'content and filename required' }, 400);

  const doc = await documentManager.create({
    tenantId: auth.tenantId,
    kbId: c.req.param('id'),
    filename: `${filename}.md`,
    fileType: 'text/markdown',
    fileSize: Buffer.byteLength(content, 'utf-8'),
    source: 'manual',
  });

  try {
    await documentManager.updateStatus(doc.id, 'indexing');
    const count = await ragManager.indexText(c.req.param('id'), content, { filename: `${filename}.md`, source: 'manual' }, doc.id);
    await documentManager.updateChunkCount(doc.id, count);
    await documentManager.updateStatus(doc.id, 'ready');
    return c.json({ id: doc.id, chunk_count: count });
  } catch (err: any) {
    await documentManager.updateStatus(doc.id, 'error', err.message);
    throw err;
  }
});
```

- [ ] **Step 2: 前端新建文档 Dialog**

在 KnowledgeDetail 页面「文档列表」Tab 顶部新增「新建文档」按钮：
- 弹出 Dialog，包含 filename 输入框和 Markdown 编辑器（Textarea，支持基本 Markdown 语法）
- 可选「AI 生成摘要」按钮（调用 LLM 生成 content 摘要作为文档描述）
- 保存时调用 `POST /api/v1/knowledge-bases/:id/documents`
- 保存成功后自动刷新文档列表



---

## 总结

| Task | 范围 | 预计时间 |
|------|------|---------|
| 1.1 RagConfig 类型 + 全局默认值 | Config | 20 分钟 |
| 1.2 documents 表 | Schema | 20 分钟 |
| 1.3 DocumentManager 服务 | 新建 Service | 45 分钟 |
| 1.4 RAGManager 文档级索引 | 修改 Core | 1 小时 |
| 1.5 KnowledgeManager 集成 | 修改 Service | 45 分钟 |
| 1.6 文档 + Chunk API | 修改 API | 1 小时 |
| 1.7 前端详情页 | 修改前端 | 1.5 小时 |
| 2.1 RAG Tool 更新 | 修改 Tool | 1 小时 |
| 2.2 Query Rewrite | 新建 Module | 45 分钟 |
| 2.3 Reranker | 新建 Module | 1 小时 |
| 3.1 上下文压缩 | 新建 Module | 45 分钟 |
| 3.2 前端引用渲染 | 修改前端 | 1 小时 |
| 4.1 解析器注册表 | 新建 Module | 1.5 小时 |
| 4.2 URL 导入 | 修改 API+Service | 45 分钟 |
| 4.3 在线 Markdown 编辑器 | 新增前端+后端 | 1.5 小时 |

**总计：约 14 小时（2 个工作日）**
