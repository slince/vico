// @vico/agent - Prompt module type definitions

/** Skill 目录项（元数据，非完整指令） */
export interface SkillCatalogEntry {
  name: string;
  description: string;
  location: string;
}

/** RAG 检索结果 */
export interface RagChunk {
  content: string;
  score: number;
  source: string;
}

