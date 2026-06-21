import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import {
  listDatasets, createDataset, deleteDataset, getDataset,
  addTestCase, listTestCases, deleteTestCase,
} from '../agent/evals/datasets.js';
import { runEval, getEvalRunDetail } from '../agent/evals/runner.js';

/**
 * Evals API 路由 — 评估数据集与测试用例管理，以及评估运行触发与结果查询。
 *
 * 所有端点均需认证，数据集和测试用例按 tenant_id 隔离。
 */
export function evalsRoutes(app: Hono<{ Variables: Variables }>) {
  // List datasets
  app.get('/api/v1/evals/datasets', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    return c.json(await listDatasets(auth.tenantId));
  });

  // Create dataset
  app.post('/api/v1/evals/datasets', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const body = await c.req.json();
    return c.json(await createDataset(auth.tenantId, body));
  });

  // Delete dataset
  app.delete('/api/v1/evals/datasets/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const ok = await deleteDataset(auth.tenantId, c.req.param('id'));
    if (!ok) return c.json({ error: 'Dataset not found' }, 404);
    return c.json({ message: 'deleted' });
  });

  // Dataset detail with test cases
  app.get('/api/v1/evals/datasets/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const dataset = await getDataset(auth.tenantId, c.req.param('id'));
    if (!dataset) return c.json({ error: 'Dataset not found' }, 404);
    const cases = await listTestCases(c.req.param('id'));
    return c.json({ ...dataset, cases });
  });

  // Add test case
  app.post('/api/v1/evals/datasets/:id/cases', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    // Verify dataset belongs to tenant
    const dataset = await getDataset(auth.tenantId, c.req.param('id'));
    if (!dataset) return c.json({ error: 'Dataset not found' }, 404);
    const body = await c.req.json();
    return c.json(await addTestCase(c.req.param('id'), body));
  });

  // Delete test case
  app.delete('/api/v1/evals/cases/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const ok = await deleteTestCase(c.req.param('id'));
    if (!ok) return c.json({ error: 'Test case not found' }, 404);
    return c.json({ message: 'deleted' });
  });

  // Trigger eval run
  app.post('/api/v1/evals/datasets/:id/run', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const dataset = await getDataset(auth.tenantId, c.req.param('id'));
    if (!dataset) return c.json({ error: 'Dataset not found' }, 404);
    const run = await runEval(auth.tenantId, c.req.param('id'));
    return c.json(run);
  });

  // Get eval run result
  app.get('/api/v1/evals/runs/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;
    const detail = await getEvalRunDetail(c.req.param('id'));
    if (!detail) return c.json({ error: 'Eval run not found' }, 404);
    return c.json(detail);
  });
}
