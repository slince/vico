import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getDb, schema } from '../db/db.js';
import { ragManager } from '../memory/rag.js';
import { config } from '../config.js';

/** 文件名消毒 — 移除路径分隔符、null 字节等危险字符，仅保留安全的文件名字符 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:\0\x00-\x1f]/g, '_')  // 路径分隔符、控制字符
    .replace(/^\.+/, '')                    // 去除开头的点（隐藏文件）
    .slice(0, 255);                         // 限制长度
}

/** 通过 magic bytes 检测文件是否为允许的类型 */
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

const { knowledge_bases } = schema;

export function knowledgeRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/knowledge-bases', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const db = getDb();
    return c.json(await db.select().from(knowledge_bases)
      .where(eq(knowledge_bases.tenant_id, auth.tenantId))
      .orderBy(desc(knowledge_bases.created_at))
      .all());
  });

  app.post('/api/v1/knowledge-bases', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const { name, description } = await c.req.json();
    const db = getDb();
    const id = uuid();
    await db.insert(knowledge_bases).values({
      id, tenant_id: auth.tenantId, name, description: description || '',
      source: 'upload', chunk_count: 0, created_at: Date.now(),
    }).run();
    return c.json({ id, message: 'created' });
  });

  app.get('/api/v1/knowledge-bases/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();
    const kb = await db.select().from(knowledge_bases)
      .where(and(eq(knowledge_bases.id, id), eq(knowledge_bases.tenant_id, auth.tenantId)))
      .get();
    if (!kb) return c.json({ error: 'Not found' }, 404);

    // TODO: chunks table removed — data is now in LibSQLVector.
    // The chunks for a knowledge base can be queried via ragManager if needed.
    return c.json({ ...kb, chunks: [] });
  });

  app.delete('/api/v1/knowledge-bases/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();
    await db.delete(schema.agent_knowledge_bases).where(eq(schema.agent_knowledge_bases.kb_id, id)).run();
    await db.delete(knowledge_bases).where(and(eq(knowledge_bases.id, id), eq(knowledge_bases.tenant_id, auth.tenantId))).run();
    return c.json({ message: 'deleted' });
  });

  app.post('/api/v1/knowledge-bases/:id/upload', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const db = getDb();

    const kb = await db.select().from(knowledge_bases)
      .where(and(eq(knowledge_bases.id, id), eq(knowledge_bases.tenant_id, auth.tenantId)))
      .get();
    if (!kb) return c.json({ error: 'Not found' }, 404);

    // Handle multipart file upload via formData
    const formData = await c.req.formData();
    let file: File | null = null;
    for (const [_, value] of formData.entries()) {
      if (value instanceof File) { file = value; break; }
    }
    if (!file || !file.name) return c.json({ error: 'No file uploaded' }, 400);

    // 文件大小检查
    if (file.size > config.upload.max_size_bytes) {
      const limitMB = Math.round(config.upload.max_size_bytes / 1024 / 1024);
      return c.json({ error: `File too large (max ${limitMB}MB)` }, 413);
    }

    // 文件名消毒
    const safeName = sanitizeFilename(file.name);
    if (!safeName) return c.json({ error: 'Invalid filename' }, 400);

    // MIME type 白名单
    const ext = extname(safeName).toLowerCase();
    const declaredType = file.type || EXT_TO_MIME[ext] || 'application/octet-stream';
    if (!config.upload.allowed_mime_types.includes(declaredType)) {
      return c.json({ error: `Unsupported file type: ${declaredType}` }, 400);
    }

    const tmpDir = '/tmp/vico-uploads';
    mkdirSync(tmpDir, { recursive: true });
    const tmpPath = `${tmpDir}/${uuid()}-${safeName}`;
    const buf = Buffer.from(await file.arrayBuffer());
    writeFileSync(tmpPath, buf);

    // Magic bytes 校验：对已知类型验证文件头
    const expectedMagic = MAGIC_BYTES[declaredType];
    if (expectedMagic) {
      const header = buf.subarray(0, expectedMagic.length);
      if (!expectedMagic.every((b, i) => header[i] === b)) {
        try { unlinkSync(tmpPath); } catch {}
        return c.json({ error: 'File content does not match declared type' }, 400);
      }
    }

    try {
      const count = await ragManager.indexFile(id, tmpPath);
      unlinkSync(tmpPath);
      return c.json({ message: 'indexed', chunk_count: count });
    } catch (err) {
      try { unlinkSync(tmpPath); } catch {}
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ error: message }, 400);
    }
  });

  // TODO: chunks table removed — chunk deletion via LibSQLVector not yet implemented.
  // This endpoint is kept but returns 501 until LibSQLVector CRUD is added.
  app.delete('/api/v1/knowledge-bases/:id/chunks/:chunkId', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const chunkId = c.req.param('chunkId');
    const db = getDb();

    const kb = await db.select().from(knowledge_bases)
      .where(and(eq(knowledge_bases.id, id), eq(knowledge_bases.tenant_id, auth.tenantId)))
      .get();
    if (!kb) return c.json({ error: 'Not found' }, 404);

    // Chunks are now stored in LibSQLVector; delete not yet implemented
    return c.json({ message: 'Chunk deletion via LibSQLVector not yet implemented.' }, 501);
  });
}
