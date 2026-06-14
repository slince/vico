import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getStorage } from '../agent/memory-setup.js';

/**
 * Observability 观测性 API 路由
 *
 * 提供 trace 列表查询、单条 trace 详情、聚合统计三个端点。
 * 数据来源于 Mastra Storage Exporter 自动写入 LibSQL 的遥测数据。
 * 所有端点均按 tenantId 进行租户隔离过滤。
 */
export function observabilityRoutes(app: Hono<{ Variables: Variables }>) {
  /**
   * 安全解析日期查询参数，返回 NaN 表示无效值。
   */
  function parseDateParam(value: string | undefined): number {
    if (!value) return NaN;
    return parseInt(value, 10);
  }

  // ── Trace 列表（分页） ──
  app.get('/api/v1/observability/traces', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const obsStore = getStorage().stores?.observability;
    if (!obsStore) return c.json({ error: 'Observability not available' }, 500);

    const page = parseInt(c.req.query('page') || '1', 10);
    const perPage = parseInt(c.req.query('perPage') || '20', 10);
    const fromDate = c.req.query('fromDate');
    const toDate = c.req.query('toDate');

    // 构建过滤器（含租户隔离和时间范围）
    const filters: Record<string, unknown> = {
      tenantId: auth.tenantId,
    };

    const fromParsed = parseDateParam(fromDate);
    const toParsed = parseDateParam(toDate);
    if (!isNaN(fromParsed) || !isNaN(toParsed)) {
      filters.startedAt = {
        ...(!isNaN(fromParsed) ? { start: new Date(fromParsed) } : {}),
        ...(!isNaN(toParsed) ? { end: new Date(toParsed) } : {}),
      };
    }

    const result = await obsStore.listTracesLight({
      filters,
      pagination: { page, perPage },
    });

    return c.json(result);
  });

  // ── Trace 详情 ──
  app.get('/api/v1/observability/traces/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const obsStore = getStorage().stores?.observability;
    if (!obsStore) return c.json({ error: 'Observability not available' }, 500);

    const traceId = c.req.param('id');

    // 通过 listTracesLight 验证该 trace 属于当前租户，防止横向越权访问
    const filtered = await obsStore.listTracesLight({
      filters: { traceId, tenantId: auth.tenantId },
      pagination: { page: 1, perPage: 1 },
    });
    if (!filtered.spans.length) {
      return c.json({ error: 'Trace not found' }, 404);
    }

    const trace = await obsStore.getTrace({ traceId });

    if (!trace) {
      return c.json({ error: 'Trace not found' }, 404);
    }

    return c.json(trace);
  });

  // ── 聚合统计 ──
  app.get('/api/v1/observability/stats', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const obsStore = getStorage().stores?.observability;
    if (!obsStore) return c.json({ error: 'Observability not available' }, 500);

    const fromDate = c.req.query('fromDate');
    const toDate = c.req.query('toDate');

    // 构建过滤器（含租户隔离和时间范围）
    const filters: Record<string, unknown> = {
      tenantId: auth.tenantId,
    };

    const fromParsed = parseDateParam(fromDate);
    const toParsed = parseDateParam(toDate);
    if (!isNaN(fromParsed) || !isNaN(toParsed)) {
      filters.startedAt = {
        ...(!isNaN(fromParsed) ? { start: new Date(fromParsed) } : {}),
        ...(!isNaN(toParsed) ? { end: new Date(toParsed) } : {}),
      };
    }

    // 拉取较大页面以进行聚合统计
    const result = await obsStore.listTracesLight({
      filters,
      pagination: { page: 1, perPage: 500 },
    });

    // 按 entityId（即 agentId）聚合
    const byAgent: Record<string, {
      count: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      latencies: number[];
    }> = {};

    for (const span of result.spans ?? []) {
      const agentId = (span as Record<string, unknown>).entityId as string || 'unknown';
      if (!byAgent[agentId]) {
        byAgent[agentId] = { count: 0, totalInputTokens: 0, totalOutputTokens: 0, latencies: [] };
      }
      byAgent[agentId].count++;

      // 计算延迟（毫秒）
      const startedAt = (span as Record<string, unknown>).startedAt as Date | string | undefined;
      const endedAt = (span as Record<string, unknown>).endedAt as Date | string | undefined;
      if (startedAt && endedAt) {
        const startedMs = typeof startedAt === 'string' ? new Date(startedAt).getTime() : startedAt.getTime();
        const endedMs = typeof endedAt === 'string' ? new Date(endedAt).getTime() : endedAt.getTime();
        byAgent[agentId].latencies.push(endedMs - startedMs);
      }
    }

    // 计算分位数
    const stats = Object.entries(byAgent).map(([agentId, data]) => {
      const sorted = [...data.latencies].sort((a, b) => a - b);
      const len = sorted.length;
      return {
        agentId,
        traceCount: data.count,
        totalInputTokens: data.totalInputTokens,
        totalOutputTokens: data.totalOutputTokens,
        p50Latency: len > 0 ? sorted[Math.floor(len * 0.5)] : 0,
        p95Latency: len > 0 ? sorted[Math.floor(len * 0.95)] : 0,
        p99Latency: len > 0 ? sorted[Math.floor(len * 0.99)] : 0,
      };
    });

    return c.json({ stats, truncated: result.pagination.hasMore });
  });
}
