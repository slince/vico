// src/agent-loop/context-compactor.ts
import type { ModelMessage, ModelClient } from '../model/model-client.js';

export interface ContextCompactor {
  compactIfNeeded(
    items: ModelMessage[],
    model: ModelClient,
    signal: AbortSignal,
  ): Promise<{ compacted: ModelMessage[]; wasCompacted: boolean; removedTokens: number }>;
}

/** 简单的 Token 估算（4 字符 ≈ 1 token） */
function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
    if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
  }
  return Math.ceil(chars / 4);
}

/** 上下文压缩器 — 启发式阈值 + LLM 摘要 */
export class ContextCompactorImpl implements ContextCompactor {
  private softThreshold: number;
  private keepRecent: number;

  constructor(softThreshold = 8000, keepRecent = 6) {
    this.softThreshold = softThreshold;
    this.keepRecent = keepRecent;
  }

  async compactIfNeeded(
    items: ModelMessage[],
    model: ModelClient,
    signal: AbortSignal,
  ): Promise<{ compacted: ModelMessage[]; wasCompacted: boolean; removedTokens: number }> {
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
      const request = {
        system: 'Summarize the following conversation concisely. Keep key decisions, facts, and action items.',
        messages: head,
        tools: [],
        abortSignal: signal,
      };
      let text = '';
      for await (const chunk of model.stream(request)) {
        if (chunk.type === 'text_delta') text += chunk.content;
      }
      summaryContent = text;
    } catch {
      // 模型摘要失败时回退到简单截断
      summaryContent = head.map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');
    }

    const summaryMessage: ModelMessage = { role: 'system', content: `[Conversation summary]\n${summaryContent}` };
    return {
      compacted: [summaryMessage, ...tail],
      wasCompacted: true,
      removedTokens: headTokens - Math.ceil(summaryContent.length / 4),
    };
  }
}
