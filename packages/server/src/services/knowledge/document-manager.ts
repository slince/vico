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
  path: string;
  storage_key: string | null;
  created_at: number;
  updated_at: number;
}

export interface DocumentListOptions {
  page?: number;
  pageSize?: number;
  path?: string;
}

export interface PaginatedDocuments {
  data: DocumentRow[];
  total: number;
  page: number;
  page_size: number;
}

class DocumentManager {
  /** 获取知识库内文档列表（分页 + 可选路径过滤） */
  async listByKb(tenantId: string, kbId: string, opts?: DocumentListOptions): Promise<PaginatedDocuments> {
    const db = getDb();
    const page = Math.max(1, opts?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions = [eq(documents.tenant_id, tenantId), eq(documents.kb_id, kbId)];
    if (opts?.path !== undefined) {
      conditions.push(eq(documents.path, opts.path));
    }

    const whereClause = and(...conditions);

    const [totalResult] = await db.select({ c: count() }).from(documents).where(whereClause).all();
    const total = totalResult?.c ?? 0;

    const rows = await db.select().from(documents)
      .where(whereClause)
      .orderBy(desc(documents.created_at))
      .limit(pageSize)
      .offset(offset)
      .all();

    return { data: rows, total, page, page_size: rows.length };
  }

  /** 获取知识库内所有文档的目录路径列表（虚拟文件夹） */
  async listPaths(tenantId: string, kbId: string): Promise<string[]> {
    const db = getDb();
    const rows = await db.selectDistinct({ path: documents.path }).from(documents)
      .where(and(eq(documents.tenant_id, tenantId), eq(documents.kb_id, kbId)))
      .all();
    return rows.map(r => r.path).filter(Boolean);
  }

  /** 获取单个文档 */
  async getById(tenantId: string, docId: string): Promise<DocumentRow | null> {
    const db = getDb();
    const row = await db.select().from(documents)
      .where(and(eq(documents.id, docId), eq(documents.tenant_id, tenantId)))
      .get();
    return row ?? null;
  }

  /** 创建文档记录 */
  async create(params: {
    tenantId: string; kbId: string; filename: string; fileType: string;
    fileSize: number; fileHash?: string; source?: string; sourceUrl?: string;
    path?: string; storageKey?: string;
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
      path: params.path ?? '',
      storage_key: params.storageKey ?? null,
      created_at: now,
      updated_at: now,
    }).run();
    return (await this.getById(params.tenantId, id))!;
  }

  /** 按 file_hash 查找已存在文档（去重） */
  async findByHash(tenantId: string, kbId: string, hash: string): Promise<DocumentRow | null> {
    const db = getDb();
    const row = await db.select().from(documents)
      .where(and(
        eq(documents.tenant_id, tenantId),
        eq(documents.kb_id, kbId),
        eq(documents.file_hash, hash),
      ))
      .get();
    return row ?? null;
  }

  /** 更新文档状态 */
  async updateStatus(tenantId: string, id: string, status: string, errorMsg?: string): Promise<void> {
    const db = getDb();
    await db.update(documents).set({
      status,
      error_msg: errorMsg ?? null,
      updated_at: Date.now(),
    }).where(and(eq(documents.id, id), eq(documents.tenant_id, tenantId))).run();
  }

  /** 更新文档 chunk_count */
  async updateChunkCount(tenantId: string, id: string, delta: number): Promise<void> {
    const db = getDb();
    const doc = await db.select().from(documents)
      .where(and(eq(documents.id, id), eq(documents.tenant_id, tenantId)))
      .get();
    if (!doc) return;
    await db.update(documents).set({
      chunk_count: doc.chunk_count + delta,
      updated_at: Date.now(),
    }).where(and(eq(documents.id, id), eq(documents.tenant_id, tenantId))).run();
  }

  /** 更新文档标签或元数据 */
  async updateMeta(tenantId: string, id: string, data: { tags?: string[]; metadata?: Record<string, unknown> }): Promise<void> {
    const db = getDb();
    const updates: Record<string, any> = { updated_at: Date.now() };
    if (data.tags) updates.tags = JSON.stringify(data.tags);
    if (data.metadata) updates.metadata = JSON.stringify(data.metadata);
    await db.update(documents).set(updates)
      .where(and(eq(documents.id, id), eq(documents.tenant_id, tenantId))).run();
  }

  /** 更新文档 storage_key */
  async updateStorageKey(tenantId: string, id: string, storageKey: string): Promise<void> {
    const db = getDb();
    await db.update(documents).set({
      storage_key: storageKey,
      updated_at: Date.now(),
    }).where(and(eq(documents.id, id), eq(documents.tenant_id, tenantId))).run();
  }

  /** 删除文档 */
  async remove(tenantId: string, id: string): Promise<void> {
    const db = getDb();
    await db.delete(documents)
      .where(and(eq(documents.id, id), eq(documents.tenant_id, tenantId)))
      .run();
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
