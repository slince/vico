// @vico/agent - RagProcessor: retrieves RAG knowledge and appends as system message
import type { ContextProcessor, ModelRequestContext } from './context-processor.js';
import { Priority } from './context-processor.js';
import type { RagProvider } from '../../rag/types.js';

/** 检索 RAG 知识库并追加为 system 消息（NORMAL 优先级） */
export class RagProcessor implements ContextProcessor {
  readonly name = 'rag';
  readonly priority = Priority.NORMAL;

  constructor(private readonly ragProvider: RagProvider) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    const query = ctx.getLastUserMessage();
    if (!query) return;

    const results = await this.ragProvider.search(query, '', 5);
    if (results.length === 0) return;

    const ragText = results.map((r) => `[${r.source}] ${r.content}`).join('\n');
    ctx.messages.push({ role: 'system', content: `相关知识：\n${ragText}` });
  }
}
