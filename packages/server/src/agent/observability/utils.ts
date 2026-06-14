/**
 * Observability 辅助工具
 *
 * 提供 span 数据提取、trace 筛选等工具函数。
 */

/**
 * 从 RequestContext 提取 observability 元数据。
 * 用于在非 Mastra 管理的上下文中手动关联 trace。
 *
 * @param context - 请求上下文信息
 * @returns 键值对元数据
 */
export function extractObservabilityMeta(context: {
  tenantId: string;
  userId: string;
  agentId?: string;
}): Record<string, string> {
  return {
    tenantId: context.tenantId,
    userId: context.userId,
    ...(context.agentId ? { agentId: context.agentId } : {}),
  };
}
