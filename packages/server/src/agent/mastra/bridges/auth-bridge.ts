// Bridge 4: Vico AuthContext → Mastra RuntimeContext (threadId/resourceId)
// resourceId = tenantId 确保多租户记忆隔离
// threadId = conversationId 确保对话连续性

import type { AuthContext } from '../../../api/helpers.js';

export interface MastraRuntimeContext {
  threadId: string;
  resourceId: string;
}

/**
 * 将 Vico AuthContext 映射为 Mastra RuntimeContext。
 * 若 conversationId 不存在（新对话），使用空字符串，Mastra 会自动创建 thread。
 */
export function authToMastraContext(
  auth: AuthContext,
  conversationId?: string,
): MastraRuntimeContext {
  return {
    threadId: conversationId || '',
    resourceId: auth.tenantId,
  };
}
