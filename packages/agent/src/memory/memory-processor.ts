// @vico/agent - MemoryProcessor: injects conversation history, working memory, and semantic recall
import type { ContextProcessor, ModelRequestContext } from '../prompt/context-processor.js';
import { Priority } from '../prompt/context-processor.js';
import type { MemoryStore } from './memory-store.js';

/** 注入会话历史、工作记忆和语义召回结果（NORMAL 优先级） */
export class MemoryProcessor implements ContextProcessor {
  readonly name = 'memory';
  readonly priority = Priority.NORMAL;

  constructor(private readonly memoryStore: MemoryStore) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    await this.injectConversationHistory(ctx);
    await this.injectWorkingMemory(ctx);
    await this.injectSemanticRecall(ctx);
  }

  /** 注入会话历史（FIFO 滑动窗口） */
  private async injectConversationHistory(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.conversation || !ctx.threadId) return;
    const history = await this.memoryStore.conversation.get(
      ctx.threadId,
      this.memoryStore.conversationWindow,
    );
    if (history.length === 0) return;

    ctx.messages.unshift(...history);
  }

  /** 注入工作记忆模板 + 当前数据，引导 LLM 自主更新 */
  private async injectWorkingMemory(ctx: ModelRequestContext): Promise<void> {
    if (!ctx.scopeId) return;
    const wm = this.memoryStore.working;
    const template = wm.getTemplate();
    const current = await wm.get(ctx.scopeId);

    const dataBlock = current || template;

    ctx.messages.push({
      role: 'system',
      content:
        `Store and update user facts by calling the updateWorkingMemory tool. If information might be referenced again — store it!\n\n` +
        `Guidelines:\n` +
        `1. Update proactively when you learn new facts about the user\n` +
        `2. Replace only the changed parts, keep the rest intact\n` +
        `3. Use the exact Markdown format shown below\n\n` +
        `<working_memory>\n${dataBlock}\n</working_memory>`,
    });
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
