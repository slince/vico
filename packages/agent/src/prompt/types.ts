// @vico/agent - Prompt module type definitions
import type { AgentConfig } from '../contracts/agent.js';
import type { ModelRequest, ModelMessage } from '../model/types.js';
import type { ToolSpec } from '../contracts/tool.js';
import type { MemoryRecord } from '../contracts/memory.js';

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

/** Prompt 拼装上下文 */
export interface PromptContext {
  agent: AgentConfig;
  skillCatalog: SkillCatalogEntry[];
  memoryItems: MemoryRecord[];
  ragResults: RagChunk[];
  history: ModelMessage[];
  tools: ToolSpec[];
  dynamicInstructions: string[];
}

