// @vico/core - ConversationHistoryMemory: 摘要（前置）+ 最近 N 个已完成 turn 的非归档消息
import type {ThreadStore} from '@vico/thread';
import type {ModelMessage} from 'ai';
import {toModelMessages} from '@vico/thread';
import {getMessageText} from '@vico/model';

/**
 * 包装 ThreadStore，按已完结轮次读取会话历史并转为模型格式。
 * conversationWindow 表示取最近 N 轮已完结的轮次（status === 'completed'）。
 * 历史 = 最新非归档摘要（role='summary' → system，前置）+ 这些 turn 的非归档消息。
 */
export class ConversationHistoryMemory {

  constructor(readonly threadStore: ThreadStore, readonly conversationWindow: number) {}

  async get(threadId: string): Promise<ModelMessage[]> {
    const [summaryEntries, turns] = await Promise.all([
      this.threadStore.getEntries(threadId, { roles: ['summary'], includeArchived: false }),
      this.threadStore.getRecentTurns(threadId, this.conversationWindow, 'completed'),
    ]);

    const summary = summaryEntries.length > 0 ? toModelMessages([summaryEntries[summaryEntries.length - 1]])[0] : null;
    const ordered = [...turns].reverse(); // 升序（最旧在前）
    const entries = ordered.length > 0
      ? await this.threadStore.getEntriesByTurns(ordered.map((t) => t.id), { includeArchived: false })
      : [];

    const result: ModelMessage[] = [];
    if (summary) result.push({ role: 'system', content: getMessageText(summary) });
    result.push(...toModelMessages(entries));
    return result;
  }
}
