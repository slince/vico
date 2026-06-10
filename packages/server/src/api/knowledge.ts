import { FastifyInstance } from 'fastify';
import { getDb } from '../data/db.js';
import { ragManager } from '../memory/rag.js';
import { v4 as uuid } from 'uuid';

export function knowledgeRoutes(app: FastifyInstance) {
  app.get('/api/v1/knowledge-bases', async (req) => {
    const ctx = req.authContext!;
    const db = getDb();
    return db.prepare('SELECT * FROM knowledge_bases WHERE tenant_id = ? ORDER BY created_at DESC').all(ctx.tenantId);
  });

  app.post('/api/v1/knowledge-bases', async (req, reply) => {
    const ctx = req.authContext!;
    const { name, description } = req.body as any;
    const db = getDb();
    const id = uuid();
    db.prepare('INSERT INTO knowledge_bases (id, tenant_id, name, description, source, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, ctx.tenantId, name, description || '', 'upload', Date.now()
    );
    return { id, message: 'created' };
  });

  app.get('/api/v1/knowledge-bases/:id', async (req, reply) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const db = getDb();
    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ? AND tenant_id = ?').get(id, ctx.tenantId);
    if (!kb) return reply.status(404).send({ error: 'Not found' });

    const chunks = db.prepare('SELECT id, content, metadata, created_at FROM chunks WHERE kb_id = ? ORDER BY created_at').all(id);
    return { ...kb as any, chunks };
  });

  app.delete('/api/v1/knowledge-bases/:id', async (req, reply) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const db = getDb();
    db.prepare('DELETE FROM agent_knowledge_bases WHERE kb_id = ?').run(id);
    db.prepare('DELETE FROM knowledge_bases WHERE id = ? AND tenant_id = ?').run(id, ctx.tenantId);
    return { message: 'deleted' };
  });

  app.post('/api/v1/knowledge-bases/:id/upload', async (req, reply) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const db = getDb();

    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ? AND tenant_id = ?').get(id, ctx.tenantId);
    if (!kb) return reply.status(404).send({ error: 'Not found' });

    // Handle file upload via multipart
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    // Save temp file
    const tmpDir = '/tmp/vico-uploads';
    const { mkdirSync, writeFileSync, unlinkSync } = await import('node:fs');
    mkdirSync(tmpDir, { recursive: true });
    const tmpPath = `${tmpDir}/${uuid()}-${data.filename}`;
    const buf = await data.toBuffer();
    writeFileSync(tmpPath, buf);

    try {
      const count = await ragManager.indexFile(id, tmpPath);
      unlinkSync(tmpPath);
      return { message: 'indexed', chunk_count: count };
    } catch (err: any) {
      try { unlinkSync(tmpPath); } catch {}
      return reply.status(400).send({ error: err.message });
    }
  });

  app.delete('/api/v1/knowledge-bases/:id/chunks/:chunkId', async (req, reply) => {
    const ctx = req.authContext!;
    const { id, chunkId } = req.params as any;
    const db = getDb();

    const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ? AND tenant_id = ?').get(id, ctx.tenantId);
    if (!kb) return reply.status(404).send({ error: 'Not found' });

    db.prepare('DELETE FROM chunks WHERE id = ? AND kb_id = ?').run(chunkId, id);
    db.prepare('UPDATE knowledge_bases SET chunk_count = MAX(0, chunk_count - 1) WHERE id = ?').run(id);
    return { message: 'deleted' };
  });
}
