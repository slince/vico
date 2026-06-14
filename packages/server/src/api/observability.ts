import { Hono } from 'hono';
import type { Variables } from '../index.js';
import { getAuthContext } from './helpers.js';
import { getClient } from '../db/init-libsql.js';
import type { InValue } from '@libsql/client';

/**
 * Observability 观测性 API 路由
 *
 * 提供 trace 列表查询、单条 trace 详情、聚合统计三个端点。
 * 数据来源于 Mastra Storage Exporter 自动写入 mastra_ai_spans 的遥测数据。
 * 所有端点均按 tenantId（通过 requestContext JSON 字段）进行租户隔离过滤。
 *
 * 注意：LibSQL 存储后端未实现 listTracesLight/getTrace 方法（会抛错误），
 * 因此直接通过 libsql client 查询 mastra_ai_spans 表。
 */
export function observabilityRoutes(app: Hono<{ Variables: Variables }>) {

  // ── Trace 列表（分页） ──
  app.get('/api/v1/observability/traces', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(c.req.query('perPage') || '20', 10) || 20));
    const fromDate = c.req.query('fromDate');
    const toDate = c.req.query('toDate');

    const client = getClient();
    const tenantId = auth.tenantId;
    const offset = (page - 1) * perPage;

    // 构建时间过滤条件
    const timeConditions: string[] = [];
    const timeParams: InValue[] = [];
    if (fromDate) {
      timeConditions.push('startedAt >= ?');
      timeParams.push(fromDate);
    }
    if (toDate) {
      timeConditions.push('startedAt <= ?');
      timeParams.push(toDate);
    }
    const timeClause = timeConditions.length > 0 ? `AND ${timeConditions.join(' AND ')}` : '';

    // 总数查询
    const countSql = `SELECT COUNT(DISTINCT traceId) as total FROM mastra_ai_spans WHERE json_extract(requestContext, '$.tenantId') = ? ${timeClause}`;
    const countResult = await client.execute({ sql: countSql, args: [tenantId, ...timeParams] });
    const total = (countResult.rows[0]?.total as number) ?? 0;

    // 分页查询
    const dataSql = `
      SELECT traceId, spanId, name, spanType, parentSpanId, startedAt, endedAt,
             entityId, entityName, error, createdAt
      FROM mastra_ai_spans
      WHERE json_extract(requestContext, '$.tenantId') = ? ${timeClause}
      ORDER BY startedAt DESC
      LIMIT ? OFFSET ?
    `;
    const dataResult = await client.execute({
      sql: dataSql,
      args: [tenantId, ...timeParams, perPage, offset],
    });

    const traces = dataResult.rows.map((row) => {
      const startedMs = toMs(row.startedAt as string);
      const endedMs = toMs(row.endedAt as string | null);
      return {
        traceId: row.traceId as string,
        status: row.error ? 'error' : 'ok',
        latency: endedMs && startedMs ? endedMs - startedMs : null,
        createdAt: startedMs,
        metadata: row.entityId ? { agentId: row.entityId as string, entityName: row.entityName as string } : {},
      };
    });

    return c.json({ traces, total, page, perPage });
  });

  // ── Trace 详情 ──
  app.get('/api/v1/observability/traces/:id', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const traceId = c.req.param('id');
    const client = getClient();
    const tenantId = auth.tenantId;

    // 租户验证
    const verifySql = `
      SELECT traceId FROM mastra_ai_spans
      WHERE traceId = ? AND json_extract(requestContext, '$.tenantId') = ?
      LIMIT 1
    `;
    const verifyResult = await client.execute({ sql: verifySql, args: [traceId, tenantId] });
    if (verifyResult.rows.length === 0) {
      return c.json({ error: 'Trace not found' }, 404);
    }

    // 获取所有 span
    const spansSql = `SELECT * FROM mastra_ai_spans WHERE traceId = ? ORDER BY startedAt ASC`;
    const spansResult = await client.execute({ sql: spansSql, args: [traceId] });

    const spanMap = new Map<string, SpanNode>();
    const rootSpans: SpanNode[] = [];

    // 第一遍：创建所有 SpanNode
    for (const row of spansResult.rows) {
      const node: SpanNode = {
        spanId: row.spanId as string,
        name: row.name as string,
        type: row.spanType as string,
        startTime: toMs(row.startedAt as string),
        endTime: toMs(row.endedAt as string | null),
        attributes: safeJsonParse(row.attributes as string | null) as Record<string, unknown> | undefined,
        children: [],
      };
      spanMap.set(node.spanId, node);
    }

    // 第二遍：构建父子关系
    for (const row of spansResult.rows) {
      const spanId = row.spanId as string;
      const parentSpanId = row.parentSpanId as string | null;
      const node = spanMap.get(spanId)!;

      if (parentSpanId && spanMap.has(parentSpanId)) {
        spanMap.get(parentSpanId)!.children.push(node);
      } else {
        rootSpans.push(node);
      }
    }

    return c.json({
      traceId,
      spans: rootSpans,
      metadata: spansResult.rows.length > 0
        ? { serviceName: (spansResult.rows[0] as Record<string, unknown>).serviceName }
        : {},
    });
  });

  // ── 聚合统计 ──
  app.get('/api/v1/observability/stats', async (c) => {
    const auth = await getAuthContext(c);
    if (auth instanceof Response) return auth;

    const fromDate = c.req.query('fromDate');
    const toDate = c.req.query('toDate');

    const client = getClient();
    const tenantId = auth.tenantId;

    const timeConditions: string[] = [];
    const timeParams: InValue[] = [];
    if (fromDate) {
      timeConditions.push('startedAt >= ?');
      timeParams.push(fromDate);
    }
    if (toDate) {
      timeConditions.push('startedAt <= ?');
      timeParams.push(toDate);
    }
    const timeClause = timeConditions.length > 0 ? `AND ${timeConditions.join(' AND ')}` : '';

    // 按 entityId（即 agentId）聚合 root span
    const statsSql = `
      SELECT
        COALESCE(entityId, 'unknown') as agentId,
        COUNT(*) as traceCount,
        GROUP_CONCAT(
          CASE WHEN startedAt IS NOT NULL AND endedAt IS NOT NULL
            THEN CAST((julianday(endedAt) - julianday(startedAt)) * 86400000 AS INTEGER)
          END
        ) as latencies
      FROM mastra_ai_spans
      WHERE json_extract(requestContext, '$.tenantId') = ?
        AND parentSpanId IS NULL
        ${timeClause}
      GROUP BY entityId
      ORDER BY traceCount DESC
    `;

    const result = await client.execute({ sql: statsSql, args: [tenantId, ...timeParams] });

    const stats = result.rows.map((row) => {
      const latenciesStr = row.latencies as string;
      const latencies = latenciesStr
        ? latenciesStr.split(',').map(Number).filter((n) => n > 0).sort((a, b) => a - b)
        : [];
      const len = latencies.length;

      return {
        agentId: row.agentId as string,
        traceCount: row.traceCount as number,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        p50Latency: len > 0 ? latencies[Math.floor(len * 0.5)] : 0,
        p95Latency: len > 0 ? latencies[Math.floor(len * 0.95)] : 0,
        p99Latency: len > 0 ? latencies[Math.floor(len * 0.99)] : 0,
      };
    });

    return c.json({ stats, truncated: false });
  });
}

/** SpanNode 类型 */
interface SpanNode {
  spanId: string;
  name: string;
  type: string;
  startTime: number;
  endTime: number;
  attributes?: Record<string, unknown>;
  children: SpanNode[];
}

/** ISO 日期字符串转毫秒时间戳 */
function toMs(value: string | null): number {
  if (!value) return 0;
  const d = new Date(value);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/** 安全解析 JSON，失败时返回 null */
function safeJsonParse(value: string | null): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
