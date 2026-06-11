import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getDb } from '../data/db.js';
import { ragManager } from '../memory/rag.js';
import { v4 as uuid } from 'uuid';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';

export function knowledgeRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/knowledge-bases', (c) => {
    const auth = c.get('auth');
    const db = getDb();
    return c.json(db.prepare('SELECT * FROM knowledge_bases WHERE tenant_id = ? ORDER BY created_at DESC').all(auth.tenantId));
  });

  app.post('/api/v1/knowledge-bases', async (c) => {
    const auth = c.get('auth');
    const { name, description } = await c.req.json();
    const db = getDb();
    const id = uuid();
    db.prepare('INSERT INTO knowledge_bases (id, tenant_id, name, description, source, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, auth.tenantId, name, description || '', 'upload', Date.now()
    );
    return c.json({ id, message: 'created' });
  });

  app.get('/api/v1/knowledge-bases/:id', (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const db = getDb();
    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ? AND tenant_id = ?').get(id, auth.tenantId);
    if (!kb) return c.json({ error: 'Not found' }, 404);

    const chunks = db.prepare('SELECT id, content, metadata, created_at FROM chunks WHERE kb_id = ? ORDER BY created_at').all(id);
    return c.json({ ...kb as any, chunks });
  });

  app.delete('/api/v1/knowledge-bases/:id', (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const db = getDb();
    db.prepare('DELETE FROM agent_knowledge_bases WHERE kb_id = ?').run(id);
    db.prepare('DELETE FROM knowledge_bases WHERE id = ? AND tenant_id = ?').run(id, auth.tenantId);
    return c.json({ message: 'deleted' });
  });

  app.post('/api/v1/knowledge-bases/:id/upload', async (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const db = getDb();

    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ? AND tenant_id = ?').get(id, auth.tenantId);
    if (!kb) return c.json({ error: 'Not found' }, 404);

    // Handle multipart file upload via formData
    const formData = await c.req.formData();
    // Find the first file entry (mimics Fastify's req.file() behavior)
    let file: File | null = null;
    for (const [_, value] of formData.entries()) {
      if (value instanceof File) {
        file = value;
        break;
      }
    }
    if (!file || !file.name) return c.json({ error: 'No file uploaded' }, 400);

    // Save temp file
    const tmpDir = '/tmp/vico-uploads';
    mkdirSync(tmpDir, { recursive: true });
    const tmpPath = `${tmpDir}/${uuid()}-${file.name}`;
    const buf = Buffer.from(await file.arrayBuffer());
    writeFileSync(tmpPath, buf);

    try {
      const count = await ragManager.indexFile(id, tmpPath);
      unlinkSync(tmpPath);
      return c.json({ message: 'indexed', chunk_count: count });
    } catch (err: any) {
      try { unlinkSync(tmpPath); } catch {}
      return c.json({ error: err.message }, 400);
    }
  });

  app.delete('/api/v1/knowledge-bases/:id/chunks/:chunkId', (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const chunkId = c.req.param('chunkId');
    const db = getDb();

    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ? AND tenant_id = ?').get(id, auth.tenantId);
    if (!kb) return c.json({ error: 'Not found' }, 404);

    db.prepare('DELETE FROM chunks WHERE id = ? AND kb_id = ?').run(chunkId, id);
    db.prepare('UPDATE knowledge_bases SET chunk_count = MAX(0, chunk_count - 1) WHERE id = ?').run(id);
    return c.json({ message: 'deleted' });
  });
}
