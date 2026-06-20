// @vico/agent - MemoryProcessor: retrieves long-term memory and appends as system message
import type { ContextProcessor, ModelRequestContext } from '../prompt/context-processor.js';
import { Priority } from '../prompt/context-processor.js';
import type { MemoryStore } from './types.js';

/** 检索长期记忆并追加为 system 消息（NORMAL 优先级） */
export class MemoryProcessor implements ContextProcessor {
  readonly name = 'memory';
  readonly priority = Priority.NORMAL;

  constructor(private readonly memoryStore: MemoryStore) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    const query = ctx.getLastUserMessage();
    if (!query) return;

    const items = await this.memoryStore.ltm.search(query, 5);
    if (items.length === 0) return;

    const memText = items.map((m) => `- ${m.content}`).join('\n');
    ctx.messages.push({ role: 'system', content: `Relevant memories:\n${memText}` });
  }
}
