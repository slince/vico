// @vico/memory - ConversationHistoryMemory: 读取会话历史并转为模型消息
import type {AgentMessage, ThreadStore} from '@vico/thread';
import {toModelMessages} from '@vico/thread';

/**
 * 包装 ThreadStore，读取会话历史并转为模型格式。
 *
 * 历史 = 最新摘要（role='summary' → user 前置）+ 摘要之后的所有非归档消息。
 * compaction 采用「先写摘要、后归档 head」，因此摘要之前的消息都已被归档；
 * 读一次非归档消息即可得到「摘要 + 之后的消息」，摘要由 toModelMessages 统一转成用户消息。
 */
export class ConversationHistoryMemory {

  constructor(readonly threadStore: ThreadStore) {}

  /**
   * 读取会话历史：最新摘要（用户消息前置）+ 摘要之后的所有非归档消息。
   *
   * @param threadId - 线程 ID
   * @returns 按时间升序排列的 AgentMessage 数组（含所属 turnId）
   */
  async get(threadId: string): Promise<AgentMessage[]> {
    // 读全部非归档消息（摘要之前已被归档；summary 时间最早，转成 user 后自然位于结果最前）
    const entries = await this.threadStore.getEntries(threadId, { includeArchived: false });
    return toModelMessages(entries);
  }
}
