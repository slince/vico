import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { knowledgeManager } from '../services/knowledge/knowledge-manager.js';

export function knowledgeRoutes(app: Hono<{ Variables: Variables }>) {
  /** GET /api/v1/knowledge-bases — 知识库列表 */
  app.get('/api/v1/knowledge-bases', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json(await knowledgeManager.list(auth.tenantId));
  });

  /** POST /api/v1/knowledge-bases — 创建知识库 */
  app.post('/api/v1/knowledge-bases', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const kb = await knowledgeManager.create(auth.tenantId, await c.req.json());
    return c.json({ id: kb.id, message: 'created' });
  });

  /** GET /api/v1/knowledge-bases/:id — 知识库详情 */
  app.get('/api/v1/knowledge-bases/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const kb = await knowledgeManager.getById(auth.tenantId, c.req.param('id'));
    if (!kb) return c.json({ error: 'Not found' }, 404);
    // chunks table removed — data is now in LibSQLVector
    return c.json({ ...kb, chunks: [] });
  });

  /** DELETE /api/v1/knowledge-bases/:id — 删除知识库 */
  app.delete('/api/v1/knowledge-bases/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    await knowledgeManager.remove(auth.tenantId, c.req.param('id'));
    return c.json({ message: 'deleted' });
  });

  /** POST /api/v1/knowledge-bases/:id/upload — 上传文件并索引 */
  app.post('/api/v1/knowledge-bases/:id/upload', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    try {
      const { chunkCount } = await knowledgeManager.uploadFile(
        auth.tenantId,
        c.req.param('id'),
        await c.req.formData(),
      );
      return c.json({ message: 'indexed', chunk_count: chunkCount });
    } catch (e: any) {
      const msg = e.message;
      if (msg === 'Knowledge base not found') return c.json({ error: 'Not found' }, 404);
      if (msg.startsWith('File too large')) return c.json({ error: msg }, 413);
      if (['No file uploaded', 'Invalid filename', 'Unsupported file type', 'File content does not match declared type'].some((m) => msg.includes(m))) {
        return c.json({ error: msg }, 400);
      }
      throw e;
    }
  });

  /** DELETE /api/v1/knowledge-bases/:id/chunks/:chunkId — 删除分块（暂未实现） */
  app.delete('/api/v1/knowledge-bases/:id/chunks/:chunkId', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json({ message: 'Chunk deletion via LibSQLVector not yet implemented.' }, 501);
  });
}
