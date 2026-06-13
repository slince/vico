// Bridge 3: Vico RAG 知识库检索 → Mastra Tool
// Phase 1 策略：将 Vico 知识库检索封装为 search_knowledge_base tool
// Phase 3 时替换为 Mastra SemanticRecall 原生检索

import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../db/db.js';
import { ragManager } from '../../../memory/rag.js';
import { config } from '../../../config.js';

const { agent_knowledge_bases } = schema;

/**
 * 创建 RAG 检索 Tool，Agent 可主动调用 search_knowledge_base。
 * 若 Agent 未绑定任何知识库，返回 null（不注册该 tool）。
 */
export function createRagTool(agentId: string) {
  const db = getDb();
  const bindings = db.select({ kb_id: agent_knowledge_bases.kb_id })
    .from(agent_knowledge_bases)
    .where(eq(agent_knowledge_bases.agent_id, agentId))
    .all();

  if (bindings.length === 0) return null;

  const kbIds = bindings.map((b) => b.kb_id);

  return {
    id: 'search_knowledge_base',
    description: '搜索知识库获取相关信息。当需要查询特定领域的专业知识时使用此工具。',
    inputSchema: z.object({
      query: z.string().describe('要搜索的问题或关键词'),
    }),
    execute: async ({ context }: { context: any }) => {
      const query = context?.args?.query || context?.query || '';
      const chunks = await ragManager.hybridSearch(query, kbIds, config.rag.retrieval_top_k);
      if (chunks.length === 0) return { results: [], message: '未找到相关知识' };
      return {
        results: chunks.map((c) => ({ content: c.content })),
        message: `找到 ${chunks.length} 条相关知识`,
      };
    },
  };
}

/**
 * 获取 Agent 绑定的 RAG 知识库上下文文本，直接注入 system prompt。
 * 保留原 pipeline.ts 的行为。
 */
export async function getRagContext(agentId: string, message: string): Promise<string> {
  const db = getDb();
  const bindings = db.select({ kb_id: agent_knowledge_bases.kb_id })
    .from(agent_knowledge_bases)
    .where(eq(agent_knowledge_bases.agent_id, agentId))
    .all();

  if (bindings.length === 0) return '';

  const kbIds = bindings.map((b) => b.kb_id);
  const chunks = await ragManager.hybridSearch(message, kbIds, config.rag.retrieval_top_k);

  if (chunks.length === 0) return '';
  return '\n\n## 相关知识库内容\n' + chunks.map((c) => c.content).join('\n\n');
}
