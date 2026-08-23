// @vico/core - MemoryProcessor: injects conversation history, working memory, and semantic recall
import {randomUUID} from 'node:crypto';
import type {ContextProcessor} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import {Priority} from './context-processor.js';
import { getMessageText } from '../../model/message-utils.js';
import type {MemoryStore} from '../../memory/memory-store.js';
import type {MemoryRecord} from '../../memory/types.js';

/** 事实匹配模式 — 聚焦用户属性陈述（“我”开头或含属性词），避免泛化 be/have 动词误报 */
const FACT_PATTERNS = /(我(?:叫|是|住|在|喜欢|偏好|做|从事)|职业|工作|职位|电话|邮箱|地址|生日|年龄|姓名|名字|(?:my|i'?m|i)\b|occupation|role|job|email|phone|address|location|prefer|like)/i;

/** 语义召回最小相似度 — 低于该值的记忆视为不相关，不注入上下文 */
const RECALL_MIN_SCORE = 0.5;

/** 注入会话历史、工作记忆和语义召回结果（NORMAL 优先级） */
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

    const items = await this.memoryStore.semantic.search(query, 5, ctx.scopeId);
    // 按相似度阈值过滤，避免低相关记忆污染上下文
    const relevant = items.filter((m) => m.score >= RECALL_MIN_SCORE);
    if (relevant.length === 0) return;

    const memText = relevant.map((m) => `- ${m.content}`).join('\n');
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
    const scopeId = ctx.scopeId || undefined;
    const facts: MemoryRecord[] = [];

    // 仅扫本轮用户消息 — 用户陈述是事实源头，且避免跨轮重复提取历史
    for (const msg of ctx.userMessages) {
      if (msg.role !== 'user') continue;
      const text = getMessageText(msg);
      if (!text || text.length < 4) continue;

      // 按中英文标点拆分句子
      const sentences = text.split(/[。！？!?.\n]+/).map((s) => s.trim()).filter(Boolean);
      for (const sentence of sentences) {
        if (sentence.length < 4) continue; // 过滤过短片段（“嗯”“好”等）
        if (!FACT_PATTERNS.test(sentence)) continue;

        facts.push({
          id: randomUUID(),
          threadId,
          scopeId,
          content: sentence,
          metadata: { source: 'resolve' },
          createdAt: now,
        });
      }
    }

    return facts;
  }
}
