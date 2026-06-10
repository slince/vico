import { FastifyInstance } from 'fastify';
import { listModels, addModel, updateModel, deleteModel } from '../agent/model-registry.js';

export function modelRoutes(app: FastifyInstance) {
  app.get('/api/v1/models', async (req) => {
    return listModels(req.authContext!.tenantId);
  });

  app.post('/api/v1/models', async (req) => {
    const ctx = req.authContext!;
    const body = req.body as any;
    return addModel(ctx.tenantId, {
      tenant_id: ctx.tenantId,
      provider: body.provider,
      model_name: body.model_name,
      api_key_encrypted: body.api_key_encrypted,
      base_url: body.base_url || null,
      is_default: body.is_default || 0,
    });
  });

  app.patch('/api/v1/models/:id', async (req) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    const body = req.body as any;
    updateModel(ctx.tenantId, id, body);
    return { message: 'updated' };
  });

  app.delete('/api/v1/models/:id', async (req) => {
    const ctx = req.authContext!;
    const { id } = req.params as any;
    deleteModel(ctx.tenantId, id);
    return { message: 'deleted' };
  });
}
