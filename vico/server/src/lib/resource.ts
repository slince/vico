/** 拼接租户 ID 和用户 ID 作为 Mastra Memory 的 resourceId（用户级隔离） */
export function resourceId(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

/** 将知识库 UUID 转换为合法的 LibSQLVector 索引名（替换连字符为下划线） */
export function kbIndexName(kbId: string): string {
  return `kb_${kbId.replace(/-/g, '_')}`;
}
