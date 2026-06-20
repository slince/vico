// @vico/agent - Default ContextProcessor implementations
import type { ContextProcessor, ModelRequestContext } from './context-processor.js';
import { Priority } from './context-processor.js';
import type { SkillCatalogEntry, RagChunk } from './types.js';
import type { MemoryStore } from '../memory/types.js';
import type { ModelMessage } from '../model/types.js';

/** 提取最后一条用户消息内容作为检索查询 */
function extractLastUserMessage(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

/** 注入 agent 基础系统提示词（HIGH 优先级） */
export class SystemPromptProcessor implements ContextProcessor {
  readonly name = 'system-prompt';
  readonly priority = Priority.HIGH;

  async process(ctx: ModelRequestContext): Promise<void> {
    ctx.systemPrompt = ctx.agent.systemPrompt;
  }
}

/** 追加 Skill 目录到系统提示词（HIGH 优先级） */
export class SkillCatalogProcessor implements ContextProcessor {
  readonly name = 'skill-catalog';
  readonly priority = Priority.HIGH;

  constructor(private readonly catalog: SkillCatalogEntry[]) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    if (this.catalog.length === 0) return;
    const skillList = this.catalog
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');
    ctx.systemPrompt += `\n\n<available_skills>\n${skillList}\n</available_skills>`;
  }
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

/** 检索 RAG 知识库并追加为 system 消息（NORMAL 优先级） */
export class RagProcessor implements ContextProcessor {
  readonly name = 'rag';
  readonly priority = Priority.NORMAL;

  constructor(
    private readonly ragProvider: {
      search(query: string, kbId: string, limit?: number): Promise<RagChunk[]>;
    },
  ) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    const query = extractLastUserMessage(ctx.messages);
    if (!query) return;

    const results = await this.ragProvider.search(query, '', 5);
    if (results.length === 0) return;

    const ragText = results.map((r) => `[${r.source}] ${r.content}`).join('\n');
    ctx.messages.push({ role: 'system', content: `Relevant knowledge:\n${ragText}` });
  }
}

/** 追加动态指令为 system 消息（LOW 优先级） */
export class DynamicInstructionProcessor implements ContextProcessor {
  readonly name = 'dynamic-instructions';
  readonly priority = Priority.LOW;

  constructor(private readonly getInstructions: () => string[]) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    const instructions = this.getInstructions();
    if (instructions.length === 0) return;

    ctx.messages.push({ role: 'system', content: instructions.join('\n') });
  }
}
