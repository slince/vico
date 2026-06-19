/**
 * RAG 知识库检索工具
 * 基于向量语义搜索，可选启用查询改写 + 重排序。
 */
import { tool } from 'ai';
import { z } from 'zod';
import { getVector, getMemory } from '../memory-setup.js';
import { kbIndexName } from '../../lib/resource.js';
import { DEFAULT_RAG_CONFIG } from '../../config.js';
import type { AgentDetail } from '../../services/agent/types.js';

/**
 * 为指定 Agent 创建 RAG 知识库检索工具。
 *
 * 取代原有的 @mastra/rag createVectorQueryTool，
 * 改用 ai 包的 tool() 构建自定义工具，支持：
 * - Query Rewrite：改写用户问题提升召回率
 * - Rerank：Cross-Encoder 二次打分重排序
 * - 灵活的无匹配策略（free_answer / fallback / reject）
 *
 * @param agent - Agent 详情（含 kb_id、model_id 等）
 * @returns tool 实例，或 null（当 agent 无 kb_id 或 embedder 不可用时）
 */
export async function createRagSearchTool(agent: AgentDetail): Promise<any> {
  const kbId = agent.kb_id;
  if (!kbId) return null;

  const memory = await getMemory();
  if (!memory.embedder) return null;

  const cfg = DEFAULT_RAG_CONFIG;
  const vector = getVector();
  const indexName = kbIndexName(kbId);

  return tool({
    id: 'search_knowledge_base',
    description:
      '搜索知识库获取相关文档内容。返回结果包含来源标记 [source: 文件名#chunk序号]。\n使用规则：\n1. 每条基于知识库的结论必须引用对应的 [source: ...] 标记\n2. 如果检索无结果或结果不相关，明确告知用户"未找到相关知识"\n3. 不要编造检索结果中不存在的信息',
    inputSchema: z.object({
      query: z.string().describe('搜索查询内容'),
    }),
    execute: async ({ query }: { query: string }) => {
      // Query Rewrite
      let queries = [query];
      if (cfg.query_rewrite.enabled) {
        try {
          const { rewriteQuery } = await import('../../memory/query-rewrite.js');
          queries = await rewriteQuery(query);
        } catch { /* 未安装依赖或模块不存在时静默降级 */ }
      }

      // 对每个 rewrite 执行向量搜索，合并结果
      const allResults: any[] = [];
      for (const q of queries) {
        try {
          const { embeddings } = await memory.embedder!.doEmbed({ values: [q] });
          const results = await vector.query({
            indexName, queryVector: embeddings[0],
            topK: cfg.retrieval.top_k * 3,
          });
          allResults.push(...results.filter((r: any) =>
            (r.score ?? r.similarity ?? 0) >= cfg.retrieval.similarity_threshold));
        } catch { /* 单次查询失败不影响其他改写查询 */ }
      }

      if (allResults.length === 0) {
        if (cfg.no_match.strategy === 'fallback') {
          return { results: [], message: cfg.no_match.fallback_message };
        }
        if (cfg.no_match.strategy === 'reject') {
          return { results: [], message: '未找到相关知识，请根据已有信息如实告知用户。' };
        }
        return { results: [], message: '未找到相关文档片段。' };
      }

      // 去重 + 按相似度排序
      const seen = new Set<string>();
      let results = allResults
        .filter((r: any) => {
          const id = r.id || r.vectorId;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((r: any) => ({
          id: r.id || r.vectorId,
          content: r.metadata?.content || '',
          metadata: r.metadata || {},
          score: r.score ?? r.similarity ?? 0,
        }))
        .sort((a: any, b: any) => b.score - a.score);

      // Rerank
      if (cfg.rerank.enabled && results.length > 1) {
        try {
          const { rerank } = await import('../../memory/reranker.js');
          results = await rerank(query, results, cfg.rerank.model);
        } catch { /* rerank 失败静默降级 */ }
      }

      results = results.slice(0, cfg.retrieval.top_k);

      // 格式化结果，带引用标记
      const formatted = results.map((r: any, i: number) => {
        const filename = r.metadata?.filename || 'unknown';
        const chunkIdx = r.metadata?.chunk_index ?? i;
        return `[source: ${filename}#chunk${chunkIdx}] ${r.content}`;
      });

      return { results: formatted, total: results.length, query };
    },
  } as any); // type assertion: ai SDK tool() type doesn't include `id` for function tools at compile-time, but it is accepted at runtime
}
