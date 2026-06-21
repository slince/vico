// @vico/rag — Standard RAG search tool for AI agents
//
// 提供 search_knowledge_base 工具定义，Agent 可直接调用检索知识库。
// 兼容 ai SDK tool() 格式。

import { DEFAULT_RAG_CONFIG } from '../types/config.js';
import type { DefaultRetrievalPipeline } from '../retrieval/pipeline.js';
import { formatResults } from '../retrieval/formatter.js';

export interface RagToolOptions {
  pipeline: DefaultRetrievalPipeline;
  indexName: string;
  /** 无匹配结果策略（覆盖全局配置） */
  noMatchStrategy?: 'free_answer' | 'fallback' | 'reject';
  /** 无匹配时的兜底消息 */
  fallbackMessage?: string;
}

/** RAG 工具执行上下文 */
export interface RagToolExecuteParams {
  query: string;
}

/** RAG 工具执行结果 */
export interface RagToolResult {
  results: string[];
  total: number;
  query: string;
  message?: string;
}

/**
 * 创建 RAG 检索工具（返回 tool 定义对象）。
 *
 * @example
 * ```ts
 * const searchTool = createSearchTool({ pipeline, indexName: 'kb_abc123' });
 * // 注册到 Agent
 * ```
 */
export function createSearchTool(options: RagToolOptions) {
  const { pipeline, indexName } = options;

  return {
    name: 'search_knowledge_base',
    description:
      '搜索知识库获取相关文档内容。返回结果包含来源标记 [source: 文件名#chunk序号]。\n使用规则：\n1. 每条基于知识库的结论必须引用对应的 [source: ...] 标记\n2. 如果检索无结果或结果不相关，明确告知用户"未找到相关知识"\n3. 不要编造检索结果中不存在的信息',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询内容' },
      },
      required: ['query'],
    },
    async execute({ query }: RagToolExecuteParams): Promise<RagToolResult> {
      const results = await pipeline.search({
        query,
        indexName,
      });

      if (results.length === 0) {
        const strategy = options.noMatchStrategy ?? DEFAULT_RAG_CONFIG.noMatch.strategy;
        if (strategy === 'fallback') {
          return {
            results: [],
            total: 0,
            query,
            message: options.fallbackMessage ?? DEFAULT_RAG_CONFIG.noMatch.fallbackMessage ?? '未找到相关文档片段。',
          };
        }
        if (strategy === 'reject') {
          return {
            results: [],
            total: 0,
            query,
            message: '未找到相关知识，请根据已有信息如实告知用户。',
          };
        }
        return { results: [], total: 0, query, message: '未找到相关文档片段。' };
      }

      const formatted = formatResults(results);
      return { results: formatted, total: results.length, query };
    },
  };
}
