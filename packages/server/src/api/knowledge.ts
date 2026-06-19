import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { knowledgeManager } from '../services/knowledge/knowledge-manager.js';
import { documentManager } from '../services/knowledge/document-manager.js';
import { storageManager } from '../services/knowledge/storage-manager.js';
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
    return c.json(kb);
  });

  app.delete('/api/v1/knowledge-bases/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    await knowledgeManager.remove(auth.tenantId, c.req.param('id'));
    return c.json({ message: 'deleted' });
  });

  // ── 文档管理 ──

  // ── 虚拟文件夹 ──

  app.get('/api/v1/knowledge-bases/:id/folders', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const paths = await documentManager.listPaths(auth.tenantId, c.req.param('id'));
    // 从存储的路径派生所有父级目录
    const folderSet = new Set<string>();
    folderSet.add('/');
    for (const p of paths) {
      const parts = p.replace(/^\//, '').replace(/\/$/, '').split('/');
      let accumulated = '';
      for (const part of parts) {
        if (!part) continue;
        accumulated += '/' + part;
        folderSet.add(accumulated + '/');
      }
    }
    return c.json({ folders: Array.from(folderSet).sort() });
  });

  app.get('/api/v1/knowledge-bases/:id/documents', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const page = parseInt(c.req.query('page') || '1');
    const pageSize = parseInt(c.req.query('page_size') || '20');
    const path = c.req.query('path') || undefined;
    return c.json(await documentManager.listByKb(auth.tenantId, c.req.param('id'), {
      page, pageSize, path,
    }));
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

    // 清理存储文件
    const doc = await documentManager.getById(auth.tenantId, docId);
    if (doc?.storage_key) {
      try { await storageManager.delete(doc.storage_key); } catch {}
    }

    await ragManager.deleteDocumentChunks(kbId, docId);
    await documentManager.remove(auth.tenantId, docId);
    return c.json({ message: 'deleted' });
  });

  app.post('/api/v1/knowledge-bases/:id/documents/:docId/reindex', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json({ message: 'Reindex not yet implemented for LibSQLVector-stored documents' }, 501);
  });

  app.patch('/api/v1/knowledge-bases/:id/documents/:docId', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const docId = c.req.param('docId');
    const body = await c.req.json();
    await documentManager.updateMeta(auth.tenantId, docId, body);
    return c.json({ message: 'updated' });
  });

  // ── 文件下载 ──

  app.get('/api/v1/knowledge-bases/:id/documents/:docId/download', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const doc = await documentManager.getById(auth.tenantId, c.req.param('docId'));
    if (!doc) return c.json({ error: 'Not found' }, 404);
    if (!doc.storage_key) return c.json({ error: 'File not persisted' }, 404);

    const stream = await storageManager.getStream(doc.storage_key);
    return new Response(stream, {
      headers: {
        'Content-Type': doc.file_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.filename)}"`,
      },
    });
  });

  // ── Chunk 管理 ──

  app.get('/api/v1/knowledge-bases/:id/chunks', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const kbId = c.req.param('id');
    const docId = c.req.query('document_id');
    const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

    const { getClient } = await import('../db/init-libsql.js');
    const client = getClient();
    const tableName = kbIndexName(kbId);

    try {
      let sql = `SELECT vector_id, metadata FROM ${tableName}`;
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
          id: r.vector_id,
          content: metadata.content || '',
          metadata: r.metadata,
        };
      });
      return c.json(chunks);
    } catch {
      return c.json([]);
    }
  });

  app.delete('/api/v1/knowledge-bases/:id/chunks/:chunkId', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const vector = getVector();
    const kbId = c.req.param('id');
    const chunkId = c.req.param('chunkId');

    await vector.deleteVectors({
      indexName: kbIndexName(kbId),
      ids: [chunkId],
    });

    const { getDb } = await import('../db/db.js');
    const { knowledge_bases } = (await import('../db/db.js')).schema;
    const db = getDb();
    const { eq, sql } = await import('drizzle-orm');
    await db.update(knowledge_bases)
      .set({ chunk_count: sql`MAX(0, ${knowledge_bases.chunk_count} - 1)` })
      .where(eq(knowledge_bases.id, kbId));

    return c.json({ message: 'deleted' });
  });

  // ── URL 导入 ──

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

  // ── 手动文档创建 ──

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
      await documentManager.updateStatus(auth.tenantId, doc.id, 'indexing');
      const count = await ragManager.indexText(c.req.param('id'), content, { filename: `${filename}.md`, source: 'manual' }, doc.id);
      await documentManager.updateChunkCount(auth.tenantId, doc.id, count);
      await documentManager.updateStatus(auth.tenantId, doc.id, 'ready');
      return c.json({ id: doc.id, chunk_count: count });
    } catch (err: any) {
      await documentManager.updateStatus(auth.tenantId, doc.id, 'error', err.message);
      throw err;
    }
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
