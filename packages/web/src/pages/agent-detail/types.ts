/** Skill 数据形状 */
export interface Skill {
  name: string;
  displayName: string;
  description: string;
}

/** 知识库数据形状 */
export interface KnowledgeBase {
  id: string;
  name: string;
  chunk_count: number;
}

/** 模型配置数据形状 */
export interface Model {
  id: string;
  provider: string;
  model_name: string;
}

/** Agent 完整数据形状 */
export interface Agent {
  id: string;
  name: string;
  enabled: boolean;
  is_default?: number;
  system_prompt?: string;
  model_id?: string;
  temperature?: number;
  max_tokens?: number;
  rag_mode?: string;
  skills?: { skill_name: string }[];
  kb_id?: string | null;
}
