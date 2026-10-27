// @vico/memory - ConversationHistoryMemory: 最新摘要（用户角色前置）+ 摘要之后的所有非归档消息
import type {ThreadStore} from '@vico/thread';
import {toModelMessages} from '@vico/thread';
import type {ModelMessage} from 'ai';
import {getMessageText} from '@vico/model';

/**
 * 包装 ThreadStore，读取会话历史并转为模型格式。
 *
 * 历史 = 最新非归档摘要（role='summary' → user 前置）+ 该摘要之后的所有非归档消息。
 * 先按角色查出最新摘要，再以摘要时间戳为界增量读取之后的消息，避免全量拉取后在内存过滤。
 */
export class ConversationHistoryMemory {

  constructor(readonly threadStore: ThreadStore) {}

  /**
   * 读取会话历史：最新摘要（以用户消息前置）+ 摘要之后的所有非归档消息。
   *
   * @param threadId - 线程 ID
   * @returns 按时间升序排列的 ModelMessage 数组
   */
  async get(threadId: string): Promise<ModelMessage[]> {
    // 先查最新一条摘要（旧摘要已被归档，正常只有一条）
    const summaryEntries = await this.threadStore.getEntries(threadId, { roles: ['summary'], includeArchived: false });
    const latestSummary = summaryEntries.length > 0 ? summaryEntries[summaryEntries.length - 1] : undefined;

    // 再查该摘要之后的所有非归档消息；无摘要时读取全部非归档消息
    const entries = await (latestSummary
      ? this.threadStore.getEntriesAfter(threadId, latestSummary.createdAt, { includeArchived: false })
      : this.threadStore.getEntries(threadId, { includeArchived: false }));

    const result: ModelMessage[] = [];

    // 摘要以用户消息形式注入，模型视作用户提供的上下文
    if (latestSummary) {
      result.push({ role: 'user', content: getMessageText(toModelMessages([latestSummary])[0]) });
    }

    result.push(...toModelMessages(entries));

    return result;
  }
}
