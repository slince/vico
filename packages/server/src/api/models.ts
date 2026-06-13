import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { listModels, addModel, updateModel, deleteModel } from '../agent/model-registry.js';
import { maskApiKey } from '../lib/crypto.js';

export function modelRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/models', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const models = await listModels(auth.tenantId);
    // 掩码 API Key 后再返回给前端
    const masked = models.map((m) => ({ ...m, api_key_encrypted: maskApiKey(m.api_key_encrypted) }));
    return c.json(masked);
  });

  app.post('/api/v1/models', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const body = await c.req.json();
    return c.json(await addModel(auth.tenantId, body));
  });

  app.patch('/api/v1/models/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateModel(auth.tenantId, id, body);
    return c.json({ message: 'updated' });
  });

  app.delete('/api/v1/models/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    await deleteModel(auth.tenantId, id);
    return c.json({ message: 'deleted' });
  });
}
