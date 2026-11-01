// @vico/memory - ConversationHistoryMemory: 读取会话历史并转为模型消息
import type {AgentMessage, ThreadStore} from '@vico/thread';
import {toModelMessages} from '@vico/thread';

/**
 * 包装 ThreadStore，读取会话历史并转为模型格式。
 *
 * 历史 = 最新摘要（role='summary' → user 前置）+ 其余非归档消息（按 created_at 升序）。
 * compaction 采用「先写摘要、后归档 head」，摘要之前的消息都已被归档；
 * 摘要落库时间晚于被保留的 tail 消息，故读取时显式把 summary 提到最前，保证语义顺序正确。
 */
export class ConversationHistoryMemory {

  constructor(readonly threadStore: ThreadStore) {}

  /**
   * 读取会话历史：最新摘要（用户消息前置）+ 其余非归档消息。
   *
   * @param threadId - 线程 ID
   * @returns summary 在前、其余按时间升序的 AgentMessage 数组（含所属 turnId）
   */
  async get(threadId: string): Promise<AgentMessage[]> {
    const entries = await this.threadStore.getEntries(threadId, { includeArchived: false });
    // summary 代表更早历史，置顶；其余保持 created_at 升序
    const summary = entries.filter((e) => e.role === 'summary');
    const rest = entries.filter((e) => e.role !== 'summary');
    return toModelMessages([...summary, ...rest]);
  }
}
