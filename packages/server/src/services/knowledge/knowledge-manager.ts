import { eq, and, desc, count } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { extname } from 'node:path';
import { getDb, schema } from '../../db/db.js';
import { ragManager } from '../../memory/rag.js';
import { config } from '../../config.js';
import {
  createKbSchema,
  type CreateKbInput,
  type KnowledgeBaseRow,
} from './types.js';

/** 文件名消毒 — 移除路径分隔符、null 字节等危险字符 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:\0\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 255);
}

/** 通过 magic bytes 检测文件类型 */
const MAGIC_BYTES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
};

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.py': 'text/x-python',
  '.js': 'text/javascript',
  '.json': 'application/json',
};

const { knowledge_bases, agent_knowledge_bases } = schema;

/**
 * 知识库业务管理器。
 * 封装知识库 CRUD 和文件上传索引逻辑。
 */
class KnowledgeManager {
  /** 获取租户下知识库总数 */
  async count(tenantId: string): Promise<number> {
    const db = getDb();
    const [row] = await db.select({ c: count() }).from(knowledge_bases)
      .where(eq(knowledge_bases.tenant_id, tenantId))
      .all();
    return row?.c ?? 0;
  }

  /** 获取租户下所有知识库 */
  async list(tenantId: string): Promise<KnowledgeBaseRow[]> {
    const db = getDb();
    return db.select().from(knowledge_bases)
      .where(eq(knowledge_bases.tenant_id, tenantId))
      .orderBy(desc(knowledge_bases.created_at))
      .all();
  }

  /** 获取单个知识库 */
  async getById(tenantId: string, id: string): Promise<KnowledgeBaseRow | null> {
    const db = getDb();
    const kb = await db.select().from(knowledge_bases)
      .where(and(eq(knowledge_bases.id, id), eq(knowledge_bases.tenant_id, tenantId)))
      .get();
    return kb || null;
  }

  /** 创建知识库 */
  async create(tenantId: string, input: unknown): Promise<KnowledgeBaseRow> {
    const data = createKbSchema.parse(input) as CreateKbInput;
    const db = getDb();
    const id = uuid();
    await db.insert(knowledge_bases).values({
      id,
      tenant_id: tenantId,
      name: data.name,
      description: data.description,
      source: 'upload',
      chunk_count: 0,
      created_at: Date.now(),
    }).run();
    return (await this.getById(tenantId, id))!;
  }

  /** 删除知识库，级联解除 Agent 绑定 */
  async remove(tenantId: string, id: string): Promise<void> {
    const db = getDb();
    await db.delete(agent_knowledge_bases).where(eq(agent_knowledge_bases.kb_id, id)).run();
    await db.delete(knowledge_bases)
      .where(and(eq(knowledge_bases.id, id), eq(knowledge_bases.tenant_id, tenantId)))
      .run();
  }

  /**
   * 上传文件到知识库并触发索引。
   * 包含文件大小校验、MIME 白名单、magic bytes 校验。
   */
  async uploadFile(tenantId: string, kbId: string, formData: FormData): Promise<{ chunkCount: number }> {
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

    // 文件名消毒
    const safeName = sanitizeFilename(file.name);
    if (!safeName) throw new Error('Invalid filename');

    // MIME type 白名单
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

    try {
      const count = await ragManager.indexFile(kbId, tmpPath);
      unlinkSync(tmpPath);
      return { chunkCount: count };
    } catch (err) {
      try { unlinkSync(tmpPath); } catch {}
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw new Error(message);
    }
  }
}

/** 知识库业务管理器单例 */
export const knowledgeManager = new KnowledgeManager();
