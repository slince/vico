import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { listModels, addModel, updateModel, deleteModel } from '../agent/model-registry.js';

export function modelRoutes(app: Hono<{ Variables: Variables }>) {
  app.get('/api/v1/models', (c) => {
    const auth = c.get('auth');
    return c.json(listModels(auth.tenantId));
  });

  app.post('/api/v1/models', async (c) => {
    const auth = c.get('auth');
    const body = await c.req.json();
    return c.json(addModel(auth.tenantId, {
      tenant_id: auth.tenantId,
      provider: body.provider,
      model_name: body.model_name,
      api_key_encrypted: body.api_key_encrypted,
      base_url: body.base_url || null,
      is_default: body.is_default || 0,
    }));
  });

  app.patch('/api/v1/models/:id', async (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const body = await c.req.json();
    updateModel(auth.tenantId, id, body);
    return c.json({ message: 'updated' });
  });

  app.delete('/api/v1/models/:id', (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    deleteModel(auth.tenantId, id);
    return c.json({ message: 'deleted' });
  });
}
