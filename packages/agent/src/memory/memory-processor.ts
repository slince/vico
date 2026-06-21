// @vico/agent - MemoryProcessor: injects conversation history, working memory, and semantic recall
import type { ContextProcessor, ModelRequestContext } from '../prompt/context-processor.js';
import { Priority } from '../prompt/context-processor.js';
import type { MemoryStore } from './memory-store.js';

/** 注入会话历史、工作记忆和语义召回结果（NORMAL 优先级） */
export class MemoryProcessor implements ContextProcessor {
  readonly name = 'memory';
  readonly priority = Priority.NORMAL;

  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly threadId: string,
  ) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    await this.injectConversationHistory(ctx);
    await this.injectWorkingMemory(ctx);
    await this.injectSemanticRecall(ctx);
  }

  /** 注入会话历史（FIFO 滑动窗口） */
  private async injectConversationHistory(ctx: ModelRequestContext): Promise<void> {
    const history = await this.memoryStore.conversation.get(
      this.threadId,
      this.memoryStore.conversationWindow,
    );
    if (history.length === 0) return;

    // 会话历史插入到消息列表最前面，保持时间顺序
    ctx.messages.unshift(...history);
  }

  /** 注入工作记忆实体 */
  private async injectWorkingMemory(ctx: ModelRequestContext): Promise<void> {
    const keys = await this.memoryStore.working.keys();
    if (keys.length === 0) return;

    const entries: string[] = [];
    for (const key of keys) {
      const value = await this.memoryStore.working.get(key);
      if (value !== undefined) {
        entries.push(`- ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
      }
    }
    if (entries.length === 0) return;

    ctx.messages.push({ role: 'system', content: `User profile:\n${entries.join('\n')}` });
  }

  /** 语义召回长期记忆 */
  private async injectSemanticRecall(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.semanticEnabled) return;

    const query = ctx.getLastUserMessage();
    if (!query) return;

    const items = await this.memoryStore.semantic.search(query, 5);
    if (items.length === 0) return;

    const memText = items.map((m) => `- ${m.content}`).join('\n');
    ctx.messages.push({ role: 'system', content: `Relevant memories:\n${memText}` });
  }
}
