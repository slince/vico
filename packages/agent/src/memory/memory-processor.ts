// @vico/agent - MemoryProcessor: retrieves long-term memory and appends as system message
import type { ContextProcessor, ModelRequestContext } from '../prompt/context-processor.js';
import { Priority } from '../prompt/context-processor.js';
import type { MemoryStore } from './types.js';
import type { ModelMessage } from '../model/types.js';

/** 提取最后一条用户消息内容作为检索查询 */
function extractLastUserMessage(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

/** 检索长期记忆并追加为 system 消息（NORMAL 优先级） */
export class MemoryProcessor implements ContextProcessor {
  readonly name = 'memory';
  readonly priority = Priority.NORMAL;

  constructor(private readonly memoryStore: MemoryStore) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    const query = extractLastUserMessage(ctx.messages);
    if (!query) return;

    const items = await this.memoryStore.ltm.search(query, 5);
    if (items.length === 0) return;

    const memText = items.map((m) => `- ${m.content}`).join('\n');
    ctx.messages.push({ role: 'system', content: `Relevant memories:\n${memText}` });
  }
}
