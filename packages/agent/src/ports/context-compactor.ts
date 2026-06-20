import type { ModelMessage } from './model-client.js';

/**
 * ContextCompactor — 上下文压缩端口。
 * 当对话历史超出 Token 预算时，自动压缩旧消息为摘要。
 */
export interface ContextCompactor {
  /**
   * 检查并压缩消息列表。
   * 返回压缩后的消息列表（可能包含摘要 system message）。
   */
  compactIfNeeded(
    messages: ModelMessage[],
    estimatedTokens: number,
    softThreshold: number,
    hardThreshold: number,
  ): { compacted: ModelMessage[]; wasCompacted: boolean; removedTokens: number };
}
