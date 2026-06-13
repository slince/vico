import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { listModels, addModel, updateModel, deleteModel } from '../agent/model-registry.js';

export function modelRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/models', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json(await listModels(auth.tenantId));
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
