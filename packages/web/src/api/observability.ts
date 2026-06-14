/**
 * Observability API 客户端
 *
 * 封装 trace 查询接口，供前端页面使用。
 */
import { api } from './client';

export interface TraceItem {
  traceId: string;
  agentId?: string;
  status?: string;
  latency?: number;
  createdAt?: number;
  metadata?: Record<string, unknown>;
}

export interface TraceListResponse {
  traces: TraceItem[];
  total: number;
  page: number;
  perPage: number;
}

export interface TraceDetail {
  traceId: string;
  spans: SpanNode[];
  metadata?: Record<string, unknown>;
}

export interface SpanNode {
  spanId: string;
  name: string;
  type: string;
  startTime: number;
  endTime: number;
  attributes?: Record<string, unknown>;
  children: SpanNode[];
}

export interface ObservabilityStats {
  agentId: string;
  traceCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
}

export interface StatsResponse {
  stats: ObservabilityStats[];
  truncated?: boolean;
}

/** 分页查询 trace 列表 */
export function fetchTraces(params?: {
  page?: number;
  perPage?: number;
  fromDate?: number;
  toDate?: number;
  agentId?: string;
}): Promise<TraceListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page != null) searchParams.set('page', String(params.page));
  if (params?.perPage != null) searchParams.set('perPage', String(params.perPage));
  if (params?.fromDate != null) searchParams.set('fromDate', String(params.fromDate));
  if (params?.toDate != null) searchParams.set('toDate', String(params.toDate));
  if (params?.agentId) searchParams.set('agentId', params.agentId);

  return api<TraceListResponse>(`/observability/traces?${searchParams.toString()}`);
}

/** 获取单条 trace 详情 */
export function fetchTraceDetail(traceId: string): Promise<TraceDetail> {
  return api<TraceDetail>(`/observability/traces/${traceId}`);
}

/** 获取聚合统计 */
export function fetchObservabilityStats(params?: {
  fromDate?: number;
  toDate?: number;
}): Promise<StatsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.fromDate != null) searchParams.set('fromDate', String(params.fromDate));
  if (params?.toDate != null) searchParams.set('toDate', String(params.toDate));

  return api<StatsResponse>(`/observability/stats?${searchParams.toString()}`);
}
