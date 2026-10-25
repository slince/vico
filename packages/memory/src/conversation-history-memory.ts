// @vico/memory - ConversationHistoryMemory: 摘要（前置）+ 最近 N 个 turn（含未完结）的非归档消息
import type {ThreadStore} from '@vico/thread';
import {toModelMessages} from '@vico/thread';
import type {ModelMessage} from 'ai';
import {getMessageText} from '@vico/model';

/**
 * 包装 ThreadStore，按最近 N 轮读取会话消息并转为模型格式。
 * conversationWindow 表示取最近 N 轮（含未完结的当前轮，status 不限）。
 * 必须包含未完结轮：暂停/失败轮恢复时，其自身消息（用户消息、assistant 的 tool-call）
 * 需进入模型上下文，否则工具结果会因缺少配对 tool-call 被判为孤儿而丢弃。
 * 历史 = 最新非归档摘要（role='summary' → system，前置）+ 这些 turn 的非归档消息。
 */
export class ConversationHistoryMemory {

  constructor(readonly threadStore: ThreadStore, readonly conversationWindow: number) {}

  /**
   * 读取会话历史：最新摘要（system 前置）+ 最近 N 轮（含未完结）的非归档消息。
   *
   * @param threadId - 线程 ID
   * @returns 按时间升序排列的 ModelMessage 数组
   */
  async get(threadId: string): Promise<ModelMessage[]> {
    // 摘要与最近 N 轮并行读取
    const [summaryEntries, turns] = await Promise.all([
      this.threadStore.getEntries(threadId, { roles: ['summary'], includeArchived: false }),
      this.threadStore.getRecentTurns(threadId, this.conversationWindow),
    ]);

    // 取最新一条摘要转成 system 消息，无摘要则为 null
    let summary: ModelMessage | null = null;
    if (summaryEntries.length > 0) {
      const latest = summaryEntries[summaryEntries.length - 1];
      summary = toModelMessages([latest])[0];
    }

    // turns 按 createdAt 降序返回，反转为升序（最旧在前）
    const ordered = [...turns].reverse();

    const result: ModelMessage[] = [];
    if (summary) {
      result.push({ role: 'user', content: getMessageText(summary) });
    }

    // 按 turn 升序读取非归档消息，追加到结果尾部
    if (ordered.length > 0) {
      const turnIds = ordered.map((t) => t.id);
      const entries = await this.threadStore.getEntriesByTurns(turnIds, { includeArchived: false });
      result.push(...toModelMessages(entries));
    }

    return result;
  }
}
