// @vico/agent - RAG module type definitions

/** RAG 检索结果 */
export interface RagChunk {
  content: string;
  score: number;
  source: string;
}

/** RAG 知识库检索端口 */
export interface RagProvider {
  search(query: string, knowledgeBaseId: string, limit?: number): Promise<RagChunk[]>;
}
