/**
 * DocumentManager — 文档生命周期管理。
 *
 * 负责文档记录的 CRUD、状态流转和去重检测。
 * 不负责文件解析和索引（由 RAGManager 处理）。
 */
import { eq, and, desc, count, isNull } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { getDb, schema } from '../../db/db.js';

const { documents } = schema;

export interface DocumentRow {
  id: string;
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
  parent_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface DocumentListOptions {
  page?: number;
  pageSize?: number;
  /** 过滤 parent_id，null 表示根目录，undefined 表示不过滤 */
  parentId?: string | null;
}

export interface PaginatedDocuments {
  data: DocumentRow[];
  total: number;
  page: number;
  page_size: number;
}

class DocumentManager {
  /** 获取知识库内文档列表（分页 + 可选父级目录过滤） */
  async listByKb(kbId: string, opts?: DocumentListOptions): Promise<PaginatedDocuments> {
    const db = getDb();
    const page = Math.max(1, opts?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const conditions = [eq(documents.kb_id, kbId)];
    if (opts?.parentId !== undefined) {
      if (opts.parentId === null) {
        conditions.push(isNull(documents.parent_id));
      } else {
        conditions.push(eq(documents.parent_id, opts.parentId));
      }
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

  /** 获取指定目录下的子目录列表 */
  async listFolders(kbId: string, parentId?: string | null): Promise<DocumentRow[]> {
    const db = getDb();
    const conditions = [
      eq(documents.kb_id, kbId),
      eq(documents.file_type, 'application/x-directory'),
    ];
    if (parentId === undefined || parentId === null) {
      conditions.push(isNull(documents.parent_id));
    } else {
      conditions.push(eq(documents.parent_id, parentId));
    }
    return db.select().from(documents).where(and(...conditions)).orderBy(documents.filename).all();
  }

  /** 获取文件夹的祖先链（从根到当前） */
  async getAncestors(folderId: string): Promise<DocumentRow[]> {
    const db = getDb();
    const ancestors: DocumentRow[] = [];
    let currentId: string | null = folderId;
    // 最多查询 20 层防止死循环
    for (let i = 0; i < 20 && currentId; i++) {
      const row = await db.select().from(documents)
        .where(and(
          eq(documents.id, currentId),
          eq(documents.file_type, 'application/x-directory'),
        ))
        .get();
      if (!row) break;
      ancestors.unshift(row);
      currentId = row.parent_id;
    }
    return ancestors;
  }

  /** 获取单个文档 */
  async getById(docId: string): Promise<DocumentRow | null> {
    const db = getDb();
    const row = await db.select().from(documents)
      .where(eq(documents.id, docId))
      .get();
    return row ?? null;
  }

  /** 创建文档记录 */
  async create(params: {
    kbId: string; filename: string; fileType: string;
    fileSize: number; fileHash?: string; source?: string; sourceUrl?: string;
    path?: string; storageKey?: string; parentId?: string | null;
  }): Promise<DocumentRow> {
    const db = getDb();
    const id = uuid();
    const now = Date.now();

    // 计算相对知识库根目录的路径
    const isDir = params.fileType === 'application/x-directory';
    let computedPath: string;
    if (params.path !== undefined) {
      computedPath = params.path; // 调用方显式指定路径时优先使用
    } else if (params.parentId) {
      const parent = await this.getById(params.parentId);
      const parentPath = parent?.path || '';
      computedPath = isDir
        ? `${parentPath}${params.filename}/`
        : `${parentPath}${params.filename}`;
    } else {
      computedPath = isDir ? `/${params.filename}/` : `/${params.filename}`;
    }

    await db.insert(documents).values({
      id,
      kb_id: params.kbId,
      filename: params.filename,
      file_type: params.fileType,
      file_size: params.fileSize,
      file_hash: params.fileHash ?? null,
      status: 'pending',
      source: params.source ?? 'upload',
      source_url: params.sourceUrl ?? null,
      path: computedPath,
      storage_key: params.storageKey ?? null,
      parent_id: params.parentId ?? null,
      created_at: now,
      updated_at: now,
    }).run();
    return (await this.getById(id))!;
  }

  /** 按 file_hash 查找已存在文档（去重） */
  async findByHash(kbId: string, hash: string): Promise<DocumentRow | null> {
    const db = getDb();
    const row = await db.select().from(documents)
      .where(and(
        eq(documents.kb_id, kbId),
        eq(documents.file_hash, hash),
      ))
      .get();
    return row ?? null;
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
    const doc = await db.select().from(documents)
      .where(eq(documents.id, id))
      .get();
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
    await db.update(documents).set(updates)
      .where(eq(documents.id, id)).run();
  }

  /** 更新文档 storage_key */
  async updateStorageKey(id: string, storageKey: string): Promise<void> {
    const db = getDb();
    await db.update(documents).set({
      storage_key: storageKey,
      updated_at: Date.now(),
    }).where(eq(documents.id, id)).run();
  }

  /** 删除文档 */
  async remove(id: string): Promise<void> {
    const db = getDb();
    await db.delete(documents)
      .where(eq(documents.id, id))
      .run();
  }

  /** 统计知识库内文档数 */
  async countByKb(kbId: string): Promise<number> {
    const db = getDb();
    const [row] = await db.select({ c: count() }).from(documents)
      .where(eq(documents.kb_id, kbId))
      .all();
    return row?.c ?? 0;
  }
}

export const documentManager = new DocumentManager();
