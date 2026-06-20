// @vico/agent - ContextCompactor port interface: context window management
import type { ModelMessage } from '../model/model-client.js';
import type { ModelClient } from '../model/model-client.js';

/** 上下文紧凑器端口 — 当上下文窗口接近上限时压缩对话历史 */
export interface ContextCompactor {
  /** 检查是否需要压缩，若需要则执行压缩并返回紧凑后的消息列表 */
  compactIfNeeded(
    items: ModelMessage[],
    model: ModelClient,
    signal: AbortSignal,
  ): Promise<{
    /** 压缩后的消息列表 */
    compacted: ModelMessage[];
    /** 是否实际执行了压缩 */
    wasCompacted: boolean;
    /** 移除的 token 数 */
    removedTokens: number;
  }>;
}
