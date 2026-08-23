// @vico/core - MemoryProcessor: injects conversation history, working memory, and semantic recall
import {randomUUID} from 'node:crypto';
import type {ContextProcessor} from './context-processor.js';
import {Priority} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import {getMessageText} from '../../model/message-utils.js';
import type {MemoryStore} from '../../memory/memory-store.js';

/** 语义召回最小相似度 — 低于该值的记忆视为不相关，不注入上下文 */
const RECALL_MIN_SCORE = 0.5;

/** 注入会话历史、工作记忆和语义召回结果（HIGH 优先级） */
export class MemoryProcessor implements ContextProcessor {
  readonly name = 'memory';
  readonly priority = Priority.HIGH;

  constructor(private readonly memoryStore: MemoryStore) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    await this.injectConversationHistory(ctx);
    await this.injectWorkingMemory(ctx);
    await this.injectSemanticRecall(ctx);
  }

  /**
   * 循环结束后将本轮用户消息原文向量化存入语义记忆。
   * 语义记忆只做「向量化 + 语义检索」，不做事实提取。
   *
   * @param ctx - 模型请求上下文
   */
  async resolve(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.semantic) return;
    const now = Date.now();
    const threadId = ctx.threadId || undefined;
    const scopeId = ctx.scopeId || undefined;

    for (const msg of ctx.userMessages) {
      if (msg.role !== 'user') continue;
      const content = getMessageText(msg).trim();
      if (!content) continue;

      await this.memoryStore.semantic.create({
        id: randomUUID(),
        threadId,
        scopeId,
        content,
        metadata: { source: 'resolve' },
        createdAt: now,
      });
    }
  }

  /**
   * 注入会话历史（FIFO 滑动窗口）。
   *
   * @param ctx - 模型请求上下文
   */
  private async injectConversationHistory(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.conversation || !ctx.threadId) return;
    const history = await this.memoryStore.conversation.get(ctx.threadId);
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

    ctx.appendSystemPrompt(
      `调用 update_working_memory 工具存储用户信息。如果信息可能被再次引用——存储它！\n\n` +
      `使用指南：\n` +
      `1. 了解到用户新信息时主动更新\n` +
      `2. 仅替换变更部分，保持其他部分不变\n` +
      `3. 使用下方 Markdown 格式——不要直接输出模板文本，始终通过工具更新\n\n` +
      `当前工作记忆：\n\`\`\`markdown\n${dataBlock}\n\`\`\``);
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

    const items = await this.memoryStore.semantic.search(query, 5, ctx.scopeId);
    // 按相似度阈值过滤，避免低相关记忆污染上下文
    const relevant = items.filter((m) => m.score >= RECALL_MIN_SCORE);
    if (relevant.length === 0) return;

    const memText = relevant.map((m) => `- ${m.content}`).join('\n');
    ctx.appendSystemPrompt(`相关记忆：\n${memText}`);
  }
}
