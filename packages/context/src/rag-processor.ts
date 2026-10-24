// @vico/context - RagProcessor: retrieves RAG knowledge and appends to system prompt
import type {ContextProcessor} from './context-processor.js';
import {Priority} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import type {RagProvider} from '@vico/rag';
import type {Next} from '@vico/utils';

/** 检索 RAG 知识库并追加到系统提示词（HIGH + 50 优先级，介于 HIGH 与 NORMAL 之间） */
export class RagProcessor implements ContextProcessor {
  readonly name = 'rag';
  readonly priority = Priority.HIGH + 50;

  constructor(private readonly ragProvider: RagProvider) {}

  async handle(ctx: ModelRequestContext, next: Next): Promise<void> {
    const query = ctx.getLastUserMessage();

    if (query) {
      const results = await this.ragProvider.search(query, '', 5);

      if (results.length > 0) {
        const ragText = results.map((r) => `[${r.source}] ${r.content}`).join('\n');
        ctx.appendSystemPrompt(`相关知识：\n${ragText}`);
      }
    }

    await next();
  }
}
