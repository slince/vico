// @vico/context - MemoryProcessor: injects conversation history, semantic memory, and episodic recall
import {randomUUID} from 'node:crypto';
import type {ContextProcessor} from './context-processor.js';
import {Priority} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import {getMessageText} from '@vico/model';
import type {MemoryStore} from '@vico/memory';
import type {Next} from '@vico/utils';

/** 语义召回最小相似度 — 低于该值的记忆视为不相关，不注入上下文 */
const RECALL_MIN_SCORE = 0.5;

/** 注入会话历史、语义记忆和情景召回结果；核心跑完后落库情景记忆（HIGH 优先级） */
export class MemoryProcessor implements ContextProcessor {
  readonly name = 'memory';
  readonly priority = Priority.HIGH;

  constructor(private readonly memoryStore: MemoryStore) {}

  async handle(ctx: ModelRequestContext, next: Next): Promise<void> {
    await this.injectConversationHistory(ctx);
    await this.injectSemanticMemory(ctx);
    await this.injectEpisodicRecall(ctx);

    await next();

    // 暂停等待审批时本轮尚未完结（completed=false），跳过情景记忆落库
    if (!ctx.completed) return;

    // 情景记忆是非关键路径：落库失败只告警，不阻塞 turn 完结
    await this.storeEpisodic(ctx);
  }

  /**
   * 核心循环结束后将本轮用户消息原文向量化存入情景记忆。
   * 情景记忆只做「向量化 + 语义检索」，不做事实提取。
   *
   * @param ctx - 模型请求上下文
   */
  private async storeEpisodic(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.episodic) return;
    const now = Date.now();
    const threadId = ctx.threadId || undefined;
    const scopeId = ctx.scopeId || undefined;

    for (const msg of ctx.userMessages) {
      if (msg.role !== 'user') continue;
      const content = getMessageText(msg).trim();
      if (!content) continue;

      await this.memoryStore.episodic.create({
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
   * 注入语义记忆模板 + 当前数据，引导 LLM 自主更新。
   *
   * @param ctx - 模型请求上下文
   */
  private async injectSemanticMemory(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.semantic || !ctx.scopeId) return;
    const sm = this.memoryStore.semantic;
    const template = sm.getTemplate();
    const current = await sm.get(ctx.scopeId);

    const dataBlock = current || template;

    ctx.systemPrompt.registerSection(
      'semantic-memory',
      `Use the update_semantic_memory tool to store user information. If the information might be referenced again — store it!\n\n` +
      `Guidelines:\n` +
      `1. Proactively update when you learn new information about the user\n` +
      `2. Replace only the changed parts and keep the rest unchanged\n` +
      `3. Use the Markdown format below — never output the template text directly, always update through the tool\n\n` +
      `Current semantic memory:\n\`\`\`markdown\n${dataBlock}\n\`\`\``);
  }

  /**
   * 情景召回长期记忆。
   *
   * @param ctx - 模型请求上下文
   */
  private async injectEpisodicRecall(ctx: ModelRequestContext): Promise<void> {
    if (!this.memoryStore.episodic) return;
    const query = ctx.getLastUserMessage();
    if (!query) return;

    const items = await this.memoryStore.episodic.search(query, 5, ctx.scopeId);
    // 按相似度阈值过滤，避免低相关记忆污染上下文
    const relevant = items.filter((m) => m.score >= RECALL_MIN_SCORE);
    if (relevant.length === 0) return;

    const memText = relevant.map((m) => `- ${m.content}`).join('\n');
    ctx.systemPrompt.registerSection('episodic-recall', `Relevant memories:\n${memText}`);
  }
}
