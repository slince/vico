// @vico/agent - MemoryProcessor: injects conversation history, working memory, and semantic recall
import {randomUUID} from 'node:crypto';
import type {ContextProcessor, ModelRequestContext} from './context-processor.js';
import {Priority} from './context-processor.js';
import type {MemoryStore} from '../../memory/memory-store.js';
import type {MemoryRecord} from '../../memory/types.js';

/** 事实匹配模式 — 包含这些动词/模式的句子视为事实 */
const FACT_PATTERNS = /\b(is|are|was|were|lives?|works?|located|prefers?|likes?|uses?|has|have|name|from|occupation|role|goal|deadline|project)\b/i;

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

  /**
   * 循环结束后提取事实存入语义记忆。
   *
   * @param ctx - 模型请求上下文
   */
  async resolve(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.semantic) return;
    const facts = this.extractFacts(ctx);
    for (const fact of facts) {
      await this.memoryStore.semantic.create(fact);
    }
  }

  /**
   * 注入会话历史（FIFO 滑动窗口）。
   *
   * @param ctx - 模型请求上下文
   */
  private async injectConversationHistory(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.conversation || !ctx.threadId) return;
    const history = await this.memoryStore.conversation.get(
      ctx.threadId,
      this.memoryStore.conversationWindow,
    );
    if (history.length === 0) return;

    ctx.messages.unshift(...history);
  }

  /**
   * 注入工作记忆模板 + 当前数据，引导 LLM 自主更新。
   *
   * @param ctx - 模型请求上下文
   */
  private async injectWorkingMemory(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.working || !ctx.scopeId) return;
    const wm = this.memoryStore.working;
    const template = wm.getTemplate();
    const current = await wm.get(ctx.scopeId);

    const dataBlock = current || template;

    ctx.messages.push({
      role: 'system',
      content:
        `调用 updateWorkingMemory 工具存储用户信息。如果信息可能被再次引用——存储它！\n\n` +
        `使用指南：\n` +
        `1. 了解到用户新信息时主动更新\n` +
        `2. 仅替换变更部分，保持其他部分不变\n` +
        `3. 使用下方 Markdown 格式——不要直接输出模板文本，始终通过工具更新\n\n` +
        `当前工作记忆：\n\`\`\`markdown\n${dataBlock}\n\`\`\``,
    });
  }

  /**
   * 语义召回长期记忆。
   *
   * @param ctx - 模型请求上下文
   */
  private async injectSemanticRecall(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.semantic) return;
    const query = ctx.getLastUserMessage();
    if (!query) return;

    const items = await this.memoryStore.semantic.search(query, 5);
    if (items.length === 0) return;

    const memText = items.map((m) => `- ${m.content}`).join('\n');
    ctx.messages.push({ role: 'system', content: `相关记忆：\n${memText}` });
  }

  /**
   * 从对话中提取事实句子，转为 MemoryRecord。
   *
   * @param ctx - 模型请求上下文
   * @returns 提取到的记忆记录数组
   */
  private extractFacts(ctx: ModelRequestContext): MemoryRecord[] {
    const now = Date.now();
    const threadId = ctx.threadId || undefined;
    const facts: MemoryRecord[] = [];

    for (const msg of ctx.messages) {
      if (msg.role !== 'assistant') continue;
      if (!msg.content || msg.content.length < 10) continue;

      // 按句号、换行拆分
      const sentences = msg.content.split(/[.\n]+/).map((s) => s.trim()).filter(Boolean);
      for (const sentence of sentences) {
        if (sentence.length < 15) continue; // 太短的不算事实
        if (!FACT_PATTERNS.test(sentence)) continue;

        facts.push({
          id: randomUUID(),
          threadId,
          content: sentence,
          metadata: { source: 'resolve' },
          createdAt: now,
        });
      }
    }

    return facts;
  }
}
