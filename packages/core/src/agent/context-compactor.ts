// src/agent-loop/context-compactor.ts
import type {ModelClient} from '../model/model-client.js';
import type {LanguageModelV4StreamPart} from '@ai-sdk/provider';
import type { ModelMessage } from 'ai';
import { getMessageText } from '../model/message-utils.js';

/** 压缩结果 */
export interface CompactResult {
  /** 压缩后的消息列表 */
  compacted: ModelMessage[];
  /** 是否实际执行了压缩 */
  wasCompacted: boolean;
  /** 被移除的 token 数 */
  removedTokens: number;
}

/**
 * 简单的 Token 估算（4 字符 ≈ 1 token）。
 *
 * @param messages - 消息列表
 * @returns 估算的 token 数量
 */
function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    // parts 数组按 JSON 长度估算（含 tool-call/tool-result 的结构开销）
    chars += typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length;
  }
  return Math.ceil(chars / 4);
}

/** 上下文压缩器 — 启发式阈值 + LLM 摘要 */
export class ContextCompactor {
  private softThreshold: number;
  private keepRecent: number;

  constructor(softThreshold = 8000, keepRecent = 6) {
    this.softThreshold = softThreshold;
    this.keepRecent = keepRecent;
  }

  async compactIfNeeded(
    items: ModelMessage[],
    modelClient: ModelClient,
    signal: AbortSignal,
  ): Promise<CompactResult> {
    const estimated = estimateTokens(items);
    if (estimated < this.softThreshold) {
      return { compacted: items, wasCompacted: false, removedTokens: 0 };
    }

    if (items.length <= this.keepRecent + 2) {
      return { compacted: items, wasCompacted: false, removedTokens: 0 };
    }

    const head = items.slice(0, -this.keepRecent);
    const tail = items.slice(-this.keepRecent);
    const headTokens = estimateTokens(head);

    let summaryContent: string;
    try {
      const { stream } = await modelClient.stream({
        system: '简洁地总结以下对话。保留关键决策、事实和待办事项。',
        messages: head,
        abortSignal: signal,
      });
      let text = '';
      for await (const chunk of stream as unknown as AsyncIterable<LanguageModelV4StreamPart>) {
        if (chunk.type === 'text-delta') text += chunk.delta;
      }
      summaryContent = text;
    } catch {
      // 模型摘要失败时回退到简单截断
      summaryContent = head.map((m) => `${m.role}: ${getMessageText(m).slice(0, 200)}`).join('\n');
    }

    const summaryMessage: ModelMessage = { role: 'system', content: `[对话摘要]\n${summaryContent}` };
    return {
      compacted: [summaryMessage, ...tail],
      wasCompacted: true,
      removedTokens: headTokens - Math.ceil(summaryContent.length / 4),
    };
  }
}
