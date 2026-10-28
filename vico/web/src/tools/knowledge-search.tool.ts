/**
 * 知识库检索工具定义。
 *
 * 对应 packages/rag/src/tool/rag-tool.ts，
 * 参数 schema 与服务端 RagToolExecuteParams 保持一致。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {Search} from 'lucide-react';
import {KnowledgeSearchToolRenderer} from './ToolUIs/knowledge-search-ui';
import type {ToolRunActivitySummary} from './tool-summary';

const knowledgeSearchSchema = z.object({
  query: z.string().describe('搜索查询内容'),
});

const knowledgeSearchOutputSchema = z.object({
  results: z.array(z.string()),
  total: z.number(),
  query: z.string(),
  message: z.string().optional(),
});

export type KnowledgeSearchArgs = z.infer<typeof knowledgeSearchSchema>;
export type KnowledgeSearchResult = z.infer<typeof knowledgeSearchOutputSchema>;

/**
 * search_knowledge_base 的 RunActivity 摘要 — 关键参数是搜索查询。
 */
export function summarizeKnowledgeSearch(args: KnowledgeSearchArgs): ToolRunActivitySummary {
  return {
    icon: Search,
    description: args.query,
  };
}

export const knowledgeSearchTool: ToolkitDefinitionEntry<KnowledgeSearchArgs, KnowledgeSearchResult> = {
  description:
    '搜索知识库获取相关文档内容。返回结果包含来源标记 [source: 文件名#chunk序号]。',
  parameters: knowledgeSearchSchema,
  render: KnowledgeSearchToolRenderer,
  display: 'standalone' as const,
};
