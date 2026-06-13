/**
 * RAG 知识库检索工具
 * 包装为 Mastra Tool，使用 LibSQLVector 进行语义搜索
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb, schema } from '../../db/db.js';
import { getVector, getMemory } from '../memory-setup.js';
import { config } from '../../config.js';

const { agent_knowledge_bases, agents } = schema;

/**
 * 为指定 Agent 创建 RAG 知识库检索工具。
 *
 * 查询 agent_knowledge_bases 表（JOIN agents 按 tenant_id 过滤）获取 Agent 绑定的知识库列表，
 * 使用 Mastra Memory embedder 将查询文本向量化，
 * 然后通过 LibSQLVector 在各知识库索引中进行语义搜索，
 * 返回拼接后的结果文本。
 *
 * 若 Agent 未绑定任何知识库，返回 null。
 * 若 embedder 未配置，execute 返回错误提示文本。
 *
 * @param agentId - Agent ID
 * @param tenantId - 租户 ID，用于多租户数据隔离
 * @returns Mastra Tool 实例，或 null（无绑定知识库时）
 */
export async function createRagSearchTool(agentId: string, tenantId: string) {
  const db = getDb();
  const kbBindings = await db
    .select({ kb_id: agent_knowledge_bases.kb_id })
    .from(agent_knowledge_bases)
    .innerJoin(agents, eq(agent_knowledge_bases.agent_id, agents.id))
    .where(and(
      eq(agent_knowledge_bases.agent_id, agentId),
      eq(agents.tenant_id, tenantId),
    ));

  if (kbBindings.length === 0) return null;

  const kbIds = kbBindings.map((b) => b.kb_id);

  return createTool({
    id: 'search_knowledge_base',
    description:
      '搜索知识库获取相关文档内容。当需要查找特定信息、参考文档或获取领域知识时使用。',
    inputSchema: z.object({
      query: z.string().describe('在知识库中搜索的查询字符串'),
    }),
    execute: async ({ query }) => {
      if (!query || !query.trim()) return '未提供搜索查询';

      const memory = getMemory();
      if (!memory.embedder) return '嵌入模型未配置';

      const vector = getVector();
      try {
        // 使用 Mastra Memory 的 embedder 将查询文本向量化
        const embedResult = await memory.embedder.doEmbed({ values: [query.trim()] });
        const queryEmbedding = embedResult.embeddings[0];

        const results: string[] = [];
        for (const kbId of kbIds) {
          const indexName = `kb_${kbId}`;
          try {
            const searchResults = await vector.query({
              indexName,
              queryVector: queryEmbedding,
              topK: config.rag.retrieval_top_k,
            });
            for (const r of searchResults) {
              // content 存储在 metadata 中
              if (r.metadata?.content && typeof r.metadata.content === 'string') {
                results.push(r.metadata.content);
              }
            }
          } catch {
            // 索引可能尚未创建，静默跳过
            continue;
          }
        }

        if (results.length === 0) return '未找到相关知识库内容';
        return results.join('\n\n---\n\n');
      } catch (err: any) {
        return `知识库搜索失败: ${err.message}`;
      }
    },
  });
}
