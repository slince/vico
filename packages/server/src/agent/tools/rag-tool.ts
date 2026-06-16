/**
 * RAG 知识库检索工具
 * 使用 @mastra/rag createVectorQueryTool 进行向量语义搜索。
 * Agent 绑定单一知识库，工具直接指向 kb_${kbId} 索引。
 */
import { createVectorQueryTool } from '@mastra/rag';
import { getVector, getMemory } from '../memory-setup.js';
import { kbIndexName } from '../../lib/resource.js';
import type { AgentDetail } from '../../services/agent/types.js';

/**
 * 为指定 Agent 创建 RAG 知识库检索工具。
 *
 * Agent 只绑定一个 KB（kb_id），若无绑定或 embedder 不可用则返回 null。
 *
 * @param agent - Agent 详情
 * @returns vectorQueryTool 实例，或 null
 */
export async function createRagSearchTool(agent: AgentDetail): Promise<any> {
  const kbId = agent.kb_id;
  if (!kbId) return null;

  const memory = await getMemory();
  if (!memory.embedder) return null;

  return createVectorQueryTool({
    id: 'search_knowledge_base',
    description:
      '搜索知识库获取相关文档内容。当需要查找特定信息、参考文档或获取领域知识时使用。',
    vectorStore: getVector(),
    indexName: kbIndexName(kbId),
    model: memory.embedder,
  });
}
