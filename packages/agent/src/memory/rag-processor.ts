// @vico/agent - RagProcessor: retrieves RAG knowledge and appends as system message
import type { ContextProcessor, ModelRequestContext } from '../prompt/context-processor.js';
import { Priority } from '../prompt/context-processor.js';
import type { RagChunk } from './types.js';
import type { ModelMessage } from '../model/types.js';

/** 提取最后一条用户消息内容作为检索查询 */
function extractLastUserMessage(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
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
