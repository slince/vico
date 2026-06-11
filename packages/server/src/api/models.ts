import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { listModels, addModel, updateModel, deleteModel } from '../agent/model-registry.js';

export function modelRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/models', (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json(listModels(auth.tenantId));
  });

  app.post('/api/v1/models', async (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const body = await c.req.json();
    return c.json(addModel(auth.tenantId, body));
  });

  app.patch('/api/v1/models/:id', async (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    const body = await c.req.json();
    updateModel(auth.tenantId, id, body);
    return c.json({ message: 'updated' });
  });

  app.delete('/api/v1/models/:id', (c) => {
    const auth = getAuthContext(c);
    if (auth instanceof Response) return auth;
    const id = c.req.param('id');
    deleteModel(auth.tenantId, id);
    return c.json({ message: 'deleted' });
  });
}
